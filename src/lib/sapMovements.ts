import { 
  collection, 
  doc, 
  runTransaction, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  Timestamp 
} from 'firebase/firestore';
import { db, cleanFirestoreData } from './firebase';
import { 
  SapMovementCode, 
  StockMovementRecord, 
  InventoryItem, 
  UserProfile, 
  PurchaseRequest 
} from '../types';

export const SAP_MOVEMENT_DEFINITIONS: Record<SapMovementCode, {
  code: SapMovementCode;
  label: string;
  category: 'Receipt' | 'Issuance' | 'WriteOff' | 'Sales' | 'Transfer';
  direction: 'IN' | 'OUT';
  reversalCode: SapMovementCode;
  description: string;
  requiresReason: boolean;
  requiresApproval?: boolean;
}> = {
  '101': {
    code: '101',
    label: 'Goods Receiving',
    category: 'Receipt',
    direction: 'IN',
    reversalCode: '102',
    description: 'Receipt of ordered materials from vendor into warehouse storage',
    requiresReason: false
  },
  '102': {
    code: '102',
    label: 'Cancel Goods Receiving / Vendor Return',
    category: 'Receipt',
    direction: 'OUT',
    reversalCode: '101',
    description: 'Reverse goods receipt or return defective shipment back to vendor',
    requiresReason: true
  },
  '973': {
    code: '973',
    label: 'Wastage / Scrap Write-Off',
    category: 'WriteOff',
    direction: 'OUT',
    reversalCode: '974',
    description: 'Manual stock reduction due to spoilage, breakage, or expired goods',
    requiresReason: true,
    requiresApproval: true
  },
  '974': {
    code: '974',
    label: 'Reverse Wastage Write-Off',
    category: 'WriteOff',
    direction: 'IN',
    reversalCode: '973',
    description: 'Correction / reversal of an erroneous wastage write-off entry',
    requiresReason: true
  },
  '905': {
    code: '905',
    label: 'Goods Issue to Employee',
    category: 'Issuance',
    direction: 'OUT',
    reversalCode: '906',
    description: 'Issuance of assets, tools, uniforms, or consumables to specific staff member',
    requiresReason: false,
    requiresApproval: true
  },
  '906': {
    code: '906',
    label: 'Cancel Employee Goods Issue',
    category: 'Issuance',
    direction: 'IN',
    reversalCode: '905',
    description: 'Return of issued tools or assets by an employee back into company stores',
    requiresReason: true
  },
  '907': {
    code: '907',
    label: 'Sales to Employee / POS Checkout',
    category: 'Sales',
    direction: 'OUT',
    reversalCode: '908',
    description: 'Point-of-sale customer checkout or staff purchase transaction',
    requiresReason: false
  },
  '908': {
    code: '908',
    label: 'Cancel Sales / Customer Return',
    category: 'Sales',
    direction: 'IN',
    reversalCode: '907',
    description: 'Customer return or POS sales reversal refunding stock to inventory',
    requiresReason: true
  },
  '221': {
    code: '221',
    label: 'Internal Department Issuance',
    category: 'Issuance',
    direction: 'OUT',
    reversalCode: '222',
    description: 'Transfer of stock to cost center or operational department usage',
    requiresReason: false
  },
  '222': {
    code: '222',
    label: 'Cancel Internal Department Issuance',
    category: 'Issuance',
    direction: 'IN',
    reversalCode: '221',
    description: 'Return of unused departmental stock back to central warehouse',
    requiresReason: true
  }
};

/**
 * Generates standardized 10-digit SAP Movement Sequence: 45000XXXXX
 */
export function generateSapMovementNumber(): string {
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `45000${rand}`;
}

/**
 * Generates standardized 8-digit SAP Purchase Requisition Sequence: 200XXXXX
 */
export function generateSapPrNumber(): string {
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `200${rand}`;
}

/**
 * Checks if a user is an Executive / Director / Admin with cost price privileges
 */
export function isExecutiveRole(profile: UserProfile | null | undefined): boolean {
  if (!profile) return false;
  if (profile.email === 'arvin8786@gmail.com') return true;
  const role = (profile.role || '').toLowerCase();
  if (role === 'owner' || role === 'admin' || role === 'manager') return true;
  const pos = (profile.position || '').toLowerCase();
  return pos.includes('director') || pos.includes('chief') || pos.includes('head') || pos.includes('owner');
}

import { isItemPromotionActive, getItemEffectivePrice, getItemPromotionDetails } from './pricingUtils';
export { isItemPromotionActive, getItemEffectivePrice, getItemPromotionDetails };

/**
 * Formats pricing visibility according to Role-Based Security:
 * Executive / Admin: sees cost_price, selling_price, promotion_price, and promo schedule
 * General / POS Cashier: hides cost_price, sees active promotion_price if within promotion period, else standard selling_price
 */
export function getRoleBasedPricing(
  item: InventoryItem, 
  profile: UserProfile | null | undefined,
  currentDate: Date = new Date()
) {
  const isExec = isExecutiveRole(profile);
  const cost = item.cost_price ?? item.unitPrice ?? 0;
  const selling = item.selling_price ?? item.unitPrice ?? 0;
  
  const promoActive = isItemPromotionActive(item, currentDate);
  const rawPromo = item.promotion_price ?? (item as any).promotionalPrice;
  const promo = (rawPromo !== undefined && rawPromo !== null && Number(rawPromo) > 0)
    ? Number(rawPromo)
    : null;

  const effectiveSellingPrice = promoActive && promo !== null ? promo : selling;
  const promoDetails = getItemPromotionDetails(item, currentDate);

  return {
    isExecutive: isExec,
    cost_price: isExec ? cost : null,
    cost_price_display: isExec ? `$${cost.toFixed(2)}` : '*** (Restricted)',
    selling_price: selling,
    promotion_price: promo,
    promoStartDate: item.promoStartDate || item.promotionStartDate || null,
    promoEndDate: item.promoEndDate || item.promotionEndDate || null,
    effectivePrice: effectiveSellingPrice,
    hasActivePromotion: promoActive,
    promoStatusLabel: promoDetails.statusLabel,
    promoStatus: promoDetails.status,
  };
}

/**
 * Records an inventory movement using SAP-aligned movement code and updates items stock atomically
 */
export async function executeSapStockMovement(params: {
  movementCode: SapMovementCode;
  itemId: string;
  quantity: number;
  reason?: string;
  departmentCode?: string;
  departmentName?: string;
  employeeId?: string;
  employeeName?: string;
  batchNumber?: string;
  expiryDate?: string;
  serialNumber?: string;
  sourceLocation?: string;
  targetLocation?: string;
  executor: { uid: string; name: string };
}): Promise<{ documentNumber: string; newStock: number }> {
  const {
    movementCode,
    itemId,
    quantity,
    reason,
    departmentCode,
    departmentName,
    employeeId,
    employeeName,
    batchNumber,
    expiryDate,
    serialNumber,
    sourceLocation,
    targetLocation,
    executor
  } = params;

  const def = SAP_MOVEMENT_DEFINITIONS[movementCode];
  if (!def) {
    throw new Error(`Invalid SAP Movement Code: ${movementCode}`);
  }

  if (def.requiresReason && (!reason || reason.trim().length < 3)) {
    throw new Error(`Movement ${movementCode} (${def.label}) strictly requires an audit justification reason.`);
  }

  const documentNumber = generateSapMovementNumber();
  let finalStock = 0;

  await runTransaction(db, async (txn) => {
    const itemRef = doc(db, 'items', itemId);
    const itemSnap = await txn.get(itemRef);

    if (!itemSnap.exists()) {
      throw new Error(`Inventory item with ID ${itemId} not found.`);
    }

    const itemData = itemSnap.data() as InventoryItem;
    const currentStock = Number(itemData.currentStock) || 0;
    const isIncoming = def.direction === 'IN';
    const delta = isIncoming ? Math.abs(quantity) : -Math.abs(quantity);

    if (!isIncoming && currentStock < Math.abs(quantity)) {
      throw new Error(
        `Insufficient stock for ${itemData.name}. Current stock: ${currentStock}, Requested deduction: ${Math.abs(quantity)}`
      );
    }

    finalStock = currentStock + delta;

    // Update item stock and latest movement stamp
    txn.update(itemRef, {
      currentStock: finalStock,
      lastUpdated: Timestamp.now(),
      batchNumber: batchNumber || itemData.batchNumber || null,
      expiryDate: expiryDate || itemData.expiryDate || null,
      serialNumber: serialNumber || itemData.serialNumber || null
    });

    // Write movement record to stockMovements collection
    const movementRef = doc(collection(db, 'stockMovements'));
    const movementRecord: Omit<StockMovementRecord, 'id'> = {
      documentNumber,
      movementCode,
      movementDescription: def.label,
      itemId,
      sku: itemData.sku || itemData.productCode || 'SKU-GEN',
      materialName: itemData.name,
      quantity: Math.abs(quantity),
      unit: itemData.unit || 'PCS',
      cost_price: itemData.cost_price ?? itemData.unitPrice ?? 0,
      selling_price: itemData.selling_price ?? itemData.unitPrice ?? 0,
      totalValue: (itemData.cost_price ?? itemData.unitPrice ?? 0) * Math.abs(quantity),
      batchNumber: batchNumber || itemData.batchNumber || undefined,
      expiryDate: expiryDate || itemData.expiryDate || undefined,
      serialNumber: serialNumber || itemData.serialNumber || undefined,
      sourceLocation: sourceLocation || (isIncoming ? 'Vendor / External' : 'Central Warehouse'),
      targetLocation: targetLocation || (isIncoming ? 'Central Warehouse' : 'Dispatched'),
      departmentCode,
      departmentName,
      employeeId,
      employeeName,
      executedBy: executor.name,
      executedById: executor.uid,
      reason: reason?.trim() || null,
      status: 'completed',
      timestamp: Timestamp.now()
    };

    txn.set(movementRef, cleanFirestoreData(movementRecord));
  });

  // Automated Reorder Point (ROP) trigger check
  checkAndTriggerReorderPoint(itemId, finalStock).catch((err) => {
    console.warn('[ROP Trigger] Non-blocking reorder check error:', err);
  });

  return { documentNumber, newStock: finalStock };
}

/**
 * Convenience wrapper for logging stock movements without duplicate transaction deduplication
 */
export async function executeStockMovement(
  _dbInstance: any,
  params: {
    movementCode: SapMovementCode;
    itemId: string;
    quantity: number;
    costPrice?: number;
    reason?: string;
    referenceDocNumber?: string;
    performedBy?: string;
    performedByUid?: string;
    performedByRole?: string;
    departmentCode?: string;
    departmentName?: string;
    employeeId?: string;
    employeeName?: string;
  }
) {
  const def = SAP_MOVEMENT_DEFINITIONS[params.movementCode] || {
    label: 'Sales to Employee / POS Checkout',
    direction: 'OUT'
  };
  const docNumber = params.referenceDocNumber || generateSapMovementNumber();

  await addDoc(collection(db, 'stockMovements'), cleanFirestoreData({
    documentNumber: docNumber,
    movementCode: params.movementCode,
    movementDescription: def.label,
    itemId: params.itemId,
    quantity: Math.abs(params.quantity),
    cost_price: params.costPrice || 0,
    totalValue: (params.costPrice || 0) * Math.abs(params.quantity),
    reason: params.reason || null,
    departmentCode: params.departmentCode || null,
    departmentName: params.departmentName || null,
    employeeId: params.employeeId || null,
    employeeName: params.employeeName || null,
    executedBy: params.performedBy || 'System User',
    executedById: params.performedByUid || 'system',
    status: 'completed',
    timestamp: Timestamp.now()
  }));

  return { documentNumber: docNumber };
}

/**
 * Automated Reorder Point (ROP) Trigger:
 * When available inventory drops below minSafetyStock, auto-drafts a pending PR (200XXXXX)
 */
export async function checkAndTriggerReorderPoint(itemId: string, currentStock: number) {
  try {
    const itemSnap = await getDocs(query(collection(db, 'items'), where('__name__', '==', itemId)));
    if (itemSnap.empty) return;

    const item = itemSnap.docs[0].data() as InventoryItem;
    const safetyThreshold = item.minSafetyStock ?? item.minStock ?? 10;

    if (currentStock <= safetyThreshold) {
      // Check if an active pending PR already exists to prevent duplication
      const existingPrSnap = await getDocs(
        query(
          collection(db, 'purchaseRequests'),
          where('status', '==', 'pending')
        )
      );

      const alreadyQueued = existingPrSnap.docs.some(d => {
        const pr = d.data() as PurchaseRequest;
        return pr.items?.some(i => i.itemId === itemId);
      });

      if (!alreadyQueued) {
        const prNumber = generateSapPrNumber();
        const reorderQuantity = Math.max(safetyThreshold * 2 - currentStock, 20);
        const unitPrice = item.cost_price ?? item.unitPrice ?? 10;
        const totalEstimatedCost = unitPrice * reorderQuantity;

        await addDoc(collection(db, 'purchaseRequests'), {
          prNumber,
          requesterId: 'SYSTEM-ROP-ENGINE',
          requesterName: 'Automated SAP Reorder Engine',
          requesterEmail: 'system.rop@proease-erp.internal',
          departmentCode: 'DEPT-WH',
          departmentName: 'Warehouse & Storage',
          deliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          status: 'pending',
          isAutoDraftedByRop: true,
          totalEstimatedCost,
          notes: `[AUTO ROP TRIGGER] Stock level (${currentStock}) breached safety threshold (${safetyThreshold}). Replenishment queued for approval.`,
          items: [
            {
              itemId,
              productCode: item.productCode || item.sku,
              materialName: item.name,
              quantity: reorderQuantity,
              unit: item.unit || 'PCS',
              vendorCode: item.vendorCode || 'VEND-TECH',
              vendorName: item.vendorName || 'Authorized Vendor',
              materialQuotedPrice: unitPrice,
              totalQuotedPrice: totalEstimatedCost
            }
          ],
          createdAt: Timestamp.now()
        });

        console.log(`[ROP TRIGGER] Successfully auto-drafted Requisition ${prNumber} for ${item.name}`);
      }
    }
  } catch (error) {
    console.error('[ROP Trigger Failure]', error);
  }
}

