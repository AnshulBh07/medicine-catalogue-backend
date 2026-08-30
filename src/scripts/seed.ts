import argon2 from 'argon2';
import { $Enums } from '@prisma/client/index';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

export async function seedDatabase() {
  logger.info('Starting realistic Medicine Catalogue database seed...');

  // 1. Ensure Admin User exists for CommercialDetails relation
  const adminEmail = 'admin@medicina.com';
  const adminPasswordHash = await argon2.hash('AdminPassword123!', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: 'System Admin',
      email: adminEmail,
      phone: '+919999999999',
      passwordHash: adminPasswordHash,
      role: $Enums.UserRole.ADMIN,
      active: true,
    },
  });

  // 2. Clear old test-generated placeholder medicines, commercial details, compositions, salts
  await prisma.commercialDetails.deleteMany({});
  await prisma.batch.deleteMany({});
  await prisma.medicine.deleteMany({});
  await prisma.compositionCompositionSalt.deleteMany({});
  await prisma.compositionSalt.deleteMany({});
  await prisma.composition.deleteMany({});
  await prisma.salt.deleteMany({});
  await prisma.mR.deleteMany({});
  await prisma.manufacturer.deleteMany({});

  logger.info('Cleaned previous database records.');

  // 3. Manufacturers
  const manufacturersData = [
    { name: 'Sun Pharmaceutical Industries Ltd.' },
    { name: 'Cipla Ltd.' },
    { name: 'Dr. Reddy\'s Laboratories' },
    { name: 'Abbott Healthcare Pvt. Ltd.' },
    { name: 'Torrent Pharmaceuticals Ltd.' },
    { name: 'Alkem Laboratories Ltd.' },
    { name: 'GlaxoSmithKline Pharmaceuticals' },
    { name: 'Mankind Pharma Ltd.' },
  ];

  const manufacturers: Record<string, { id: string; name: string }> = {};
  for (const mfg of manufacturersData) {
    const created = await prisma.manufacturer.create({
      data: { name: mfg.name, active: true },
    });
    manufacturers[mfg.name] = created;
  }

  // 4. Medical Representatives (MRs)
  const mrsData = [
    { name: 'Ravi Kumar', company: 'Sun Pharmaceutical Industries Ltd.', phone: '+919876543210', email: 'ravi.kumar@sunpharma.example.com' },
    { name: 'Priya Sharma', company: 'Cipla Ltd.', phone: '+919876543211', email: 'priya.sharma@cipla.example.com' },
    { name: 'Amit Patel', company: 'Dr. Reddy\'s Laboratories', phone: '+919876543212', email: 'amit.patel@drreddys.example.com' },
    { name: 'Sunil Verma', company: 'Abbott Healthcare Pvt. Ltd.', phone: '+919876543213', email: 'sunil.verma@abbott.example.com' },
  ];

  const mrs: Record<string, { id: string; name: string }> = {};
  for (const mr of mrsData) {
    const created = await prisma.mR.create({
      data: { ...mr, active: true },
    });
    mrs[mr.name] = created;
  }

  // 5. Salts
  const saltsData = [
    { name: 'Paracetamol', description: 'Analgesic and antipyretic agent' },
    { name: 'Caffeine', description: 'Central nervous system stimulant' },
    { name: 'Amoxicillin', description: 'Broad-spectrum penicillin antibiotic' },
    { name: 'Clavulanic Acid', description: 'Beta-lactamase inhibitor' },
    { name: 'Cetirizine', description: 'Second-generation antihistamine' },
    { name: 'Omeprazole', description: 'Proton-pump inhibitor for gastric acid' },
    { name: 'Ibuprofen', description: 'Non-steroidal anti-inflammatory drug (NSAID)' },
    { name: 'Amlodipine', description: 'Dihydropyridine calcium channel blocker' },
    { name: 'Atorvastatin', description: 'HMG-CoA reductase inhibitor (statin)' },
    { name: 'Pantoprazole', description: 'Proton-pump inhibitor' },
    { name: 'Montelukast', description: 'Leukotriene receptor antagonist' },
    { name: 'Levocetirizine', description: 'Non-sedating antihistamine' },
    { name: 'Diphenhydramine', description: 'First-generation antihistamine and antitussive' },
    { name: 'Dextromethorphan', description: 'Cough suppressant' },
    { name: 'Vitamin B-Complex', description: 'Essential water-soluble B vitamins' },
  ];

  const salts: Record<string, { id: string; name: string }> = {};
  for (const s of saltsData) {
    const created = await prisma.salt.create({
      data: { name: s.name, description: s.description, active: true },
    });
    salts[s.name] = created;
  }

  // 6. Composition Salts & Compositions
  type CompDef = {
    key: string;
    displayText: string;
    description: string;
    salts: Array<{ saltName: string; amount: number; unit: $Enums.CompositionSaltUnit }>;
  };

  const compositionsData: CompDef[] = [
    {
      key: 'paracetamol-500',
      displayText: 'Paracetamol 500mg',
      description: 'Single ingredient analgesic',
      salts: [{ saltName: 'Paracetamol', amount: 500, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'paracetamol-650',
      displayText: 'Paracetamol 650mg',
      description: 'Higher strength antipyretic',
      salts: [{ saltName: 'Paracetamol', amount: 650, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'amoxicillin-500',
      displayText: 'Amoxicillin 500mg',
      description: 'Single ingredient antibiotic',
      salts: [{ saltName: 'Amoxicillin', amount: 500, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'amox-clav-625',
      displayText: 'Amoxicillin 500mg + Clavulanic Acid 125mg',
      description: 'Potentiated broad-spectrum antibiotic',
      salts: [
        { saltName: 'Amoxicillin', amount: 500, unit: $Enums.CompositionSaltUnit.MG },
        { saltName: 'Clavulanic Acid', amount: 125, unit: $Enums.CompositionSaltUnit.MG },
      ],
    },
    {
      key: 'cetirizine-10',
      displayText: 'Cetirizine 10mg',
      description: 'Once-daily antiallergy',
      salts: [{ saltName: 'Cetirizine', amount: 10, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'omeprazole-20',
      displayText: 'Omeprazole 20mg',
      description: 'Gastric acid reducer',
      salts: [{ saltName: 'Omeprazole', amount: 20, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'ibuprofen-400',
      displayText: 'Ibuprofen 400mg',
      description: 'Anti-inflammatory pain relief',
      salts: [{ saltName: 'Ibuprofen', amount: 400, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'amlodipine-5',
      displayText: 'Amlodipine 5mg',
      description: 'Antihypertensive therapy',
      salts: [{ saltName: 'Amlodipine', amount: 5, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'atorvastatin-10',
      displayText: 'Atorvastatin 10mg',
      description: 'Cholesterol lowering statin',
      salts: [{ saltName: 'Atorvastatin', amount: 10, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'para-caff-500-65',
      displayText: 'Paracetamol 500mg + Caffeine 65mg',
      description: 'Dual action pain and headache relief',
      salts: [
        { saltName: 'Paracetamol', amount: 500, unit: $Enums.CompositionSaltUnit.MG },
        { saltName: 'Caffeine', amount: 65, unit: $Enums.CompositionSaltUnit.MG },
      ],
    },
    {
      key: 'pantoprazole-40',
      displayText: 'Pantoprazole 40mg',
      description: 'Proton-pump inhibitor for acid reflux and GERD',
      salts: [{ saltName: 'Pantoprazole', amount: 40, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'montair-lc',
      displayText: 'Montelukast 10mg + Levocetirizine 5mg',
      description: 'Combination anti-allergic and bronchodilator',
      salts: [
        { saltName: 'Montelukast', amount: 10, unit: $Enums.CompositionSaltUnit.MG },
        { saltName: 'Levocetirizine', amount: 5, unit: $Enums.CompositionSaltUnit.MG },
      ],
    },
    {
      key: 'benadryl-syrup',
      displayText: 'Diphenhydramine 12.5mg/5ml',
      description: 'Antihistamine cough relief formulation',
      salts: [{ saltName: 'Diphenhydramine', amount: 12.5, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'ascoril-syrup',
      displayText: 'Dextromethorphan 10mg/5ml',
      description: 'Dry cough suppressant formulation',
      salts: [{ saltName: 'Dextromethorphan', amount: 10, unit: $Enums.CompositionSaltUnit.MG }],
    },
    {
      key: 'vitamin-b-comp',
      displayText: 'Vitamin B-Complex + Zinc',
      description: 'Daily multivitamin nutritional supplement',
      salts: [{ saltName: 'Vitamin B-Complex', amount: 50, unit: $Enums.CompositionSaltUnit.MG }],
    },
  ];

  const compositions: Record<string, { id: string; displayText: string }> = {};
  for (const cDef of compositionsData) {
    const compSalts: string[] = [];
    for (const sDef of cDef.salts) {
      const targetSalt = salts[sDef.saltName];
      if (!targetSalt) continue;
      const cs = await prisma.compositionSalt.create({
        data: {
          saltId: targetSalt.id,
          amount: sDef.amount,
          unit: sDef.unit,
        },
      });
      compSalts.push(cs.id);
    }

    const createdComp = await prisma.composition.create({
      data: {
        displayText: cDef.displayText,
        description: cDef.description,
        active: true,
        compositionSaltLinks: {
          create: compSalts.map((csId) => ({
            compositionSaltId: csId,
          })),
        },
      },
    });
    compositions[cDef.key] = createdComp;
  }

  // 7. Realistic Medicines with human-readable names and CommercialDetails
  type MedicineDef = {
    name: string;
    compositionKey: string;
    form: $Enums.MedicineForm;
    packQuantity: number;
    packUnit: $Enums.MedicinePackUnit;
    manufacturerName: string;
    mrName?: string;
    shortDescription: string;
    uses: string;
    recommendedAgeGroup: string;
    directions: string;
    warnings: string;
    storageInstructions: string;
    prescriptionRequired: boolean;
    mrp: number;
    purchaseRate: number;
    discountPercent: number;
  };

  const medicinesData: MedicineDef[] = [
    {
      name: 'Paracetamol 500mg Tablet',
      compositionKey: 'paracetamol-500',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 10,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'Sun Pharmaceutical Industries Ltd.',
      mrName: 'Ravi Kumar',
      shortDescription: 'Analgesic / Antipyretic',
      uses: 'Relief of mild to moderate pain and reduction of fever.',
      recommendedAgeGroup: 'Adults and children over 12 years',
      directions: 'Take 1-2 tablets every 4-6 hours as needed. Maximum 8 tablets in 24 hours.',
      warnings: 'Do not exceed the recommended daily dose. Avoid alcohol.',
      storageInstructions: 'Store below 25°C in a dry place protected from direct sunlight.',
      prescriptionRequired: false,
      mrp: 25.00,
      purchaseRate: 15.00,
      discountPercent: 5.00,
    },
    {
      name: 'Dolo 650mg Tablet',
      compositionKey: 'paracetamol-650',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 15,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'Micro Labs Ltd.' in manufacturers ? 'Micro Labs Ltd.' : 'Cipla Ltd.',
      mrName: 'Priya Sharma',
      shortDescription: 'High Strength Antipyretic',
      uses: 'Effective symptomatic relief in fever, viral fever, and body aches.',
      recommendedAgeGroup: 'Adults and adolescents weighing over 45 kg',
      directions: 'Take 1 tablet every 6 to 8 hours after food.',
      warnings: 'Caution in liver or kidney disease. Do not take with other paracetamol products.',
      storageInstructions: 'Store in a cool, dry place away from moisture.',
      prescriptionRequired: false,
      mrp: 32.50,
      purchaseRate: 20.00,
      discountPercent: 6.50,
    },
    {
      name: 'Amoxicillin 500mg Capsule',
      compositionKey: 'amoxicillin-500',
      form: $Enums.MedicineForm.CAPSULE,
      packQuantity: 10,
      packUnit: $Enums.MedicinePackUnit.CAPSULE,
      manufacturerName: 'Cipla Ltd.',
      mrName: 'Priya Sharma',
      shortDescription: 'Broad-Spectrum Antibiotic',
      uses: 'Treatment of bacterial infections of ear, nose, throat, respiratory tract, and skin.',
      recommendedAgeGroup: 'Adults and elderly',
      directions: 'Take 1 capsule 3 times daily at evenly spaced intervals.',
      warnings: 'Complete the entire prescribed course even if symptoms improve. Report any rash.',
      storageInstructions: 'Store below 25°C in original blister pack.',
      prescriptionRequired: true,
      mrp: 85.00,
      purchaseRate: 55.00,
      discountPercent: 10.00,
    },
    {
      name: 'Augmentin 625 Duo Tablet',
      compositionKey: 'amox-clav-625',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 10,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'GlaxoSmithKline Pharmaceuticals',
      shortDescription: 'Potentiated Antibacterial',
      uses: 'Severe bacterial respiratory, sinus, urinary tract, and dental infections.',
      recommendedAgeGroup: 'Adults and children over 12 years',
      directions: 'Take 1 tablet twice daily with meals to optimize absorption and reduce GI discomfort.',
      warnings: 'Contraindicated in patients with history of penicillin hypersensitivity or cholestatic jaundice.',
      storageInstructions: 'Store in moisture-proof packaging below 25°C.',
      prescriptionRequired: true,
      mrp: 204.00,
      purchaseRate: 140.00,
      discountPercent: 12.00,
    },
    {
      name: 'Cetirizine 10mg Tablet',
      compositionKey: 'cetirizine-10',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 10,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'Dr. Reddy\'s Laboratories',
      mrName: 'Amit Patel',
      shortDescription: 'Antihistamine / Antiallergic',
      uses: 'Relief of allergic rhinitis symptoms, watery eyes, sneezing, runny nose, and urticaria.',
      recommendedAgeGroup: 'Adults and children 6 years and older',
      directions: 'Take 1 tablet once daily in the evening.',
      warnings: 'May cause mild drowsiness. Avoid driving or operating machinery.',
      storageInstructions: 'Store at room temperature between 15°C and 30°C.',
      prescriptionRequired: false,
      mrp: 35.00,
      purchaseRate: 18.00,
      discountPercent: 8.00,
    },
    {
      name: 'Omez 20mg Capsule',
      compositionKey: 'omeprazole-20',
      form: $Enums.MedicineForm.CAPSULE,
      packQuantity: 15,
      packUnit: $Enums.MedicinePackUnit.CAPSULE,
      manufacturerName: 'Dr. Reddy\'s Laboratories',
      mrName: 'Amit Patel',
      shortDescription: 'Proton Pump Inhibitor (Anti-Ulcer)',
      uses: 'Treatment of gastroesophageal reflux disease (GERD), acid peptic disease, and peptic ulcers.',
      recommendedAgeGroup: 'Adults and adolescents over 12',
      directions: 'Take 1 capsule in the morning at least 30 minutes before breakfast.',
      warnings: 'Swallow whole with water. Do not chew, crush, or open capsules.',
      storageInstructions: 'Keep in original container to protect from light and moisture.',
      prescriptionRequired: false,
      mrp: 78.50,
      purchaseRate: 48.00,
      discountPercent: 7.50,
    },
    {
      name: 'Brufen 400mg Tablet',
      compositionKey: 'ibuprofen-400',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 15,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'Abbott Healthcare Pvt. Ltd.',
      mrName: 'Sunil Verma',
      shortDescription: 'NSAID / Anti-inflammatory',
      uses: 'Relief of acute musculoskeletal pain, joint inflammation, arthritis, dental pain, and dysmenorrhea.',
      recommendedAgeGroup: 'Adults and children over 12 years',
      directions: 'Take 1 tablet 3 times daily immediately after meals with plenty of water.',
      warnings: 'Use lowest effective dose for shortest duration. Take with food to prevent stomach irritation.',
      storageInstructions: 'Store in dry place below 30°C.',
      prescriptionRequired: false,
      mrp: 42.00,
      purchaseRate: 26.00,
      discountPercent: 5.00,
    },
    {
      name: 'Amlong 5mg Tablet',
      compositionKey: 'amlodipine-5',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 15,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'Torrent Pharmaceuticals Ltd.',
      shortDescription: 'Calcium Channel Blocker / Antihypertensive',
      uses: 'Management of essential hypertension and chronic stable angina pectoris.',
      recommendedAgeGroup: 'Adults only',
      directions: 'Take 1 tablet once daily at the same time each day, with or without food.',
      warnings: 'Do not discontinue abruptly without physician consultation.',
      storageInstructions: 'Store in a dry location below 25°C protected from light.',
      prescriptionRequired: true,
      mrp: 54.00,
      purchaseRate: 32.00,
      discountPercent: 8.00,
    },
    {
      name: 'Atorva 10mg Tablet',
      compositionKey: 'atorvastatin-10',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 10,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'Sun Pharmaceutical Industries Ltd.',
      mrName: 'Ravi Kumar',
      shortDescription: 'Lipid Lowering Statin',
      uses: 'Primary hypercholesterolemia, mixed dyslipidemia, and cardiovascular risk reduction.',
      recommendedAgeGroup: 'Adults and adolescents from 10 years',
      directions: 'Take 1 tablet once daily, preferably at bedtime.',
      warnings: 'Periodic liver function monitoring recommended. Report unexplained muscle pain.',
      storageInstructions: 'Store in moisture-proof pack below 25°C.',
      prescriptionRequired: true,
      mrp: 98.00,
      purchaseRate: 60.00,
      discountPercent: 10.00,
    },
    {
      name: 'Panadol Extra Tablet',
      compositionKey: 'para-caff-500-65',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 10,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'GlaxoSmithKline Pharmaceuticals',
      shortDescription: 'Dual Action Analgesic',
      uses: 'Tough headache, migraine, backache, and toothache relief.',
      recommendedAgeGroup: 'Adults and children 12 years and older',
      directions: 'Take 1-2 tablets every 4 to 6 hours as needed.',
      warnings: 'Limit caffeine-containing drinks while taking this product.',
      storageInstructions: 'Store below 30°C in dry conditions.',
      prescriptionRequired: false,
      mrp: 45.00,
      purchaseRate: 28.00,
      discountPercent: 5.00,
    },
    {
      name: 'Pantocid 40mg Tablet',
      compositionKey: 'pantoprazole-40',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 15,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'Sun Pharmaceutical Industries Ltd.',
      mrName: 'Ravi Kumar',
      shortDescription: 'Gastroprotective PPI',
      uses: 'Erosive esophagitis, gastroesophageal reflux disease, and NSAID-induced ulcer prevention.',
      recommendedAgeGroup: 'Adults',
      directions: 'Take 1 tablet 30 minutes before the morning meal.',
      warnings: 'Do not crush or chew delayed-release tablets.',
      storageInstructions: 'Store protected from moisture below 25°C.',
      prescriptionRequired: true,
      mrp: 145.00,
      purchaseRate: 90.00,
      discountPercent: 12.50,
    },
    {
      name: 'Montair-LC Tablet',
      compositionKey: 'montair-lc',
      form: $Enums.MedicineForm.TABLET,
      packQuantity: 10,
      packUnit: $Enums.MedicinePackUnit.TABLET,
      manufacturerName: 'Cipla Ltd.',
      mrName: 'Priya Sharma',
      shortDescription: 'Anti-Allergic & Bronchodilator',
      uses: 'Symptomatic treatment of allergic rhinitis associated with bronchial asthma.',
      recommendedAgeGroup: 'Adults and adolescents over 15 years',
      directions: 'Take 1 tablet once daily in the evening with water.',
      warnings: 'Not indicated for treatment of acute asthma attacks.',
      storageInstructions: 'Store below 25°C in a dry place.',
      prescriptionRequired: true,
      mrp: 185.00,
      purchaseRate: 115.00,
      discountPercent: 10.00,
    },
    {
      name: 'Benadryl Cough Syrup 100ml',
      compositionKey: 'benadryl-syrup',
      form: $Enums.MedicineForm.SYRUP,
      packQuantity: 100,
      packUnit: $Enums.MedicinePackUnit.ML,
      manufacturerName: 'Abbott Healthcare Pvt. Ltd.',
      mrName: 'Sunil Verma',
      shortDescription: 'Antihistamine Cough Formula',
      uses: 'Soothes throat irritation, tickling, and suppresses irritating allergic cough.',
      recommendedAgeGroup: 'Adults and children over 6 years',
      directions: 'Adults: 5-10 ml every 4 hours. Children 6-12 yrs: 2.5-5 ml every 4 hours.',
      warnings: 'May cause drowsiness. Use measuring cap provided.',
      storageInstructions: 'Store in cool place. Shake well before use.',
      prescriptionRequired: false,
      mrp: 115.00,
      purchaseRate: 75.00,
      discountPercent: 8.00,
    },
    {
      name: 'Ascoril D Plus Syrup 100ml',
      compositionKey: 'ascoril-syrup',
      form: $Enums.MedicineForm.SYRUP,
      packQuantity: 100,
      packUnit: $Enums.MedicinePackUnit.ML,
      manufacturerName: 'Alkem Laboratories Ltd.',
      shortDescription: 'Dry Cough Relief Syrup',
      uses: 'Relief of non-productive dry cough caused by cold or minor throat irritation.',
      recommendedAgeGroup: 'Adults and children over 6 years',
      directions: '5 ml to 10 ml 3 times a day using measuring cup.',
      warnings: 'Do not exceed recommended dose. Avoid with MAO inhibitors.',
      storageInstructions: 'Store protected from direct light.',
      prescriptionRequired: false,
      mrp: 130.00,
      purchaseRate: 85.00,
      discountPercent: 7.50,
    },
    {
      name: 'Becosules Z Capsule',
      compositionKey: 'vitamin-b-comp',
      form: $Enums.MedicineForm.CAPSULE,
      packQuantity: 20,
      packUnit: $Enums.MedicinePackUnit.CAPSULE,
      manufacturerName: 'GlaxoSmithKline Pharmaceuticals',
      shortDescription: 'Multivitamin with Zinc',
      uses: 'Nutritional deficiency, mouth ulcers, recovery after illness, and immunity support.',
      recommendedAgeGroup: 'Adults',
      directions: 'Take 1 capsule daily after a main meal.',
      warnings: 'Dietary supplement; not a substitute for balanced diet.',
      storageInstructions: 'Store in cool, dark place below 25°C.',
      prescriptionRequired: false,
      mrp: 48.00,
      purchaseRate: 30.00,
      discountPercent: 5.00,
    },
  ];

  for (const mDef of medicinesData) {
    const comp = compositions[mDef.compositionKey];
    const mfg = manufacturers[mDef.manufacturerName];
    if (!comp || !mfg) continue;
    const mr = mDef.mrName ? mrs[mDef.mrName] : undefined;

    const medicine = await prisma.medicine.create({
      data: {
        name: mDef.name,
        compositionId: comp.id,
        form: mDef.form,
        packQuantity: mDef.packQuantity,
        packUnit: mDef.packUnit,
        shortDescription: mDef.shortDescription,
        uses: mDef.uses,
        recommendedAgeGroup: mDef.recommendedAgeGroup,
        directions: mDef.directions,
        warnings: mDef.warnings,
        storageInstructions: mDef.storageInstructions,
        prescriptionRequired: mDef.prescriptionRequired,
        manufacturerId: mfg.id,
        mrId: mr?.id ?? null,
        active: true,
      },
    });

    await prisma.commercialDetails.create({
      data: {
        medicineId: medicine.id,
        purchaseRate: mDef.purchaseRate,
        mrp: mDef.mrp,
        discountPercent: mDef.discountPercent,
        privateNotes: null,
        updatedBy: admin.id,
      },
    });
  }

  logger.info(`Successfully seeded ${medicinesData.length} realistic catalogue medicines!`);
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seedDatabase()
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
