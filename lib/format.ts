import type { SheetDate } from './types';

// Blank and zero both render as `-` — an employee should never wonder
// whether a blank line means "nothing" or "we forgot".
export function money(n: number | null | undefined): string {
  if (n == null || n === 0) return '-';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Counts (days, leaves) share the blank/zero rule but it's fine to reuse money()
// for them — the sheet shows 13.00 / 3.00 with two decimals too.

// Year/month/day everywhere (Lexi, 2026-08-04) — matches the workbook file
// naming (YYYYMMDD) so the app and its Excel exports read the same way.
// Payslips included, by her explicit choice A.
export function fmtDate(d: SheetDate | null | undefined): string {
  if (!d) return '';
  return `${d.y}/${d.m}/${d.d}`;
}

// Same format for JS Date values (archive timestamps and the like).
export function fmtJsDate(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function fmtDateCompact(d: SheetDate | null | undefined): string {
  if (!d) return 'undated';
  return `${d.y}${String(d.m).padStart(2, '0')}${String(d.d).padStart(2, '0')}`;
}

// `de guzman` → `de_guzman`
export function slug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

export function payslipFilename(
  family: string,
  given: string,
  disbursement: SheetDate | null
): string {
  return `${slug(family)}_${slug(given)}_${fmtDateCompact(disbursement)}.pdf`;
}

export function zipFilename(disbursement: SheetDate | null): string {
  return `tanawin-payslips-${fmtDateCompact(disbursement)}.zip`;
}
