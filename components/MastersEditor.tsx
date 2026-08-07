'use client';

// Employees & loans — a contact-list of people; tap one for their full page.
import { useEffect, useState } from 'react';
import type { Loan } from '@/lib/engine';
import {
  addEmployee,
  addLoan,
  loadMasters,
  saveEmployeeComp,
  setEmployeeActive,
  setLoanActive,
  type MasterEmployee,
} from '@/lib/masters';
import { money } from '@/lib/format';
import { Avatar, CHANNEL_LABEL, Chip, DateField, Field, INPUT, SectionTitle, StickyBar } from './ui';

type View = { kind: 'list' } | { kind: 'person'; id: string } | { kind: 'add' };

const parse = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const str = (n: number | null): string => (n == null ? '' : String(n));

interface Draft {
  family: string;
  given: string;
  email: string;
  team: string;
  employeeType: 'regular' | 'trainee' | 'daily';
  payoutChannel: 'paywise' | 'manual';
  paywiseName: string;
  paywiseAccount: string;
  basicMonthly: string;
  allowanceMonthly: string;
  dailyRate: string;
  benefitsClass: 'full' | 'regular' | 'probation' | '';
  benefitsLabel: string;
  mSss: string;
  mPhilhealth: string;
  mHdmf: string;
  leaveBalance: string;
  dateHired: string;
  probationEnd: string;
  regularizedOn: string;
  contactNumber: string;
  birthday: string;
}

const toDraft = (e: MasterEmployee): Draft => ({
  family: e.family,
  given: e.given,
  email: e.email,
  team: e.team,
  employeeType: e.employeeType,
  payoutChannel: e.payoutChannel,
  paywiseName: e.paywiseName ?? '',
  paywiseAccount: e.paywiseAccount ?? '',
  basicMonthly: str(e.basicMonthly),
  allowanceMonthly: str(e.allowanceMonthly),
  dailyRate: str(e.dailyRate),
  benefitsClass: e.benefitsClass ?? '',
  benefitsLabel: e.benefitsLabel,
  mSss: str(e.mSss),
  mPhilhealth: str(e.mPhilhealth),
  mHdmf: str(e.mHdmf),
  leaveBalance: str(e.leaveBalance),
  dateHired: e.dateHired ?? '',
  probationEnd: e.probationEnd ?? '',
  regularizedOn: e.regularizedOn ?? '',
  contactNumber: e.contactNumber ?? '',
  birthday: e.birthday ?? '',
});

function PersonPage({
  employee,
  loans,
  onBack,
  onChanged,
}: {
  employee: MasterEmployee;
  loans: Loan[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(employee));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newLoan, setNewLoan] = useState({ kind: 'sss' as Loan['kind'], perCutoff: '', note: '' });
  const set = (patch: Partial<Draft>) => setD((p) => ({ ...p, ...patch }));
  const myLoans = loans.filter((l) => l.employeeId === employee.id);

  async function save() {
    if (!d.family.trim()) {
      setStatus('🚨 Surname cannot be empty.');
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      await saveEmployeeComp(employee.id, {
        family: d.family,
        given: d.given,
        email: d.email,
        team: d.team,
        employeeType: d.employeeType,
        payoutChannel: d.payoutChannel,
        paywiseName: d.paywiseName,
        paywiseAccount: d.paywiseAccount,
        basicMonthly: parse(d.basicMonthly),
        allowanceMonthly: parse(d.allowanceMonthly),
        dailyRate: parse(d.dailyRate),
        benefitsClass: d.benefitsClass === '' ? null : d.benefitsClass,
        benefitsLabel: d.benefitsLabel,
        mSss: parse(d.mSss),
        mPhilhealth: parse(d.mPhilhealth),
        mHdmf: parse(d.mHdmf),
        leaveBalance: parse(d.leaveBalance),
        dateHired: d.dateHired || null,
        probationEnd: d.probationEnd || null,
        regularizedOn: d.regularizedOn || null,
        contactNumber: d.contactNumber,
        birthday: d.birthday || null,
      });
      setStatus(
        d.family.trim().toLowerCase() !== employee.family
          ? '✅ Saved — renamed. Remember: the sheet must use the same surname in BOTH tabs.'
          : '✅ Saved.'
      );
      onChanged();
    } catch (err) {
      setStatus(`🚨 ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddLoan() {
    if (newLoan.perCutoff.trim() === '') {
      setStatus('🚨 Enter the amount per cutoff for the loan.');
      return;
    }
    try {
      await addLoan({
        employeeId: employee.id,
        kind: newLoan.kind,
        perCutoff: Number(newLoan.perCutoff),
        note: newLoan.note || null,
        active: true,
      });
      setNewLoan({ kind: 'sss', perCutoff: '', note: '' });
      setStatus('✅ Loan added.');
      onChanged();
    } catch (err) {
      setStatus(`🚨 ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function toggleActive() {
    if (
      employee.active &&
      !window.confirm(
        `Mark ${employee.family} as no longer employed? Past payslips stay on record; they just stop appearing in new payrolls.`
      )
    )
      return;
    try {
      await setEmployeeActive(employee.id, !employee.active);
      onChanged();
      onBack();
    } catch (err) {
      setStatus(`🚨 ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const LOAN_LABEL = { sss: 'SSS loan', hdmf: 'HDMF loan', advance: 'Tanawin advance' };

  return (
    <div className="space-y-5">
      <button className="text-[#9A3518] font-medium active:opacity-70" onClick={onBack}>
        ← All staff
      </button>

      <div className="flex items-center gap-3">
        <Avatar name={d.family} muted={!employee.active} />
        <div>
          <p className="font-bold text-lg leading-tight">
            {d.given} {d.family}
          </p>
          <div className="flex gap-1.5 mt-0.5">
            <Chip kind={d.employeeType}>{d.employeeType}</Chip>
            <Chip kind={d.payoutChannel}>{CHANNEL_LABEL[d.payoutChannel]}</Chip>
            {!employee.active && <Chip kind="inactive">no longer employed</Chip>}
          </div>
        </div>
      </div>

      {status && (
        <div className="border rounded-xl px-3 py-2 text-sm bg-white border-[#E6D8C9]">{status}</div>
      )}

      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>Who they are</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Surname">
            <input className={INPUT} value={d.family} onChange={(e) => set({ family: e.target.value })} />
          </Field>
          <Field label="Given name">
            <input className={INPUT} value={d.given} onChange={(e) => set({ given: e.target.value })} />
          </Field>
          <Field label="Email (payslips)" className="col-span-2">
            <input className={INPUT} inputMode="email" value={d.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Team">
            <input className={INPUT} value={d.team} onChange={(e) => set({ team: e.target.value })} />
          </Field>
          <Field label="Type">
            <select className={INPUT} value={d.employeeType} onChange={(e) => set({ employeeType: e.target.value as Draft['employeeType'] })}>
              <option value="regular">regular</option>
              <option value="trainee">trainee</option>
              <option value="daily">daily</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>HR file</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date of hire">
            <DateField value={d.dateHired} onChange={(v) => set({ dateHired: v })} />
          </Field>
          <Field label="Probation until">
            <DateField value={d.probationEnd} onChange={(v) => set({ probationEnd: v })} />
          </Field>
          <Field label="Regularized on">
            <DateField value={d.regularizedOn} onChange={(v) => set({ regularizedOn: v })} />
          </Field>
          <Field label="Birthday">
            <DateField value={d.birthday} onChange={(v) => set({ birthday: v })} />
          </Field>
          <Field label="Contact number" className="col-span-2">
            <input className={INPUT} inputMode="tel" value={d.contactNumber} onChange={(e) => set({ contactNumber: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-[#6E4B38]">
          "Probation until" drives the regularization reminder (blank = 3 months from hire).
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>Pay</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Basic salary ₱/month">
            <input className={INPUT} inputMode="decimal" value={d.basicMonthly} onChange={(e) => set({ basicMonthly: e.target.value })} />
          </Field>
          <Field label="Allowance ₱/month">
            <input className={INPUT} inputMode="decimal" value={d.allowanceMonthly} onChange={(e) => set({ allowanceMonthly: e.target.value })} />
          </Field>
          <Field label="Daily rate ₱ (trainees/dailies)">
            <input className={INPUT} inputMode="decimal" value={d.dailyRate} onChange={(e) => set({ dailyRate: e.target.value })} />
          </Field>
          <Field label="Leave balance (days)">
            <input className={INPUT} inputMode="decimal" value={d.leaveBalance} onChange={(e) => set({ leaveBalance: e.target.value })} />
          </Field>
          <Field label="Benefits class">
            <select className={INPUT} value={d.benefitsClass} onChange={(e) => set({ benefitsClass: e.target.value as Draft['benefitsClass'] })}>
              <option value="">—</option>
              <option value="full">full coverage</option>
              <option value="regular">regular</option>
              <option value="probation">probation</option>
            </select>
          </Field>
          <Field label="Benefits text (on payslip)">
            <input className={INPUT} value={d.benefitsLabel} onChange={(e) => set({ benefitsLabel: e.target.value })} />
          </Field>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>Monthly contributions (their share)</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <Field label="SSS ₱">
            <input className={INPUT} inputMode="decimal" value={d.mSss} onChange={(e) => set({ mSss: e.target.value })} />
          </Field>
          <Field label="PhilHealth ₱">
            <input className={INPUT} inputMode="decimal" value={d.mPhilhealth} onChange={(e) => set({ mPhilhealth: e.target.value })} />
          </Field>
          <Field label="HDMF ₱">
            <input className={INPUT} inputMode="decimal" value={d.mHdmf} onChange={(e) => set({ mHdmf: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-[#6E4B38]">Half is deducted each cutoff. Full-coverage staff: 0 for SSS &amp; PhilHealth.</p>
      </section>

      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>How they get paid</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Payout">
            <select className={INPUT} value={d.payoutChannel} onChange={(e) => set({ payoutChannel: e.target.value as Draft['payoutChannel'] })}>
              <option value="paywise">🏦 PNB Paywise</option>
              <option value="manual">📱 GCash/BPI (Ani)</option>
            </select>
          </Field>
          <div />
          {d.payoutChannel === 'paywise' && (
            <>
              <Field label="Name at PNB (exact)">
                <input className={INPUT} value={d.paywiseName} onChange={(e) => set({ paywiseName: e.target.value })} />
              </Field>
              <Field label="PNB account number">
                <input className={INPUT} inputMode="numeric" value={d.paywiseAccount} onChange={(e) => set({ paywiseAccount: e.target.value })} />
              </Field>
            </>
          )}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>Loans &amp; advances</SectionTitle>
        <ul className="divide-y divide-[#E6D8C9] text-sm">
          {myLoans.map((l) => (
            <li key={l.id} className="py-2.5 flex items-center gap-3">
              <span className={l.active ? '' : 'line-through opacity-50'}>
                <span className="font-medium">{LOAN_LABEL[l.kind]}</span> · {money(l.perCutoff)} / cutoff
                {l.note && <span className="block text-xs text-[#6E4B38]">{l.note}</span>}
              </span>
              <button
                className="ml-auto text-sm underline text-[#9A3518] active:opacity-70"
                onClick={async () => {
                  try {
                    await setLoanActive(l.id, !l.active);
                    onChanged();
                  } catch (err) {
                    setStatus(`🚨 ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
              >
                {l.active ? 'End' : 'Reactivate'}
              </button>
            </li>
          ))}
          {!myLoans.length && <li className="py-2 text-[#6E4B38]">No loans.</li>}
        </ul>
        <div className="grid grid-cols-2 gap-3 border-t border-[#E6D8C9] pt-3">
          <Field label="Add a loan">
            <select className={INPUT} value={newLoan.kind} onChange={(e) => setNewLoan({ ...newLoan, kind: e.target.value as Loan['kind'] })}>
              <option value="sss">SSS loan</option>
              <option value="hdmf">HDMF loan</option>
              <option value="advance">Tanawin advance</option>
            </select>
          </Field>
          <Field label="₱ per cutoff">
            <input className={INPUT} inputMode="decimal" value={newLoan.perCutoff} onChange={(e) => setNewLoan({ ...newLoan, perCutoff: e.target.value })} />
          </Field>
          <Field label="Note" className="col-span-2">
            <input className={INPUT} value={newLoan.note} onChange={(e) => setNewLoan({ ...newLoan, note: e.target.value })} />
          </Field>
          <p className="col-span-2 text-xs text-[#6E4B38]">
            A negative amount is a refund — it's added to their pay instead of deducted (like the HDMF refunds).
          </p>
        </div>
        <button className="px-4 py-2 rounded-xl border border-[#CC7459] text-[#9A3518] font-medium active:opacity-80" onClick={handleAddLoan}>
          Add loan
        </button>
      </section>

      <button className="text-sm underline text-[#6E4B38] active:opacity-70" onClick={toggleActive}>
        {employee.active ? 'Mark as no longer employed' : 'Mark as employed again'}
      </button>

      <StickyBar>
        <button
          className="flex-1 px-5 py-3 rounded-xl bg-[#9A3518] text-[#FBF6EF] font-semibold active:opacity-80 disabled:opacity-50"
          onClick={save}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </StickyBar>
    </div>
  );
}

function AddPage({ onBack, onAdded }: { onBack: () => void; onAdded: () => void }) {
  const [d, setD] = useState({
    family: '', given: '', email: '', team: '',
    employeeType: 'regular' as 'regular' | 'trainee' | 'daily',
    payoutChannel: 'paywise' as 'paywise' | 'manual',
    dailyRate: '', dateHired: '',
  });
  const [status, setStatus] = useState<string | null>(null);

  async function handleAdd() {
    if (!d.family.trim() || !d.given.trim()) {
      setStatus('🚨 Surname and given name are needed.');
      return;
    }
    try {
      await addEmployee({
        family: d.family,
        given: d.given,
        email: d.email,
        team: d.team,
        employeeType: d.employeeType,
        payoutChannel: d.payoutChannel,
        dailyRate: d.dailyRate.trim() === '' ? null : Number(d.dailyRate),
        dateHired: d.dateHired || null,
      });
      onAdded();
    } catch (err) {
      setStatus(`🚨 ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="space-y-5">
      <button className="text-[#9A3518] font-medium active:opacity-70" onClick={onBack}>
        ← All staff
      </button>
      <h2 className="font-bold text-lg">➕ New person</h2>
      {status && <div className="border rounded-xl px-3 py-2 text-sm bg-white border-[#E6D8C9]">{status}</div>}
      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 grid grid-cols-2 gap-3">
        <Field label="Surname">
          <input className={INPUT} value={d.family} onChange={(e) => setD({ ...d, family: e.target.value })} />
        </Field>
        <Field label="Given name">
          <input className={INPUT} value={d.given} onChange={(e) => setD({ ...d, given: e.target.value })} />
        </Field>
        <Field label="Email (blank for dailies)" className="col-span-2">
          <input className={INPUT} inputMode="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
        </Field>
        <Field label="Team">
          <input className={INPUT} value={d.team} onChange={(e) => setD({ ...d, team: e.target.value })} />
        </Field>
        <Field label="Type">
          <select className={INPUT} value={d.employeeType} onChange={(e) => setD({ ...d, employeeType: e.target.value as typeof d.employeeType })}>
            <option value="regular">regular</option>
            <option value="trainee">trainee</option>
            <option value="daily">daily</option>
          </select>
        </Field>
        <Field label="Payout">
          <select className={INPUT} value={d.payoutChannel} onChange={(e) => setD({ ...d, payoutChannel: e.target.value as typeof d.payoutChannel })}>
            <option value="paywise">🏦 PNB Paywise</option>
            <option value="manual">📱 GCash/BPI (Ani)</option>
          </select>
        </Field>
        <Field label="Daily rate ₱">
          <input className={INPUT} inputMode="decimal" value={d.dailyRate} onChange={(e) => setD({ ...d, dailyRate: e.target.value })} />
        </Field>
        <Field label="Date hired">
          <DateField value={d.dateHired} onChange={(v) => setD({ ...d, dateHired: v })} />
        </Field>
      </section>
      <StickyBar>
        <button className="flex-1 px-5 py-3 rounded-xl bg-[#9A3518] text-[#FBF6EF] font-semibold active:opacity-80" onClick={handleAdd}>
          Add person
        </button>
      </StickyBar>
    </div>
  );
}

export default function MastersEditor({ onBack }: { onBack: () => void }) {
  const [employees, setEmployees] = useState<MasterEmployee[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [showFormer, setShowFormer] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function reload() {
    try {
      const m = await loadMasters(true);
      setEmployees(m.employees);
      setLoans(m.loans);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    reload();
  }, []);

  if (view.kind === 'person') {
    const e = employees.find((x) => x.id === view.id);
    if (e)
      return (
        <PersonPage
          key={e.id + String(e.active)}
          employee={e}
          loans={loans}
          onBack={() => setView({ kind: 'list' })}
          onChanged={reload}
        />
      );
  }
  if (view.kind === 'add') {
    return (
      <AddPage
        onBack={() => setView({ kind: 'list' })}
        onAdded={() => {
          reload();
          setView({ kind: 'list' });
        }}
      />
    );
  }

  const visible = employees.filter((e) => showFormer || e.active);

  return (
    <div className="space-y-4">
      <button className="text-[#9A3518] font-medium active:opacity-70" onClick={onBack}>
        ← Back
      </button>

      {loadError && (
        <div className="border rounded-xl px-4 py-3 text-sm bg-rose-50 border-rose-300 text-rose-900">
          🚨 {loadError}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-lg">👥 Staff</h2>
        <button
          className="px-4 py-2 rounded-xl bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80"
          onClick={() => setView({ kind: 'add' })}
        >
          ➕ Add
        </button>
      </div>

      <ul className="bg-white rounded-2xl border border-[#E6D8C9] divide-y divide-[#E6D8C9] overflow-hidden">
        {visible.map((e) => {
          const loanCount = loans.filter((l) => l.employeeId === e.id && l.active).length;
          return (
            <li key={e.id}>
              <button
                className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-[#F5EDE4]"
                onClick={() => setView({ kind: 'person', id: e.id })}
              >
                <Avatar name={e.family} muted={!e.active} />
                <span className="min-w-0 flex-1">
                  <span className={`font-semibold block truncate ${e.active ? '' : 'opacity-60'}`}>
                    {e.given} {e.family}
                  </span>
                  <span className="flex gap-1.5 mt-0.5 flex-wrap">
                    <Chip kind={e.employeeType}>{e.employeeType}</Chip>
                    <Chip kind={e.payoutChannel}>{CHANNEL_LABEL[e.payoutChannel]}</Chip>
                    {loanCount > 0 && <Chip kind="paywise">💳 {loanCount}</Chip>}
                    {!e.active && <Chip kind="inactive">former</Chip>}
                  </span>
                </span>
                <span className="text-[#CC7459] text-lg">›</span>
              </button>
            </li>
          );
        })}
        {!visible.length && <li className="px-4 py-3 text-sm text-[#6E4B38]">No staff yet.</li>}
      </ul>

      <label className="text-sm flex items-center gap-1.5 text-[#6E4B38] px-1">
        <input
          type="checkbox"
          className="accent-[#9A3518]"
          checked={showFormer}
          onChange={(e) => setShowFormer(e.target.checked)}
        />
        show former staff
      </label>
    </div>
  );
}
