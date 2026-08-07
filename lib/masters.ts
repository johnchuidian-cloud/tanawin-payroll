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
  const loans: Loan[] = (lns.data as { id: string; employee_id: string; kind: Loan['kind']; per_cutoff: number; note: string | null; active: boolean }[]).map((l) => ({
    id: l.id,
    employeeId: l.employee_id,
    kind: l.kind,
    perCutoff: l.per_cutoff,
    note: l.note,
    active: l.active,
  }));
  return { employees, loans };
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
  const { error } = await supabase.from('employees').update(patch).eq('id', id);
  if (error) throw new Error(`Could not save ${e.family ?? 'employee'}: ${error.message}`);
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
}

export async function addLoan(l: Omit<Loan, 'id'>): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('loans').insert({
    employee_id: l.employeeId,
    kind: l.kind,
    per_cutoff: l.perCutoff,
    note: l.note,
    active: l.active,
  });
  if (error) throw new Error(`Could not add loan: ${error.message}`);
}

export async function setLoanActive(id: string, active: boolean): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('loans').update({ active }).eq('id', id);
  if (error) throw new Error(`Could not update loan: ${error.message}`);
}
