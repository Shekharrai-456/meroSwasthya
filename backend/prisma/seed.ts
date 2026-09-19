// REQ-SEED-001/002/003 (backend.md §10). The full demo dataset: 4 facilities,
// 3 invite codes, 3 demo users (PIN 1234), 3 demo patients (Sita/Ram/Aarav),
// Ram's 4-visit clinical history with prescriptions, Sita's 1 old visit, her
// active pregnancy at week 30 (3 done contacts, contact 4 due today with an
// already-sent anc_due reminder + mock_sms row), one document for Ram, and
// the 40/60/50 codelist target (complaint/diagnosis/drug) plus dangerSign/
// riskFactor entries mirrored from rules.json for picklist use.
//
// Every entity that has one is created through the real service functions
// (createPatient/createVisit/createPregnancy/recordContact/presignDocument)
// rather than raw prisma.create calls, so ids/versions/computed fields
// (edd, riskLevel, triage, reminders) are generated exactly as the real app
// would produce them - same "one implementation, reused everywhere"
// principle as Sync's dispatcher (docs/PROGRESS.md's Session 12 entry).
//
// Idempotent by design so `npm run seed` is safe to re-run: patients/visits
// are naturally idempotent by their fixed client-generated id (the same
// convention every create endpoint uses); the pregnancy block is guarded
// explicitly since `createPregnancy` itself has no id-based idempotency
// (it only checks "no other active pregnancy", which would throw
// RULE_VIOLATION on a second run without this guard). `npm run demo:reset`
// (package.json: `prisma migrate reset --force --skip-seed && tsx
// prisma/seed.ts`) truncates everything first, so Sita's lmp = today - 210
// days is always recomputed to keep her at gestational week 30 on demo day.

import { randomUUID } from 'node:crypto';
import { Role } from '../generated/prisma/enums.js';
import { addDaysToDateOnly, toDateOnly } from '../src/lib/dates.js';
import { hashPin } from '../src/lib/hash.js';
import { prisma } from '../src/lib/prisma.js';
import { recordContact, createPregnancy } from '../src/modules/maternal/service.js';
import { presignDocument } from '../src/modules/documents/service.js';
import { createPatient } from '../src/modules/patients/service.js';
import { buildAncDueMessages } from '../src/modules/reminders/templates.js';
import { createVisit } from '../src/modules/visits/service.js';
import type { AuthenticatedUser } from '../src/plugins/auth.js';

// ---------------------------------------------------------------------------
// Code lists (REQ-SEED-003): 40 complaints, 60 diagnoses (ICD-10-style codes,
// real standard codes - not independently re-verified against the WHO ICD-10
// index or a live drug formulary for this build, same "structurally correct,
// not externally re-verified" treatment as this session's other external-
// reference content; see docs/TECH_DECISIONS.md), 50 drugs (WHO Model List
// of Essential Medicines style), plus dangerSign/riskFactor entries mirrored
// verbatim from rules.json.
// ---------------------------------------------------------------------------

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
  ['CC_SORE_THROAT', 'Sore throat', 'घाँटी दुखाइ'],
  ['CC_EAR_PAIN', 'Ear pain', 'कान दुखाइ'],
  ['CC_TOOTHACHE', 'Toothache', 'दाँत दुखाइ'],
  ['CC_EYE_REDNESS', 'Eye redness', 'आँखा रातो हुनु'],
  ['CC_CONSTIPATION', 'Constipation', 'कब्जियत'],
  ['CC_BLOOD_IN_STOOL', 'Blood in stool', 'दिसामा रगत'],
  ['CC_BLOOD_IN_URINE', 'Blood in urine', 'पिसाबमा रगत'],
  ['CC_SWELLING_LEG', 'Leg swelling', 'खुट्टा सुन्निनु'],
  ['CC_SWELLING_FACE', 'Face swelling', 'अनुहार सुन्निनु'],
  ['CC_PALPITATIONS', 'Palpitations', 'मुटु ढुकढुकी'],
  ['CC_NUMBNESS', 'Numbness / tingling', 'सुन्न हुनु'],
  ['CC_SEIZURE', 'Seizure', 'छारे रोग / काम्ने'],
  ['CC_LOSS_OF_CONSCIOUSNESS', 'Loss of consciousness', 'बेहोस हुनु'],
  ['CC_BURNS', 'Burns', 'डढेको'],
  ['CC_ANIMAL_BITE', 'Animal bite', 'जनावरले टोकेको'],
  ['CC_POISONING', 'Poisoning', 'विषाक्तता'],
  ['CC_ALLERGIC_REACTION', 'Allergic reaction', 'एलर्जी प्रतिक्रिया'],
  ['CC_MENSTRUAL_IRREGULARITY', 'Menstrual irregularity', 'महिनावारी अनियमितता'],
  ['CC_VAGINAL_DISCHARGE', 'Vaginal discharge', 'योनीबाट स्राव'],
  ['CC_LABOUR_PAIN', 'Labour pain', 'सुत्केरी वेदना'],
  ['CC_REDUCED_FETAL_MOVEMENT', 'Reduced fetal movement', 'बच्चा कम चल्नु'],
  ['CC_NEWBORN_NOT_FEEDING', 'Newborn not feeding well', 'नवजात दूध नखाने'],
  ['CC_CHILD_NOT_GROWING', 'Child not growing well', 'बच्चा राम्ररी नबढ्नु'],
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
  ['J20', 'Acute bronchitis', 'ब्रोन्काइटिस'],
  ['J02', 'Acute pharyngitis', 'घाँटीको सूजन'],
  ['H66', 'Otitis media', 'कानको संक्रमण'],
  ['K02', 'Dental caries', 'दाँत कुहिने'],
  ['K30', 'Dyspepsia', 'अपच'],
  ['K25', 'Peptic ulcer', 'आमाशयको अल्सर'],
  ['N30', 'Cystitis', 'मूत्राशय सूजन'],
  ['L01', 'Impetigo', 'छालाको जीवाणु संक्रमण'],
  ['L03', 'Cellulitis', 'छाला र मुनिको तन्तु सूजन'],
  ['B86', 'Scabies', 'लुतो'],
  ['B35', 'Tinea (fungal skin infection)', 'दादुरा (फंगल संक्रमण)'],
  ['A90', 'Dengue fever', 'डेंगु ज्वरो'],
  ['A01', 'Typhoid fever', 'टाइफाइड ज्वरो'],
  ['B15', 'Hepatitis A', 'हेपाटाइटिस ए'],
  ['B16', 'Hepatitis B', 'हेपाटाइटिस बी'],
  ['J44', 'Chronic obstructive pulmonary disease', 'दीर्घ फोक्सो रोग'],
  ['I50', 'Heart failure', 'हृदय विफलता'],
  ['I21', 'Myocardial infarction', 'हृदयघात'],
  ['I63', 'Cerebral infarction (stroke)', 'पक्षाघात'],
  ['E03', 'Hypothyroidism', 'थाइरोइड ग्रन्थि न्यून सक्रियता'],
  ['E05', 'Hyperthyroidism', 'थाइरोइड ग्रन्थि अति सक्रियता'],
  ['E66', 'Obesity', 'मोटोपना'],
  ['N18', 'Chronic kidney disease', 'दीर्घ मृगौला रोग'],
  ['N40', 'Benign prostatic hyperplasia', 'प्रोस्टेट वृद्धि'],
  ['M06', 'Rheumatoid arthritis', 'ग्रन्थिवात'],
  ['M81', 'Osteoporosis', 'हड्डी कमजोर हुने रोग'],
  ['G40', 'Epilepsy', 'छारे रोग'],
  ['F32', 'Depressive episode', 'मानसिक अवसाद'],
  ['F41', 'Anxiety disorder', 'चिन्ता रोग'],
  ['O21', 'Hyperemesis gravidarum', 'गर्भावस्थाको अत्यधिक बान्ता'],
  ['O23', 'Urinary tract infection in pregnancy', 'गर्भावस्थामा पिसाब नलीको संक्रमण'],
  ['O60', 'Preterm labour', 'समय अगावै सुत्केरी वेदना'],
  ['O72', 'Postpartum haemorrhage', 'सुत्केरी पछिको रक्तस्राव'],
  ['P07', 'Low birth weight', 'कम तौलको नवजात'],
  ['P59', 'Neonatal jaundice', 'नवजातमा जन्डिस'],
  ['Z34', 'Normal pregnancy supervision', 'सामान्य गर्भ अनुगमन'],
  ['N95', 'Menopausal disorders', 'रजोनिवृत्ति समस्या'],
  ['N91', 'Amenorrhoea', 'महिनावारी नहुनु'],
  ['N92', 'Menorrhagia', 'अत्यधिक महिनावारी'],
  ['T14', 'Injury, unspecified', 'चोटपटक'],
  ['T30', 'Burns, unspecified', 'डढेको घाउ'],
  ['S52', 'Fracture of forearm', 'हातको हड्डी भाँचिएको'],
  ['W54', 'Bitten by dog', 'कुकुरले टोकेको'],
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
  ['AZITHROMYCIN_500', 'Azithromycin 500 mg', 'एजिथ्रोमाइसिन ५०० मि.ग्रा.', '500 mg', 'tablet'],
  ['DOXYCYCLINE_100', 'Doxycycline 100 mg', 'डक्सिसाइक्लिन १०० मि.ग्रा.', '100 mg', 'capsule'],
  ['ERYTHROMYCIN_500', 'Erythromycin 500 mg', 'एरिथ्रोमाइसिन ५०० मि.ग्रा.', '500 mg', 'tablet'],
  ['COTRIMOXAZOLE_480', 'Cotrimoxazole 480 mg', 'कोट्राइमोक्साजोल ४८० मि.ग्रा.', '480 mg', 'tablet'],
  ['METRONIDAZOLE_400', 'Metronidazole 400 mg', 'मेट्रोनिडाजोल ४०० मि.ग्रा.', '400 mg', 'tablet'],
  ['ATENOLOL_50', 'Atenolol 50 mg', 'एटेनोलोल ५० मि.ग्रा.', '50 mg', 'tablet'],
  ['LOSARTAN_50', 'Losartan 50 mg', 'लोसार्टान ५० मि.ग्रा.', '50 mg', 'tablet'],
  [
    'HYDROCHLOROTHIAZIDE_25',
    'Hydrochlorothiazide 25 mg',
    'हाइड्रोक्लोरोथायाजाइड २५ मि.ग्रा.',
    '25 mg',
    'tablet',
  ],
  ['ATORVASTATIN_20', 'Atorvastatin 20 mg', 'एटोर्भास्टाटिन २० मि.ग्रा.', '20 mg', 'tablet'],
  ['INSULIN_REGULAR', 'Insulin, regular', 'इन्सुलिन', null, 'injection'],
  ['GLIBENCLAMIDE_5', 'Glibenclamide 5 mg', 'ग्लिबेन्क्लामाइड ५ मि.ग्रा.', '5 mg', 'tablet'],
  ['FOLIC_ACID_5', 'Folic acid 5 mg', 'फोलिक एसिड ५ मि.ग्रा.', '5 mg', 'tablet'],
  ['MAGNESIUM_SULFATE', 'Magnesium sulfate', 'म्याग्नेसियम सल्फेट', null, 'injection'],
  ['OXYTOCIN', 'Oxytocin', 'अक्सिटोसिन', null, 'injection'],
  ['MISOPROSTOL_200', 'Misoprostol 200 mcg', 'मिसोप्रोस्टोल २०० माइक्रोग्राम', '200 mcg', 'tablet'],
  ['NIFEDIPINE_10', 'Nifedipine 10 mg', 'निफेडिपिन १० मि.ग्रा.', '10 mg', 'tablet'],
  ['METHYLDOPA_250', 'Methyldopa 250 mg', 'मेथाइल्डोपा २५० मि.ग्रा.', '250 mg', 'tablet'],
  ['PREDNISOLONE_5', 'Prednisolone 5 mg', 'प्रेडनिसोलोन ५ मि.ग्रा.', '5 mg', 'tablet'],
  ['HYDROCORTISONE_CREAM', 'Hydrocortisone cream', 'हाइड्रोकोर्टिसोन क्रिम', null, 'cream'],
  ['BENZYL_BENZOATE', 'Benzyl benzoate lotion', 'बेन्जाइल बेन्जोएट लोसन', null, 'lotion'],
  ['PERMETHRIN_CREAM', 'Permethrin cream', 'पर्मेथ्रिन क्रिम', null, 'cream'],
  ['MULTIVITAMIN', 'Multivitamin', 'मल्टिभिटामिन', null, 'tablet'],
  ['VITAMIN_D3', 'Vitamin D3', 'भिटामिन डी ३', null, 'tablet'],
  ['VITAMIN_B_COMPLEX', 'Vitamin B complex', 'भिटामिन बी कम्प्लेक्स', null, 'tablet'],
  ['ANTACID_SUSPENSION', 'Antacid suspension', 'एन्टासिड सस्पेन्सन', null, 'suspension'],
  ['LOPERAMIDE_2', 'Loperamide 2 mg', 'लोपेरामाइड २ मि.ग्रा.', '2 mg', 'tablet'],
  ['DOMPERIDONE_10', 'Domperidone 10 mg', 'डम्पेरिडोन १० मि.ग्रा.', '10 mg', 'tablet'],
  ['TRAMADOL_50', 'Tramadol 50 mg', 'ट्रामाडोल ५० मि.ग्रा.', '50 mg', 'capsule'],
  ['ASPIRIN_75', 'Aspirin 75 mg', 'एस्पिरिन ७५ मि.ग्रा.', '75 mg', 'tablet'],
  ['FUROSEMIDE_40', 'Furosemide 40 mg', 'फ्युरोसेमाइड ४० मि.ग्रा.', '40 mg', 'tablet'],
  ['SPIRONOLACTONE_25', 'Spironolactone 25 mg', 'स्पाइरोनोल्याक्टोन २५ मि.ग्रा.', '25 mg', 'tablet'],
] as const;

// Mirrored verbatim from src/modules/maternal/rules/rules.json (REQ-SEED-003's
// "dangerSign and riskFactor mirrored from RULES for picklist use").
const dangerSigns = [
  ['VAGINAL_BLEEDING', 'red', 'Vaginal bleeding', 'योनिबाट रगत बग्नु'],
  ['CONVULSIONS', 'red', 'Convulsions / fits', 'काम्ने / मुर्छा पर्ने'],
  [
    'SEVERE_HEADACHE_BLURRED_VISION',
    'red',
    'Severe headache with blurred vision',
    'कडा टाउको दुखाइ र आँखा धमिलो',
  ],
  ['FEVER_WEAKNESS', 'red', 'High fever with weakness', 'उच्च ज्वरो र कमजोरी'],
  ['SEVERE_ABDOMINAL_PAIN', 'red', 'Severe abdominal pain', 'पेट कडा दुख्ने'],
  ['DIFFICULTY_BREATHING', 'red', 'Fast or difficult breathing', 'सास फेर्न गाह्रो'],
  ['WATER_BREAK_PRETERM', 'red', 'Water breaking before 37 weeks', '३७ हप्ता अघि पानी फुट्नु'],
  [
    'REDUCED_FETAL_MOVEMENT',
    'red',
    'Reduced or absent fetal movement (after 20 wk)',
    'बच्चा नचल्ने / कम चल्ने',
  ],
  ['SWELLING_FACE_HANDS', 'amber', 'Swelling of face and hands', 'अनुहार र हात सुन्निनु'],
  ['PERSISTENT_VOMITING', 'amber', 'Persistent vomiting', 'लगातार बान्ता'],
] as const;

const riskFactors = [
  ['AGE_LT_18', 'Age under 18', '१८ वर्ष मुनि'],
  ['AGE_GT_35', 'Age over 35', '३५ वर्ष माथि'],
  ['PREV_CS', 'Previous caesarean section', 'पहिले शल्यक्रिया'],
  ['PREV_STILLBIRTH', 'Previous stillbirth / neonatal death', 'पहिले मृत जन्म'],
  ['GRAND_MULTIPARA', 'Para ≥ 5', '५ वा बढी सन्तान'],
  ['MULTIPLE_PREGNANCY', 'Twins / multiple', 'जुम्ल्याहा'],
  ['HEIGHT_LT_145', 'Height under 145 cm', 'उचाइ १४५ से.मि. मुनि'],
  ['CHRONIC_ILLNESS', 'Chronic illness (diabetes, hypertension, heart, HIV)', 'दीर्घ रोग'],
] as const;

async function seedCodeLists(): Promise<void> {
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
    ...dangerSigns.map(([code, level, labelEn, labelNp]) => ({
      kind: 'dangerSign',
      code,
      labelEn,
      labelNp,
      meta: { level },
    })),
    ...riskFactors.map(([code, labelEn, labelNp]) => ({
      kind: 'riskFactor',
      code,
      labelEn,
      labelNp,
      meta: undefined,
    })),
  ];

  const result = await prisma.codeListItem.createMany({ data: rows, skipDuplicates: true });
  console.log(
    `Seeded ${result.count} codelist item(s) (${rows.length - result.count} already present).`,
  );
}

// ---------------------------------------------------------------------------
// Facilities (REQ-SEED-001). Approximate real-world coordinates for actual
// towns in Dang district, Nepal (Ghorahi, Tulsipur) - not verified against
// an official facility registry, same "structurally reasonable, not
// externally re-verified" treatment as the codelist content above.
// ---------------------------------------------------------------------------

const FACILITY_GHORAHI_HP = 'f_0001';
const FACILITY_RAPTI_HOSPITAL = 'f_0002';
const FACILITY_TULSIPUR_PHCC = 'f_0003';
const FACILITY_WARD5_BIRTHING = 'f_0004';

async function seedFacilities(): Promise<void> {
  await prisma.facility.upsert({
    where: { id: FACILITY_GHORAHI_HP },
    create: {
      id: FACILITY_GHORAHI_HP,
      name: 'Ghorahi Health Post',
      type: 'health_post',
      hasBirthingCentre: false,
      lat: 28.0419,
      lng: 82.4926,
      municipality: 'Ghorahi',
    },
    update: {},
  });
  await prisma.facility.upsert({
    where: { id: FACILITY_RAPTI_HOSPITAL },
    create: {
      id: FACILITY_RAPTI_HOSPITAL,
      name: 'Rapti Provincial Hospital',
      type: 'hospital',
      hasBirthingCentre: true,
      lat: 28.0456,
      lng: 82.4884,
      municipality: 'Ghorahi',
    },
    update: {},
  });
  await prisma.facility.upsert({
    where: { id: FACILITY_TULSIPUR_PHCC },
    create: {
      id: FACILITY_TULSIPUR_PHCC,
      name: 'Tulsipur PHCC',
      type: 'phcc',
      hasBirthingCentre: true,
      lat: 28.1333,
      lng: 82.2833,
      municipality: 'Tulsipur',
    },
    update: {},
  });
  await prisma.facility.upsert({
    where: { id: FACILITY_WARD5_BIRTHING },
    create: {
      id: FACILITY_WARD5_BIRTHING,
      name: 'Ward 5 Birthing Centre',
      type: 'birthing_centre',
      hasBirthingCentre: true,
      lat: 28.038,
      lng: 82.498,
      municipality: 'Ghorahi',
    },
    update: {},
  });
  console.log('Seeded 4 facilities.');
}

// ---------------------------------------------------------------------------
// Invite codes (REQ-SEED-001). Left unused/unredeemed - they exist so the
// demo can separately show the "become a provider" activation flow live,
// independent of the 3 pre-configured demo users below.
// ---------------------------------------------------------------------------

async function seedInviteCodes(): Promise<void> {
  await prisma.inviteCode.upsert({
    where: { code: 'HA-GHORAHI-01' },
    create: { code: 'HA-GHORAHI-01', role: Role.provider, facilityId: FACILITY_GHORAHI_HP },
    update: {},
  });
  await prisma.inviteCode.upsert({
    where: { code: 'FCHV-W5-01' },
    create: { code: 'FCHV-W5-01', role: Role.fchv, facilityId: FACILITY_GHORAHI_HP },
    update: {},
  });
  // backend.md §10's table gives ADMIN-01 no facility - InviteCode.facilityId
  // is NOT NULL in the schema, so it defaults to the same home facility as
  // the other two demo codes (an assumption, not specified either way).
  await prisma.inviteCode.upsert({
    where: { code: 'ADMIN-01' },
    create: { code: 'ADMIN-01', role: Role.admin, facilityId: FACILITY_GHORAHI_HP },
    update: {},
  });
  console.log('Seeded 3 invite codes.');
}

// ---------------------------------------------------------------------------
// Demo users (REQ-SEED-001). PIN 1234 for all three, hashed with the same
// argon2id function real PIN-set uses.
// ---------------------------------------------------------------------------

const OWNER_PHONE = '+9779801000001';
const PROVIDER_PHONE = '+9779801000002';
const FCHV_PHONE = '+9779801000003';
const DEMO_PIN = '1234';

async function seedUsers(): Promise<{
  owner: AuthenticatedUser;
  provider: AuthenticatedUser;
}> {
  const pinHash = await hashPin(DEMO_PIN);

  const owner = await prisma.user.upsert({
    where: { phone: OWNER_PHONE },
    create: { phone: OWNER_PHONE, pinHash, role: Role.patient, name: 'Buddhi Chaudhary' },
    update: { pinHash },
  });
  const provider = await prisma.user.upsert({
    where: { phone: PROVIDER_PHONE },
    create: {
      phone: PROVIDER_PHONE,
      pinHash,
      role: Role.provider,
      name: 'Ramesh Thapa',
      facilityId: FACILITY_GHORAHI_HP,
    },
    update: { pinHash, role: Role.provider, facilityId: FACILITY_GHORAHI_HP },
  });
  await prisma.user.upsert({
    where: { phone: FCHV_PHONE },
    create: {
      phone: FCHV_PHONE,
      pinHash,
      role: Role.fchv,
      name: 'Kamala FCHV',
      facilityId: FACILITY_GHORAHI_HP,
    },
    update: { pinHash, role: Role.fchv, facilityId: FACILITY_GHORAHI_HP },
  });
  console.log('Seeded 3 demo users (PIN 1234).');

  return {
    owner: { id: owner.id, role: owner.role, facilityId: owner.facilityId },
    provider: { id: provider.id, role: provider.role, facilityId: provider.facilityId },
  };
}

// ---------------------------------------------------------------------------
// Demo patients, visits, pregnancy, document (REQ-SEED-001). All recorded by
// the account owner ("self-reported") - the simplest story that exercises
// every feature without needing to also seed an access-grant redemption
// chain just for internal seed-script plumbing.
// ---------------------------------------------------------------------------

const SITA_PATIENT_ID = '11111111-0000-4000-8000-000000000001';
const RAM_PATIENT_ID = '11111111-0000-4000-8000-000000000002';
const AARAV_PATIENT_ID = '11111111-0000-4000-8000-000000000003';
const SITA_PREGNANCY_ID = '22222222-0000-4000-8000-000000000001';
const RAM_DOCUMENT_ID = '33333333-0000-4000-8000-000000000001';

function yearsAgoDateOnly(years: number): string {
  const now = new Date();
  return toDateOnly(
    new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate())),
  );
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedPatients(owner: AuthenticatedUser): Promise<void> {
  await createPatient(owner, {
    id: SITA_PATIENT_ID,
    name: 'Sita Chaudhary',
    sex: 'female',
    dob: yearsAgoDateOnly(24),
    bloodGroup: 'B+',
    ward: 5,
    municipality: 'Ghorahi',
    allergies: [],
    chronicConditions: [],
  });
  await createPatient(owner, {
    id: RAM_PATIENT_ID,
    name: 'Ram Bahadur Chaudhary',
    sex: 'male',
    dob: yearsAgoDateOnly(58),
    ward: 5,
    municipality: 'Ghorahi',
    allergies: ['penicillin'],
    chronicConditions: ['E11'],
  });
  await createPatient(owner, {
    id: AARAV_PATIENT_ID,
    name: 'Aarav Chaudhary',
    sex: 'male',
    dob: yearsAgoDateOnly(3),
    ward: 5,
    municipality: 'Ghorahi',
    allergies: [],
    chronicConditions: [],
  });
  console.log('Seeded 3 demo patients (Sita, Ram, Aarav).');
}

async function seedVisits(owner: AuthenticatedUser): Promise<void> {
  // Ram: 4 visits over ~12 months (E11, I10), the last with Metformin +
  // Amlodipine prescriptions (durationDays long enough to still show as
  // "current medicines" on whatever day the demo actually runs).
  await createVisit(owner, RAM_PATIENT_ID, {
    id: '44444444-0000-4000-8000-000000000001',
    visitAt: daysAgoIso(360),
    chiefComplaintCode: 'CC_POLYURIA',
    vitals: { bpSys: 128, bpDia: 82, weightKg: 74 },
    diagnosisCodes: ['E11'],
    notes: 'New diagnosis of type 2 diabetes.',
    prescriptions: [],
  });
  await createVisit(owner, RAM_PATIENT_ID, {
    id: '44444444-0000-4000-8000-000000000002',
    visitAt: daysAgoIso(270),
    chiefComplaintCode: 'CC_HEADACHE',
    vitals: { bpSys: 148, bpDia: 94, weightKg: 75 },
    diagnosisCodes: ['I10'],
    notes: 'Raised BP noted, hypertension diagnosed.',
    prescriptions: [],
  });
  await createVisit(owner, RAM_PATIENT_ID, {
    id: '44444444-0000-4000-8000-000000000003',
    visitAt: daysAgoIso(120),
    chiefComplaintCode: 'CC_WEAKNESS',
    vitals: { bpSys: 142, bpDia: 90, weightKg: 74 },
    diagnosisCodes: ['E11', 'I10'],
    notes: 'Routine follow-up, both conditions stable.',
    prescriptions: [],
  });
  await createVisit(owner, RAM_PATIENT_ID, {
    id: '44444444-0000-4000-8000-000000000004',
    visitAt: daysAgoIso(10),
    chiefComplaintCode: 'CC_DIZZINESS',
    vitals: { bpSys: 138, bpDia: 88, weightKg: 73 },
    diagnosisCodes: ['E11', 'I10'],
    notes: 'Adjusting medication.',
    prescriptions: [
      {
        id: randomUUID(),
        drugCode: 'METFORMIN_500',
        drugName: 'Metformin 500 mg',
        dose: '1 tablet',
        frequency: 'BD',
        durationDays: 90,
      },
      {
        id: randomUUID(),
        drugCode: 'AMLODIPINE_5',
        drugName: 'Amlodipine 5 mg',
        dose: '1 tablet',
        frequency: 'OD',
        durationDays: 90,
      },
    ],
  });

  // Sita: 1 visit last year (fever), long since resolved.
  await createVisit(owner, SITA_PATIENT_ID, {
    id: '44444444-0000-4000-8000-000000000005',
    visitAt: daysAgoIso(365),
    chiefComplaintCode: 'CC_FEVER',
    vitals: { tempC: 38.5 },
    diagnosisCodes: [],
    notes: 'Viral fever, resolved with rest and fluids.',
    prescriptions: [
      {
        id: randomUUID(),
        drugCode: 'PARACETAMOL_500',
        drugName: 'Paracetamol 500 mg',
        dose: '1 tablet',
        frequency: 'TDS',
        durationDays: 3,
      },
    ],
  });
  console.log('Seeded Ram’s 4 visits and Sita’s 1 visit.');
}

// REQ-SEED-001: Sita's active pregnancy at gestational week 30 on demo day,
// contacts 1-3 done and green, contact 4 due today (not done) with its
// anc_due reminder already "sent" (a mock_sms row so the projector shows
// it). `createPregnancy` recomputes lmp = today - 210 days every run
// (REQ-SEED-002), so re-running this via `npm run demo:reset` always keeps
// her at week 30 regardless of when the demo actually happens.
async function seedPregnancy(owner: AuthenticatedUser): Promise<void> {
  const existing = await prisma.pregnancy.findUnique({ where: { id: SITA_PREGNANCY_ID } });
  if (existing) {
    console.log('Sita’s pregnancy already seeded, skipping (idempotent re-run).');
    return;
  }

  const todayDateOnly = toDateOnly(new Date());
  const lmp = addDaysToDateOnly(todayDateOnly, -210);

  const { pregnancy, ancContacts } = await createPregnancy(owner, SITA_PATIENT_ID, {
    id: SITA_PREGNANCY_ID,
    lmp,
    gravida: 1,
    para: 0,
    riskFactors: [],
  });

  // Contacts 1-3 (weeks 12/20/26, all already due relative to week 30) are
  // recorded done with normal findings -> green triage. Contact 4 (week 30,
  // due exactly today) is deliberately left undone.
  const doneContacts = ancContacts
    .filter((c) => c.contactNo <= 3)
    .sort((a, b) => a.contactNo - b.contactNo);
  const normalFindingsByContact = [
    {
      weightKg: 52,
      bpSys: 112,
      bpDia: 72,
      fundalHeightCm: 12,
      hbGdl: 12.4,
      urineProtein: 'neg' as const,
      ifaGiven: true,
      tdDoseGiven: true,
    },
    {
      weightKg: 54,
      bpSys: 110,
      bpDia: 70,
      fundalHeightCm: 20,
      ifaGiven: true,
      calciumGiven: true,
      dewormingGiven: true,
      tdDoseGiven: true,
    },
    {
      weightKg: 56,
      bpSys: 114,
      bpDia: 74,
      fundalHeightCm: 26,
      fhrBpm: 142,
      ifaGiven: true,
      calciumGiven: true,
      fetalMovement: 'normal' as const,
    },
  ];
  for (const [index, contact] of doneContacts.entries()) {
    await recordContact(owner, pregnancy.id, contact.contactNo, {
      doneAt: `${addDaysToDateOnly(contact.dueAt, 1)}T05:00:00.000Z`,
      findings: normalFindingsByContact[index] ?? null,
      dangerSigns: [],
      referral: null,
    });
  }

  // Contact 4's anc_due reminder is already "sent" by demo day (its own
  // dueAt is exactly today, so the normal creation-time logic in
  // maternal/service.ts - which only pre-creates a reminder for a contact
  // still strictly *in the future* - never generates one for it). Created
  // directly here, matching exactly what the real worker would have
  // produced had it fired yesterday.
  const contact4 = ancContacts.find((c) => c.contactNo === 4);
  if (contact4) {
    const ownerUser = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const messages = buildAncDueMessages('Sita Chaudhary', 4, contact4.weekTarget, contact4.dueAt);
    const sentAt = new Date(Date.now() - 20 * 60 * 60 * 1000); // ~20h ago
    await prisma.reminder.create({
      data: {
        patientId: SITA_PATIENT_ID,
        pregnancyId: pregnancy.id,
        refId: contact4.id,
        kind: 'anc_due',
        dueAt: sentAt,
        recipientPhone: ownerUser.phone,
        recipientRole: 'patient',
        messageNp: messages.np,
        messageEn: messages.en,
        status: 'sent',
        sentAt,
      },
    });
    await prisma.mockSms.create({
      data: { to: ownerUser.phone, text: messages.np, sentAt },
    });
  }

  console.log('Seeded Sita’s pregnancy (week 30, contacts 1-3 done green, contact 4 due today).');
}

// REQ-SEED-001: one seeded document for Ram. `completeDocument`'s own
// upload-completion check (a real HEAD request against S3) is bypassed
// here with a direct status update - no live S3-compatible server is
// available in this environment to actually upload a placeholder image to
// (docs/TECH_DECISIONS.md's "Object storage" entry), so the row exists and
// looks uploaded for demo purposes, but its presigned download URL will not
// resolve to a real object. Presigning itself needs no network call and
// works normally.
async function seedDocument(owner: AuthenticatedUser): Promise<void> {
  const existing = await prisma.document.findUnique({ where: { id: RAM_DOCUMENT_ID } });
  if (existing?.status === 'uploaded') {
    console.log('Ram’s document already seeded, skipping (idempotent re-run).');
    return;
  }

  await presignDocument(owner, {
    id: RAM_DOCUMENT_ID,
    patientId: RAM_PATIENT_ID,
    type: 'discharge',
    title: 'Discharge summary - Rapti Provincial Hospital',
    takenAt: toDateOnly(new Date(Date.now() - 90 * 86_400_000)),
    contentType: 'image/jpeg',
    sizeBytes: 250_000,
  });
  await prisma.document.update({
    where: { id: RAM_DOCUMENT_ID },
    data: { status: 'uploaded' },
  });
  console.log(
    'Seeded 1 document for Ram (status forced to "uploaded" - no live object, see comment).',
  );
}

async function main(): Promise<void> {
  await seedCodeLists();
  await seedFacilities();
  await seedInviteCodes();
  const { owner } = await seedUsers();
  await seedPatients(owner);
  await seedVisits(owner);
  await seedPregnancy(owner);
  await seedDocument(owner);
  console.log('Demo seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
