import { describe, expect, it } from 'vitest';
import { eddFromLmp, gestationalAgeDays, lmpFromEdd } from '../src/modules/maternal/rules/edd.js';
import { generateContactSchedule } from '../src/modules/maternal/rules/schedule.js';
import { triage } from '../src/modules/maternal/rules/triage.js';

// REQ-RULES-002/003, REQ-TEST-001. The 16 shared cases from backend.md A.6 -
// this file covers the 11 that are pure rules-engine logic (no DB/HTTP
// needed). Per backend.md §12/§14 rule 6, these must pass before any
// Maternal endpoint is wired up - written and run first, before
// modules/maternal/{service,routes}.ts exist.
//
// Case 12 (pregnancy for a male patient -> 422 RULE_VIOLATION) is an
// endpoint-level test, covered in test/maternal.test.ts instead (same
// pattern as REQ-PREG-001's own test). Cases 15/16 (grant expiry) are
// already covered by test/grants.test.ts. Cases 13/14 (sync idempotency/
// conflict) need the Sync module, not built yet - not omitted, just not
// yet reachable.

describe('maternal rules engine (backend.md A.5/A.6)', () => {
  describe('EDD and schedule (A.6 cases 1-2)', () => {
    it('case 1: lmp=2026-02-20 -> edd=2026-11-27; contact 1 dueAt week 12; contact 5 dueAt week 34', () => {
      const edd = eddFromLmp('2026-02-20');
      expect(edd).toBe('2026-11-27');

      const contacts = generateContactSchedule('pg_test', edd);
      const contact1 = contacts.find((c) => c.contactNo === 1);
      const contact5 = contacts.find((c) => c.contactNo === 5);
      expect(contact1?.weekTarget).toBe(12);
      expect(contact1?.dueAt).toBe('2026-05-15');
      expect(contact5?.weekTarget).toBe(34);
      expect(contact5?.dueAt).toBe('2026-10-16');
    });

    it('case 2: edd=2026-11-27, lmp=null -> derived lmp=2026-02-20; gestationalAgeDays on 2026-09-18 = 210', () => {
      const edd = '2026-11-27';
      expect(lmpFromEdd(edd)).toBe('2026-02-20');
      const today = new Date('2026-09-18T00:00:00.000Z');
      expect(gestationalAgeDays(edd, today)).toBe(210);
    });
  });

  describe('triage (A.6 cases 3-11)', () => {
    const base = { riskLevel: 'normal' as const, gaDays: 200 };

    it('case 3: BP 150/95 + severe headache danger sign -> red, includes the pre-eclampsia reason', () => {
      const result = triage({
        ...base,
        findings: { bpSys: 150, bpDia: 95 },
        dangerSigns: ['SEVERE_HEADACHE_BLURRED_VISION'],
      });
      expect(result.level).toBe('red');
      expect(result.reasons.some((r) => r.includes('BP ≥ 140/90'))).toBe(true);
    });

    it('case 4: BP 142/88, no danger signs, riskLevel normal -> amber (BP >= 140/90 only)', () => {
      const result = triage({ ...base, findings: { bpSys: 142, bpDia: 88 }, dangerSigns: [] });
      expect(result.level).toBe('amber');
    });

    it('case 5: hbGdl 6.8 -> red (Hb < 7)', () => {
      const result = triage({ ...base, findings: { hbGdl: 6.8 }, dangerSigns: [] });
      expect(result.level).toBe('red');
    });

    it('case 6: hbGdl 9.2 -> amber', () => {
      const result = triage({ ...base, findings: { hbGdl: 9.2 }, dangerSigns: [] });
      expect(result.level).toBe('amber');
    });

    it('case 7: fetalMovement absent, gaDays 150 -> red', () => {
      const result = triage({
        ...base,
        gaDays: 150,
        findings: { fetalMovement: 'absent' },
        dangerSigns: [],
      });
      expect(result.level).toBe('red');
    });

    it('case 8: fetalMovement absent, gaDays 120 -> not red by that rule (before 20 wk)', () => {
      const result = triage({
        ...base,
        gaDays: 120,
        findings: { fetalMovement: 'absent' },
        dangerSigns: [],
      });
      expect(result.level).not.toBe('red');
    });

    it('case 9: no findings, dangerSigns [SWELLING_FACE_HANDS] -> amber', () => {
      const result = triage({ ...base, findings: null, dangerSigns: ['SWELLING_FACE_HANDS'] });
      expect(result.level).toBe('amber');
    });

    it('case 10: no findings, no danger signs, riskLevel high -> amber', () => {
      const result = triage({ ...base, riskLevel: 'high', findings: null, dangerSigns: [] });
      expect(result.level).toBe('amber');
    });

    it('case 11: no findings, no danger signs, riskLevel normal -> green', () => {
      const result = triage({ ...base, findings: null, dangerSigns: [] });
      expect(result.level).toBe('green');
    });
  });
});
