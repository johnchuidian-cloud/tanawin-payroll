'use client';

// Employees & loans — a contact-list of people; tap one for their full page.
import { useEffect, useMemo, useState } from 'react';
import { computeRun, DEFAULT_REST_DAYS, type CompEmployee, type EmployeeInputs, type Loan } from '@/lib/engine';
import { cutoffDates, EMPTY_DRAFT, EMPTY_INPUTS, readDraft, writeDraft, type ComputeDraft } from '@/lib/computeDraft';
import type { SheetDate } from '@/lib/types';
import {
  addEmployee,
  addEmployeeNote,
  addLoan,
  deleteEmployeeNote,
  loadChangeLog,
  loadMasters,
  loadNotes,
  saveEmployeeComp,
  setEmployeeActive,
  setLoanActive,
  undoFieldChanges,
  type ChangeEntry,
  type EmployeeNote,
  type MasterEmployee,
} from '@/lib/masters';
import { fmtJsDate, money } from '@/lib/format';
import { Avatar, CHANNEL_LABEL, Chip, DateField, Field, INPUT, SectionTitle, StickyBar } from './ui';

type View = { kind: 'list' } | { kind: 'person'; id: string } | { kind: 'add' };

const parse = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const str = (n: number | null): string => (n == null ? '' : String(n));

const isoYmd = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : iso;
};

const isoToSheet = (s: string): SheetDate | null => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};

// Per-person calculator: a scratchpad payslip preview on the person's own
// page (Lexi's instinct on Aug 10 — she tried to compute salenga-frias from
// here). NOTHING is saved by itself: the one button copies the inputs into
// the shared compute draft, so archives only ever hold complete runs.
function TryComputeSection({
  pageDraft,
  employee,
  allEmployees,
  loans,
}: {
  pageDraft: Draft;
  employee: MasterEmployee;
  allEmployees: MasterEmployee[];
  loans: Loan[];
}) {
  const [computeDraft] = useState(readDraft);
  const [dates, setDates] = useState({
    periodStart: computeDraft?.periodStart ?? '',
    periodEnd: computeDraft?.periodEnd ?? '',
    disbursement: computeDraft?.disbursement ?? '',
  });
  const [inp, setInp] = useState<EmployeeInputs>({
    ...EMPTY_INPUTS,
    ...(computeDraft?.perEmp?.[employee.id] ?? {}),
    include: true,
  });
  const [keptNote, setKeptNote] = useState<string | null>(null);
  const set = (patch: Partial<EmployeeInputs>) => {
    setInp((p) => ({ ...p, ...patch }));
    setKeptNote(null);
  };

  // The what-if person: the values SHOWN on the page, unsaved edits included,
  // so "what if the salary becomes X?" answers itself before a Save.
  const whatIf: CompEmployee = {
    ...employee,
    employeeType: pageDraft.employeeType,
    basicMonthly: parse(pageDraft.basicMonthly),
    allowanceMonthly: parse(pageDraft.allowanceMonthly),
    dailyRate: parse(pageDraft.dailyRate),
    benefitsClass: pageDraft.benefitsClass === '' ? null : pageDraft.benefitsClass,
    benefitsLabel: pageDraft.benefitsLabel,
    mSss: parse(pageDraft.mSss),
    mPhilhealth: parse(pageDraft.mPhilhealth),
    mHdmf: parse(pageDraft.mHdmf),
    leaveBalance: parse(pageDraft.leaveBalance),
  };

  const result = useMemo(() => {
    const ps = isoToSheet(dates.periodStart);
    const pe = isoToSheet(dates.periodEnd);
    const dd = isoToSheet(dates.disbursement);
    if (!ps || !pe || !dd) return null;
    const employees = allEmployees.filter((e) => e.active).map((e) => (e.id === employee.id ? { ...e, ...whatIf } : e));
    const perEmployee: Record<string, EmployeeInputs> = {};
    for (const e of employees) {
      const other = computeDraft?.perEmp?.[e.id] ?? { ...EMPTY_INPUTS, include: e.employeeType !== 'daily' };
      perEmployee[e.id] =
        e.id === employee.id
          ? { ...inp, include: true }
          : e.employeeType === 'daily' && other.days === ''
            ? { ...other, include: false }
            : other;
    }
    try {
      const run = computeRun(employees, loans, {
        periodStart: ps,
        periodEnd: pe,
        disbursementDate: dd,
        restDays: computeDraft?.restDays === '' || computeDraft?.restDays == null ? DEFAULT_REST_DAYS : computeDraft.restDays,
        ridePax: computeDraft?.ridePax ?? '',
        serviceCharge: computeDraft?.serviceCharge ?? '',
        horsePax: computeDraft?.horsePax ?? '',
        tipBox: computeDraft?.tipBox ?? '',
        perEmployee,
      });
      const slip = run.payslips.find((p) => p.employeeId === employee.id) ?? null;
      return slip ? { slip, hasTips: (slip.earnings.tips ?? 0) > 0 } : null;
    } catch {
      return null;
    }
    // whatIf is derived from pageDraft each render; listing pageDraft covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, inp, pageDraft, allEmployees, loans, employee.id, computeDraft]);

  function keepInputs() {
    const cur = readDraft();
    const next: ComputeDraft = cur ?? { ...EMPTY_DRAFT, perEmp: {} };
    if (!next.periodStart && dates.periodStart) {
      next.periodStart = dates.periodStart;
      next.periodEnd = dates.periodEnd;
      next.disbursement = dates.disbursement;
    }
    next.perEmp = { ...next.perEmp, [employee.id]: { ...inp, include: true } };
    writeDraft(next);
    setKeptNote('✅ Kept — these inputs will already be filled in on the Compute screen.');
  }

  const numField = (label: string, key: keyof EmployeeInputs) => (
    <Field label={label}>
      <input
        type="number"
        inputMode="decimal"
        className={INPUT}
        value={inp[key] as number | ''}
        onChange={(e) => set({ [key]: e.target.value === '' ? '' : Number(e.target.value) } as Partial<EmployeeInputs>)}
      />
    </Field>
  );

  return (
    <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
      <SectionTitle>Try a computation</SectionTitle>
      <p className="text-xs text-[#6E4B38]">
        Preview only — nothing is saved. Uses the values shown on this page (pay changes still need Save to count in the real payroll).
      </p>
      {!dates.periodStart && (
        <div className="flex flex-wrap gap-2">
          {([10, 25] as const).map((w) => (
            <button
              key={w}
              className="px-3 py-1.5 rounded-lg border border-[#CC7459] text-[#9A3518] text-sm active:opacity-80"
              onClick={() => {
                const c = cutoffDates(w);
                setDates({ periodStart: c.periodStart, periodEnd: c.periodEnd, disbursement: c.disbursement });
              }}
            >
              {w === 10 ? '10th (24th → 8th)' : '25th (9th → 23rd)'}
            </button>
          ))}
          <p className="w-full text-xs text-[#6E4B38]">Pick a cutoff to preview against.</p>
        </div>
      )}
      {dates.periodStart && (
        <>
          <p className="text-xs text-[#6E4B38]">
            Cutoff {isoYmd(dates.periodStart)} → {isoYmd(dates.periodEnd)} · payday {isoYmd(dates.disbursement)}
            {computeDraft?.periodStart ? ' (from the Compute screen)' : ''}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {numField('Days worked', 'days')}
            {numField('Overtime hours', 'otHours')}
            {numField('Regular holidays', 'regularHolidays')}
            {numField('Special holidays', 'specialHolidays')}
            {numField('Paid leave days', 'paidLeaves')}
            {numField('Unpaid days', 'unpaidDays')}
            {numField('Additions to pay ₱', 'adjustments')}
            {numField('Deductions from pay ₱', 'others')}
          </div>
          {result && (
            <div className="border border-[#E6D8C9] rounded-xl px-3 py-2.5 text-sm space-y-1">
              <div className="flex justify-between"><span>Total earnings</span><span>{money(result.slip.earnings.total)}</span></div>
              <div className="flex justify-between"><span>Total deductions</span><span>{money(result.slip.deductions.total)}</span></div>
              <div className="flex justify-between font-semibold text-[#9A3518]"><span>Net pay ≈</span><span>₱{money(result.slip.netPay)}</span></div>
              {!result.hasTips && (
                <p className="text-xs text-[#6E4B38]">Tips not included — the tips pool is entered on the Compute screen.</p>
              )}
            </div>
          )}
          {!result && <p className="text-xs text-[#6E4B38]">No numbers to preview yet — check the pay fields above.</p>}
          <button
            className="px-4 py-2 rounded-xl border border-[#CC7459] text-[#9A3518] font-medium active:opacity-80"
            onClick={keepInputs}
          >
            Keep these inputs for this cutoff
          </button>
          {keptNote && <p className="text-sm text-[#6E4B38]">{keptNote}</p>}
        </>
      )}
    </section>
  );
}

const COL_LABEL: Record<string, string> = {
  family_name: 'surname',
  given_name: 'given name',
  email: 'email',
  team: 'team',
  employee_type: 'type',
  payout_channel: 'payout',
  paywise_name: 'PNB name',
  paywise_account: 'PNB account',
  basic_monthly: 'basic salary',
  allowance_monthly: 'allowance',
  daily_rate: 'daily rate',
  benefits_class: 'benefits class',
  benefits_label: 'benefits label',
  m_sss: 'SSS monthly',
  m_philhealth: 'PhilHealth monthly',
  m_hdmf: 'Pag-IBIG monthly',
  leave_balance: 'leave balance',
  date_hired: 'date hired',
  probation_end: 'probation until',
  regularized_on: 'regularized on',
  contact_number: 'contact',
  birthday: 'birthday',
};

const val = (v: unknown): string => (v == null || v === '' ? '—' : String(v));

function entrySummary(c: ChangeEntry): string {
  if (c.details?.changes) {
    const parts = Object.entries(c.details.changes).map(
      ([col, ch]) => `${COL_LABEL[col] ?? col}: ${val(ch.from)} → ${val(ch.to)}`
    );
    return (c.action === 'undo' ? 'undid — ' : '') + parts.join(' · ');
  }
  if (c.details?.loan) {
    const l = c.details.loan;
    const label = { sss: 'SSS loan', hdmf: 'HDMF loan', advance: 'Tanawin advance' }[l.kind];
    const verb = { 'loan-added': 'added', 'loan-ended': 'ended', 'loan-reactivated': 'reactivated' }[c.action as 'loan-added' | 'loan-ended' | 'loan-reactivated'] ?? c.action;
    return `${label} ${verb}: ${money(l.perCutoff)}/cutoff${l.startsOn ? ` · starts ${isoYmd(l.startsOn)}` : ''}`;
  }
  if (c.action === 'note-added') return `note added: "${c.details?.note ?? ''}"`;
  if (c.action === 'note-deleted') return `note deleted: "${c.details?.note ?? ''}"`;
  if (c.action === 'deactivated') return 'marked as no longer employed';
  if (c.action === 'reactivated') return 'marked as employed again';
  return c.action;
}

// Edit history — who changed what, when; field edits can be undone. The undo
// itself is logged, so the trail stays honest.
function HistorySection({ employeeId, onUndone }: { employeeId: string; onUndone: () => Promise<void> }) {
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null);
  const [histError, setHistError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadChangeLog(employeeId)
      .then((e) => {
        setEntries(e);
        setHistError(null);
      })
      .catch((e) => setHistError(e instanceof Error ? e.message : String(e)));
  }, [employeeId]);

  async function handleUndo(c: ChangeEntry) {
    if (!c.details?.changes || busy) return;
    const summary = Object.entries(c.details.changes)
      .map(([col, ch]) => `${COL_LABEL[col] ?? col} back to ${val(ch.from)}`)
      .join(', ');
    if (!confirm(`Undo this change? This sets ${summary}.`)) return;
    setBusy(true);
    try {
      await undoFieldChanges(employeeId, c.details.changes);
      await onUndone();
    } catch (e) {
      setHistError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
      <SectionTitle>Edit history</SectionTitle>
      {histError && (
        <div className="border rounded-lg px-3 py-2 text-sm bg-rose-50 border-rose-300 text-rose-900">
          🚨 {histError}
        </div>
      )}
      <ul className="divide-y divide-[#E6D8C9] text-sm">
        {(entries ?? []).map((c) => (
          <li key={c.id} className="py-2.5 flex items-start gap-3">
            <span className="min-w-0">
              <span className="text-xs text-[#6E4B38]">
                {fmtJsDate(new Date(c.createdAt))}
                {c.actor ? ` · ${c.actor.split('@')[0]}` : ''}
              </span>
              <span className="block break-words">{entrySummary(c)}</span>
            </span>
            {(c.action === 'update' || c.action === 'undo') && c.details?.changes && (
              <button
                className="ml-auto text-xs underline text-[#9A3518] active:opacity-70 shrink-0"
                onClick={() => handleUndo(c)}
              >
                Undo
              </button>
            )}
          </li>
        ))}
        {entries !== null && !entries.length && <li className="py-2 text-[#6E4B38]">No changes recorded yet.</li>}
        {entries === null && !histError && <li className="py-2 text-[#6E4B38]">Loading…</li>}
      </ul>
    </section>
  );
}

// Dated notes — a small logbook per person ("8/10 — loan starts"), newest
// first. Chosen over one free-text blob so notes keep their context.
function NotesSection({ employeeId }: { employeeId: string }) {
  const [notes, setNotes] = useState<EmployeeNote[] | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadNotes(employeeId)
      .then((n) => {
        setNotes(n);
        setNoteError(null);
      })
      .catch((e) => setNoteError(e instanceof Error ? e.message : String(e)));
  }, [employeeId]);

  async function handleAdd() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await addEmployeeNote(employeeId, text.trim());
      setText('');
      setNotes(await loadNotes(employeeId));
      setNoteError(null);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, noteText: string) {
    if (!confirm('Delete this note?')) return;
    try {
      await deleteEmployeeNote(id, employeeId, noteText);
      setNotes(await loadNotes(employeeId));
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
      <SectionTitle>Notes</SectionTitle>
      {noteError && (
        <div className="border rounded-lg px-3 py-2 text-sm bg-rose-50 border-rose-300 text-rose-900">
          🚨 {noteError}
        </div>
      )}
      <ul className="divide-y divide-[#E6D8C9] text-sm">
        {(notes ?? []).map((n) => (
          <li key={n.id} className="py-2.5 flex items-start gap-3">
            <span>
              <span className="text-xs text-[#6E4B38]">{fmtJsDate(new Date(n.createdAt))}</span>
              <span className="block">{n.note}</span>
            </span>
            <button
              className="ml-auto text-xs underline text-[#6E4B38] active:opacity-70"
              onClick={() => handleDelete(n.id, n.note)}
            >
              delete
            </button>
          </li>
        ))}
        {notes !== null && !notes.length && <li className="py-2 text-[#6E4B38]">No notes yet.</li>}
        {notes === null && !noteError && <li className="py-2 text-[#6E4B38]">Loading…</li>}
      </ul>
      <div className="flex gap-2 border-t border-[#E6D8C9] pt-3">
        <input
          className={INPUT + ' mt-0 flex-1'}
          placeholder="e.g. loan granted, starts next cutoff"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
          }}
        />
        <button
          className="px-4 py-2 rounded-xl border border-[#CC7459] text-[#9A3518] font-medium active:opacity-80 shrink-0"
          onClick={handleAdd}
        >
          Add
        </button>
      </div>
    </section>
  );
}

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
  allEmployees,
  loans,
  onBack,
  onChanged,
  onUndone,
}: {
  employee: MasterEmployee;
  allEmployees: MasterEmployee[];
  loans: Loan[];
  onBack: () => void;
  onChanged: () => void;
  onUndone: () => Promise<void>;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(employee));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newLoan, setNewLoan] = useState({ kind: 'sss' as Loan['kind'], perCutoff: '', note: '', startsOn: '' });
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
        startsOn: newLoan.startsOn || null,
      });
      setNewLoan({ kind: 'sss', perCutoff: '', note: '', startsOn: '' });
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
                {l.startsOn && (
                  <span className="ml-1.5 text-xs text-[#6E4B38]">
                    starts {isoYmd(l.startsOn)}
                  </span>
                )}
                {l.note && <span className="block text-xs text-[#6E4B38]">{l.note}</span>}
              </span>
              <button
                className="ml-auto text-sm underline text-[#9A3518] active:opacity-70"
                onClick={async () => {
                  try {
                    await setLoanActive(l.id, !l.active, {
                      employeeId: l.employeeId,
                      kind: l.kind,
                      perCutoff: l.perCutoff,
                    });
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
          <Field label="First deduction on (optional)">
            <DateField value={newLoan.startsOn} onChange={(v) => setNewLoan({ ...newLoan, startsOn: v })} />
          </Field>
          <Field label="Note">
            <input className={INPUT} value={newLoan.note} onChange={(e) => setNewLoan({ ...newLoan, note: e.target.value })} />
          </Field>
          <p className="col-span-2 text-xs text-[#6E4B38]">
            A negative amount is a refund — it's added to their pay instead of deducted (like the HDMF refunds).
            Set "first deduction on" to enter a loan the day it's granted — the app starts deducting it on that payday by itself.
          </p>
        </div>
        <button className="px-4 py-2 rounded-xl border border-[#CC7459] text-[#9A3518] font-medium active:opacity-80" onClick={handleAddLoan}>
          Add loan
        </button>
      </section>

      <TryComputeSection pageDraft={d} employee={employee} allEmployees={allEmployees} loans={loans} />

      <NotesSection employeeId={employee.id} />

      <HistorySection employeeId={employee.id} onUndone={onUndone} />

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
  // Bumped after an undo so the person page remounts with restored values —
  // the draft state initializes once and must not silently keep stale edits.
  const [undoTick, setUndoTick] = useState(0);

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
          key={`${e.id}:${e.active}:${undoTick}`}
          employee={e}
          allEmployees={employees}
          loans={loans}
          onBack={() => setView({ kind: 'list' })}
          onChanged={reload}
          onUndone={async () => {
            await reload();
            setUndoTick((t) => t + 1);
          }}
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
