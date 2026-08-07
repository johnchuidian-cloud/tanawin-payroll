// The payroll calculation engine — a faithful port of the asp_payroll sheet's
// formulas (extracted 2026-07-31 from the 260725 workbook). Pure functions,
// no I/O, so it can be tested head-to-head against real sheet outputs.
//
// Sheet ground truth:
//   daily          = basic*12/313            (payroll!H, divisor payroll!H4)
//   days in period = (end - start + 1) - rest days   (payroll!T4, rest = 2)
//   cutoff basic   = daily * days
//   allowance      = monthly / 2             (semi-monthly cutoffs)
//   overtime       = daily/8 * 1.25 * hours  (payroll!K, rate payroll!K4)
//   holiday pay    = daily * count * pct     (regular 100%, special 30%)
//   tips share     = pool / headcount        (tips!G5 = F5/G3)
//   gov deductions = monthly employee amount / 2
//   loan payments  = per-cutoff amount while active
//   unpaid leaves  = days * daily            (payroll!V = U*H)
import { looksSimilar } from './build';
import type { Payslip, RunWarning, SheetDate } from './types';

export const WORKING_DAYS_PER_YEAR = 313; // payroll!H4
export const OT_RATE = 1.25; // payroll!K4
export const REGULAR_HOLIDAY_PCT = 1.0; // holidays!K3
export const SPECIAL_HOLIDAY_PCT = 0.3; // holidays!K4
export const RIDE_PRICE = 100; // per pax, confirmed flat for all packages
export const HORSE_PRICE = 250; // tips!W3
export const DEFAULT_REST_DAYS = 2; // "always usually two" per 15-day cutoff
export const REGULARIZATION_MONTHS = 3;

export interface CompEmployee {
  id: string;
  family: string;
  given: string;
  email: string; // '' for dailies — they have no log entry or email
  team: string;
  employeeType: 'regular' | 'trainee' | 'daily';
  payoutChannel: 'paywise' | 'manual';
  paywiseName: string | null; // name EXACTLY as registered with PNB
  paywiseAccount: string | null;
  dateHired: string | null; // ISO
  probationEnd: string | null; // ISO — overrides the 3-months-from-hire default
  regularizedOn: string | null; // ISO
  contactNumber: string | null;
  birthday: string | null; // ISO
  basicMonthly: number | null;
  allowanceMonthly: number | null;
  dailyRate: number | null; // trainee fallback; salaried derive from basic
  benefitsClass: 'full' | 'regular' | 'probation' | null;
  benefitsLabel: string;
  mSss: number | null;
  mPhilhealth: number | null;
  mHdmf: number | null;
  leaveBalance: number | null;
}

export interface Loan {
  id: string;
  employeeId: string;
  kind: 'sss' | 'hdmf' | 'advance';
  perCutoff: number;
  note: string | null;
  active: boolean;
}

export interface EmployeeInputs {
  include: boolean;
  days: number | ''; // days worked; defaults to period days - rest days
  otHours: number | '';
  regularHolidays: number | ''; // days present on regular holidays
  specialHolidays: number | ''; // days present on special holidays
  paidLeaves: number | ''; // reduces leave balance, not pay
  unpaidDays: number | ''; // deducted at daily rate
  adjustments: number | '';
  others: number | ''; // other deductions (payroll!W)
}

export interface CutoffInputs {
  periodStart: SheetDate;
  periodEnd: SheetDate;
  disbursementDate: SheetDate;
  restDays: number;
  ridePax: number | '';
  serviceCharge: number | '';
  horsePax: number | '';
  tipBox: number | '';
  perEmployee: Record<string, EmployeeInputs>; // by employee id
}

const n = (v: number | '' | null | undefined): number => (v === '' || v == null ? 0 : v);

export function dailyRateOf(e: CompEmployee): number | null {
  if (e.basicMonthly != null) return (e.basicMonthly * 12) / WORKING_DAYS_PER_YEAR;
  return e.dailyRate;
}

export function daysBetweenInclusive(a: SheetDate, b: SheetDate): number {
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000) + 1;
}

export function defaultDays(inputs: Pick<CutoffInputs, 'periodStart' | 'periodEnd' | 'restDays'>): number {
  return daysBetweenInclusive(inputs.periodStart, inputs.periodEnd) - inputs.restDays;
}

export function tipsPool(inputs: CutoffInputs): number {
  return n(inputs.ridePax) * RIDE_PRICE + n(inputs.serviceCharge) + n(inputs.horsePax) * HORSE_PRICE + n(inputs.tipBox);
}

function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d;
}

export interface ComputedRun {
  payslips: Payslip[];
  warnings: RunWarning[];
}

export function computeRun(
  employees: CompEmployee[],
  loans: Loan[],
  inputs: CutoffInputs
): ComputedRun {
  const warnings: RunWarning[] = [];
  const payslips: Payslip[] = [];

  const included = employees.filter((e) => inputs.perEmployee[e.id]?.include);
  // Dailies are paid daily rate × days only — no tips share, and they don't
  // dilute the pool (matches the sheet: its headcount counts rows 6-18 only).
  const headcount = included.filter((e) => e.employeeType !== 'daily').length;
  const pool = tipsPool(inputs);
  const tipShare = headcount > 0 ? pool / headcount : 0;
  if (pool > 0) {
    warnings.push({
      severity: 'info',
      message: `Tips pool ₱${pool.toFixed(2)} (rides ${n(inputs.ridePax)}×${RIDE_PRICE} + service ${n(inputs.serviceCharge).toFixed(2)} + horse ${n(inputs.horsePax)}×${HORSE_PRICE} + tip box ${n(inputs.tipBox).toFixed(2)}) ÷ ${headcount} = ${tipShare.toFixed(2)} each.`,
    });
  }

  for (const e of included) {
    const inp = inputs.perEmployee[e.id];
    const daily = dailyRateOf(e);
    if (daily == null) {
      warnings.push({
        severity: 'error',
        message: `${e.family}: no basic salary or daily rate on file — payslip skipped. Fill it in on the Employees screen.`,
      });
      continue;
    }
    const days = inp.days === '' ? defaultDays(inputs) : inp.days;
    const isDaily = e.employeeType === 'daily';

    const eBasic = daily * days;
    const eAllowance = !isDaily && e.allowanceMonthly != null ? e.allowanceMonthly / 2 : null;
    const eOvertime = n(inp.otHours) > 0 ? (daily / 8) * OT_RATE * n(inp.otHours) : null;
    const holiday =
      daily * REGULAR_HOLIDAY_PCT * n(inp.regularHolidays) +
      daily * SPECIAL_HOLIDAY_PCT * n(inp.specialHolidays);
    const eHoliday = holiday > 0 ? holiday : null;
    const eAdjustments = n(inp.adjustments) !== 0 ? n(inp.adjustments) : null;
    const eTips = !isDaily && tipShare > 0 ? tipShare : null;
    const totalEarnings =
      eBasic + (eAllowance ?? 0) + (eOvertime ?? 0) + (eHoliday ?? 0) + (eAdjustments ?? 0) + (eTips ?? 0);

    const dUnpaid = n(inp.unpaidDays) > 0 ? n(inp.unpaidDays) * daily : null;
    const dSss = e.mSss != null && e.mSss > 0 ? e.mSss / 2 : null;
    const dPhilhealth = e.mPhilhealth != null && e.mPhilhealth > 0 ? e.mPhilhealth / 2 : null;
    const dHdmf = e.mHdmf != null && e.mHdmf > 0 ? e.mHdmf / 2 : null;
    const myLoans = loans.filter((l) => l.employeeId === e.id && l.active);
    // Negative sums are REFUNDS (e.g. the 2026 HDMF refunds after EGOV
    // payments lapsed and HDMF collected from contributions instead) — they
    // must flow through as negative deductions, exactly like the sheet's.
    const loanSum = (kind: Loan['kind']) => {
      const s = myLoans.filter((l) => l.kind === kind).reduce((a, l) => a + l.perCutoff, 0);
      return s !== 0 ? s : null;
    };
    const dSssLoan = loanSum('sss');
    const dHdmfLoan = loanSum('hdmf');
    const dAdvance = loanSum('advance');
    const dOthers = n(inp.others) !== 0 ? n(inp.others) : null;
    const totalDeductions =
      (dUnpaid ?? 0) + (dSss ?? 0) + (dPhilhealth ?? 0) + (dHdmf ?? 0) +
      (dSssLoan ?? 0) + (dHdmfLoan ?? 0) + (dAdvance ?? 0) + (dOthers ?? 0);

    payslips.push({
      employeeId: e.id,
      family: e.family,
      given: e.given,
      email: e.email,
      department: e.team,
      daysInPeriod: days,
      dailyRate: daily,
      basicMonthly: e.basicMonthly,
      allowanceMonthly: e.allowanceMonthly,
      totalMonthlyComp:
        e.basicMonthly != null ? e.basicMonthly + (e.allowanceMonthly ?? 0) : null,
      benefits: e.benefitsLabel,
      leavesRemaining:
        e.leaveBalance != null ? e.leaveBalance - n(inp.paidLeaves) : null,
      earnings: {
        basic: eBasic,
        allowance: eAllowance,
        overtime: eOvertime,
        meal: null,
        holiday: eHoliday,
        adjustments: eAdjustments,
        tips: eTips,
        total: totalEarnings,
      },
      deductions: {
        unpaidLeaves: dUnpaid,
        sss: dSss,
        philhealth: dPhilhealth,
        hdmf: dHdmf,
        sssLoan: dSssLoan,
        hdmfLoan: dHdmfLoan,
        cashAdvance: dAdvance,
        others: dOthers,
        total: totalDeductions,
      },
      netPay: totalEarnings - totalDeductions,
    });

    // Regularization tripwire: explicit probation end if set, else 3 months
    // from start date. Starts whole.
    if (e.benefitsClass === 'probation' && (e.probationEnd || e.dateHired)) {
      const due = e.probationEnd
        ? new Date(e.probationEnd)
        : addMonths(e.dateHired!, REGULARIZATION_MONTHS);
      const periodEnd = new Date(Date.UTC(inputs.periodEnd.y, inputs.periodEnd.m - 1, inputs.periodEnd.d));
      if (due.getTime() <= periodEnd.getTime()) {
        warnings.push({
          severity: 'warning',
          message: `${e.family} hits ${REGULARIZATION_MONTHS} months on ${due.getFullYear()}/${due.getMonth() + 1}/${due.getDate()} — regularize? (set benefits class, basic salary, contributions and leave allotment on the Employees screen)`,
        });
      }
    }
  }

  payslips.sort((a, b) => a.family.localeCompare(b.family));
  return { payslips, warnings };
}

// Parallel-run diff: computed run vs sheet run for the same cutoff, to the
// centavo. This is the gate the sheet retires behind.
const DIFF_TOLERANCE = 0.01;

export function compareRuns(
  computed: Payslip[],
  sheet: Payslip[],
  // Dailies are app-only (the sheet never gives them payslips) — exclude them
  // from the diff so they don't read as false mismatches.
  skipFamilies?: Set<string>
): RunWarning[] {
  const out: RunWarning[] = [];
  const byFam = (list: Payslip[]) =>
    new Map(
      list
        .filter((p) => !skipFamilies?.has(p.family.toLowerCase()))
        .map((p) => [p.family.toLowerCase(), p])
    );
  const c = byFam(computed);
  const s = byFam(sheet);
  // A rename mid-parallel (salenga → salenga-frias) shows up as one person
  // "missing" from each side under two similar surnames. Say that plainly
  // instead of raising two alarming missing-person errors.
  const missingFromSheet = [...c.keys()].filter((f) => !s.has(f));
  const missingFromComputed = [...s.keys()].filter((f) => !c.has(f));
  const renamed = new Set<string>();
  for (const cf of missingFromSheet) {
    const match = missingFromComputed.find((sf) => looksSimilar(cf, sf));
    if (match) {
      renamed.add(cf);
      renamed.add(match);
      out.push({
        severity: 'warning',
        message: `Parallel run: "${cf}" (computed) and "${match}" (sheet upload) look like the same person with different spellings. If someone was renamed, re-upload the current sheet so the names match.`,
      });
    }
  }

  for (const [fam, cp] of c) {
    const sp = s.get(fam);
    if (!sp) {
      if (!renamed.has(fam)) {
        out.push({ severity: 'error', message: `Parallel run: ${fam} is in the computed run but not in the sheet upload.` });
      }
      continue;
    }
    const checks: [string, number, number][] = [
      ['total earnings', cp.earnings.total, sp.earnings.total],
      ['total deductions', cp.deductions.total, sp.deductions.total],
      ['net pay', cp.netPay, sp.netPay],
    ];
    for (const [label, a, b] of checks) {
      if (Math.abs(a - b) > DIFF_TOLERANCE) {
        out.push({
          severity: 'error',
          message: `Parallel run: ${fam} ${label} differs — app ${a.toFixed(2)} vs sheet ${b.toFixed(2)} (Δ ${(a - b).toFixed(2)}).`,
        });
      }
    }
  }
  for (const fam of s.keys()) {
    if (!c.has(fam) && !renamed.has(fam)) {
      out.push({ severity: 'error', message: `Parallel run: ${fam} is in the sheet upload but not in the computed run.` });
    }
  }
  if (!out.length) {
    out.push({
      severity: 'info',
      message: `Parallel run: computed payslips match the sheet upload to the centavo for all ${computed.length} employees. ✅`,
    });
  }
  return out;
}
