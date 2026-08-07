// A date read from an xlsx serial — kept as plain fields to avoid timezone drift.
export interface SheetDate {
  y: number;
  m: number;
  d: number;
}

export interface PayrollRow {
  row: number; // 1-indexed sheet row, for error messages
  family: string;
  given: string;
  employeeNo: string;
  team: string;
  basic: number | null; // F — basic salary (monthly)
  allowance: number | null; // G — allowance (monthly)
  daily: number | null; // H — daily rate
  leaves: number | null; // I — leaves remaining
  otPay: number | null; // K
  otMeals: number | null; // L
  regularPay: number | null; // N — holiday pay part 1
  specialPay: number | null; // P — holiday pay part 2
  tips: number | null; // Q
  adjustments: number | null; // R
  days: number | null; // S — # of days worked
  cutoffTotal: number | null; // T — sheet's own total earnings (cross-check)
  unpaidLeaves: number | null; // V — unpaid leave AMOUNT (U days × daily rate)
  others: number | null; // W
  sss: number | null; // X
  philhealth: number | null; // Y
  hdmf: number | null; // Z
  sssLoan: number | null; // AA
  hdmfLoan: number | null; // AB
  advance: number | null; // AC — tanawin cash advance
  totalPay: number | null; // AE — sheet's own net pay (cross-check)
  totalComp: number | null; // AF
  benefits: string; // AG
}

export interface LogRow {
  row: number;
  family: string;
  given: string;
  employeeNo: string;
  team: string;
  dateHired: SheetDate | null;
  email: string;
}

export interface ParsedWorkbook {
  periodStart: SheetDate | null; // payroll!B2
  periodEnd: SheetDate | null; // payroll!C2
  disbursementDate: SheetDate | null; // payroll!F2
  cutoffs: number | null; // payroll!B3 — the ÷2 comes from here
  payrollRows: PayrollRow[];
  logRows: LogRow[];
  sourceFilename: string;
}

export type WarningSeverity = 'info' | 'warning' | 'error';

export interface RunWarning {
  severity: WarningSeverity;
  message: string;
}

// One fully computed payslip, ready to render.
export interface Payslip {
  employeeId?: string; // set by the calc engine; sheet uploads resolve via family
  family: string;
  given: string;
  email: string;
  department: string;
  daysInPeriod: number | null;
  dailyRate: number | null;
  basicMonthly: number | null;
  allowanceMonthly: number | null;
  totalMonthlyComp: number | null;
  benefits: string;
  leavesRemaining: number | null;
  earnings: {
    basic: number | null; // daily × days
    allowance: number | null; // monthly ÷ 2
    overtime: number | null;
    meal: number | null;
    holiday: number | null; // N + P
    adjustments: number | null;
    tips: number | null;
    total: number;
  };
  deductions: {
    unpaidLeaves: number | null;
    sss: number | null;
    philhealth: number | null;
    hdmf: number | null;
    sssLoan: number | null;
    hdmfLoan: number | null;
    cashAdvance: number | null;
    others: number | null;
    total: number;
  };
  netPay: number;
}

export interface BuildResult {
  payslips: Payslip[];
  warnings: RunWarning[];
  notInLog: string[]; // payroll surnames with no payslip
  notInPayroll: string[]; // log surnames missing pay data
  noEmail: string[]; // log surnames with no email
}
