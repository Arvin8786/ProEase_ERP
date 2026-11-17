import { InventoryItem } from '../types';

/**
 * Normalizes various raw Excel / user input dates (Excel numeric serial, Date object, or text)
 * into a standardized 'YYYY-MM-DD' string format, or null if empty / invalid.
 */
export function normalizeExcelDate(val: any): string | null {
  if (val === null || val === undefined || val === '') {
    return null;
  }

  // Handle Excel serial date numbers (e.g. 45550)
  if (typeof val === 'number') {
    if (isNaN(val) || val <= 0) return null;
    // Excel epoch base: Dec 30 1899 (accounts for the Lotus 1-2-3 1900 leap year defect)
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const targetMs = excelEpoch.getTime() + Math.round(val * 86400000);
    const dateObj = new Date(targetMs);
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toISOString().split('T')[0];
    }
    return null;
  }

  // Handle Date instances
  if (val instanceof Date) {
    return !isNaN(val.getTime()) ? val.toISOString().split('T')[0] : null;
  }

  // Handle strings
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // Handles common formats like MM/DD/YYYY or DD/MM/YYYY or standard ISO dates
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    // If string is purely numeric representation of an excel date (e.g. "45550")
    const num = Number(trimmed);
    if (!isNaN(num) && num > 10000 && num < 100000) {
      return normalizeExcelDate(num);
    }

    return null;
  }

  return null;
}

/**
 * Checks whether an item's promotion price is currently active based on:
 * 1. Has a valid promotion_price > 0 and < standard selling price
 * 2. Promo Start Date (if configured): current time >= start date at 00:00:00
 * 3. Promo End Date (if configured): current time <= end date at 23:59:59.999
 * If current date passes the Promo End Date, returns false (the promo has ended).
 */
export function isItemPromotionActive(
  item: Partial<InventoryItem> | null | undefined,
  currentDate: Date = new Date()
): boolean {
  if (!item) return false;

  const promoVal = item.promotion_price ?? item.promotionalPrice;
  if (promoVal === undefined || promoVal === null || (promoVal as unknown) === '') {
    return false;
  }

  const promoNum = Number(promoVal);
  if (isNaN(promoNum) || promoNum <= 0) {
    return false;
  }

  const standardPrice = Number(item.selling_price ?? item.sellingPrice ?? item.unitPrice ?? 0);
  if (standardPrice > 0 && promoNum >= standardPrice) {
    // Promo price is not lower than standard price
    return false;
  }

  const startDateStr = normalizeExcelDate(item.promoStartDate || item.promotionStartDate);
  const endDateStr = normalizeExcelDate(item.promoEndDate || item.promotionEndDate);

  const nowMs = currentDate.getTime();

  // If start date is specified, check that promotion has started
  if (startDateStr) {
    const [sYear, sMonth, sDay] = startDateStr.split('-').map(Number);
    const startObj = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0);
    if (!isNaN(startObj.getTime()) && nowMs < startObj.getTime()) {
      return false; // Scheduled for future
    }
  }

  // If end date is specified, check that promotion has not ended
  if (endDateStr) {
    const [eYear, eMonth, eDay] = endDateStr.split('-').map(Number);
    const endObj = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999);
    if (!isNaN(endObj.getTime()) && nowMs > endObj.getTime()) {
      return false; // Promotion period has ended!
    }
  }

  return true;
}

/**
 * Detailed promotion status for UI indicators and badges
 */
export interface ItemPromotionDetails {
  hasPromoPriceConfigured: boolean;
  isPromoActive: boolean;
  status: 'active' | 'upcoming' | 'expired' | 'no_promo';
  standardPrice: number;
  promoPrice: number | null;
  effectivePrice: number;
  startDate: string | null;
  endDate: string | null;
  statusLabel: string;
  badgeColor: string; // Tailwind class
}

export function getItemPromotionDetails(
  item: Partial<InventoryItem> | null | undefined,
  currentDate: Date = new Date()
): ItemPromotionDetails {
  const standardPrice = Number(item?.selling_price ?? item?.sellingPrice ?? item?.unitPrice ?? 0);
  const rawPromo = item?.promotion_price ?? item?.promotionalPrice;
  const promoNum = rawPromo !== undefined && rawPromo !== null && (rawPromo as unknown) !== '' ? Number(rawPromo) : null;
  const hasPromoPrice = promoNum !== null && !isNaN(promoNum) && promoNum > 0;

  const startDate = normalizeExcelDate(item?.promoStartDate || item?.promotionStartDate);
  const endDate = normalizeExcelDate(item?.promoEndDate || item?.promotionEndDate);

  if (!hasPromoPrice) {
    return {
      hasPromoPriceConfigured: false,
      isPromoActive: false,
      status: 'no_promo',
      standardPrice,
      promoPrice: null,
      effectivePrice: standardPrice,
      startDate: null,
      endDate: null,
      statusLabel: 'Regular Price',
      badgeColor: 'text-slate-500 bg-slate-100 border-slate-200',
    };
  }

  const nowMs = currentDate.getTime();

  // Check if upcoming
  if (startDate) {
    const [sYear, sMonth, sDay] = startDate.split('-').map(Number);
    const startObj = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0);
    if (!isNaN(startObj.getTime()) && nowMs < startObj.getTime()) {
      return {
        hasPromoPriceConfigured: true,
        isPromoActive: false,
        status: 'upcoming',
        standardPrice,
        promoPrice: promoNum,
        effectivePrice: standardPrice,
        startDate,
        endDate,
        statusLabel: `Promo Starts ${startDate}`,
        badgeColor: 'text-blue-700 bg-blue-50 border-blue-200',
      };
    }
  }

  // Check if expired
  if (endDate) {
    const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
    const endObj = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999);
    if (!isNaN(endObj.getTime()) && nowMs > endObj.getTime()) {
      return {
        hasPromoPriceConfigured: true,
        isPromoActive: false,
        status: 'expired',
        standardPrice,
        promoPrice: promoNum,
        effectivePrice: standardPrice,
        startDate,
        endDate,
        statusLabel: `Promo Ended ${endDate}`,
        badgeColor: 'text-slate-500 bg-slate-100 border-slate-200 line-through',
      };
    }
  }

  // Active promotion
  const label = endDate 
    ? `Promo ends ${endDate}`
    : startDate 
      ? `Promo (from ${startDate})`
      : 'Active Promo';

  return {
    hasPromoPriceConfigured: true,
    isPromoActive: true,
    status: 'active',
    standardPrice,
    promoPrice: promoNum,
    effectivePrice: promoNum,
    startDate,
    endDate,
    statusLabel: label,
    badgeColor: 'text-purple-700 bg-purple-50 border-purple-300 font-bold',
  };
}

/**
 * Returns the effective selling price for an item considering active promotion periods.
 */
export function getItemEffectivePrice(
  item: Partial<InventoryItem> | null | undefined,
  currentDate: Date = new Date()
): number {
  if (!item) return 0;
  const standardPrice = Number(item.selling_price ?? item.sellingPrice ?? item.unitPrice ?? 0);
  if (isItemPromotionActive(item, currentDate)) {
    const promo = Number(item.promotion_price ?? item.promotionalPrice);
    return !isNaN(promo) && promo > 0 ? promo : standardPrice;
  }
  return standardPrice;
}
