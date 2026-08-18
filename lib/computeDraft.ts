// The compute draft: one in-progress cutoff, shared between the Compute form
// and the per-person calculator on the Employees pages. Leaving a screen
// unmounts it — without the draft, every typed input would be lost (that
// bug cost Lexi her Aug 10 entries). Session-scoped; a successful Save to
// archive clears it so a finished cutoff never leaks into the next one.
import type { EmployeeInputs } from './engine';

const DRAFT_KEY = 'tanawin-payroll-compute-draft';

export interface ComputeDraft {
  periodStart: string;
  periodEnd: string;
  disbursement: string;
  restDays: number | '';
  ridePax: number | '';
  serviceCharge: number | '';
  horsePax: number | '';
  tipBox: number | '';
  perEmp: Record<string, EmployeeInputs>;
}

export function readDraft(): ComputeDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = sessionStorage.getItem(DRAFT_KEY);
    return s ? (JSON.parse(s) as ComputeDraft) : null;
  } catch {
    return null;
  }
}

export function writeDraft(d: ComputeDraft): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // storage full/unavailable — drafts are a convenience, never fatal
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}

export const EMPTY_INPUTS: EmployeeInputs = {
  include: true,
  days: '',
  otHours: '',
  regularHolidays: '',
  specialHolidays: '',
  paidLeaves: '',
  unpaidDays: '',
  adjustments: '',
  others: '',
};

// The two standing cutoffs, dated relative to today. Shared by the Compute
// form's quick-fill buttons and the per-person calculator.
export function cutoffDates(which: 10 | 25): { periodStart: string; periodEnd: string; disbursement: string } {
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (which === 10) {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    return { periodStart: iso(py, pm, 24), periodEnd: iso(y, m, 8), disbursement: iso(y, m, 10) };
  }
  return { periodStart: iso(y, m, 9), periodEnd: iso(y, m, 23), disbursement: iso(y, m, 25) };
}

export const EMPTY_DRAFT: Omit<ComputeDraft, 'perEmp'> = {
  periodStart: '',
  periodEnd: '',
  disbursement: '',
  restDays: '',
  ridePax: '',
  serviceCharge: '',
  horsePax: '',
  tipBox: '',
};
