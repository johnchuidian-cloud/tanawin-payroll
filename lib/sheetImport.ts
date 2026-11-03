// Import from an uploaded sheet: the workbook already carries every
// per-cutoff input and every masters value — so instead of Maya retyping
// them card by card (the tedium that nearly sank the parallel run), derive
// them straight from the sheet. Two halves:
//   1. buildDraftFromSheet — fills the shared compute draft (days, OT,
//      holidays, unpaid, adjustments, deductions, tips pool, dates).
//   2. diffMastersAgainstSheet — lists where the app's stored masters
//      disagree with the sheet (loan amounts, comp, contributions), each
//      with an applyable patch. Applying goes through the normal masters
//      functions, so everything lands in the edit history.
import type { ParsedWorkbook, PayrollRow, SheetDate } from './types';
import type { CompEmployee, Loan, EmployeeInputs } from './engine';
import { EMPTY_INPUTS, type ComputeDraft } from './computeDraft';

const iso = (d: SheetDate | null): string =>
  d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : '';

const key = (s: string) => s.trim().toLowerCase();

// A row participates in payroll if it has a pay basis.
const hasPay = (r: PayrollRow) => r.basic != null || r.daily != null;

function rowDaily(r: PayrollRow): number {
  return r.basic != null ? (r.basic * 12) / 313 : (r.daily ?? 0);
}

// Reverse a pay amount into the count the engine multiplies back out.
// Exact round-trip: (a / b) * b === a in IEEE double for these magnitudes —
// proven to the centavo on five real cutoffs by the test harness.
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface SheetImportResult {
  draft: ComputeDraft;
  matched: number;
  unmatched: string[]; // sheet rows with pay data but no app record
  excluded: string[]; // app-active people absent from the sheet (marked not paid)
  tipsPool: number;
}

export function buildDraftFromSheet(wb: ParsedWorkbook, employees: CompEmployee[]): SheetImportResult {
  const byFam = new Map(employees.map((e) => [key(e.family), e]));
  const perEmp: Record<string, EmployeeInputs> = {};
  const unmatched: string[] = [];
  const seen = new Set<string>();

  // Tips: the sheet stores each person's equal share; the pool is share ×
  // the number of tipped rows (the sheet's own headcount definition).
  const tipped = wb.payrollRows.filter((r) => (r.tips ?? 0) > 0);
  const tipsPool = tipped.length ? (tipped[0].tips ?? 0) * tipped.length : 0;

  for (const r of wb.payrollRows) {
    if (!hasPay(r)) continue;
    const e = byFam.get(key(r.family));
    if (!e) {
      unmatched.push(r.family.trim());
      continue;
    }
    seen.add(e.id);
    const daily = rowDaily(r);
    const inp: EmployeeInputs = {
      ...EMPTY_INPUTS,
      include: e.employeeType === 'daily' ? (r.days ?? 0) > 0 : true,
      days: r.days ?? '',
      otHours: r.otPay && daily ? round4(r.otPay / ((daily / 8) * 1.25)) : '',
      regularHolidays: r.regularPay && daily ? round4(r.regularPay / daily) : '',
      specialHolidays: r.specialPay && daily ? round4(r.specialPay / (daily * 0.3)) : '',
      unpaidDays: r.unpaidLeaves && daily ? round4(r.unpaidLeaves / daily) : '',
      adjustments: r.adjustments || '',
      others: r.others || '',
    };
    perEmp[e.id] = inp;
  }

  // App-active people the sheet doesn't pay this cutoff: mark not paid, so
  // they neither pollute the diff nor silently ride along.
  const excluded: string[] = [];
  for (const e of employees) {
    if (!perEmp[e.id]) {
      perEmp[e.id] = { ...EMPTY_INPUTS, include: false };
      excluded.push(e.family);
    }
  }

  const draft: ComputeDraft = {
    periodStart: iso(wb.periodStart),
    periodEnd: iso(wb.periodEnd),
    disbursement: iso(wb.disbursementDate),
    restDays: '',
    ridePax: '',
    ride2Pax: '',
    fortPax: '',
    serviceCharge: '',
    horsePax: '',
    tipBox: tipsPool ? round4(tipsPool) : '',
    perEmp,
  };
  return { draft, matched: seen.size, unmatched, excluded, tipsPool };
}

// ---------------------------------------------------------------------------

export interface DriftItem {
  employeeId: string;
  family: string;
  label: string; // human line: "SSS loan: app 610.57 → sheet 935.31"
  kind: 'field' | 'loan';
  fieldPatch?: Partial<CompEmployee>;
  loanKind?: Loan['kind'];
  loanNew?: number; // 0 = just end the existing ones
  loanOldIds?: string[];
}

export interface MastersDrift {
  items: DriftItem[];
  sheetOnly: string[]; // paid in the sheet, no app record
  appOnly: string[]; // active in app, absent from the sheet
}

const LOAN_LABEL: Record<Loan['kind'], string> = { sss: 'SSS loan', hdmf: 'HDMF loan', advance: 'Tanawin advance' };
const money2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function diffMastersAgainstSheet(
  wb: ParsedWorkbook,
  employees: CompEmployee[],
  loans: Loan[]
): MastersDrift {
  const byFam = new Map(employees.map((e) => [key(e.family), e]));
  const items: DriftItem[] = [];
  const sheetOnly: string[] = [];
  const disbIso = iso(wb.disbursementDate);
  const seen = new Set<string>();
  const near = (a: number | null, b: number | null) => Math.abs((a ?? 0) - (b ?? 0)) <= 0.005;

  for (const r of wb.payrollRows) {
    if (!hasPay(r)) continue;
    const e = byFam.get(key(r.family));
    if (!e) {
      sheetOnly.push(r.family.trim());
      continue;
    }
    seen.add(e.id);
    const fam = e.family;

    // Pay basis. Salaried rows carry basic+allowance; daily-basis rows only H.
    if (r.basic != null && !near(e.basicMonthly, r.basic)) {
      items.push({
        employeeId: e.id, family: fam, kind: 'field',
        label: `basic salary: app ${e.basicMonthly != null ? money2(e.basicMonthly) : '—'} → sheet ${money2(r.basic)}`,
        fieldPatch: { basicMonthly: r.basic },
      });
    }
    // Allowance applies to salaried AND daily-basis people (cortez carries
    // one during probation), so compare it whenever either side has a value.
    if ((r.allowance != null || e.allowanceMonthly != null) && !near(e.allowanceMonthly, r.allowance)) {
      items.push({
        employeeId: e.id, family: fam, kind: 'field',
        label: `allowance: app ${e.allowanceMonthly != null ? money2(e.allowanceMonthly) : '—'} → sheet ${r.allowance != null ? money2(r.allowance) : 'none'}`,
        fieldPatch: { allowanceMonthly: r.allowance ?? null },
      });
    }
    if (r.basic == null && r.daily != null && e.basicMonthly == null && !near(e.dailyRate, r.daily)) {
      items.push({
        employeeId: e.id, family: fam, kind: 'field',
        label: `daily rate: app ${e.dailyRate != null ? money2(e.dailyRate) : '—'} → sheet ${money2(r.daily)}`,
        fieldPatch: { dailyRate: r.daily },
      });
    }

    // Contributions (sheet stores the per-cutoff half). Only meaningful when
    // the sheet has any signal — probation rows leave all three blank.
    if (r.sss != null || r.philhealth != null || r.hdmf != null) {
      const checks: [string, number | null, number | null, keyof CompEmployee][] = [
        ['SSS monthly', e.mSss, r.sss != null ? r.sss * 2 : null, 'mSss'],
        ['PhilHealth monthly', e.mPhilhealth, r.philhealth != null ? r.philhealth * 2 : null, 'mPhilhealth'],
        ['Pag-IBIG monthly', e.mHdmf, r.hdmf != null ? r.hdmf * 2 : null, 'mHdmf'],
      ];
      for (const [name, appV, sheetV, field] of checks) {
        if (!near(appV, sheetV)) {
          items.push({
            employeeId: e.id, family: fam, kind: 'field',
            label: `${name}: app ${appV != null ? money2(appV) : '—'} → sheet ${sheetV != null ? money2(sheetV) : 'none'}`,
            fieldPatch: { [field]: sheetV } as Partial<CompEmployee>,
          });
        }
      }
    }

    // Loans by kind: the sheet's column is the truth for what deducts THIS
    // cutoff; the app side is the sum of loans active on the disbursement.
    const kinds: [Loan['kind'], number][] = [
      ['sss', r.sssLoan ?? 0],
      ['hdmf', r.hdmfLoan ?? 0],
      ['advance', r.advance ?? 0],
    ];
    for (const [kindName, sheetV] of kinds) {
      const mine = loans.filter(
        (l) => l.employeeId === e.id && l.kind === kindName && l.active && (!l.startsOn || l.startsOn <= disbIso)
      );
      const appV = mine.reduce((a, l) => a + l.perCutoff, 0);
      if (!near(appV, sheetV)) {
        items.push({
          employeeId: e.id, family: fam, kind: 'loan',
          label: `${LOAN_LABEL[kindName]}: app ${money2(appV)}/cutoff → sheet ${money2(sheetV)}`,
          loanKind: kindName,
          loanNew: sheetV,
          loanOldIds: mine.map((l) => l.id),
        });
      }
    }
  }

  const appOnly = employees.filter((e) => !seen.has(e.id)).map((e) => e.family);
  return { items, sheetOnly, appOnly };
}
