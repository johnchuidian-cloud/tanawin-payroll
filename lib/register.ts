// Generate the payroll register — the app's own version of the sheet's
// payroll tab: one row per employee, every earnings and deduction line.
// This is the document of record for a computed run (and the heart of the
// future DOLE pack).
import * as XLSX from 'xlsx';
import { COMPANY_NAME } from './company';
import { fmtDate, fmtDateCompact } from './format';
import type { Payslip, SheetDate } from './types';

// The register's "notes" cell: labeled adds/deducts + the free-text note,
// one readable string ("adds: back pay 1200 · deducts: uniform share 600 · half day 9/2").
function notesCell(p: Payslip): string {
  const parts: string[] = [];
  if (p.adjustItems?.length)
    parts.push(`adds: ${p.adjustItems.map((it) => `${it.label || 'addition'} ${it.amount}`).join(', ')}`);
  if (p.deductItems?.length)
    parts.push(`deducts: ${p.deductItems.map((it) => `${it.label || 'deduction'} ${it.amount}`).join(', ')}`);
  if (p.note) parts.push(p.note);
  return parts.join(' · ');
}

export function buildRegisterXlsx(
  payslips: Payslip[],
  meta: { periodStart: SheetDate | null; periodEnd: SheetDate | null; disbursementDate: SheetDate | null; note?: string | null }
): { blob: Blob; filename: string } {
  const n = (v: number | null) => (v == null ? '' : Math.round(v * 100) / 100);
  const header = [
    'family', 'given', 'department', 'days', 'daily rate',
    'basic', 'allowance', 'overtime', 'meal', 'holiday', 'adjustments', 'tips', 'TOTAL EARNINGS',
    'unpaid leaves', 'sss', 'philhealth', 'hdmf', 'sss loan', 'hdmf loan', 'cash advance', 'others', 'TOTAL DEDUCTIONS',
    'NET PAY', 'leaves remaining', 'notes',
  ];
  const rows = payslips.map((p) => [
    p.family, p.given, p.department, n(p.daysInPeriod), n(p.dailyRate),
    n(p.earnings.basic), n(p.earnings.allowance), n(p.earnings.overtime), n(p.earnings.meal),
    n(p.earnings.holiday), n(p.earnings.adjustments), n(p.earnings.tips), n(p.earnings.total),
    n(p.deductions.unpaidLeaves), n(p.deductions.sss), n(p.deductions.philhealth), n(p.deductions.hdmf),
    n(p.deductions.sssLoan), n(p.deductions.hdmfLoan), n(p.deductions.cashAdvance), n(p.deductions.others),
    n(p.deductions.total), n(p.netPay), n(p.leavesRemaining), notesCell(p),
  ]);
  const totals = [
    'TOTAL', '', '', '', '',
    ...([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] as const).map((col) =>
      Math.round(rows.reduce((a, r) => a + (typeof r[col] === 'number' ? (r[col] as number) : 0), 0) * 100) / 100
    ),
    '', '',
  ];
  const aoa: (string | number)[][] = [
    [`${COMPANY_NAME} — Payroll register`],
    [
      `pay period ${fmtDate(meta.periodStart)} to ${fmtDate(meta.periodEnd)}`,
      '', '', `disbursement ${fmtDate(meta.disbursementDate)}`,
    ],
    ...(meta.note?.trim() ? [[`note: ${meta.note.trim()}`]] : []),
    [],
    header,
    ...rows,
    [],
    totals,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'payroll register');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return {
    blob: new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename: `payroll-register-${fmtDateCompact(meta.disbursementDate)}.xlsx`,
  };
}
