import type { $Enums, Prisma } from '@prisma/client/index';

export interface SaltStrengthItem {
  id?: string;
  saltId?: string;
  name: string;
  amount: number | string | Prisma.Decimal;
  unit: $Enums.CompositionSaltUnit | string;
}

/**
 * Normalizes numbers/decimals for clean display (e.g. 500.000 -> "500", 12.500 -> "12.5")
 */
export const formatSaltAmount = (amount: number | string | Prisma.Decimal): string => {
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (isNaN(num)) return String(amount);
  // Avoid floating point precision issues while trimming trailing zeros
  return Number.isInteger(num) ? String(num) : String(parseFloat(num.toFixed(4)));
};

/**
 * Formats a canonical, order-independent composition formula from salt items.
 * Sorts items alphabetically by salt name to ensure consistent displayText.
 * Example: "Amlodipine Besylate 5 MG + Atorvastatin Calcium 10 MG"
 */
export const formatCompositionDisplayText = (salts: SaltStrengthItem[]): string => {
  if (!salts || salts.length === 0) {
    return '';
  }

  const sorted = [...salts].sort((a, b) =>
    a.name.trim().toLowerCase().localeCompare(b.name.trim().toLowerCase()),
  );

  return sorted
    .map((s) => `${s.name.trim()} ${formatSaltAmount(s.amount)} ${String(s.unit).toUpperCase().trim()}`)
    .join(' + ');
};

/**
 * Generates an order-independent canonical identity key for a set of composition salts.
 * Example: "salt-uuid-1:5:MG|salt-uuid-2:10:MG"
 */
export const getCanonicalCompositionKey = (
  items: Array<{ saltId: string; amount: number | string | Prisma.Decimal; unit: string }>,
): string => {
  const sorted = [...items].sort((a, b) => {
    const saltComp = a.saltId.localeCompare(b.saltId);
    if (saltComp !== 0) return saltComp;
    const aAmt = typeof a.amount === 'number' ? a.amount : Number(a.amount);
    const bAmt = typeof b.amount === 'number' ? b.amount : Number(b.amount);
    if (aAmt !== bAmt) return aAmt - bAmt;
    return a.unit.localeCompare(b.unit);
  });

  return sorted
    .map((item) => `${item.saltId}:${formatSaltAmount(item.amount)}:${item.unit.toUpperCase().trim()}`)
    .join('|');
};
