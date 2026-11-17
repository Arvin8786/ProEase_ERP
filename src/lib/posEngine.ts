import { 
  collection, 
  addDoc, 
  doc, 
  runTransaction, 
  Timestamp, 
  getDocs, 
  query, 
  where 
} from 'firebase/firestore';
import { db, cleanFirestoreData } from './firebase';
import { 
  SalesTransaction, 
  SalesTransactionItem, 
  InventoryItem, 
  PromotionalRule, 
  PosEodReconciliation, 
  UserProfile 
} from '../types';
import { generateSapMovementNumber } from './sapMovements';
import { isItemPromotionActive } from './pricingUtils';

const OFFLINE_QUEUE_KEY = 'proease_pos_offline_queue_v1';

export interface QueuedTransaction {
  id: string;
  transaction: SalesTransaction;
  queuedAt: string;
  retryCount: number;
}

/**
 * Saves a transaction to local storage offline queue
 */
export function enqueueOfflineTransaction(transaction: SalesTransaction): void {
  try {
    const queue = getOfflineQueue();
    const queuedItem: QueuedTransaction = {
      id: transaction.id || `TX-OFFLINE-${Date.now()}`,
      transaction,
      queuedAt: new Date().toISOString(),
      retryCount: 0
    };
    queue.push(queuedItem);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log(`[POS Offline Queue] Enqueued transaction ${queuedItem.id}. Total queue length: ${queue.length}`);
  } catch (err) {
    console.error('[POS Offline Queue] Failed to enqueue transaction:', err);
  }
}

/**
 * Retrieves the offline transaction queue
 */
export function getOfflineQueue(): QueuedTransaction[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clears or updates the offline queue
 */
export function setOfflineQueue(queue: QueuedTransaction[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('[POS Offline Queue] Failed to update offline queue storage:', err);
  }
}

/**
 * Flushes all queued transactions back to Firestore once connection is restored
 */
export async function flushOfflineQueue(): Promise<{ syncedCount: number; failedCount: number }> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return { syncedCount: 0, failedCount: 0 };

  console.log(`[POS Offline Queue] Attempting to flush ${queue.length} transactions to Firestore...`);
  const remainingQueue: QueuedTransaction[] = [];
  let syncedCount = 0;
  let failedCount = 0;

  for (const item of queue) {
    try {
      await processPosCheckoutTransaction(item.transaction);
      syncedCount++;
      console.log(`[POS Offline Queue] Successfully synced transaction ${item.id}`);
    } catch (err) {
      console.error(`[POS Offline Queue] Error syncing transaction ${item.id}:`, err);
      failedCount++;
      item.retryCount = (item.retryCount || 0) + 1;
      remainingQueue.push(item);
    }
  }

  setOfflineQueue(remainingQueue);
  return { syncedCount, failedCount };
}

/**
 * Processes a POS checkout transaction:
 * 1. Writes salesTransactions record
 * 2. Writes SAP 907 stock movements
 * 3. Atomically deducts inventory stock
 */
export async function processPosCheckoutTransaction(transaction: SalesTransaction): Promise<string> {
  let finalTxId = transaction.id;

  await runTransaction(db, async (txn) => {
    // 1. Verify and deduct stock for each item
    for (const lineItem of transaction.items) {
      const itemRef = doc(db, 'items', lineItem.itemId);
      const itemSnap = await txn.get(itemRef);

      if (itemSnap.exists()) {
        const itemData = itemSnap.data() as InventoryItem;
        const currentStock = Number(itemData.currentStock) || 0;
        const newStock = Math.max(0, currentStock - lineItem.quantity);

        txn.update(itemRef, {
          currentStock: newStock,
          lastUpdated: Timestamp.now()
        });

        // Record SAP Movement 907 (Sales to Customer / Employee)
        const movementRef = doc(collection(db, 'stockMovements'));
        txn.set(movementRef, cleanFirestoreData({
          documentNumber: generateSapMovementNumber(),
          movementCode: '907',
          movementDescription: 'Sales to Employee / POS Checkout',
          itemId: lineItem.itemId,
          sku: lineItem.barcode || itemData.sku || 'SKU-POS',
          materialName: (lineItem as any).itemName || lineItem.name,
          quantity: lineItem.quantity,
          unit: itemData.unit || 'PCS',
          cost_price: itemData.cost_price ?? itemData.unitPrice ?? 0,
          selling_price: lineItem.unitPrice,
          totalValue: (lineItem as any).subtotal || lineItem.total || (lineItem.unitPrice * lineItem.quantity),
          sourceLocation: 'Store Shelf / POS Counter',
          targetLocation: 'Customer / POS Sale',
          executedBy: transaction.cashierName || 'Cashier',
          executedById: transaction.cashierId || 'CASHIER-01',
          status: 'completed',
          timestamp: Timestamp.now()
        }));
      }
    }

    // 2. Insert sales transaction
    const salesTxRef = doc(collection(db, 'salesTransactions'));
    finalTxId = salesTxRef.id;

    txn.set(salesTxRef, cleanFirestoreData({
      ...transaction,
      id: salesTxRef.id,
      timestamp: Timestamp.now(),
      status: 'completed'
    }));
  });

  return finalTxId;
}

/**
 * Dynamic Promotional Pricing Engine:
 * Evaluates active promotions (Date ranges, BOGO, Employee Discount, Category Markdown).
 * If item has a promo price within its promotion period, base price shows and charges as promo,
 * and automatically ends on the promo end date.
 */
export function evaluateItemPricing(
  item: InventoryItem,
  quantity: number,
  isEmployee: boolean,
  activePromotions: PromotionalRule[] = []
): {
  originalPrice: number;
  discountedUnitPrice: number;
  subtotal: number;
  discountAmount: number;
  appliedPromoName?: string;
} {
  const now = new Date();
  const standardSellingPrice = item.selling_price ?? (item as any).sellingPrice ?? item.unitPrice ?? 0;
  const isPromo = isItemPromotionActive(item, now);
  const baseSellingPrice = isPromo
    ? Number(item.promotion_price ?? (item as any).promotionalPrice)
    : standardSellingPrice;
  let finalUnitPrice = baseSellingPrice;
  let appliedPromoName: string | undefined = isPromo ? 'Promotional Price' : undefined;

  const todayStr = now.toISOString().split('T')[0];

  // Check scheduled promotional rules
  for (const promo of activePromotions) {
    if (!promo.isActive) continue;
    if (promo.startDate && todayStr < promo.startDate) continue;
    if (promo.endDate && todayStr > promo.endDate) continue;

    const matchesSku = promo.targetSkus && promo.targetSkus.includes(item.sku);
    const matchesCategory = promo.targetCategories && promo.targetCategories.includes(item.category);

    if (!matchesSku && !matchesCategory && promo.type !== 'employee_discount') {
      continue;
    }

    if (promo.type === 'bogo' && quantity >= 2) {
      // Buy One Get One Free: every 2nd unit is 50% discount effective
      const payableUnits = Math.ceil(quantity / 2);
      const effectiveTotal = payableUnits * baseSellingPrice;
      finalUnitPrice = effectiveTotal / quantity;
      appliedPromoName = `BOGO (Buy 1 Get 1 Free)`;
      break;
    } else if (promo.type === 'category_markdown' && promo.discountPercent) {
      finalUnitPrice = baseSellingPrice * (1 - promo.discountPercent / 100);
      appliedPromoName = `${promo.name} (-${promo.discountPercent}%)`;
      break;
    } else if (promo.type === 'fixed_override' && promo.discountPercent) {
      finalUnitPrice = baseSellingPrice * (1 - promo.discountPercent / 100);
      appliedPromoName = promo.name;
      break;
    }
  }

  // Employee Discount Override (if staff member purchasing)
  if (isEmployee) {
    const employeeDiscountRate = 0.15; // 15% staff discount standard
    const staffPrice = baseSellingPrice * (1 - employeeDiscountRate);
    if (staffPrice < finalUnitPrice) {
      finalUnitPrice = staffPrice;
      appliedPromoName = 'Employee Benefit Discount (15%)';
    }
  }

  const subtotal = Math.round(finalUnitPrice * quantity * 100) / 100;
  const originalSubtotal = Math.round(baseSellingPrice * quantity * 100) / 100;
  const discountAmount = Math.max(0, originalSubtotal - subtotal);

  return {
    originalPrice: baseSellingPrice,
    discountedUnitPrice: finalUnitPrice,
    subtotal,
    discountAmount,
    appliedPromoName
  };
}

/**
 * Backwards compatibility alias for evaluateItemPricing
 */
export const calculateItemPrice = evaluateItemPricing;

/**
 * Calculates End-of-Day (EOD) Reconciliation Variances
 */
export function calculateEodReconciliation(params: {
  physicalCash: number;
  physicalCreditCards: number;
  physicalDebitCards: number;
  physicalQr: number;
  systemSales: {
    cash: number;
    creditCard: number;
    debitCard: number;
    qr: number;
    total: number;
    count: number;
  };
}) {
  const { physicalCash, physicalCreditCards, physicalDebitCards, physicalQr, systemSales } = params;

  const totalPhysicalCards = physicalCreditCards + physicalDebitCards;
  const totalSystemCards = systemSales.creditCard + systemSales.debitCard;

  const cashVariance = Math.round((physicalCash - systemSales.cash) * 100) / 100;
  const cardVariance = Math.round((totalPhysicalCards - totalSystemCards) * 100) / 100;
  const qrVariance = Math.round((physicalQr - systemSales.qr) * 100) / 100;
  const totalVariance = Math.round((cashVariance + cardVariance + qrVariance) * 100) / 100;

  const hasDiscrepancy = Math.abs(totalVariance) > 0.05;

  return {
    physicalCash,
    physicalCards: totalPhysicalCards,
    physicalQr,
    totalPhysical: physicalCash + totalPhysicalCards + physicalQr,
    systemSales,
    cashVariance,
    cardVariance,
    qrVariance,
    totalVariance,
    hasDiscrepancy,
    flagged: Math.abs(totalVariance) >= 10 // Flag for manager if variance exceeds $10
  };
}
