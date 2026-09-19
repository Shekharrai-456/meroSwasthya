import rules from './rules.json' with { type: 'json' };

// Mirrors domain/rules/triage.dart line-for-line (frontend.md §12,
// backend.md A.5/§9.5) - the server-side half of REQ-RULES-002. Evaluated
// in fixed priority order (red > amber > green); the 16 A.6 cases (mostly
// 3-11 for this function specifically) are the shared unit tests both sides
// must pass identically.
//
// Returns a single `reasons: string[]` (English), matching the literal
// `AncContact.triageReasons` shape in backend.md A.2's example JSON - the
// Dart source additionally computes a parallel `reasonsNp` for the client's
// own live-triage UI (bilingual chips before saving), but the field this
// server actually persists/returns is English-only, so there's nothing to
// port for that half.

export interface AncFindings {
  weightKg?: number;
  bpSys?: number;
  bpDia?: number;
  fundalHeightCm?: number;
  fhrBpm?: number;
  hbGdl?: number;
  urineProtein?: 'neg' | 'trace' | '+' | '++' | '+++';
  tdDoseGiven?: boolean;
  ifaGiven?: boolean;
  dewormingGiven?: boolean;
  calciumGiven?: boolean;
  fetalMovement?: 'normal' | 'reduced' | 'absent';
}

export interface TriageInput {
  findings: AncFindings | null;
  dangerSigns: string[];
  riskLevel: 'normal' | 'high';
  gaDays: number;
}

export type TriageLevel = 'green' | 'amber' | 'red';

export interface TriageResult {
  level: TriageLevel;
  reasons: string[];
}

interface DangerSignDef {
  code: string;
  level: 'red' | 'amber';
  en: string;
  np: string;
}

const dangerSignByCode = new Map<string, DangerSignDef>(
  (rules.dangerSigns as DangerSignDef[]).map((d) => [d.code, d]),
);

const PROTEIN_POSITIVE = ['+', '++', '+++'];

export function triage(input: TriageInput): TriageResult {
  const { findings: f, dangerSigns, riskLevel, gaDays } = input;
  const reasons: string[] = [];
  let red = false;
  let amber = false;

  const redSigns = dangerSigns.filter((c) => dangerSignByCode.get(c)?.level === 'red');
  if (redSigns.length > 0) {
    red = true;
    reasons.push(...redSigns.map((c) => dangerSignByCode.get(c)?.en ?? c));
  }

  if (f) {
    const sys = f.bpSys ?? 0;
    const dia = f.bpDia ?? 0;
    const hb = f.hbGdl ?? 99;
    const protein = f.urineProtein !== undefined && PROTEIN_POSITIVE.includes(f.urineProtein);

    if (sys >= 160 || dia >= 110) {
      red = true;
      reasons.push('Severe hypertension (≥160/110)');
    }
    if (
      (sys >= 140 || dia >= 90) &&
      (protein || dangerSigns.includes('SEVERE_HEADACHE_BLURRED_VISION'))
    ) {
      red = true;
      reasons.push('BP ≥ 140/90 with proteinuria or severe headache — possible pre-eclampsia');
    }
    if (hb < 7) {
      red = true;
      reasons.push('Severe anaemia (Hb < 7)');
    }
    if (f.fetalMovement === 'absent' && gaDays >= 140) {
      red = true;
      reasons.push('Absent fetal movement');
    }

    if (!red) {
      if (sys >= 140 || dia >= 90) {
        amber = true;
        reasons.push('Raised BP (≥140/90)');
      }
      if (hb >= 7 && hb < 10) {
        amber = true;
        reasons.push('Anaemia (Hb 7–9.9)');
      }
      if (protein) {
        amber = true;
        reasons.push('Proteinuria');
      }
      if (f.fetalMovement === 'reduced') {
        amber = true;
        reasons.push('Reduced fetal movement');
      }
    }
  }

  if (!red) {
    const amberSigns = dangerSigns.filter((c) => dangerSignByCode.get(c)?.level === 'amber');
    if (amberSigns.length > 0) {
      amber = true;
      reasons.push(...amberSigns.map((c) => dangerSignByCode.get(c)?.en ?? c));
    }
    if (riskLevel === 'high') {
      amber = true;
      reasons.push('High-risk pregnancy (risk factors present)');
    }
  }

  const level: TriageLevel = red ? 'red' : amber ? 'amber' : 'green';
  return { level, reasons };
}
