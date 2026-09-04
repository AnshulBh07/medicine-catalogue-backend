export function formatScheme(scheme: unknown): string {
  if (!scheme) return 'None';
  if (typeof scheme === 'string') {
    const trimmed = scheme.trim();
    return trimmed || 'None';
  }
  if (typeof scheme === 'object') {
    const obj = scheme as Record<string, unknown>;
    if (typeof obj.text === 'string' && obj.text.trim()) {
      return obj.text.trim();
    }
    if (typeof obj.scheme === 'string' && obj.scheme.trim()) {
      return obj.scheme.trim();
    }
    if (obj.buy !== undefined && obj.free !== undefined) {
      return `Buy ${obj.buy} Get ${obj.free} Free`;
    }
    if (obj.type !== undefined) {
      return `Scheme: ${obj.type}`;
    }
    try {
      return JSON.stringify(scheme);
    } catch {
      return 'Custom Scheme';
    }
  }
  return String(scheme);
}

export interface CommercialMetrics {
  sellingPrice: number;
  profitPerUnit: number;
  marginPercent: number;
  markupPercent: number;
  isProfit: boolean;
  effectivePurchaseRate: number;
  purchaseCost?: number;
  sellingValue?: number;
  profit?: number;
  purchasedQuantity?: number;
  freeQuantity?: number;
  sellableQuantity?: number;
  formattedSellingPrice: string;
  formattedProfit: string;
  formattedMargin: string;
  formattedEffectivePurchaseRate?: string;
}

/**
 * Parses scheme formats such as "10+2", "10 + 2", "Buy 10 Get 2 Free", "10+1"
 * Returns { buy: number, free: number } or null if not applicable.
 */
export function parseSchemeQuantities(scheme: unknown): { buy: number; free: number } | null {
  if (!scheme) return null;

  if (typeof scheme === 'object') {
    const obj = scheme as Record<string, unknown>;
    if (typeof obj.buy === 'number' && typeof obj.free === 'number' && obj.buy > 0 && obj.free >= 0) {
      return { buy: obj.buy, free: obj.free };
    }
    if (typeof obj.baseQuantity === 'number' && typeof obj.freeQuantity === 'number' && obj.baseQuantity > 0 && obj.freeQuantity >= 0) {
      return { buy: obj.baseQuantity, free: obj.freeQuantity };
    }
    if (typeof obj.description === 'string') {
      return parseSchemeQuantities(obj.description);
    }
    if (typeof obj.text === 'string') {
      return parseSchemeQuantities(obj.text);
    }
    if (typeof obj.value === 'string') {
      return parseSchemeQuantities(obj.value);
    }
  }

  const str = String(scheme).trim();
  // Match "10+2", "10 + 2", "10+1"
  const plusMatch = str.match(/^(\d+)\s*\+\s*(\d+)$/);
  if (plusMatch && plusMatch[1] && plusMatch[2]) {
    const buy = parseInt(plusMatch[1], 10);
    const free = parseInt(plusMatch[2], 10);
    if (buy > 0) return { buy, free };
  }

  // Match "Buy 10 Get 2 Free" or "Buy 10 get 2"
  const buyGetMatch = str.match(/buy\s+(\d+)\s+get\s+(\d+)/i);
  if (buyGetMatch && buyGetMatch[1] && buyGetMatch[2]) {
    const buy = parseInt(buyGetMatch[1], 10);
    const free = parseInt(buyGetMatch[2], 10);
    if (buy > 0) return { buy, free };
  }

  return null;
}

/**
 * Authoritative Commercial / Margin Calculation:
 *
 * Purchase Rate: Supplier purchase rate
 * Discount: Trade/invoice discount WE RECEIVE from the supplier/MR (reduces purchase cost)
 * GST: Explicit GST (%) applied to discounted purchase rate
 * Scheme: e.g. 10+3 (purchased quantity = 10, free quantity = 3, total sellable = 13)
 *
 * Step 1: discountedPurchaseRate = purchaseRate * (1 - discountPercent / 100)
 * Step 2: purchaseRateWithGst = discountedPurchaseRate * (1 + gstPercent / 100)
 * Step 3: purchaseCost = purchasedQuantity * purchaseRateWithGst
 * Step 4: sellingValue = sellableQuantity * MRP
 * Step 5: profit = sellingValue - purchaseCost
 * Step 6: marginPercent = (profit / sellingValue) * 100
 */
export function calculateCommercialMetrics(
  purchaseRate: number,
  mrp: number,
  discountPercent: number,
  scheme?: unknown,
  gstPercent: number = 0,
): CommercialMetrics {
  const pRate = Number(purchaseRate) || 0;
  const maxPrice = Number(mrp) || 0;
  const discount = Number(discountPercent) || 0;
  const gst = Number(gstPercent) || 0;

  // Step 1: Apply the supplier/trade discount to the purchase rate
  const discountedPurchaseRate = pRate * (1 - Math.min(Math.max(discount, 0), 100) / 100);

  // Step 2: Apply GST to the discounted purchase rate
  const purchaseRateWithGst = discountedPurchaseRate * (1 + Math.max(gst, 0) / 100);

  // Scheme handling:
  // For a 10+3 scheme: purchased = 10, free = 3, sellable = 13
  // If no scheme: purchased = 1, free = 0, sellable = 1
  const schemeQuantities = parseSchemeQuantities(scheme);
  const purchasedQuantity = schemeQuantities && schemeQuantities.buy > 0 ? schemeQuantities.buy : 1;
  const freeQuantity = schemeQuantities && schemeQuantities.buy > 0 ? schemeQuantities.free : 0;
  const sellableQuantity = purchasedQuantity + freeQuantity;

  // Step 3: Calculate actual purchase cost (only for paid/purchased quantity)
  const purchaseCost = purchasedQuantity * purchaseRateWithGst;

  // Step 4: Calculate total selling value using all sellable strips
  const sellingValue = sellableQuantity * maxPrice;

  // Step 5: Calculate profit
  const profit = sellingValue - purchaseCost;

  // Step 6: Calculate margin
  const marginPercent = sellingValue > 0 ? (profit / sellingValue) * 100 : 0;

  // Effective purchase rate per sellable unit
  const effectivePurchaseRate = sellableQuantity > 0 ? purchaseCost / sellableQuantity : 0;
  const profitPerUnit = sellableQuantity > 0 ? profit / sellableQuantity : 0;

  const markupPercent = pRate > 0 ? ((maxPrice - pRate) / pRate) * 100 : 0;
  const isProfit = profit >= 0;

  return {
    sellingPrice: maxPrice,
    profitPerUnit,
    marginPercent,
    markupPercent,
    isProfit,
    effectivePurchaseRate,
    purchaseCost,
    sellingValue,
    profit,
    purchasedQuantity,
    freeQuantity,
    sellableQuantity,
    formattedSellingPrice: `₹${maxPrice.toFixed(2)}`,
    formattedProfit: `₹${profit.toFixed(2)}`,
    formattedMargin: `${marginPercent.toFixed(2)}%`,
    formattedEffectivePurchaseRate: `₹${effectivePurchaseRate.toFixed(2)}`,
  };
}
