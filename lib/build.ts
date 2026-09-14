import type { BuildResult, ParsedWorkbook, Payslip, PayrollRow, RunWarning } from './types';

// Surname is THE match key — employee numbers have known discrepancies
// between the two tabs. Lowercase, trim, compare.
const key = (family: string) => family.trim().toLowerCase();

// Near-match detection for the warning HINT only. The join itself stays
// exact-match on purpose: a fuzzy auto-join could pair the wrong person with
// the wrong email, which is the one mistake this app exists to prevent
// (e.g. "mananzala" and "manzala" are DIFFERENT people one letter apart).
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

export function looksSimilar(a: string, b: string): boolean {
  // hyphen/space-boundary prefix: "salenga" vs "salenga-frias"
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.startsWith(shorter) && (longer.length === shorter.length || '- '.includes(longer[shorter.length]))) {
    return true;
  }
  return editDistance(a, b) <= 2;
}

const sum = (...vals: (number | null)[]) =>
  vals.reduce<number>((acc, v) => acc + (v ?? 0), 0);

// Tolerance for the sheet-vs-app cross-checks: anything beyond a rounding
// hair means a mis-mapped column and must be loud.
const TOLERANCE = 0.01;

function computePayslip(p: PayrollRow, email: string): Payslip {
  // The only arithmetic this app performs — replicating the sheet's payslip tab:
  const eBasic = p.daily != null && p.days != null ? p.daily * p.days : null;
  const eAllowance = p.allowance != null ? p.allowance / 2 : null; // semi-monthly cutoff
  const eHoliday = p.regularPay == null && p.specialPay == null ? null : sum(p.regularPay, p.specialPay);

  const totalEarnings = sum(eBasic, eAllowance, p.otPay, p.otMeals, eHoliday, p.adjustments, p.tips);
  const totalDeductions = sum(
    p.unpaidLeaves, p.sss, p.philhealth, p.hdmf, p.sssLoan, p.hdmfLoan, p.advance, p.others
  );

  return {
    family: p.family.trim(),
    given: p.given.trim(),
    email,
    department: p.team,
    daysInPeriod: p.days,
    dailyRate: p.daily,
    basicMonthly: p.basic,
    allowanceMonthly: p.allowance,
    totalMonthlyComp: p.totalComp,
    benefits: p.benefits,
    leavesRemaining: p.leaves,
    earnings: {
      basic: eBasic,
      allowance: eAllowance,
      overtime: p.otPay,
      meal: p.otMeals,
      holiday: eHoliday,
      adjustments: p.adjustments,
      tips: p.tips,
      total: totalEarnings,
    },
    deductions: {
      unpaidLeaves: p.unpaidLeaves,
      sss: p.sss,
      philhealth: p.philhealth,
      hdmf: p.hdmf,
      sssLoan: p.sssLoan,
      hdmfLoan: p.hdmfLoan,
      cashAdvance: p.advance,
      others: p.others,
      total: totalDeductions,
    },
    netPay: totalEarnings - totalDeductions,
  };
}

export function buildRun(wb: ParsedWorkbook): BuildResult {
  const warnings: RunWarning[] = [];
  const logByKey = new Map(wb.logRows.map((l) => [key(l.family), l]));
  const payrollKeys = new Set(wb.payrollRows.map((p) => key(p.family)));

  const payslips: Payslip[] = [];
  const notInLog: string[] = [];
  const noEmail: string[] = [];

  for (const p of wb.payrollRows) {
    const logRow = logByKey.get(key(p.family));
    if (!logRow) {
      // On-call / irregular staff — expected, informational only.
      notInLog.push(p.family.trim());
      continue;
    }
    if (!logRow.email) {
      noEmail.push(p.family.trim());
      continue;
    }
    const slip = computePayslip(p, logRow.email);
    payslips.push(slip);

    // Cross-check guards against a mis-mapped column — and against hand-typed
    // totals the columns can't explain (razon's June final pay was typed
    // straight into AE, ₱9,365 above her columns; a payslip printed from the
    // columns would understate her actual pay). Errors, not warnings: this is
    // the only guard between an override and a wrong payslip.
    if (p.cutoffTotal != null && Math.abs(p.cutoffTotal - slip.earnings.total) > TOLERANCE) {
      warnings.push({
        severity: 'error',
        message: `${slip.family}: computed total earnings (${slip.earnings.total.toFixed(2)}) does not match the sheet's cut off total (${p.cutoffTotal.toFixed(2)}). Their payslip would show the wrong amount — check the workbook before sending.`,
      });
    }
    if (p.totalPay != null && Math.abs(p.totalPay - slip.netPay) > TOLERANCE) {
      warnings.push({
        severity: 'error',
        message: `${slip.family}: computed net pay (${slip.netPay.toFixed(2)}) does not match the sheet's total pay (${p.totalPay.toFixed(2)}). Their payslip would show the wrong amount — check the workbook before sending.`,
      });
    }
  }

  // In log but missing from payroll — someone who should have been paid and
  // wasn't must be loud, not silent.
  const notInPayroll: string[] = [];
  for (const l of wb.logRows) {
    if (!payrollKeys.has(key(l.family))) notInPayroll.push(l.family.trim());
    if (!l.email) {
      // Even if they're also missing pay data, a log row without an email is
      // its own blocking problem.
      if (!noEmail.includes(l.family.trim())) noEmail.push(l.family.trim());
    }
  }

  if (notInLog.length) {
    warnings.push({
      severity: 'info',
      message: `In payroll but not in log — no payslip (not in log): ${notInLog.join(', ')}`,
    });
  }
  for (const name of notInPayroll) {
    const candidate = notInLog.find((p) => looksSimilar(key(p), key(name)));
    warnings.push({
      severity: 'error',
      message:
        `${name} is in log but has no pay data — check the sheet.` +
        (candidate
          ? ` Similar surname "${candidate}" is in payroll but not in log — same person? Make the surnames match in both tabs.`
          : ''),
    });
  }
  for (const name of noEmail) {
    warnings.push({
      severity: 'error',
      message: `${name} is in log but has no email address — payslip blocked until an email is added.`,
    });
  }
  if (wb.cutoffs != null && wb.cutoffs !== 2) {
    warnings.push({
      severity: 'warning',
      message: `payroll!B3 (cutoffs) is ${wb.cutoffs}, not 2 — the allowance ÷ 2 line assumes semi-monthly cutoffs. Verify allowances before sending.`,
    });
  }
  if (!wb.disbursementDate) {
    warnings.push({
      severity: 'warning',
      message: 'No disbursement date found in payroll!F2 — filenames will say "undated".',
    });
  }

  return { payslips, warnings, notInLog, notInPayroll, noEmail };
}
