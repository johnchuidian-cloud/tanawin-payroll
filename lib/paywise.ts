// Generate the PNB Paywise upload file — an .xls matching the bank's
// "PayWise XLS FileWriter" template exactly (headers + meta block in row 1,
// then name / account / amount rows).
import * as XLSX from 'xlsx';
import type { MasterEmployee } from './masters';
import type { Payslip, SheetDate } from './types';

export interface PaywiseSettings {
  sourceAccount: string;
  time: string; // e.g. "06:00 AM"
}

export interface PaywiseRow {
  name: string;
  account: string;
  amount: number;
}

// Match payslips to Paywise-channel employees (by id when available, else surname).
export function paywiseRows(payslips: Payslip[], employees: MasterEmployee[]): {
  rows: PaywiseRow[];
  missingAccount: string[];
} {
  const rows: PaywiseRow[] = [];
  const missingAccount: string[] = [];
  for (const p of payslips) {
    const e =
      employees.find((x) => x.id === p.employeeId) ??
      employees.find((x) => x.family.toLowerCase() === p.family.toLowerCase());
    if (!e || e.payoutChannel !== 'paywise') continue;
    if (!e.paywiseName || !e.paywiseAccount) {
      missingAccount.push(p.family);
      continue;
    }
    rows.push({ name: e.paywiseName, account: e.paywiseAccount, amount: Math.round(p.netPay * 100) / 100 });
  }
  return { rows, missingAccount };
}

export function manualRows(payslips: Payslip[], employees: MasterEmployee[]): PaywiseRow[] {
  const rows: PaywiseRow[] = [];
  for (const p of payslips) {
    const e =
      employees.find((x) => x.id === p.employeeId) ??
      employees.find((x) => x.family.toLowerCase() === p.family.toLowerCase());
    if (!e || e.payoutChannel !== 'manual') continue;
    rows.push({
      name: `${e.given} ${e.family}`.trim(),
      account: '',
      amount: Math.round(p.netPay * 100) / 100,
    });
  }
  return rows;
}

function excelSerial(d: SheetDate): number {
  // days since 1899-12-30 (Excel 1900 system)
  return Math.round((Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(1899, 11, 30)) / 86400000);
}

export function buildPaywiseXls(
  rows: PaywiseRow[],
  disbursement: SheetDate,
  settings: PaywiseSettings
): { blob: Blob; filename: string } {
  const total = Math.round(rows.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  const aoa: (string | number)[][] = [
    [
      'EMPLOYEE NAME', 'ACCOUNT NUMBER*', 'AMOUNT*', 'REMARKS',
      'SOURCE ACCOUNT:*', settings.sourceAccount,
      'PAYROLL DATE:*', excelSerial(disbursement),
      'PAYROLL TIME:*', settings.time,
      'TOTAL AMOUNT:', total,
      'TOTAL COUNT:', rows.length,
    ],
    ...rows.map((r) => [r.name, r.account, r.amount]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'PayWise XLS FileWriter');
  const out = XLSX.write(wb, { bookType: 'xls', type: 'array' });
  const y = disbursement.y % 100;
  const name = `${String(y).padStart(2, '0')}${String(disbursement.m).padStart(2, '0')}${String(disbursement.d).padStart(2, '0')}.PayWise XLS FileWriter.xls`;
  return { blob: new Blob([out], { type: 'application/vnd.ms-excel' }), filename: name };
}
