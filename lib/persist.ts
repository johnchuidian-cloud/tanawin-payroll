import { supabase } from './supabase';
import type { BuildResult, ParsedWorkbook, Payslip, RunWarning, SheetDate } from './types';

export type RunSource = 'sheet' | 'computed';

export interface RunSummary {
  id: string;
  period_start: string;
  period_end: string;
  disbursement_date: string;
  employee_count: number;
  source_filename: string | null;
  source: RunSource;
  created_at: string;
}

export interface LoadedRun {
  id: string;
  meta: {
    periodStart: SheetDate | null;
    periodEnd: SheetDate | null;
    disbursementDate: SheetDate | null;
    sourceFilename: string;
    uploadedAt: string;
  };
  payslips: Payslip[];
  warnings: RunWarning[];
}

function toISO(d: SheetDate | null): string | null {
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
}

function fromISO(s: string | null): SheetDate | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

// True once migration-002 (calc masters + runs.source) has been applied.
// Cached per page load; keeps the sheet-upload flow working pre-migration.
let migrationReadyCache: boolean | null = null;
export async function migrationReady(): Promise<boolean> {
  if (!supabase) return false;
  if (migrationReadyCache !== null) return migrationReadyCache;
  const { error } = await supabase.from('loans').select('id').limit(1);
  migrationReadyCache = !error;
  return migrationReadyCache;
}

export async function listRuns(): Promise<RunSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('payroll_runs')
    .select('*')
    .order('disbursement_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Could not load the archive: ${error.message}`);
  return (data ?? []).map((r) => ({ ...r, source: r.source ?? 'sheet' })) as RunSummary[];
}

// Saves one upload as an archive entry. Re-uploading the same cutoff
// (same period + disbursement date) replaces the previous entry so the
// archive stays one-row-per-cutoff instead of accumulating retries.
export async function saveRun(
  wb: ParsedWorkbook,
  run: BuildResult
): Promise<{ replaced: boolean; runId: string }> {
  if (!supabase) throw new Error('Archive storage is not connected.');
  const periodStart = toISO(wb.periodStart);
  const periodEnd = toISO(wb.periodEnd);
  const disbursement = toISO(wb.disbursementDate);
  if (!periodStart || !periodEnd || !disbursement) {
    throw new Error('Cannot archive a run without pay period and disbursement dates.');
  }

  // 1. Sync employee master from the log tab (email is required by the schema —
  //    log rows without one are excluded here and already flagged as errors).
  const employees = wb.logRows
    .filter((l) => l.email)
    .map((l) => ({
      family_name: l.family.trim().toLowerCase(),
      given_name: l.given.trim(),
      employee_no: l.employeeNo || null,
      team: l.team || null,
      email: l.email,
      date_hired: toISO(l.dateHired),
      // NOTE: no `active` here — the log sync must not resurrect staff
      // deactivated in the app (new rows get active=true from the default).
      updated_at: new Date().toISOString(),
    }));
  {
    const { error } = await supabase
      .from('employees')
      .upsert(employees, { onConflict: 'family_name' });
    if (error) throw new Error(`Could not sync employees: ${error.message}`);
  }

  // 2. Replace any previous SHEET upload of this same cutoff (cascade removes
  //    its payslips and warnings). A computed run for the same cutoff survives
  //    — the parallel-run diff needs both.
  const sourceAware = await migrationReady();
  const { data: existing, error: exErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('disbursement_date', disbursement);
  if (exErr) throw new Error(`Could not check the archive: ${exErr.message}`);
  const toReplace = (existing ?? []).filter((r) => (r.source ?? 'sheet') === 'sheet');
  if (toReplace.length) {
    // Attached files of the replaced run would otherwise be orphaned forever.
    for (const r of toReplace) await removeRunFiles(r.id);
    const { error } = await supabase
      .from('payroll_runs')
      .delete()
      .in('id', toReplace.map((r) => r.id));
    if (error) throw new Error(`Could not replace the previous upload: ${error.message}`);
  }

  // 3. The run itself.
  const { data: runRow, error: runErr } = await supabase
    .from('payroll_runs')
    .insert({
      period_start: periodStart,
      period_end: periodEnd,
      disbursement_date: disbursement,
      total_days: run.payslips[0]?.daysInPeriod ?? null,
      employee_count: run.payslips.length,
      source_filename: wb.sourceFilename,
      ...(sourceAware ? { source: 'sheet' } : {}),
    })
    .select('id')
    .single();
  if (runErr) throw new Error(`Could not save the run: ${runErr.message}`);
  const runId = runRow.id as string;

  // 4. Payslips, snapshotting every field (names change; records must not).
  const { data: empRows, error: empErr } = await supabase
    .from('employees')
    .select('id, family_name');
  if (empErr) throw new Error(`Could not read employees back: ${empErr.message}`);
  const empByFamily = new Map((empRows ?? []).map((e) => [e.family_name, e.id]));

  const payslipRows = run.payslips.map((s) => ({
    run_id: runId,
    employee_id: empByFamily.get(s.family.toLowerCase()),
    family_name: s.family,
    given_name: s.given,
    department: s.department,
    days_in_period: s.daysInPeriod,
    daily_rate: s.dailyRate,
    basic_monthly: s.basicMonthly,
    allowance_monthly: s.allowanceMonthly,
    total_monthly_comp: s.totalMonthlyComp,
    benefits: s.benefits,
    e_basic: s.earnings.basic,
    e_allowance: s.earnings.allowance,
    e_overtime: s.earnings.overtime,
    e_meal: s.earnings.meal,
    e_holiday: s.earnings.holiday,
    e_adjustments: s.earnings.adjustments,
    e_tips: s.earnings.tips,
    total_earnings: s.earnings.total,
    d_unpaid_leaves: s.deductions.unpaidLeaves,
    d_sss: s.deductions.sss,
    d_philhealth: s.deductions.philhealth,
    d_hdmf: s.deductions.hdmf,
    d_sss_loan: s.deductions.sssLoan,
    d_hdmf_loan: s.deductions.hdmfLoan,
    d_cash_advance: s.deductions.cashAdvance,
    d_others: s.deductions.others,
    total_deductions: s.deductions.total,
    net_pay: s.netPay,
    leaves_remaining: s.leavesRemaining,
  }));
  {
    const { error } = await supabase.from('payslips').insert(payslipRows);
    if (error) throw new Error(`Could not save payslips: ${error.message}`);
  }

  // 5. Warnings — the audit trail of what the screen said at upload time.
  if (run.warnings.length) {
    const { error } = await supabase.from('run_warnings').insert(
      run.warnings.map((w) => ({ run_id: runId, severity: w.severity, message: w.message }))
    );
    if (error) throw new Error(`Could not save warnings: ${error.message}`);
  }

  return { replaced: toReplace.length > 0, runId };
}

// Save a run produced by the in-app calculation engine. Replaces a previous
// COMPUTED run for the same cutoff; a sheet upload for the cutoff survives.
export async function saveComputedRun(
  meta: { periodStart: SheetDate; periodEnd: SheetDate; disbursementDate: SheetDate },
  payslips: Payslip[],
  warnings: RunWarning[]
): Promise<{ replaced: boolean; runId: string }> {
  if (!supabase) throw new Error('Archive storage is not connected.');
  if (!(await migrationReady())) {
    throw new Error('migration-002-calc.sql has not been run in Supabase yet.');
  }
  const periodStart = toISO(meta.periodStart)!;
  const periodEnd = toISO(meta.periodEnd)!;
  const disbursement = toISO(meta.disbursementDate)!;

  const { data: existing, error: exErr } = await supabase
    .from('payroll_runs')
    .select('id, source')
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('disbursement_date', disbursement)
    .eq('source', 'computed');
  if (exErr) throw new Error(`Could not check the archive: ${exErr.message}`);
  if (existing?.length) {
    for (const r of existing) await removeRunFiles(r.id);
    const { error } = await supabase
      .from('payroll_runs')
      .delete()
      .in('id', existing.map((r) => r.id));
    if (error) throw new Error(`Could not replace the previous computed run: ${error.message}`);
  }

  const { data: runRow, error: runErr } = await supabase
    .from('payroll_runs')
    .insert({
      period_start: periodStart,
      period_end: periodEnd,
      disbursement_date: disbursement,
      total_days: payslips[0]?.daysInPeriod ?? null,
      employee_count: payslips.length,
      source_filename: 'computed in app',
      source: 'computed',
    })
    .select('id')
    .single();
  if (runErr) throw new Error(`Could not save the computed run: ${runErr.message}`);
  const runId = runRow.id as string;

  const rows = payslips.map((s) => ({
    run_id: runId,
    employee_id: s.employeeId,
    family_name: s.family,
    given_name: s.given,
    department: s.department,
    days_in_period: s.daysInPeriod,
    daily_rate: s.dailyRate,
    basic_monthly: s.basicMonthly,
    allowance_monthly: s.allowanceMonthly,
    total_monthly_comp: s.totalMonthlyComp,
    benefits: s.benefits,
    e_basic: s.earnings.basic,
    e_allowance: s.earnings.allowance,
    e_overtime: s.earnings.overtime,
    e_meal: s.earnings.meal,
    e_holiday: s.earnings.holiday,
    e_adjustments: s.earnings.adjustments,
    e_tips: s.earnings.tips,
    total_earnings: s.earnings.total,
    d_unpaid_leaves: s.deductions.unpaidLeaves,
    d_sss: s.deductions.sss,
    d_philhealth: s.deductions.philhealth,
    d_hdmf: s.deductions.hdmf,
    d_sss_loan: s.deductions.sssLoan,
    d_hdmf_loan: s.deductions.hdmfLoan,
    d_cash_advance: s.deductions.cashAdvance,
    d_others: s.deductions.others,
    total_deductions: s.deductions.total,
    net_pay: s.netPay,
    leaves_remaining: s.leavesRemaining,
  }));
  {
    const { error } = await supabase.from('payslips').insert(rows);
    if (error) throw new Error(`Could not save computed payslips: ${error.message}`);
  }
  if (warnings.length) {
    const { error } = await supabase.from('run_warnings').insert(
      warnings.map((w) => ({ run_id: runId, severity: w.severity, message: w.message }))
    );
    if (error) throw new Error(`Could not save warnings: ${error.message}`);
  }
  return { replaced: (existing?.length ?? 0) > 0, runId };
}

// ---------------- run files (Supabase Storage, private bucket) ----------------
// Each run can carry attached files: the uploaded workbook, the generated
// payroll register, and the payslip PDF/PNG zips actually sent to staff.
const BUCKET = 'run-files';

export interface RunFile {
  name: string;
  path: string;
}

// Best-effort file cleanup — storage problems must never block a save/delete.
async function removeRunFiles(runId: string): Promise<void> {
  try {
    const files = await listRunFiles(runId);
    if (files.length && supabase) {
      await supabase.storage.from(BUCKET).remove(files.map((f) => f.path));
    }
  } catch {
    // best-effort
  }
}

// Best-effort: storage problems (bucket not created yet, offline) must never
// break a save — the run data itself is already safe in the tables.
export async function uploadRunFile(
  runId: string,
  filename: string,
  blob: Blob
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'not connected' };
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${runId}/${filename}`, blob, { upsert: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listRunFiles(runId: string): Promise<RunFile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.storage.from(BUCKET).list(runId);
  if (error || !data) return [];
  return data
    .filter((f) => f.name && !f.name.startsWith('.'))
    .map((f) => ({ name: f.name, path: `${runId}/${f.name}` }));
}

export async function downloadRunFile(path: string): Promise<Blob> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not download: ${error?.message ?? 'unknown error'}`);
  return data;
}

// Delete an archived run (mistaken upload, test run) — removes its payslips,
// warnings (cascade) and any attached files. The one destructive action.
export async function deleteRun(runId: string): Promise<void> {
  if (!supabase) throw new Error('Archive storage is not connected.');
  await removeRunFiles(runId);
  const { error } = await supabase.from('payroll_runs').delete().eq('id', runId);
  if (error) throw new Error(`Could not delete the run: ${error.message}`);
}

// Parallel run: find the OTHER source's run for the same cutoff, if any.
export async function loadCounterpartRun(
  period: { periodStart: SheetDate | null; periodEnd: SheetDate | null; disbursementDate: SheetDate | null },
  mySource: RunSource
): Promise<LoadedRun | null> {
  if (!supabase) return null;
  if (!(await migrationReady())) return null;
  const ps = toISO(period.periodStart);
  const pe = toISO(period.periodEnd);
  const dd = toISO(period.disbursementDate);
  if (!ps || !pe || !dd) return null;
  const { data, error } = await supabase
    .from('payroll_runs')
    .select('id')
    .eq('period_start', ps)
    .eq('period_end', pe)
    .eq('disbursement_date', dd)
    .eq('source', mySource === 'sheet' ? 'computed' : 'sheet')
    .limit(1);
  // An error is NOT "no counterpart" — callers tell the user "nothing was
  // compared" on null, so a failed lookup must not impersonate a clean miss.
  if (error) throw new Error(`Could not check for a run to compare against: ${error.message}`);
  if (!data?.length) return null;
  return loadRun(data[0].id);
}

export async function loadRun(id: string): Promise<LoadedRun> {
  if (!supabase) throw new Error('Archive storage is not connected.');
  const { data: run, error: runErr } = await supabase
    .from('payroll_runs')
    .select('*')
    .eq('id', id)
    .single();
  if (runErr) throw new Error(`Could not load the run: ${runErr.message}`);

  const { data: slips, error: slipErr } = await supabase
    .from('payslips')
    .select('*, employees(email)')
    .eq('run_id', id)
    .order('family_name');
  if (slipErr) throw new Error(`Could not load payslips: ${slipErr.message}`);

  const { data: warns, error: warnErr } = await supabase
    .from('run_warnings')
    .select('severity, message')
    .eq('run_id', id)
    .order('created_at');
  if (warnErr) throw new Error(`Could not load warnings: ${warnErr.message}`);

  const payslips: Payslip[] = (slips ?? []).map((r) => ({
    family: r.family_name,
    given: r.given_name ?? '',
    email: (r.employees as { email: string } | null)?.email ?? '',
    department: r.department ?? '',
    daysInPeriod: r.days_in_period,
    dailyRate: r.daily_rate,
    basicMonthly: r.basic_monthly,
    allowanceMonthly: r.allowance_monthly,
    totalMonthlyComp: r.total_monthly_comp,
    benefits: r.benefits ?? '',
    leavesRemaining: r.leaves_remaining,
    earnings: {
      basic: r.e_basic,
      allowance: r.e_allowance,
      overtime: r.e_overtime,
      meal: r.e_meal,
      holiday: r.e_holiday,
      adjustments: r.e_adjustments,
      tips: r.e_tips,
      total: r.total_earnings ?? 0,
    },
    deductions: {
      unpaidLeaves: r.d_unpaid_leaves,
      sss: r.d_sss,
      philhealth: r.d_philhealth,
      hdmf: r.d_hdmf,
      sssLoan: r.d_sss_loan,
      hdmfLoan: r.d_hdmf_loan,
      cashAdvance: r.d_cash_advance,
      others: r.d_others,
      total: r.total_deductions ?? 0,
    },
    netPay: r.net_pay ?? 0,
  }));

  return {
    id,
    meta: {
      periodStart: fromISO(run.period_start),
      periodEnd: fromISO(run.period_end),
      disbursementDate: fromISO(run.disbursement_date),
      sourceFilename: run.source_filename ?? '',
      uploadedAt: run.created_at,
    },
    payslips,
    warnings: (warns ?? []) as RunWarning[],
  };
}
