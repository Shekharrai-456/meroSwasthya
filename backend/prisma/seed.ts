// REQ-SEED-003 (partial - see below). Facilities/invite codes/demo users/
// patients/visits/pregnancy seed (REQ-SEED-001/002) are still NOT_STARTED -
// nothing else is added here yet, per docs/PROJECT_PLAN.md's phase order.

import { prisma } from '../src/lib/prisma.js';

// Real (not placeholder) codelist entries, scoped to what this build actually
// exercises: REQ-VISIT-004 needs complaint/diagnosis/drug codes to validate
// visits against. This is a genuinely useful working subset, not the full
// curated 40/60/50-code demo target backend.md §10 describes - authoring the
// complete lists is a content task independent of Visits' logic. Tracked as
// REQ-SEED-003 "IMPLEMENTED (partial)" in docs/PROJECT_PLAN.md until the rest
// is filled in (Phase 1/Seed's own slot).

const complaints = [
  ['CC_FEVER', 'Fever', 'ज्वरो'],
  ['CC_COUGH', 'Cough', 'खोकी'],
  ['CC_DIARRHOEA', 'Diarrhoea', 'पखाला'],
  ['CC_ABD_PAIN', 'Abdominal pain', 'पेट दुखाइ'],
  ['CC_HEADACHE', 'Headache', 'टाउको दुखाइ'],
  ['CC_POLYURIA', 'Frequent urination', 'बारम्बार पिसाब लाग्ने'],
  ['CC_ANC', 'Antenatal checkup', 'गर्भ जाँच'],
  ['CC_VOMITING', 'Vomiting', 'बान्ता'],
  ['CC_CHEST_PAIN', 'Chest pain', 'छाती दुखाइ'],
  ['CC_BREATHLESSNESS', 'Breathlessness', 'सास फेर्न गाह्रो'],
  ['CC_SKIN_RASH', 'Skin rash', 'छालामा दाग वा चिलाउने'],
  ['CC_JOINT_PAIN', 'Joint pain', 'जोर्नी दुखाइ'],
  ['CC_WEAKNESS', 'General weakness', 'शरीर कमजोर हुनु'],
  ['CC_DIZZINESS', 'Dizziness', 'रिंगटा लाग्ने'],
  ['CC_URINARY_SYMPTOMS', 'Urinary symptoms', 'पिसाबमा समस्या'],
  ['CC_BACK_PAIN', 'Back pain', 'ढाड दुखाइ'],
  ['CC_INJURY', 'Injury', 'चोटपटक'],
] as const;

const diagnoses = [
  ['A09', 'Diarrhoea and gastroenteritis', 'पखाला तथा आन्द्राको संक्रमण'],
  ['J06', 'Upper respiratory tract infection', 'माथिल्लो श्वासप्रश्वास नलीको संक्रमण'],
  ['E11', 'Type 2 diabetes', 'मधुमेह (प्रकार २)'],
  ['I10', 'Hypertension', 'उच्च रक्तचाप'],
  ['O14', 'Pre-eclampsia', 'गर्भावस्थाको उच्च रक्तचाप (प्री-इक्लाम्पसिया)'],
  ['D50', 'Iron-deficiency anaemia', 'फलामको कमीले हुने रक्तअल्पता'],
  ['J18', 'Pneumonia', 'निमोनिया'],
  ['K29', 'Gastritis', 'ग्यास्ट्राइटिस'],
  ['N39', 'Urinary tract infection', 'पिसाब नलीको संक्रमण'],
  ['L23', 'Contact dermatitis', 'छालाको एलर्जी'],
  ['M54', 'Back pain (dorsalgia)', 'ढाड दुखाइ'],
  ['R51', 'Headache', 'टाउको दुखाइ'],
  ['J45', 'Asthma', 'दम रोग'],
  ['E86', 'Dehydration', 'पानीको कमी'],
  ['B50', 'Malaria', 'मलेरिया'],
  ['O99', 'Anaemia in pregnancy', 'गर्भावस्थाको रक्तअल्पता'],
  ['H10', 'Conjunctivitis', 'आँखा आउने रोग'],
  ['G43', 'Migraine', 'माइग्रेन'],
] as const;

const drugs = [
  ['PARACETAMOL_500', 'Paracetamol 500 mg', 'प्यारासिटामोल ५०० मि.ग्रा.', '500 mg', 'tablet'],
  ['AMOXICILLIN_500', 'Amoxicillin 500 mg', 'एमोक्सिसिलिन ५०० मि.ग्रा.', '500 mg', 'capsule'],
  ['METFORMIN_500', 'Metformin 500 mg', 'मेटफर्मिन ५०० मि.ग्रा.', '500 mg', 'tablet'],
  ['AMLODIPINE_5', 'Amlodipine 5 mg', 'एम्लोडिपिन ५ मि.ग्रा.', '5 mg', 'tablet'],
  ['ORS', 'Oral rehydration salts', 'ओआरएस घोल', null, 'sachet'],
  ['ZINC_20', 'Zinc 20 mg', 'जिंक २० मि.ग्रा.', '20 mg', 'tablet'],
  ['IFA', 'Iron folic acid', 'आइरन फोलिक एसिड', null, 'tablet'],
  ['CALCIUM_500', 'Calcium 500 mg', 'क्याल्सियम ५०० मि.ग्रा.', '500 mg', 'tablet'],
  ['ALBENDAZOLE_400', 'Albendazole 400 mg', 'एल्बेन्डाजोल ४०० मि.ग्रा.', '400 mg', 'tablet'],
  ['TD_VACCINE', 'Tetanus-diphtheria vaccine', 'टिडी खोप', null, 'injection'],
  ['CIPROFLOXACIN_500', 'Ciprofloxacin 500 mg', 'सिप्रोफ्लोक्सासिन ५०० मि.ग्रा.', '500 mg', 'tablet'],
  ['OMEPRAZOLE_20', 'Omeprazole 20 mg', 'ओमेप्राजोल २० मि.ग्रा.', '20 mg', 'capsule'],
  ['CETIRIZINE_10', 'Cetirizine 10 mg', 'सेटिरिजिन १० मि.ग्रा.', '10 mg', 'tablet'],
  ['IBUPROFEN_400', 'Ibuprofen 400 mg', 'आइबुप्रोफेन ४०० मि.ग्रा.', '400 mg', 'tablet'],
  ['VITAMIN_A', 'Vitamin A', 'भिटामिन ए', null, 'capsule'],
  ['CHLORPHENIRAMINE_4', 'Chlorpheniramine 4 mg', 'क्लोरफेनिरामिन ४ मि.ग्रा.', '4 mg', 'tablet'],
  ['MEBENDAZOLE_100', 'Mebendazole 100 mg', 'मेबेन्डाजोल १०० मि.ग्रा.', '100 mg', 'tablet'],
  ['SALBUTAMOL_INHALER', 'Salbutamol inhaler', 'सल्बुटामोल इन्हेलर', null, 'inhaler'],
  ['DICLOFENAC_50', 'Diclofenac 50 mg', 'डाइक्लोफेनाक ५० मि.ग्रा.', '50 mg', 'tablet'],
] as const;

async function main(): Promise<void> {
  const rows = [
    ...complaints.map(([code, labelEn, labelNp]) => ({
      kind: 'complaint',
      code,
      labelEn,
      labelNp,
      meta: undefined,
    })),
    ...diagnoses.map(([code, labelEn, labelNp]) => ({
      kind: 'diagnosis',
      code,
      labelEn,
      labelNp,
      meta: undefined,
    })),
    ...drugs.map(([code, labelEn, labelNp, strength, form]) => ({
      kind: 'drug',
      code,
      labelEn,
      labelNp,
      meta: { strength, form },
    })),
  ];

  const result = await prisma.codeListItem.createMany({ data: rows, skipDuplicates: true });
  console.log(
    `Seeded ${result.count} codelist item(s) (${rows.length - result.count} already present).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
