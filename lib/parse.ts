import * as XLSX from 'xlsx';
import type { LogRow, ParsedWorkbook, PayrollRow, SheetDate } from './types';

const MAX_SCAN_ROW = 200; // hard stop, well past any real payroll

function cellValue(sheet: XLSX.WorkSheet, addr: string): unknown {
  const c = sheet[addr];
  return c ? c.v : null;
}

function asString(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

// Blank cells arrive as null/'' — both mean "no value", kept distinct from 0
// only until formatting (where both render as `-`).
function asNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function asDate(v: unknown): SheetDate | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? { y: d.y, m: d.m, d: d.d } : null;
  }
  // Occasionally a date comes through as text like "6/24/2026"
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? { y: Number(m[3]), m: Number(m[1]), d: Number(m[2]) } : null;
}

export class ParseError extends Error {}

export function parseWorkbook(buf: ArrayBuffer, filename: string): ParsedWorkbook {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array' });
  } catch {
    throw new ParseError(
      'Could not read this file as an Excel workbook. Make sure it is the .xlsx downloaded from Google Sheets (File → Download → Microsoft Excel).'
    );
  }

  const pay = wb.Sheets['payroll'];
  const log = wb.Sheets['log'];
  const missing: string[] = [];
  if (!pay) missing.push('payroll');
  if (!log) missing.push('log');
  if (missing.length) {
    throw new ParseError(
      `The workbook is missing the ${missing.map((t) => `"${t}"`).join(' and ')} tab${missing.length > 1 ? 's' : ''}. ` +
        `Found tabs: ${wb.SheetNames.join(', ')}. Download the whole workbook, not a single sheet.`
    );
  }

  // --- payroll tab: header row 5, data from row 6 until family (col A) is blank ---
  const payrollRows: PayrollRow[] = [];
  for (let r = 6; r <= MAX_SCAN_ROW; r++) {
    const family = asString(cellValue(pay, `A${r}`));
    if (!family) break;
    payrollRows.push({
      row: r,
      family,
      given: asString(cellValue(pay, `B${r}`)),
      employeeNo: asString(cellValue(pay, `C${r}`)),
      team: asString(cellValue(pay, `E${r}`)),
      basic: asNumber(cellValue(pay, `F${r}`)),
      allowance: asNumber(cellValue(pay, `G${r}`)),
      daily: asNumber(cellValue(pay, `H${r}`)),
      leaves: asNumber(cellValue(pay, `I${r}`)),
      otPay: asNumber(cellValue(pay, `K${r}`)),
      otMeals: asNumber(cellValue(pay, `L${r}`)),
      regularPay: asNumber(cellValue(pay, `N${r}`)),
      specialPay: asNumber(cellValue(pay, `P${r}`)),
      tips: asNumber(cellValue(pay, `Q${r}`)),
      adjustments: asNumber(cellValue(pay, `R${r}`)),
      days: asNumber(cellValue(pay, `S${r}`)),
      cutoffTotal: asNumber(cellValue(pay, `T${r}`)),
      // V, not U: the sheet's own formula is V = U × daily rate and its
      // deductions total AD sums V — U is just the day COUNT.
      unpaidLeaves: asNumber(cellValue(pay, `V${r}`)),
      others: asNumber(cellValue(pay, `W${r}`)),
      sss: asNumber(cellValue(pay, `X${r}`)),
      philhealth: asNumber(cellValue(pay, `Y${r}`)),
      hdmf: asNumber(cellValue(pay, `Z${r}`)),
      sssLoan: asNumber(cellValue(pay, `AA${r}`)),
      hdmfLoan: asNumber(cellValue(pay, `AB${r}`)),
      advance: asNumber(cellValue(pay, `AC${r}`)),
      totalPay: asNumber(cellValue(pay, `AE${r}`)),
      totalComp: asNumber(cellValue(pay, `AF${r}`)),
      benefits: asString(cellValue(pay, `AG${r}`)),
    });
  }

  // --- log tab: header row 11, data from row 12 until family name (col A) is blank ---
  const logRows: LogRow[] = [];
  for (let r = 12; r <= MAX_SCAN_ROW; r++) {
    const family = asString(cellValue(log, `A${r}`));
    if (!family) break;
    logRows.push({
      row: r,
      family,
      given: asString(cellValue(log, `B${r}`)),
      employeeNo: asString(cellValue(log, `C${r}`)),
      team: asString(cellValue(log, `D${r}`)),
      dateHired: asDate(cellValue(log, `F${r}`)),
      email: asString(cellValue(log, `G${r}`)),
    });
  }

  if (!payrollRows.length) {
    throw new ParseError(
      'The "payroll" tab has no data rows (row 6 down, surname in column A). Check that the right workbook was uploaded.'
    );
  }

  return {
    periodStart: asDate(cellValue(pay, 'B2')),
    periodEnd: asDate(cellValue(pay, 'C2')),
    disbursementDate: asDate(cellValue(pay, 'F2')),
    cutoffs: asNumber(cellValue(pay, 'B3')),
    payrollRows,
    logRows,
    sourceFilename: filename,
  };
}
