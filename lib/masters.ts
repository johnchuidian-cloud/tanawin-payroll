// Data access for the calculation masters (employees comp fields + loans).
import type { CompEmployee, Loan } from './engine';
import { supabase } from './supabase';

interface EmployeeRow {
  id: string;
  family_name: string;
  given_name: string | null;
  team: string | null;
  email: string | null;
  date_hired: string | null;
  probation_end: string | null;
  regularized_on: string | null;
  contact_number: string | null;
  birthday: string | null;
  active: boolean;
  employee_type: CompEmployee['employeeType'] | null;
  payout_channel: CompEmployee['payoutChannel'] | null;
  paywise_name: string | null;
  paywise_account: string | null;
  basic_monthly: number | null;
  allowance_monthly: number | null;
  daily_rate: number | null;
  benefits_class: CompEmployee['benefitsClass'];
  benefits_label: string | null;
  m_sss: number | null;
  m_philhealth: number | null;
  m_hdmf: number | null;
  leave_balance: number | null;
}

export interface MasterEmployee extends CompEmployee {
  active: boolean;
}

export async function loadMasters(
  includeInactive = false
): Promise<{ employees: MasterEmployee[]; loans: Loan[] }> {
 if (!supabase) throw new Error('Storage is not connected.');
  let empQuery = supabase.from('employees').select('*').order('family_name');
  if (!includeInactive) empQuery = empQuery.eq('active', true);
  const [emp, lns] = await Promise.all([
    empQuery,
    supabase.from('loans').select('*').order('created_at'),
  ]);
  if (emp.error) throw new Error(`Could not load employees: ${emp.error.message}`);
  if (lns.error) {
    throw new Error(
      lns.error.message.includes('loans')
        ? `Could not load loans — has migration-002-calc.sql been run in Supabase? (${lns.error.message})`
        : `Could not load loans: ${lns.error.message}`
    );
  }
  const employees: MasterEmployee[] = (emp.data as EmployeeRow[]).map((r) => ({
    id: r.id,
    family: r.family_name,
    given: r.given_name ?? '',
    email: r.email ?? '',
    team: r.team ?? '',
    active: r.active,
    employeeType: r.employee_type ?? 'regular',
    payoutChannel: r.payout_channel ?? 'paywise',
    paywiseName: r.paywise_name,
    paywiseAccount: r.paywise_account,
    dateHired: r.date_hired,
    probationEnd: r.probation_end ?? null,
    regularizedOn: r.regularized_on ?? null,
    contactNumber: r.contact_number ?? null,
    birthday: r.birthday ?? null,
    basicMonthly: r.basic_monthly,
    allowanceMonthly: r.allowance_monthly,
    dailyRate: r.daily_rate,
    benefitsClass: r.benefits_class,
    benefitsLabel: r.benefits_label ?? '',
    mSss: r.m_sss,
    mPhilhealth: r.m_philhealth,
    mHdmf: r.m_hdmf,
    leaveBalance: r.leave_balance,
  }));
  const loans: Loan[] = (lns.data as { id: string; employee_id: string; kind: Loan['kind']; per_cutoff: number; note: string | null; active: boolean; starts_on?: string | null }[]).map((l) => ({
    id: l.id,
    employeeId: l.employee_id,
    kind: l.kind,
    perCutoff: l.per_cutoff,
    note: l.note,
    active: l.active,
    startsOn: l.starts_on ?? null,
  }));
  return { employees, loans };
}

// --- Edit history ----------------------------------------------------------
// Every change to a person's record is logged with before/after values, and
// field edits can be undone (the undo is logged too — history never lies).

export type ChangeDetails = {
  changes?: Record<string, { from: unknown; to: unknown }>;
  loan?: { kind: Loan['kind']; perCutoff: number; startsOn?: string | null; note?: string | null };
  note?: string;
};

export interface ChangeEntry {
  id: string;
  action: 'update' | 'undo' | 'loan-added' | 'loan-ended' | 'loan-reactivated' | 'note-added' | 'note-deleted' | 'deactivated' | 'reactivated';
  actor: string | null;
  details: ChangeDetails | null;
  createdAt: string;
}

async function actor(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

// Best-effort: a failed log line must never block the save it describes.
async function logChange(employeeId: string, action: ChangeEntry['action'], details: ChangeDetails | null): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('change_log').insert({
      employee_id: employeeId,
      action,
      actor: await actor(),
      details,
    });
  } catch {
    // logging is best-effort
  }
}

export async function loadChangeLog(employeeId: string): Promise<ChangeEntry[]> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { data, error } = await supabase
    .from('change_log')
    .select('id, action, actor, details, created_at')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    throw new Error(
      error.message.includes('change_log')
        ? `Edit history needs a one-time database update — run migration-006-notes-loanstart.sql in Supabase. (${error.message})`
        : `Could not load the edit history: ${error.message}`
    );
  }
  return (data as { id: string; action: ChangeEntry['action']; actor: string | null; details: ChangeDetails | null; created_at: string }[]).map((c) => ({
    id: c.id,
    action: c.action,
    actor: c.actor,
    details: c.details,
    createdAt: c.created_at,
  }));
}

// Undo a field edit: apply the entry's "from" values back. Runs through the
// same update + logging path, so the restore appears in history as 'undo'.
export async function undoFieldChanges(employeeId: string, changes: Record<string, { from: unknown; to: unknown }>): Promise<void> {
  const patch: Record<string, unknown> = {};
  const reversed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [col, v] of Object.entries(changes)) {
    patch[col] = v.from;
    reversed[col] = { from: v.to, to: v.from };
  }
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('employees').update(patch).eq('id', employeeId);
  if (error) throw new Error(`Could not undo: ${error.message}`);
  await logChange(employeeId, 'undo', { changes: reversed });
}

export async function saveEmployeeComp(id: string, e: Partial<CompEmployee>): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const patch: Record<string, unknown> = {};
  if ('family' in e) patch.family_name = e.family?.trim().toLowerCase();
  if ('given' in e) patch.given_name = e.given?.trim();
  if ('email' in e) patch.email = e.email || null;
  if ('team' in e) patch.team = e.team || null;
  if ('employeeType' in e) patch.employee_type = e.employeeType;
  if ('payoutChannel' in e) patch.payout_channel = e.payoutChannel;
  if ('paywiseName' in e) patch.paywise_name = e.paywiseName || null;
  if ('paywiseAccount' in e) patch.paywise_account = e.paywiseAccount || null;
  if ('basicMonthly' in e) patch.basic_monthly = e.basicMonthly;
  if ('allowanceMonthly' in e) patch.allowance_monthly = e.allowanceMonthly;
  if ('dailyRate' in e) patch.daily_rate = e.dailyRate;
  if ('benefitsClass' in e) patch.benefits_class = e.benefitsClass;
  if ('benefitsLabel' in e) patch.benefits_label = e.benefitsLabel;
  if ('mSss' in e) patch.m_sss = e.mSss;
  if ('mPhilhealth' in e) patch.m_philhealth = e.mPhilhealth;
  if ('mHdmf' in e) patch.m_hdmf = e.mHdmf;
  if ('leaveBalance' in e) patch.leave_balance = e.leaveBalance;
  if ('dateHired' in e) patch.date_hired = e.dateHired;
  if ('probationEnd' in e) patch.probation_end = e.probationEnd;
  if ('regularizedOn' in e) patch.regularized_on = e.regularizedOn;
  if ('contactNumber' in e) patch.contact_number = e.contactNumber || null;
  if ('birthday' in e) patch.birthday = e.birthday;
  // Current values first, so the history entry can say what changed.
  // Best-effort: a failed read only costs the log line, never the save.
  let oldRow: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase.from('employees').select('*').eq('id', id).single();
    oldRow = data as Record<string, unknown>;
  } catch {
    oldRow = null;
  }
  const { error } = await supabase.from('employees').update(patch).eq('id', id);
  if (error) throw new Error(`Could not save ${e.family ?? 'employee'}: ${error.message}`);
  if (oldRow) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [col, to] of Object.entries(patch)) {
      const from = oldRow[col] ?? null;
      // String-compare: numerics can come back from PostgREST as strings.
      if (String(from ?? '') !== String(to ?? '')) changes[col] = { from, to: to ?? null };
    }
    if (Object.keys(changes).length) await logChange(id, 'update', { changes });
  }
}

export async function addEmployee(e: {
  family: string;
  given: string;
  email: string;
  team: string;
  employeeType: CompEmployee['employeeType'];
  payoutChannel: CompEmployee['payoutChannel'];
  dailyRate: number | null;
  dateHired: string | null;
}): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('employees').insert({
    family_name: e.family.trim().toLowerCase(),
    given_name: e.given.trim(),
    email: e.email || null,
    team: e.team || null,
    date_hired: e.dateHired,
    active: true,
    employee_type: e.employeeType,
    payout_channel: e.payoutChannel,
    daily_rate: e.dailyRate,
    benefits_class: 'probation',
    benefits_label: e.employeeType === 'daily' ? 'daily' : '3 month probation',
  });
  if (error) {
    throw new Error(
      error.message.includes('duplicate')
        ? `An employee with surname "${e.family}" already exists (maybe deactivated — check "show former staff").`
        : `Could not add employee: ${error.message}`
    );
  }
}

// Deactivate, never delete: old payslips must keep pointing at the person.
export async function setEmployeeActive(id: string, active: boolean): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('employees').update({ active }).eq('id', id);
  if (error) throw new Error(`Could not update employee: ${error.message}`);
  await logChange(id, active ? 'reactivated' : 'deactivated', null);
}

export async function addLoan(l: Omit<Loan, 'id'>): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('loans').insert({
    employee_id: l.employeeId,
    kind: l.kind,
    per_cutoff: l.perCutoff,
    note: l.note,
    active: l.active,
    starts_on: l.startsOn ?? null,
  });
  if (error) {
    throw new Error(
      error.message.includes('starts_on')
        ? `Could not add loan — has migration-006-notes-loanstart.sql been run in Supabase? (${error.message})`
        : `Could not add loan: ${error.message}`
    );
  }
  await logChange(l.employeeId, 'loan-added', {
    loan: { kind: l.kind, perCutoff: l.perCutoff, startsOn: l.startsOn ?? null, note: l.note },
  });
}

// --- Dated notes: a small logbook per person -------------------------------

export interface EmployeeNote {
  id: string;
  note: string;
  createdAt: string; // ISO timestamp
}

export async function loadNotes(employeeId: string): Promise<EmployeeNote[]> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { data, error } = await supabase
    .from('employee_notes')
    .select('id, note, created_at')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(
      error.message.includes('employee_notes')
        ? `Notes need a one-time database update — run migration-006-notes-loanstart.sql in Supabase. (${error.message})`
        : `Could not load notes: ${error.message}`
    );
  }
  return (data as { id: string; note: string; created_at: string }[]).map((n) => ({
    id: n.id,
    note: n.note,
    createdAt: n.created_at,
  }));
}

export async function addEmployeeNote(employeeId: string, note: string): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('employee_notes').insert({ employee_id: employeeId, note });
  if (error) throw new Error(`Could not add the note: ${error.message}`);
  await logChange(employeeId, 'note-added', { note });
}

export async function deleteEmployeeNote(id: string, employeeId?: string, noteText?: string): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('employee_notes').delete().eq('id', id);
  if (error) throw new Error(`Could not delete the note: ${error.message}`);
  if (employeeId) await logChange(employeeId, 'note-deleted', { note: noteText });
}

export async function setLoanActive(
  id: string,
  active: boolean,
  ctx?: { employeeId: string; kind: Loan['kind']; perCutoff: number }
): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('loans').update({ active }).eq('id', id);
  if (error) throw new Error(`Could not update loan: ${error.message}`);
  if (ctx) {
    await logChange(ctx.employeeId, active ? 'loan-reactivated' : 'loan-ended', {
      loan: { kind: ctx.kind, perCutoff: ctx.perCutoff },
    });
  }
}
