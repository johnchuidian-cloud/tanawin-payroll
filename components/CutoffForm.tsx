'use client';

import { useEffect, useMemo, useState } from 'react';
import ResultView from './ResultView';
import {
  DEFAULT_REST_DAYS,
  HORSE_PRICE,
  RIDE_PRICE,
  compareRuns,
  computeRun,
  defaultDays,
  type CompEmployee,
  type ComputedRun,
  type CutoffInputs,
  type EmployeeInputs,
  type Loan,
} from '@/lib/engine';
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

export default function CutoffForm({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: () => void;
}) {
  const [masters, setMasters] = useState<{ employees: CompEmployee[]; loans: Loan[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [disbursement, setDisbursement] = useState('');
  const [restDays, setRestDays] = useState<number | ''>(DEFAULT_REST_DAYS);
  const [ridePax, setRidePax] = useState<number | ''>('');
  const [serviceCharge, setServiceCharge] = useState<number | ''>('');
  const [horsePax, setHorsePax] = useState<number | ''>('');
  const [tipBox, setTipBox] = useState<number | ''>('');
  const [perEmp, setPerEmp] = useState<Record<string, EmployeeInputs>>({});

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
        setPerEmp(
          Object.fromEntries(
            m.employees.map((e) => [e.id, { ...EMPTY_EMP, include: e.employeeType !== 'daily' }])
          )
        );
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

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

  function fillCutoff(which: 10 | 25) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    if (which === 10) {
      const pm = m === 1 ? 12 : m - 1;
      const py = m === 1 ? y - 1 : y;
      setPeriodStart(iso(py, pm, 24));
      setPeriodEnd(iso(y, m, 8));
      setDisbursement(iso(y, m, 10));
    } else {
      setPeriodStart(iso(y, m, 9));
      setPeriodEnd(iso(y, m, 23));
      setDisbursement(iso(y, m, 25));
    }
  }

  function setEmp(id: string, patch: Partial<EmployeeInputs>) {
    setPerEmp((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
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
        [...computed.warnings, ...diffNote]
      );
      // The app's own document of record: the payroll register spreadsheet.
      // Uploaded BEFORE exposing runId so the files list includes it.
      const reg = buildRegisterXlsx(computed.payslips, {
        periodStart: dates.periodStart,
        periodEnd: dates.periodEnd,
        disbursementDate: dates.disbursementDate,
      });
      const up = await uploadRunFile(runId, reg.filename, reg.blob);
      setSavedRunId(runId);
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
  const pool = n0(ridePax) * RIDE_PRICE + n0(serviceCharge) + n0(horsePax) * HORSE_PRICE + n0(tipBox);
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
    if (inp.adjustments !== '') parts.push(`+₱${inp.adjustments}`);
    if (inp.others !== '') parts.push(`−₱${inp.others}`);
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
          <Field label={`Ride pax (× ₱${RIDE_PRICE})`}>
            <input type="number" inputMode="numeric" className={INPUT} value={ridePax} onChange={(e) => setRidePax(e.target.value === '' ? '' : Number(e.target.value))} />
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

      {/* per-employee cards */}
      <section className="space-y-2">
        <SectionTitle>People — tap anyone with something to enter</SectionTitle>
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
                  <Field label="Additions to pay ₱">
                    <input type="number" inputMode="decimal" className={INPUT} value={inp.adjustments} onChange={(ev) => setEmp(e.id, { adjustments: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </Field>
                  <Field label="Deductions from pay ₱">
                    <input type="number" inputMode="decimal" className={INPUT} value={inp.others} onChange={(ev) => setEmp(e.id, { others: ev.target.value === '' ? '' : Number(ev.target.value) })} />
                  </Field>
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
