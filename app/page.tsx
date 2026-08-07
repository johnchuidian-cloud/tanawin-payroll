'use client';

import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import CutoffForm from '@/components/CutoffForm';
import LoginCard from '@/components/LoginCard';
import MastersEditor from '@/components/MastersEditor';
import ResultView, { type ResultMeta } from '@/components/ResultView';
import Wordmark from '@/components/Wordmark';
import { buildRun } from '@/lib/build';
import { fmtJsDate } from '@/lib/format';
import { compareRuns } from '@/lib/engine';
import { ParseError, parseWorkbook } from '@/lib/parse';
import { listRuns, loadCounterpartRun, loadRun, saveRun, uploadRunFile, type RunSummary } from '@/lib/persist';
import { supabase } from '@/lib/supabase';
import type { Payslip, RunWarning } from '@/lib/types';

interface ResultState {
  meta: ResultMeta;
  payslips: Payslip[];
  warnings: RunWarning[];
  savedNote: string | null;
  runId: string | null;
}

function isoToDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Group runs by disbursement month, newest first (listRuns is already sorted).
function groupByMonth(runs: RunSummary[]): { key: string; label: string; runs: RunSummary[] }[] {
  const groups: { key: string; label: string; runs: RunSummary[] }[] = [];
  for (const r of runs) {
    const key = r.disbursement_date.slice(0, 7); // YYYY-MM
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const [y, m] = key.split('-');
      g = { key, label: `${MONTH_NAMES[Number(m) - 1]} ${y}`, runs: [] };
      groups.push(g);
    }
    g.runs.push(r);
  }
  return groups;
}

export default function Home() {
  // undefined = still checking; null = signed out. Without Supabase configured
  // the gate is skipped entirely (local/dev mode, no archive).
  const [session, setSession] = useState<Session | null | undefined>(
    supabase ? undefined : null
  );
  const [result, setResult] = useState<ResultState | null>(null);
  const [view, setView] = useState<'landing' | 'compute' | 'masters'>('landing');
  const [pageError, setPageError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [openingRun, setOpeningRun] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const signedIn = !supabase || !!session;

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    listRuns()
      .then((r) => {
        setRuns(r);
        setRunsError(null);
      })
      .catch((e) => setRunsError(e instanceof Error ? e.message : String(e)));
  }, [session]);

  async function handleFile(file: File) {
    setPageError(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = parseWorkbook(buf, file.name);
      console.log('[tanawin-payroll] parsed workbook', wb);
      const run = buildRun(wb);
      console.log('[tanawin-payroll] build result', run);

      // Parallel run: if a computed run exists for this cutoff, diff it
      // against this sheet upload and surface the result loudly. And when
      // there is nothing to diff, say so — the gate must never be silent:
      // "everything matched" and "nothing was checked" have to look different.
      if (supabase) {
        try {
          const counterpart = await loadCounterpartRun(
            { periodStart: wb.periodStart, periodEnd: wb.periodEnd, disbursementDate: wb.disbursementDate },
            'sheet'
          );
          if (counterpart) {
            // Dailies exist only in computed runs (no email/log entry) — skip
            // them in the diff so they don't read as mismatches.
            const dailies = new Set(
              counterpart.payslips.filter((p) => !p.email).map((p) => p.family.toLowerCase())
            );
            run.warnings.push(...compareRuns(counterpart.payslips, run.payslips, dailies));
          } else {
            run.warnings.push({
              severity: 'info',
              message:
                'Parallel run: no computed run found for this cutoff yet, so nothing was compared. Compute the payroll in the app with the same three dates and the comparison will run then.',
            });
          }
        } catch (e) {
          run.warnings.push({
            severity: 'warning',
            message: `Parallel run: couldn't check for a computed run to compare against, so nothing was compared. (${e instanceof Error ? e.message : String(e)})`,
          });
        }
      }

      const meta: ResultMeta = {
        periodStart: wb.periodStart,
        periodEnd: wb.periodEnd,
        disbursementDate: wb.disbursementDate,
        sourceFilename: wb.sourceFilename,
      };

      if (supabase && session) {
        setResult({ meta, payslips: run.payslips, warnings: run.warnings, savedNote: 'Archiving…', runId: null });
        try {
          const { replaced, runId } = await saveRun(wb, run);
          // Keep the original workbook on record, attached to the run.
          let fileNote = '';
          const up = await uploadRunFile(runId, wb.sourceFilename.replace(/[\\/]/g, '_'), new Blob([buf]));
          fileNote = up.ok ? ' Workbook file attached.' : '';
          setResult({
            meta,
            payslips: run.payslips,
            warnings: run.warnings,
            savedNote:
              (replaced
                ? '📁 Archived — replaced the previous upload for this cutoff.'
                : '📁 Archived.') + fileNote,
            runId,
          });
          listRuns().then(setRuns).catch(() => {});
        } catch (e) {
          setResult({
            meta,
            payslips: run.payslips,
            warnings: run.warnings,
            savedNote: `⚠️ Not archived: ${e instanceof Error ? e.message : String(e)} — downloads still work.`,
            runId: null,
          });
        }
      } else {
        setResult({
          meta,
          payslips: run.payslips,
          warnings: run.warnings,
          savedNote: supabase ? null : '⚠️ Archive storage not connected — this upload is not being recorded.',
          runId: null,
        });
      }
    } catch (e) {
      setPageError(
        e instanceof ParseError
          ? e.message
          : `Unexpected error reading the file: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  async function openArchivedRun(id: string) {
    setOpeningRun(id);
    setPageError(null);
    try {
      const loaded = await loadRun(id);
      setResult({
        meta: { ...loaded.meta },
        payslips: loaded.payslips,
        warnings: loaded.warnings,
        savedNote: null,
        runId: loaded.id,
      });
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpeningRun(null);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="bg-[#9A3518] text-[#FBF6EF] px-5 py-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[21px]">
            <Wordmark flowerClassName="text-[#F1E4D6]" />
          </h1>
          <p className="text-sm opacity-80">Payroll · ASP Bed and Breakfast, Inc</p>
        </div>
        <div className="flex items-center gap-4 shrink-0 mt-1">
          {/* Persistent launcher link — prominent in the bar, never in a menu.
              Hidden on the PIN lock screen, shown everywhere past the gate. */}
          {(!supabase || !!session) && (
            <a
              href="https://tanawin-hub.tanawinbnb.workers.dev/"
              className="text-sm font-medium bg-[#FBF6EF]/15 rounded-lg px-3 py-1.5 active:opacity-70"
            >
              ⌂ Hub
            </a>
          )}
          {supabase && session && (
            <button
              className="text-sm underline opacity-80 active:opacity-60"
              onClick={() => supabase?.auth.signOut()}
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-5 space-y-5">
        {/* auth gate */}
        {supabase && session === undefined && (
          <p className="text-center text-[#6E4B38] mt-10">Loading…</p>
        )}
        {supabase && session === null && <LoginCard />}

        {signedIn && session !== undefined && !result && view === 'compute' && (
          <CutoffForm
            onBack={() => setView('landing')}
            onSaved={() => listRuns().then(setRuns).catch(() => {})}
          />
        )}
        {signedIn && session !== undefined && !result && view === 'masters' && (
          <MastersEditor onBack={() => setView('landing')} />
        )}

        {signedIn && session !== undefined && result && (
          <ResultView
            meta={result.meta}
            payslips={result.payslips}
            warnings={result.warnings}
            savedNote={result.savedNote}
            runId={result.runId}
            onDeleted={() => {
              setResult(null);
              listRuns().then(setRuns).catch(() => {});
            }}
            onBack={() => {
              setResult(null);
              setPageError(null);
            }}
          />
        )}

        {signedIn && session !== undefined && !result && view === 'landing' && (
          <>
            {/* calc actions (parallel-run beta) */}
            {supabase && (
              <div className="flex flex-wrap gap-3">
                <button
                  className="px-4 py-2.5 rounded-lg bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80"
                  onClick={() => setView('compute')}
                >
                  🧮 Compute payroll <span className="text-xs opacity-80">beta</span>
                </button>
                <button
                  className="px-4 py-2.5 rounded-lg border border-[#CC7459] text-[#9A3518] font-medium active:opacity-80"
                  onClick={() => setView('masters')}
                >
                  ⚙️ Employees &amp; loans
                </button>
              </div>
            )}
            {/* upload */}
            <section
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                dragOver ? 'border-[#9A3518] bg-[#F5EDE4]' : 'border-[#CC7459] bg-white'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
            >
              <p className="text-lg font-medium">Upload the payroll workbook</p>
              <p className="text-sm text-[#6E4B38] mt-2">
                In Google Sheets: <span className="font-medium">File → Download → Microsoft Excel (.xlsx)</span>
                <br />
                then drop the file here or
              </p>
              <button
                className="mt-4 px-5 py-2.5 rounded-lg bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80"
                onClick={() => fileInput.current?.click()}
              >
                Choose file
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
              <p className="text-xs text-[#6E4B38] mt-5">
                Each upload is saved to the archive below, together with the workbook file itself —
                stored privately, behind this login. Re-uploading the same cutoff replaces it.
              </p>
            </section>

            {pageError && (
              <div className="border rounded-lg px-4 py-3 text-sm bg-rose-50 border-rose-300 text-rose-900">
                🚨 {pageError}
              </div>
            )}

            {/* archive */}
            <section className="bg-white rounded-xl border border-[#E6D8C9] p-4">
              <h2 className="font-semibold text-lg mb-2">📁 Archive — past uploads</h2>
              {!supabase && (
                <p className="text-sm text-[#6E4B38]">
                  Archive storage is not connected yet (Supabase project pending). Uploads still
                  work; they just aren&apos;t recorded.
                </p>
              )}
              {supabase && runsError && (
                <div className="border rounded-lg px-3 py-2 text-sm bg-rose-50 border-rose-300 text-rose-900">
                  🚨 {runsError}
                </div>
              )}
              {supabase && !runsError && runs.length === 0 && (
                <p className="text-sm text-[#6E4B38]">No uploads recorded yet.</p>
              )}
              {supabase && runs.length > 0 && (
                <div className="space-y-4">
                  {groupByMonth(runs).map((g) => (
                    <div key={g.key}>
                      <h3 className="font-semibold text-[#9A3518] border-b border-[#E6D8C9] pb-1 mb-1">
                        <span className="text-[#CC7459] text-xs mr-1.5">✸</span>
                        {g.label}
                      </h3>
                      <ul className="divide-y divide-[#E6D8C9]">
                        {g.runs.map((r) => (
                          <li key={r.id}>
                            <button
                              className="w-full text-left py-3 px-1 active:bg-[#F5EDE4] rounded-lg disabled:opacity-50"
                              onClick={() => openArchivedRun(r.id)}
                              disabled={!!openingRun}
                            >
                              <span className="font-medium">
                                {openingRun === r.id ? 'Opening… ' : ''}
                                disbursement {isoToDisplay(r.disbursement_date)}{' '}
                                <span className="text-xs font-semibold rounded-full px-2 py-0.5 border border-[#E6D8C9] bg-[#F5EDE4] text-[#6E4B38]">
                                  {r.source === 'computed' ? '🧮 computed' : '📄 sheet'}
                                </span>
                              </span>
                              <span className="text-sm text-[#6E4B38] block">
                                pay period {isoToDisplay(r.period_start)} → {isoToDisplay(r.period_end)} ·{' '}
                                {r.employee_count} payslips · uploaded{' '}
                                {fmtJsDate(new Date(r.created_at))}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
