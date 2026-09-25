'use client';

import { useEffect, useMemo, useState } from 'react';
import ResultView from './ResultView';
import {
  DEFAULT_REST_DAYS,
  FORT_PRICE,
  HORSE_PRICE,
  RIDE2_PRICE,
  RIDE_PRICE,
  compareRuns,
  computeRun,
  defaultDays,
  type CompEmployee,
  type ComputedRun,
  type CutoffInputs,
  type EmployeeInputs,
  type LineItem,
  type Loan,
} from '@/lib/engine';
import { clearDraft, cutoffDates, readDraft, toItemInputs, writeDraft, type ComputeDraft } from '@/lib/computeDraft';
import { loadMasters } from '@/lib/masters';
import { loadCounterpartRun, saveComputedRun, uploadRunFile } from '@/lib/persist';
import { buildRegisterXlsx } from '@/lib/register';
import { money } from '@/lib/format';
import type { RunWarning, SheetDate } from '@/lib/types';
import { Avatar, Chip, DateField, Field, INPUT, SectionTitle, StickyBar } from './ui';

const EMPTY_EMP: EmployeeInputs = {
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

function isoToSheet(s: string): SheetDate | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const itemsTotal = (items?: LineItem[]) =>
  (items ?? []).reduce((a, it) => a + (it.amount === '' ? 0 : it.amount), 0);

const FILL_LABELS: Record<string, string> = {
  days: 'Days worked',
  otHours: 'Overtime hours',
  regularHolidays: 'Regular holidays worked',
  specialHolidays: 'Special holidays worked',
  paidLeaves: 'Paid leave days',
  unpaidDays: 'Unpaid days',
  addition: 'Addition to pay ₱…',
  deduction: 'Deduction from pay ₱…',
};

const GRID_CELL =
  'w-16 border border-[#E6D8C9] rounded-lg px-1.5 py-1.5 text-sm text-right bg-white disabled:opacity-40';

// Labeled additions/deductions: one row per reason, so "600" is never a
// mystery in the archive. Mirrors the way the sheet gets annotated.
function ItemsEditor({
  title,
  addLabel,
  items,
  onChange,
}: {
  title: string;
  addLabel: string;
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}) {
  return (
    <div className="col-span-2 space-y-2">
      <p className="text-xs font-medium text-[#6E4B38]">{title}</p>
      {items.map((it, i) => (
        <div key={i} className="flex gap-2 items-center">
          {/* INPUT is w-full — size via wrappers, not competing width classes */}
          <div className="flex-1 min-w-0">
            <input
              type="text"
              className={INPUT}
              placeholder="what it's for — e.g. uniform share"
              value={it.label}
              onChange={(ev) => onChange(items.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))}
            />
          </div>
          <div className="w-24 shrink-0">
            <input
              type="number"
              inputMode="decimal"
              className={INPUT}
              placeholder="₱"
              value={it.amount}
              onChange={(ev) =>
                onChange(items.map((x, j) => (j === i ? { ...x, amount: ev.target.value === '' ? '' : Number(ev.target.value) } : x)))
              }
            />
          </div>
          <button
            type="button"
            aria-label={`remove ${title.toLowerCase()} row`}
            className="text-[#9A3518] px-1 active:opacity-70 shrink-0"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-sm text-[#9A3518] font-medium active:opacity-70"
        onClick={() => onChange([...items, { label: '', amount: '' }])}
      >
        + {addLabel}
      </button>
    </div>
  );
}


export default function CutoffForm({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: () => void;
}) {
  const [masters, setMasters] = useState<{ employees: CompEmployee[]; loans: Loan[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft] = useState(readDraft);
  const [periodStart, setPeriodStart] = useState(draft?.periodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(draft?.periodEnd ?? '');
  const [disbursement, setDisbursement] = useState(draft?.disbursement ?? '');
  const [restDays, setRestDays] = useState<number | ''>(draft?.restDays ?? DEFAULT_REST_DAYS);
  const [ridePax, setRidePax] = useState<number | ''>(draft?.ridePax ?? '');
  const [ride2Pax, setRide2Pax] = useState<number | ''>(draft?.ride2Pax ?? '');
  const [fortPax, setFortPax] = useState<number | ''>(draft?.fortPax ?? '');
  const [serviceCharge, setServiceCharge] = useState<number | ''>(draft?.serviceCharge ?? '');
  const [horsePax, setHorsePax] = useState<number | ''>(draft?.horsePax ?? '');
  const [tipBox, setTipBox] = useState<number | ''>(draft?.tipBox ?? '');
  const [runNote, setRunNote] = useState<string>(draft?.runNote ?? '');
  const [perEmp, setPerEmp] = useState<Record<string, EmployeeInputs>>({});

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Cards vs spreadsheet-style table. Table is the fast path on a computer
  // (type down a column like the sheet); phone defaults to cards. Remembered
  // per device only — it's a viewing preference, not cutoff data.
  const [entryView, setEntryViewState] = useState<'cards' | 'table'>('cards');
  useEffect(() => {
    try {
      if (localStorage.getItem('payroll-entry-view') === 'table') setEntryViewState('table');
    } catch {
      // storage unavailable — default stands
    }
  }, []);
  function setEntryView(v: 'cards' | 'table') {
    setEntryViewState(v);
    try {
      localStorage.setItem('payroll-entry-view', v);
    } catch {
      // storage unavailable — the toggle still works for this visit
    }
  }

  // "Set for everyone" — one action instead of 13 cards when a holiday or a
  // shared deduction (uniform share) applies to the whole team.
  type FillField = 'days' | 'otHours' | 'regularHolidays' | 'specialHolidays' | 'paidLeaves' | 'unpaidDays' | 'addition' | 'deduction';
  const [fillField, setFillField] = useState<FillField>('regularHolidays');
  const [fillValue, setFillValue] = useState<number | ''>('');
  const [fillLabel, setFillLabel] = useState('');
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [computed, setComputed] = useState<ComputedRun | null>(null);
  const [diffNote, setDiffNote] = useState<RunWarning[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [computeError, setComputeError] = useState<string | null>(null);

  useEffect(() => {
    loadMasters()
      .then((m) => {
        setMasters(m);
        // Dailies start unchecked — they're only paid when they worked.
        // Draft values overlay the defaults, so returning mid-entry (after
        // checking a loan, say) restores everything already typed.
        setPerEmp(
          Object.fromEntries(
            m.employees.map((e) => [
              e.id,
              // toItemInputs migrates draft-era bare amounts (incl. sheet
              // imports) into labeled rows so the form edits one shape only.
              toItemInputs({ ...EMPTY_EMP, include: e.employeeType !== 'daily', ...(draft?.perEmp?.[e.id] ?? {}) }),
            ])
          )
        );
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
    // draft is read once at mount; it never changes afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the working draft on every change (session-scoped).
  useEffect(() => {
    const d: ComputeDraft = { periodStart, periodEnd, disbursement, restDays, ridePax, ride2Pax, fortPax, serviceCharge, horsePax, tipBox, runNote, perEmp };
    writeDraft(d);
  }, [periodStart, periodEnd, disbursement, restDays, ridePax, ride2Pax, fortPax, serviceCharge, horsePax, tipBox, runNote, perEmp]);

  const dates = useMemo(
    () => ({
      periodStart: isoToSheet(periodStart),
      periodEnd: isoToSheet(periodEnd),
      disbursementDate: isoToSheet(disbursement),
    }),
    [periodStart, periodEnd, disbursement]
  );

  const daysDefault =
    dates.periodStart && dates.periodEnd
      ? defaultDays({
          periodStart: dates.periodStart,
          periodEnd: dates.periodEnd,
          restDays: restDays === '' ? DEFAULT_REST_DAYS : restDays,
        })
      : null;

  // Live preview: the engine is pure and instant, so projected pay shows as
  // the form is filled — before the formal Compute step. Dailies without
  // days typed are left out of the numbers (blank must never mean "guess").
  const preview = useMemo(() => {
    if (!masters || !dates.periodStart || !dates.periodEnd || !dates.disbursementDate) return null;
    const perEmployee: Record<string, EmployeeInputs> = {};
    for (const e of masters.employees) {
      const inp = perEmp[e.id] ?? EMPTY_EMP;
      perEmployee[e.id] =
        e.employeeType === 'daily' && inp.days === '' ? { ...inp, include: false } : inp;
    }
    try {
      const run = computeRun(masters.employees, masters.loans, {
        periodStart: dates.periodStart,
        periodEnd: dates.periodEnd,
        disbursementDate: dates.disbursementDate,
        restDays: restDays === '' ? DEFAULT_REST_DAYS : restDays,
        ridePax,
        ride2Pax,
        fortPax,
        serviceCharge,
        horsePax,
        tipBox,
        perEmployee,
      });
      return {
        net: new Map(run.payslips.map((p) => [p.employeeId, p.netPay])),
        total: run.payslips.reduce((a, p) => a + p.netPay, 0),
        count: run.payslips.length,
      };
    } catch {
      return null;
    }
  }, [masters, dates, restDays, ridePax, ride2Pax, fortPax, serviceCharge, horsePax, tipBox, perEmp]);

  function fillCutoff(which: 10 | 25) {
    const c = cutoffDates(which);
    setPeriodStart(c.periodStart);
    setPeriodEnd(c.periodEnd);
    setDisbursement(c.disbursement);
  }

  function setEmp(id: string, patch: Partial<EmployeeInputs>) {
    setPerEmp((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  }

  function applyToEveryone() {
    if (!masters || fillValue === '') return;
    const included = masters.employees.filter((e) => perEmp[e.id]?.include);
    setPerEmp((prev) => {
      const next = { ...prev };
      for (const e of included) {
        const inp = next[e.id];
        if (fillField === 'addition') {
          next[e.id] = { ...inp, adjustItems: [...(inp.adjustItems ?? []), { label: fillLabel.trim(), amount: fillValue }] };
        } else if (fillField === 'deduction') {
          next[e.id] = { ...inp, deductItems: [...(inp.deductItems ?? []), { label: fillLabel.trim(), amount: fillValue }] };
        } else {
          next[e.id] = { ...inp, [fillField]: fillValue };
        }
      }
      return next;
    });
    const what =
      fillField === 'addition' || fillField === 'deduction'
        ? `${fillField} "${fillLabel.trim() || '—'}" ₱${fillValue}`
        : `${FILL_LABELS[fillField]} = ${fillValue}`;
    setFillNote(`Applied ${what} to ${included.length} people. Adjust anyone individually below.`);
    setFillValue('');
    setFillLabel('');
  }

  // Column-wise keyboard travel in the table: ↓/↑/Enter move within the same
  // column, like the sheet. Tab keeps its native row-major order.
  function gridKeyNav(ev: React.KeyboardEvent<HTMLInputElement>) {
    const t = ev.currentTarget;
    const r = Number(t.dataset.r);
    const c = t.dataset.c;
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Enter') return;
    ev.preventDefault();
    const dir = ev.key === 'ArrowUp' ? -1 : 1;
    const nextEl = document.querySelector<HTMLInputElement>(`input[data-c="${c}"][data-r="${r + dir}"]`);
    nextEl?.focus();
    nextEl?.select?.();
  }

  async function handleCompute() {
    setComputeError(null);
    setSavedNote(null);
    if (!masters) return;
    if (!dates.periodStart || !dates.periodEnd || !dates.disbursementDate) {
      setComputeError('Set the period start, period end, and disbursement date first.');
      return;
    }
    if (periodEnd <= periodStart) {
      setComputeError('Period end must be after period start.');
      return;
    }
    // Dailies have no sensible default — forgetting their days would pay a
    // full cutoff. Require the number explicitly.
    const dailiesMissingDays = masters.employees
      .filter((e) => e.employeeType === 'daily' && perEmp[e.id]?.include && perEmp[e.id]?.days === '')
      .map((e) => e.family);
    if (dailiesMissingDays.length) {
      setComputeError(
        `Enter days worked for: ${dailiesMissingDays.join(', ')} — dailies don't use the default.`
      );
      return;
    }
    const inputs: CutoffInputs = {
      periodStart: dates.periodStart,
      periodEnd: dates.periodEnd,
      disbursementDate: dates.disbursementDate,
      restDays: restDays === '' ? DEFAULT_REST_DAYS : restDays,
      ridePax,
      ride2Pax,
      fortPax,
      serviceCharge,
      horsePax,
      tipBox,
      perEmployee: perEmp,
    };
    const run = computeRun(masters.employees, masters.loans, inputs);
    const dailies = new Set(
      masters.employees.filter((e) => e.employeeType === 'daily').map((e) => e.family.toLowerCase())
    );
    // The parallel-run gate must never be silent: "everything matched" and
    // "nothing was checked" have to look different on screen.
    let diff: RunWarning[] = [];
    try {
      const counterpart = await loadCounterpartRun(dates, 'computed');
      diff = counterpart
        ? compareRuns(run.payslips, counterpart.payslips, dailies)
        : [
            {
              severity: 'info',
              message:
                'Parallel run: no sheet upload found for this cutoff yet, so nothing was compared. Upload the sheet with these exact three dates and the comparison will run then.',
            },
          ];
    } catch (e) {
      diff = [
        {
          severity: 'warning',
          message: `Parallel run: couldn't check for a sheet upload to compare against, so nothing was compared. (${e instanceof Error ? e.message : String(e)})`,
        },
      ];
    }
    setDiffNote(diff);
    setSavedRunId(null);
    setComputed(run);
  }

  async function handleSave() {
    if (!computed || saving || !dates.periodStart || !dates.periodEnd || !dates.disbursementDate) return;
    setSaving(true);
    try {
      const { replaced, runId } = await saveComputedRun(
        {
          periodStart: dates.periodStart,
          periodEnd: dates.periodEnd,
          disbursementDate: dates.disbursementDate,
        },
        computed.payslips,
        [...computed.warnings, ...diffNote],
        runNote
      );
      // The app's own document of record: the payroll register spreadsheet.
      // Uploaded BEFORE exposing runId so the files list includes it.
      const reg = buildRegisterXlsx(computed.payslips, {
        periodStart: dates.periodStart,
        periodEnd: dates.periodEnd,
        disbursementDate: dates.disbursementDate,
        note: runNote,
      });
      const up = await uploadRunFile(runId, reg.filename, reg.blob);
      setSavedRunId(runId);
      // The cutoff is done — clear the draft so it can't leak stale extras
      // (a tip pool, someone's OT) into the next cutoff's form.
      clearDraft();
      setSavedNote(
        (replaced
          ? '📁 Archived — replaced the previous computed run for this cutoff.'
          : '📁 Archived as a computed run.') + (up.ok ? ' Payroll register attached.' : '')
      );
      onSaved();
    } catch (e) {
      setSavedNote(`⚠️ Not archived: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <button className="text-[#9A3518] font-medium active:opacity-70" onClick={onBack}>
          ← Back
        </button>
        <div className="border rounded-lg px-4 py-3 text-sm bg-rose-50 border-rose-300 text-rose-900">
          🚨 {loadError}
        </div>
      </div>
    );
  }
  if (!masters) return <p className="text-center text-[#6E4B38] mt-10">Loading employees…</p>;

  // Results mode: show the payslips exactly like a sheet upload, with save.
  if (computed) {
    return (
      <ResultView
        meta={{
          periodStart: dates.periodStart,
          periodEnd: dates.periodEnd,
          disbursementDate: dates.disbursementDate,
          sourceFilename: 'computed in app',
        }}
        payslips={computed.payslips}
        warnings={[...computed.warnings, ...diffNote]}
        savedNote={savedNote}
        runNote={runNote.trim() || null}
        runId={savedRunId}
        onBack={() => setComputed(null)}
        backLabel="← Edit inputs"
        extraAction={
          <button
            className="px-5 py-2.5 rounded-lg border-2 border-[#9A3518] text-[#9A3518] font-medium active:opacity-80 disabled:opacity-50"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : '💾 Save to archive'}
          </button>
        }
      />
    );
  }

  // live tips math for the header line
  const n0 = (v: number | '') => (v === '' ? 0 : v);
  const pool =
    n0(ridePax) * RIDE_PRICE + n0(ride2Pax) * RIDE2_PRICE + n0(fortPax) * FORT_PRICE +
    n0(serviceCharge) + n0(horsePax) * HORSE_PRICE + n0(tipBox);
  const headcount = masters.employees.filter(
    (e) => e.employeeType !== 'daily' && (perEmp[e.id]?.include ?? true)
  ).length;

  function summaryOf(e: CompEmployee): string {
    const inp = perEmp[e.id] ?? EMPTY_EMP;
    if (!inp.include) return 'not paid this cutoff';
    const parts: string[] = [];
    parts.push(`${inp.days === '' ? (daysDefault ?? '—') : inp.days} days`);
    if (inp.otHours !== '') parts.push(`OT ${inp.otHours}h`);
    if (inp.regularHolidays !== '') parts.push(`${inp.regularHolidays} reg hol`);
    if (inp.specialHolidays !== '') parts.push(`${inp.specialHolidays} spec hol`);
    if (inp.paidLeaves !== '') parts.push(`${inp.paidLeaves} leave`);
    if (inp.unpaidDays !== '') parts.push(`${inp.unpaidDays} unpaid`);
    const adds = itemsTotal(inp.adjustItems);
    const deducts = itemsTotal(inp.deductItems);
    if (adds !== 0) parts.push(`+₱${adds}`);
    if (deducts !== 0) parts.push(`−₱${deducts}`);
    if (inp.note?.trim()) parts.push('📝');
    return parts.length === 1 ? `${parts[0]} · no extras` : parts.join(' · ');
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <button className="text-[#9A3518] font-medium active:opacity-70" onClick={onBack}>
        ← Back
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-lg">🧮 Compute payroll</h2>
        <span className="text-[11px] bg-amber-100 text-amber-900 border border-amber-300 rounded-full px-2 py-0.5 font-semibold">
          parallel run — the sheet is still the boss
        </span>
      </div>

      {/* cutoff dates */}
      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>Cutoff</SectionTitle>
        <div className="flex gap-2">
          <button className="flex-1 text-sm px-3 py-2 rounded-xl border border-[#CC7459] text-[#9A3518] font-medium active:bg-[#F5EDE4]" onClick={() => fillCutoff(10)}>
            10th (24th → 8th)
          </button>
          <button className="flex-1 text-sm px-3 py-2 rounded-xl border border-[#CC7459] text-[#9A3518] font-medium active:bg-[#F5EDE4]" onClick={() => fillCutoff(25)}>
            25th (9th → 23rd)
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period start">
            <DateField value={periodStart} onChange={setPeriodStart} />
          </Field>
          <Field label="Period end">
            <DateField value={periodEnd} onChange={setPeriodEnd} />
          </Field>
          <Field label="Disbursement (payday)">
            <DateField value={disbursement} onChange={setDisbursement} />
          </Field>
          <Field label="Rest days">
            <input
              type="number" inputMode="numeric" className={INPUT} value={restDays}
              onChange={(e) => setRestDays(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </Field>
        </div>
        {daysDefault != null && (
          <p className="text-sm text-[#6E4B38]">→ {daysDefault} working days for everyone, unless you change a person below.</p>
        )}
      </section>

      {/* tips pool */}
      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>Tips pool (shared equally)</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Ride package 1 pax (× ₱${RIDE_PRICE})`}>
            <input type="number" inputMode="numeric" className={INPUT} value={ridePax} onChange={(e) => setRidePax(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <Field label={`Ride package 2 pax (× ₱${RIDE2_PRICE})`}>
            <input type="number" inputMode="numeric" className={INPUT} value={ride2Pax} onChange={(e) => setRide2Pax(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <Field label={`Fort of Fun pax (× ₱${FORT_PRICE})`}>
            <input type="number" inputMode="numeric" className={INPUT} value={fortPax} onChange={(e) => setFortPax(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <Field label="Service charge ₱">
            <input type="number" inputMode="decimal" className={INPUT} value={serviceCharge} onChange={(e) => setServiceCharge(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <Field label={`Horse pax (× ₱${HORSE_PRICE})`}>
            <input type="number" inputMode="numeric" className={INPUT} value={horsePax} onChange={(e) => setHorsePax(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <Field label="Tip box ₱">
            <input type="number" inputMode="decimal" className={INPUT} value={tipBox} onChange={(e) => setTipBox(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
        </div>
        {pool > 0 && headcount > 0 && (
          <p className="text-sm font-medium text-[#9A3518]">
            Pool ₱{pool.toFixed(2)} ÷ {headcount} people = ₱{(pool / headcount).toFixed(2)} each
          </p>
        )}
      </section>

      {/* run-level note */}
      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-2">
        <SectionTitle>Note for this payroll (optional)</SectionTitle>
        <textarea
          className={`${INPUT} min-h-[64px]`}
          placeholder='Anything about this cutoff as a whole — e.g. "Aug 21 special holiday applied to everyone".'
          value={runNote}
          onChange={(ev) => setRunNote(ev.target.value)}
        />
        <p className="text-xs text-[#6E4B38]">
          Saved with the archived run. It can also be added or edited later from the archive.
        </p>
      </section>

      {/* per-employee inputs — cards (phone) or a sheet-style table (desktop) */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <SectionTitle>
            {entryView === 'table' ? 'People — type down the columns, like the sheet' : 'People — tap anyone with something to enter'}
          </SectionTitle>
          <div className="flex rounded-xl border border-[#CC7459] overflow-hidden text-sm font-medium">
            {(['cards', 'table'] as const).map((v) => (
              <button
                key={v}
                className={`px-3 py-1.5 ${entryView === v ? 'bg-[#9A3518] text-[#FBF6EF]' : 'text-[#9A3518] active:bg-[#F5EDE4]'}`}
                onClick={() => setEntryView(v)}
              >
                {v === 'cards' ? '📇 Cards' : '📊 Table'}
              </button>
            ))}
          </div>
        </div>

        {/* set for everyone */}
        <div className="bg-white rounded-2xl border border-[#E6D8C9] p-3 space-y-2">
          <p className="text-xs font-medium text-[#6E4B38]">Set for everyone (everyone checked below)</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="border border-[#E6D8C9] rounded-lg px-2 py-2 text-sm bg-white"
              value={fillField}
              onChange={(ev) => setFillField(ev.target.value as typeof fillField)}
            >
              {Object.entries(FILL_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            {(fillField === 'addition' || fillField === 'deduction') && (
              <input
                type="text"
                className="border border-[#E6D8C9] rounded-lg px-2 py-2 text-sm flex-1 min-w-[10rem]"
                placeholder="what it's for — e.g. uniform share"
                value={fillLabel}
                onChange={(ev) => setFillLabel(ev.target.value)}
              />
            )}
            <input
              type="number"
              inputMode="decimal"
              className="border border-[#E6D8C9] rounded-lg px-2 py-2 text-sm w-24 text-right"
              placeholder={fillField === 'addition' || fillField === 'deduction' ? '₱' : '#'}
              value={fillValue}
              onChange={(ev) => setFillValue(ev.target.value === '' ? '' : Number(ev.target.value))}
            />
            <button
              className="px-4 py-2 rounded-lg border-2 border-[#9A3518] text-[#9A3518] text-sm font-medium active:opacity-80 disabled:opacity-50"
              onClick={applyToEveryone}
              disabled={fillValue === ''}
            >
              Apply to everyone
            </button>
          </div>
          {fillNote && <p className="text-xs text-[#6E4B38]">✅ {fillNote}</p>}
        </div>

        {entryView === 'cards' && (
        <div className="space-y-2">
        {masters.employees.map((e) => {
          const inp = perEmp[e.id] ?? EMPTY_EMP;
          const open = expanded.has(e.id);
          return (
            <div key={e.id} className={`bg-white rounded-2xl border ${open ? 'border-[#CC7459]' : 'border-[#E6D8C9]'}`}>
              <div className="flex items-center gap-3 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="accent-[#9A3518] w-5 h-5"
                  checked={inp.include}
                  onChange={(ev) => setEmp(e.id, { include: ev.target.checked })}
                />
                <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => toggleExpand(e.id)}>
                  <Avatar name={e.family} muted={!inp.include} />
                  <span className="min-w-0 flex-1">
                    <span className={`font-semibold block truncate ${inp.include ? '' : 'opacity-60'}`}>
                      {e.family}
                      {e.employeeType !== 'regular' && (
                        <span className="ml-1.5 align-middle"><Chip kind={e.employeeType}>{e.employeeType}</Chip></span>
                      )}
                    </span>
                    <span className={`text-[13px] block truncate ${inp.include ? 'text-[#6E4B38]' : 'text-neutral-400'}`}>
                      {summaryOf(e)}
                      {preview && inp.include && (
                        <span className="text-[#9A3518]">
                          {preview.net.has(e.id)
                            ? ` · ≈ ₱${money(preview.net.get(e.id))}`
                            : ' · enter days to preview'}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className={`text-[#CC7459] transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                </button>
              </div>
              {open && (
                <div className="px-3 pb-3 grid grid-cols-2 gap-3 border-t border-[#F5EDE4] pt-3">
                  <Field label={`Days worked${daysDefault != null && e.employeeType !== 'daily' ? ` (blank = ${daysDefault})` : ''}`}>
                    <input type="number" inputMode="decimal" className={INPUT} value={inp.days} placeholder={e.employeeType === 'daily' ? 'required' : daysDefault != null ? String(daysDefault) : ''} onChange={(ev) => setEmp(e.id, { days: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </Field>
                  <Field label="Overtime hours">
                    <input type="number" inputMode="decimal" className={INPUT} value={inp.otHours} onChange={(ev) => setEmp(e.id, { otHours: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </Field>
                  <Field label="Regular holidays worked">
                    <input type="number" inputMode="numeric" className={INPUT} value={inp.regularHolidays} onChange={(ev) => setEmp(e.id, { regularHolidays: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </Field>
                  <Field label="Special holidays worked">
                    <input type="number" inputMode="numeric" className={INPUT} value={inp.specialHolidays} onChange={(ev) => setEmp(e.id, { specialHolidays: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </Field>
                  <Field label="Paid leave days">
                    <input type="number" inputMode="numeric" className={INPUT} value={inp.paidLeaves} onChange={(ev) => setEmp(e.id, { paidLeaves: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </Field>
                  <Field label="Unpaid days">
                    <input type="number" inputMode="numeric" className={INPUT} value={inp.unpaidDays} onChange={(ev) => setEmp(e.id, { unpaidDays: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </Field>
                  <ItemsEditor
                    title={`Additions to pay${itemsTotal(inp.adjustItems) !== 0 ? ` — ₱${itemsTotal(inp.adjustItems)}` : ''}`}
                    addLabel="Add an addition"
                    items={inp.adjustItems ?? []}
                    onChange={(items) => setEmp(e.id, { adjustItems: items })}
                  />
                  <ItemsEditor
                    title={`Deductions from pay${itemsTotal(inp.deductItems) !== 0 ? ` — ₱${itemsTotal(inp.deductItems)}` : ''}`}
                    addLabel="Add a deduction"
                    items={inp.deductItems ?? []}
                    onChange={(items) => setEmp(e.id, { deductItems: items })}
                  />
                  <div className="col-span-2">
                    <Field label="Note for this payroll (optional)">
                      <input
                        type="text"
                        className={INPUT}
                        placeholder='e.g. "2h OT approved", "half day 9/2"'
                        value={inp.note ?? ''}
                        onChange={(ev) => setEmp(e.id, { note: ev.target.value })}
                      />
                    </Field>
                  </div>
                  {(() => {
                    // Show what will be deducted automatically so nobody
                    // wonders whether to total contributions by hand.
                    const auto: string[] = [];
                    if (e.mSss) auto.push(`SSS ${money(e.mSss / 2)}`);
                    if (e.mPhilhealth) auto.push(`PhilHealth ${money(e.mPhilhealth / 2)}`);
                    if (e.mHdmf) auto.push(`HDMF ${money(e.mHdmf / 2)}`);
                    const loanTotal = masters.loans
                      .filter((l) => l.employeeId === e.id && l.active)
                      .reduce((a, l) => a + l.perCutoff, 0);
                    if (loanTotal > 0) auto.push(`loans/advances ${money(loanTotal)}`);
                    else if (loanTotal < 0) auto.push(`refund ${money(loanTotal)} (added to pay)`);
                    return (
                      <p className="col-span-2 text-xs text-[#6E4B38]">
                        {auto.length
                          ? `Deducted automatically (from their page): ${auto.join(' · ')}`
                          : 'No automatic deductions on file for this person.'}
                      </p>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
        </div>
        )}

        {entryView === 'table' && (
          <div className="bg-white rounded-2xl border border-[#E6D8C9] overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm border-collapse">
              <thead>
                <tr className="text-xs text-[#6E4B38]">
                  <th className="text-left px-3 py-2 sticky left-0 bg-white">person</th>
                  <th className="px-1 py-2 font-medium">days</th>
                  <th className="px-1 py-2 font-medium">OT h</th>
                  <th className="px-1 py-2 font-medium">reg hol</th>
                  <th className="px-1 py-2 font-medium">spec hol</th>
                  <th className="px-1 py-2 font-medium">leave</th>
                  <th className="px-1 py-2 font-medium">unpaid</th>
                  <th className="px-1 py-2 font-medium">add ₱</th>
                  <th className="px-1 py-2 font-medium">deduct ₱</th>
                  <th className="text-left px-1 py-2 font-medium">note</th>
                  <th className="text-right px-3 py-2 font-medium">≈ net</th>
                </tr>
              </thead>
              <tbody>
                {masters.employees.map((e, r) => {
                  const inp = perEmp[e.id] ?? EMPTY_EMP;
                  const numCell = (
                    col: string,
                    value: number | '',
                    patch: (v: number | '') => Partial<EmployeeInputs>,
                    placeholder = ''
                  ) => (
                    <td className="px-1 py-1">
                      <input
                        type="number" inputMode="decimal" className={GRID_CELL}
                        data-r={r} data-c={col} onKeyDown={gridKeyNav}
                        value={value} placeholder={placeholder} disabled={!inp.include}
                        onChange={(ev) => setEmp(e.id, patch(ev.target.value === '' ? '' : Number(ev.target.value)))}
                      />
                    </td>
                  );
                  // Labeled amounts: the cell edits the single row's amount
                  // (label stays editable in Cards); several rows → total only.
                  const itemCell = (col: string, key: 'adjustItems' | 'deductItems') => {
                    const items = inp[key] ?? [];
                    if (items.length > 1) {
                      return (
                        <td className="px-1 py-1 text-right text-xs text-[#6E4B38] whitespace-nowrap">
                          ₱{itemsTotal(items)} ({items.length})
                        </td>
                      );
                    }
                    return (
                      <td className="px-1 py-1">
                        <input
                          type="number" inputMode="decimal" className={GRID_CELL}
                          data-r={r} data-c={col} onKeyDown={gridKeyNav}
                          value={items[0]?.amount ?? ''} disabled={!inp.include}
                          onChange={(ev) => {
                            const v = ev.target.value === '' ? '' : Number(ev.target.value);
                            setEmp(e.id, { [key]: [{ label: items[0]?.label ?? '', amount: v }] });
                          }}
                        />
                      </td>
                    );
                  };
                  return (
                    <tr key={e.id} className="border-t border-[#F5EDE4]">
                      <td className="px-3 py-1 sticky left-0 bg-white whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox" className="accent-[#9A3518] w-4 h-4"
                            checked={inp.include}
                            onChange={(ev) => setEmp(e.id, { include: ev.target.checked })}
                          />
                          <button
                            className={`font-semibold active:opacity-70 ${inp.include ? '' : 'opacity-50'}`}
                            title="Open in Cards (labels, details)"
                            onClick={() => { setEntryView('cards'); setExpanded(new Set([e.id])); }}
                          >
                            {e.family}
                          </button>
                          {e.employeeType !== 'regular' && <Chip kind={e.employeeType}>{e.employeeType}</Chip>}
                          {inp.note?.trim() ? <span title={inp.note}>📝</span> : null}
                        </span>
                      </td>
                      {numCell('days', inp.days, (v) => ({ days: v }), e.employeeType === 'daily' ? 'req' : daysDefault != null ? String(daysDefault) : '')}
                      {numCell('ot', inp.otHours, (v) => ({ otHours: v }))}
                      {numCell('rh', inp.regularHolidays, (v) => ({ regularHolidays: v }))}
                      {numCell('sh', inp.specialHolidays, (v) => ({ specialHolidays: v }))}
                      {numCell('pl', inp.paidLeaves, (v) => ({ paidLeaves: v }))}
                      {numCell('ud', inp.unpaidDays, (v) => ({ unpaidDays: v }))}
                      {itemCell('add', 'adjustItems')}
                      {itemCell('ded', 'deductItems')}
                      <td className="px-1 py-1">
                        <input
                          type="text"
                          className="w-40 border border-[#E6D8C9] rounded-lg px-1.5 py-1.5 text-sm bg-white disabled:opacity-40"
                          data-r={r} data-c="note" onKeyDown={gridKeyNav}
                          value={inp.note ?? ''} disabled={!inp.include}
                          onChange={(ev) => setEmp(e.id, { note: ev.target.value })}
                        />
                      </td>
                      <td className="px-3 py-1 text-right text-[#9A3518] whitespace-nowrap">
                        {preview && inp.include ? (preview.net.has(e.id) ? `₱${money(preview.net.get(e.id))}` : '—') : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {entryView === 'table' && (
          <p className="text-xs text-[#6E4B38] px-1">
            ↑ ↓ and Enter move within a column, Tab moves across. Tap a name for labels and details
            (a person with several labeled amounts shows the total here — edit those in Cards).
          </p>
        )}

        <p className="text-xs text-[#6E4B38] px-1">
          Paid leaves reduce the leave balance, not pay. Unpaid days are deducted at the daily rate.
          Dailies must have days entered before computing.
        </p>
      </section>

      {computeError && (
        <div className="border rounded-xl px-3 py-2 text-sm bg-rose-50 border-rose-300 text-rose-900">
          🚨 {computeError}
        </div>
      )}

      <StickyBar>
        {preview && (
          <span className="w-full text-sm text-[#6E4B38]">
            Preview: {preview.count} people · total ≈ ₱{money(preview.total)}
          </span>
        )}
        <button
          className="flex-1 px-5 py-3 rounded-xl bg-[#9A3518] text-[#FBF6EF] font-semibold active:opacity-80"
          onClick={handleCompute}
        >
          Compute payslips
        </button>
      </StickyBar>
    </div>
  );
}
