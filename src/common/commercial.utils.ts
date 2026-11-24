export function formatScheme(scheme: unknown): string {
  if (!scheme) return 'None';
  if (typeof scheme === 'string') {
    const trimmed = scheme.trim();
    if (!trimmed) return 'None';
    // If it's a JSON string representing an object (e.g. '{"description":"10+3"}')
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        return formatScheme(parsed);
      } catch {
        // Not valid JSON, proceed with string formatting
      }
    }
    return trimmed;
  }
  if (typeof scheme === 'object') {
    const obj = scheme as Record<string, unknown>;
    if (typeof obj.description === 'string' && obj.description.trim()) {
      return formatScheme(obj.description.trim());
    }
    if (typeof obj.text === 'string' && obj.text.trim()) {
      return formatScheme(obj.text.trim());
    }
    if (typeof obj.scheme === 'string' && obj.scheme.trim()) {
      return formatScheme(obj.scheme.trim());
    }
    if (typeof obj.value === 'string' && obj.value.trim()) {
      return formatScheme(obj.value.trim());
    }
    if (obj.buy !== undefined && obj.free !== undefined) {
      return `${obj.buy}+${obj.free}`;
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

const toNonNegativeFinite = (value: unknown): number => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
};

const normalizeZero = (value: number): number => {
  if (!Number.isFinite(value) || Object.is(value, -0)) return 0;
  return value;
};

const roundTo = (value: number, decimals = 2): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Parses scheme formats such as "10+2", "10 + 2", "10+2 Free", "Buy 10 Get 2 Free",
 * structured objects ({ buy, free }, { baseQuantity, freeQuantity }, { description/text/scheme/value }),
 * and JSON-stringified scheme objects.
 * Returns { buy: number, free: number } or null if not applicable.
 */
export function parseSchemeQuantities(scheme: unknown): { buy: number; free: number } | null {
  if (!scheme) return null;

  if (typeof scheme === 'string') {
    const trimmed = scheme.trim();
    if (!trimmed) return null;

    // Handle JSON-stringified scheme objects (e.g. '{"description":"10+3"}', '{"buy":10,"free":2}')
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          return parseSchemeQuantities(parsed);
        }
      } catch {
        // Not valid JSON, continue with string parsing
      }
    }

    // Match "10+2", "10 + 2", "10+2 Free", "10+2 free strips", "10+1 bonus"
    const plusMatch = trimmed.match(
      /^(\d+)\s*\+\s*(\d+)(?:\s+(?:free|bonus|extra|strips?|units?|pcs?|packs?|bottles?|boxes?|tablets?|capsules?)[\w\s]*)?$/i,
    );
    if (plusMatch && plusMatch[1] && plusMatch[2]) {
      const buy = parseInt(plusMatch[1], 10);
      const free = parseInt(plusMatch[2], 10);
      if (buy > 0 && free >= 0) return { buy, free };
    }

    // Match "Buy 10 Get 2 Free" or "Buy 10 get 2"
    const buyGetMatch = trimmed.match(/buy\s+(\d+)\s+get\s+(\d+)/i);
    if (buyGetMatch && buyGetMatch[1] && buyGetMatch[2]) {
      const buy = parseInt(buyGetMatch[1], 10);
      const free = parseInt(buyGetMatch[2], 10);
      if (buy > 0 && free >= 0) return { buy, free };
    }

    return null;
  }

  if (typeof scheme === 'object') {
    const obj = scheme as Record<string, unknown>;
    const rawBuy = obj.buy !== undefined ? Number(obj.buy) : NaN;
    const rawFree = obj.free !== undefined ? Number(obj.free) : NaN;
    if (Number.isFinite(rawBuy) && Number.isFinite(rawFree) && rawBuy > 0 && rawFree >= 0) {
      return { buy: rawBuy, free: rawFree };
    }

    const rawBase = obj.baseQuantity !== undefined ? Number(obj.baseQuantity) : NaN;
    const rawFreeQty = obj.freeQuantity !== undefined ? Number(obj.freeQuantity) : NaN;
    if (Number.isFinite(rawBase) && Number.isFinite(rawFreeQty) && rawBase > 0 && rawFreeQty >= 0) {
      return { buy: rawBase, free: rawFreeQty };
    }

    if (typeof obj.description === 'string') {
      return parseSchemeQuantities(obj.description);
    }
    if (typeof obj.text === 'string') {
      return parseSchemeQuantities(obj.text);
    }
    if (typeof obj.scheme === 'string') {
      return parseSchemeQuantities(obj.scheme);
    }
    if (typeof obj.value === 'string') {
      return parseSchemeQuantities(obj.value);
    }
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
 * Step 7: effectivePurchaseRate = purchaseCost / sellableQuantity
 * Step 8: markupPercent = ((MRP - effectivePurchaseRate) / effectivePurchaseRate) * 100
 */
export function calculateCommercialMetrics(
  purchaseRate: number,
  mrp: number,
  discountPercent: number,
  scheme?: unknown,
  gstPercent: number = 0,
): CommercialMetrics {
  const pRate = toNonNegativeFinite(purchaseRate);
  const maxPrice = toNonNegativeFinite(mrp);
  const discount = Math.min(toNonNegativeFinite(discountPercent), 100);
  const gst = toNonNegativeFinite(gstPercent);

  // Step 1: Apply the supplier/trade discount to the purchase rate
  const discountedPurchaseRate = pRate * (1 - discount / 100);

  // Step 2: Apply GST to the discounted purchase rate
  const purchaseRateWithGst = discountedPurchaseRate * (1 + gst / 100);

  // Scheme handling:
  // For a 10+3 scheme: purchased = 10, free = 3, sellable = 13
  // If no scheme: purchased = 1, free = 0, sellable = 1
  const schemeQuantities = parseSchemeQuantities(scheme);
  const purchasedQuantity = schemeQuantities && schemeQuantities.buy > 0 ? schemeQuantities.buy : 1;
  const freeQuantity = schemeQuantities && schemeQuantities.buy > 0 ? schemeQuantities.free : 0;
  const sellableQuantity = purchasedQuantity + freeQuantity;

  // Step 3: Calculate actual purchase cost (only for paid/purchased quantity)
  const purchaseCost = normalizeZero(purchasedQuantity * purchaseRateWithGst);

  // Step 4: Calculate total selling value using all sellable strips
  const sellingValue = normalizeZero(sellableQuantity * maxPrice);

  // Step 5: Calculate profit
  const profit = normalizeZero(sellingValue - purchaseCost);

  // Step 6: Calculate margin
  const marginPercent = sellingValue > 0 ? normalizeZero((profit / sellingValue) * 100) : 0;

  // Effective purchase rate per sellable unit
  const effectivePurchaseRate = sellableQuantity > 0 ? normalizeZero(purchaseCost / sellableQuantity) : 0;
  const profitPerUnit = sellableQuantity > 0 ? normalizeZero(profit / sellableQuantity) : 0;

  // Markup based on effective purchase rate (incorporating discount, GST, and free-quantity scheme)
  const markupPercent =
    effectivePurchaseRate > 0
      ? normalizeZero(((maxPrice - effectivePurchaseRate) / effectivePurchaseRate) * 100)
      : 0;
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
    formattedSellingPrice: `₹${roundTo(maxPrice, 2).toFixed(2)}`,
    formattedProfit: `₹${roundTo(profitPerUnit, 2).toFixed(2)}`,
    formattedMargin: `${roundTo(marginPercent, 2).toFixed(2)}%`,
    formattedEffectivePurchaseRate: `₹${roundTo(effectivePurchaseRate, 2).toFixed(2)}`,
  };
}
