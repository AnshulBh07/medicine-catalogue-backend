export interface ExtractedSalt {
  name: string;
  amount: string;
  unit: string;
}

export interface ExtractedMedicineData {
  name?: string;
  manufacturer?: string;
  mrp?: string;
  expiryDate?: string; // YYYY-MM-DD
  manufacturingDate?: string; // YYYY-MM-DD
  batchNumber?: string;
  salts?: ExtractedSalt[];
  form?: string;
  packQuantity?: string;
  packUnit?: string;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04',
  june: '06', july: '07', august: '08', september: '09',
  october: '10', november: '11', december: '12',
};

const COMMON_SALTS = [
  'Paracetamol', 'Acetaminophen', 'Amoxicillin', 'Amoxycillin',
  'Clavulanic Acid', 'Potassium Clavulanate', 'Pantoprazole', 'Omeprazole',
  'Rabeprazole', 'Esomeprazole', 'Cetirizine', 'Levocetirizine',
  'Ibuprofen', 'Diclofenac', 'Aceclofenac', 'Caffeine',
  'Domperidone', 'Metformin', 'Glimepiride', 'Atorvastatin',
  'Rosuvastatin', 'Amlodipine', 'Telmisartan', 'Losartan',
  'Azithromycin', 'Cefixime', 'Ciprofloxacin', 'Ofloxacin',
  'Metronidazole', 'Doxycycline', 'Montelukast', 'Ranitidine',
  'Famotidine', 'Chlorpheniramine', 'Phenylephrine', 'Dextromethorphan',
  'Guaifenesin', 'Ambroxol', 'Salbutamol', 'Vitamin C', 'Zinc',
];

const KNOWN_DOSAGE_FORMS: Record<string, string> = {
  tablet: 'TABLET',
  tablets: 'TABLET',
  tab: 'TABLET',
  capsule: 'CAPSULE',
  capsules: 'CAPSULE',
  cap: 'CAPSULE',
  syrup: 'SYRUP',
  suspension: 'SUSPENSION',
  liquid: 'LIQUID',
  injection: 'INJECTION',
  inj: 'INJECTION',
  ointment: 'OINTMENT',
  cream: 'CREAM',
  gel: 'GEL',
  drops: 'DROPS',
  powder: 'POWDER',
  lotion: 'LOTION',
  solution: 'SOLUTION',
  spray: 'SPRAY',
  inhaler: 'INHALER',
};

const PACK_UNIT_MAP: Record<string, string> = {
  tablet: 'TABLET',
  tablets: 'TABLET',
  tab: 'TABLET',
  tabs: 'TABLET',
  capsule: 'CAPSULE',
  capsules: 'CAPSULE',
  cap: 'CAPSULE',
  caps: 'CAPSULE',
  ml: 'ML',
  g: 'G',
  gm: 'G',
  gram: 'G',
  grams: 'G',
  vial: 'VIAL',
  vials: 'VIAL',
  bottle: 'BOTTLE',
  bottles: 'BOTTLE',
  sachet: 'SACHET',
  sachets: 'SACHET',
  strip: 'STRIP',
  strips: 'STRIP',
  ampule: 'AMPULE',
  ampules: 'AMPULE',
  ampoule: 'AMPULE',
  ampoules: 'AMPULE',
  piece: 'PIECE',
  pieces: 'PIECE',
  unit: 'PIECE',
  units: 'PIECE',
};

function getLastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeParsedYear(rawYear: number): number {
  if (rawYear < 100) {
    return rawYear < 50 ? 2000 + rawYear : 1900 + rawYear;
  }
  return rawYear;
}

function formatValidatedDate(year: number, month: number, day: number): string | undefined {
  if (year < 1990 || year > 2050 || month < 1 || month > 12) {
    return undefined;
  }
  const maxDay = getLastDayOfMonth(year, month);
  if (day < 1 || day > maxDay) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateString(rawDate: string, isExpiry = false): string | undefined {
  const cleaned = rawDate.trim().replace(/[.,;:]/g, ' ').replace(/\s+/g, ' ');
  if (!cleaned) return undefined;

  // 1. Match ISO YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = cleaned.match(/\b(\d{4})[\s/-]+(\d{1,2})[\s/-]+(\d{1,2})\b/);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    return formatValidatedDate(year, month, day);
  }

  // 2. Match full DD/MM/YYYY, DD-MM-YYYY, or DD/MM/YY (must run BEFORE MM/YYYY!)
  const dmyMatch = cleaned.match(/\b(\d{1,2})[\s/-]+(\d{1,2})[\s/-]+(\d{2,4})\b/);
  if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = normalizeParsedYear(parseInt(dmyMatch[3], 10));
    return formatValidatedDate(year, month, day);
  }

  // 3. Match DD Mon YYYY (e.g. 15 Mar 2026)
  const dayAlphaMatch = cleaned.match(/\b(\d{1,2})[\s/-]+([a-zA-Z]{3,9})[\s/-]+(\d{2,4})\b/);
  if (dayAlphaMatch && dayAlphaMatch[1] && dayAlphaMatch[2] && dayAlphaMatch[3]) {
    const monthKey = dayAlphaMatch[2].toLowerCase().slice(0, 3);
    const monthNumStr = MONTH_MAP[monthKey];
    if (monthNumStr) {
      const day = parseInt(dayAlphaMatch[1], 10);
      const month = parseInt(monthNumStr, 10);
      const year = normalizeParsedYear(parseInt(dayAlphaMatch[3], 10));
      return formatValidatedDate(year, month, day);
    }
  }

  // 4. Match Mon YYYY (e.g. Mar 2024 or MAR.2024)
  const alphaMatch = cleaned.match(/\b([a-zA-Z]{3,9})[\s/-]+(\d{2,4})\b/);
  if (alphaMatch && alphaMatch[1] && alphaMatch[2]) {
    const monthKey = alphaMatch[1].toLowerCase().slice(0, 3);
    const monthNumStr = MONTH_MAP[monthKey];
    if (monthNumStr) {
      const month = parseInt(monthNumStr, 10);
      const year = normalizeParsedYear(parseInt(alphaMatch[2], 10));
      const day = isExpiry ? getLastDayOfMonth(year, month) : 1;
      return formatValidatedDate(year, month, day);
    }
  }

  // 5. Match MM/YYYY or MM-YYYY or MM YYYY (only when not part of a 3-part date)
  const numMatch = cleaned.match(/(?:^|[^\d])(\d{1,2})[\s/-]+(\d{2,4})(?:$|[^\d])/);
  if (numMatch && numMatch[1] && numMatch[2]) {
    const month = parseInt(numMatch[1], 10);
    const year = normalizeParsedYear(parseInt(numMatch[2], 10));
    if (month >= 1 && month <= 12) {
      const day = isExpiry ? getLastDayOfMonth(year, month) : 1;
      return formatValidatedDate(year, month, day);
    }
  }

  return undefined;
}

export function parseMedicinePackagingText(rawText: string): ExtractedMedicineData {
  if (!rawText || !rawText.trim()) {
    return {};
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const result: ExtractedMedicineData = {};
  const extractedSalts: ExtractedSalt[] = [];

  for (const line of lines) {
    if (!line) continue;

    // 1. Batch Number
    if (!result.batchNumber) {
      const batchMatch = line.match(
        /(?:b\.?\s*no\.?|batch\s*(?:no\.?|#)?|bt\.?\s*no\.?|lot\s*(?:no\.?|#)?)\s*[:.-]?\s*([a-zA-Z0-9\-_/]+)/i,
      );
      if (batchMatch && batchMatch[1] && batchMatch[1].length >= 3) {
        result.batchNumber = batchMatch[1].toUpperCase();
      }
    }

    // 2. Manufacturing Date
    if (!result.manufacturingDate) {
      const mfdMatch = line.match(
        /(?:mfd\.?|mfg\.?\s*(?:date)?|date\s*of\s*mfg\.?)\s*[:.-]?\s*([a-zA-Z0-9/.\-\s]+)/i,
      );
      if (mfdMatch && mfdMatch[1]) {
        const parsed = parseDateString(mfdMatch[1], false);
        if (parsed) {
          result.manufacturingDate = parsed;
        }
      }
    }

    // 3. Expiry Date
    if (!result.expiryDate) {
      const expMatch = line.match(
        /(?:exp\.?\s*(?:date)?|expiry\s*(?:date)?|use\s*before|best\s*before)\s*[:.-]?\s*([a-zA-Z0-9/.\-\s]+)/i,
      );
      if (expMatch && expMatch[1]) {
        const parsed = parseDateString(expMatch[1], true);
        if (parsed) {
          result.expiryDate = parsed;
        }
      }
    }

    // 4. MRP
    if (!result.mrp) {
      const mrpMatch = line.match(
        /(?:m\.?r\.?p\.?|max(?:imum)?\s*retail\s*price)\s*(?:incl\.?\s*of\s*all\s*taxes)?\s*(?:rs\.?|inr|₹)?\s*[:.-]?\s*([0-9]+\.?[0-9]*)/i,
      );
      if (mrpMatch && mrpMatch[1] && parseFloat(mrpMatch[1]) > 0) {
        result.mrp = parseFloat(mrpMatch[1]).toFixed(2);
      } else {
        const standalonePrice = line.match(/(?:rs\.?|₹)\s*([0-9]+\.[0-9]{2})/i);
        if (standalonePrice && standalonePrice[1] && parseFloat(standalonePrice[1]) > 0) {
          result.mrp = parseFloat(standalonePrice[1]).toFixed(2);
        }
      }
    }

    // 5. Manufacturer
    if (!result.manufacturer) {
      const mfgMatch = line.match(
        /(?:mfd\.?\s*by|mfg\.?\s*by|manufactured\s*by|marketed\s*by|made\s*in\s*india\s*by)\s*[:.-]?\s*(.+)/i,
      );
      if (mfgMatch && mfgMatch[1] && mfgMatch[1].length > 3) {
        const candidate = mfgMatch[1]
          .replace(/[;,.]*$/, '')
          .replace(/\s+at\s+.*$/i, '')
          .trim();
        if (candidate.length > 2) {
          result.manufacturer = candidate;
        }
      } else if (
        /(?:laboratories|labs|pharma|pharmaceuticals|healthcare|biotech|remedies|lifesciences|life\s*sciences)\s*(?:ltd\.?|limited|pvt\.?\s*ltd\.?)?|(?:pvt\.?\s*ltd\.?|limited\b|ltd\b)/i.test(
          line,
        ) &&
        !/caution|warning|schedule|prescription/i.test(line)
      ) {
        result.manufacturer = line.replace(/[;,.]*$/, '').trim();
      }
    }

    // 6. Dosage Form
    if (!result.form) {
      for (const [key, val] of Object.entries(KNOWN_DOSAGE_FORMS)) {
        const formRegex = new RegExp(`\\b${key}\\b`, 'i');
        if (formRegex.test(line) && !/each|contains|warning/i.test(line)) {
          result.form = val;
          break;
        }
      }
    }

    // 7. Pack Quantity & Pack Unit
    if (!result.packQuantity) {
      const packMatch = line.match(
        /(?:(?:strip|pack|box|bottle)\s*of\s*|(?:^|[^\d.]))(\d{1,4})\s*(tablets?|tabs?|capsules?|caps?|vials?|bottles?|sachets?|strips?|ampoules?|ampules?|pieces?|units?|ml|gm|grams?|g)\b/i,
      );
      if (packMatch && packMatch[1] && packMatch[2] && !/contains|each|mg\b|mcg\b|iu\b|%/i.test(line)) {
        result.packQuantity = packMatch[1];
        const rawUnit = packMatch[2].toLowerCase();
        result.packUnit = PACK_UNIT_MAP[rawUnit] ?? 'TABLET';
      }
    }

    // 8. Salts / Active Ingredients (supports multiple salts on one line separated by +, &, "and", or ",")
    if (!/dose|warning|keep|store|exp|mrp|mfd|batch/i.test(line)) {
      const segments = line.split(/\s*(?:\+|&|,|\band\b)\s*/i);
      for (const segment of segments) {
        const trimmedSegment = segment.trim();
        if (!trimmedSegment) continue;

        const equivMatch = trimmedSegment.match(
          /(?:equivalent\s*to\s*)([a-zA-Z\s-]+?)\s*(?:ip|bp|usp)?\s*(\d+(?:\.\d+)?)\s*(mg|gm|g|mcg|ml|%|iu)(?:\b|(?=\s|$))/i,
        );

        const standardSaltMatch = !equivMatch
          ? trimmedSegment.match(
              /([a-zA-Z\s-]+?)\s*(?:ip|bp|usp)?\s*(?:tablets?|capsules?)?\s*(\d+(?:\.\d+)?)\s*(mg|gm|g|mcg|ml|%|iu)(?:\b|(?=\s|$))/i,
            )
          : null;

        const saltMatch = equivMatch || standardSaltMatch;
        if (saltMatch && saltMatch[1] && saltMatch[2] && saltMatch[3]) {
          const rawName = saltMatch[1]
            .replace(/^(?:each|uncoated|film\s*coated|tablet|capsule|contains|composition|and)\s+/gi, '')
            .replace(/\b(?:tablets?|capsules?|syrup|suspension|drops|liquid|ip|bp|usp|trihydrate|hydrochloride|diluted)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

          const amount = saltMatch[2];
          const rawUnit = saltMatch[3].toUpperCase();
          const unit = rawUnit === '%' ? 'PERCENT' : rawUnit === 'GM' ? 'G' : rawUnit;

          if (rawName.length >= 3 && !/^(the|and|for|with)$/i.test(rawName)) {
            const rawLower = rawName.toLowerCase();
            // Match exact known salt or when raw text contains the full known salt name
            const matchedSalt = COMMON_SALTS.find((s) => {
              const knownLower = s.toLowerCase();
              return rawLower === knownLower || rawLower.includes(knownLower);
            });
            extractedSalts.push({
              name: matchedSalt ?? rawName,
              amount,
              unit,
            });
          }
        }
      }
    }
  }

  if (extractedSalts.length > 0) {
    const uniqueMap = new Map<string, ExtractedSalt>();
    for (const salt of extractedSalts) {
      const key = salt.name.toLowerCase();
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, salt);
      }
    }
    result.salts = Array.from(uniqueMap.values());
  }

  // 9. Medicine / Brand Name:
  if (!result.name) {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const candidate = lines[i];
      if (
        candidate &&
        candidate.length >= 2 &&
        candidate.length <= 60 &&
        !/^(rx|schedule\s*[hg]|warning|caution|for\s*external|keep\s*out|mfg|mfd|exp|b\.?no|m\.?r\.?p|batch)/i.test(
          candidate,
        ) &&
        !/^(manufactured|marketed|each|composition|store\s*in|dosage|direction|contains|equivalent)/i.test(
          candidate,
        ) &&
        !/\b(?:equivalent\s*to|contains|trihydrate|diluted)\b/i.test(candidate) &&
        (!result.manufacturer || !result.manufacturer.includes(candidate))
      ) {
        result.name = candidate;
        break;
      }
    }
  }

  return result;
}
