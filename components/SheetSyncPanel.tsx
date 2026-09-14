'use client';

// Shown under a fresh sheet upload: everything the app can learn from the
// sheet, one tap each. Kills the card-by-card retyping that made the
// parallel run tedious (Lexi, 2026-09-09).
//  - "Copy inputs to Compute": fills the shared compute draft from the
//    sheet's own columns (days, OT, holidays, deductions, tips pool, dates).
//  - Masters drift list: where the app's records disagree with the sheet
//    (loan amounts, pay, contributions), applied through the normal masters
//    functions so every change lands in the edit history.
import { useEffect, useState } from 'react';
import type { ParsedWorkbook } from '@/lib/types';
import { addLoan, loadMasters, saveEmployeeComp, setLoanActive, type MasterEmployee } from '@/lib/masters';
import type { Loan } from '@/lib/engine';
import { buildDraftFromSheet, diffMastersAgainstSheet, type DriftItem, type MastersDrift } from '@/lib/sheetImport';
import { writeDraft } from '@/lib/computeDraft';
import { SectionTitle } from './ui';

const ymd = (s: string) => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : s;
};

export default function SheetSyncPanel({ wb }: { wb: ParsedWorkbook }) {
  const [masters, setMasters] = useState<{ employees: MasterEmployee[]; loans: Loan[] } | null>(null);
  const [drift, setDrift] = useState<MastersDrift | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [copiedNote, setCopiedNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // item id or 'all'
  const [applied, setApplied] = useState<Set<string>>(new Set());

  async function refresh() {
    try {
      const m = await loadMasters();
      setMasters(m);
      setDrift(diffMastersAgainstSheet(wb, m.employees, m.loans));
      setPanelError(null);
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function copyInputs() {
    if (!masters) return;
    const r = buildDraftFromSheet(wb, masters.employees);
    writeDraft(r.draft);
    setCopiedNote(
      `✅ Copied for ${r.matched} people — open Compute and everything is already filled in.` +
        (r.unmatched.length ? ` Not in the app (skipped): ${r.unmatched.join(', ')}.` : '')
    );
  }

  const itemId = (it: DriftItem) => `${it.employeeId}|${it.label}`;

  async function applyItem(it: DriftItem) {
    if (it.kind === 'field' && it.fieldPatch) {
      await saveEmployeeComp(it.employeeId, it.fieldPatch);
    } else if (it.kind === 'loan' && it.loanKind) {
      for (const id of it.loanOldIds ?? []) {
        await setLoanActive(id, false, { employeeId: it.employeeId, kind: it.loanKind, perCutoff: 0 });
      }
      if (it.loanNew && Math.abs(it.loanNew) > 0.005) {
        await addLoan({
          employeeId: it.employeeId,
          kind: it.loanKind,
          perCutoff: it.loanNew,
          note: `matched to sheet ${ymd(`${wb.disbursementDate!.y}-${String(wb.disbursementDate!.m).padStart(2, '0')}-${String(wb.disbursementDate!.d).padStart(2, '0')}`)}`,
          active: true,
          startsOn: null,
        });
      }
    }
    setApplied((p) => new Set(p).add(itemId(it)));
  }

  async function handleApply(it: DriftItem) {
    setBusy(itemId(it));
    try {
      await applyItem(it);
      await refresh();
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleApplyAll() {
    if (!drift) return;
    setBusy('all');
    try {
      for (const it of drift.items) await applyItem(it);
      await refresh();
    } catch (e) {
      setPanelError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (panelError) {
    return (
      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4">
        <SectionTitle>Match the app to this sheet</SectionTitle>
        <p className="mt-2 text-sm text-rose-900">🚨 {panelError}</p>
      </section>
    );
  }
  if (!drift) return null;

  return (
    <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
      <SectionTitle>Match the app to this sheet</SectionTitle>

      <div className="space-y-2">
        <button
          className="px-4 py-2.5 rounded-xl bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80"
          onClick={copyInputs}
        >
          📥 Copy this sheet's inputs to Compute
        </button>
        <p className="text-xs text-[#6E4B38]">
          Days, overtime, holidays, deductions and the tips pool — no more typing them card by card.
        </p>
        {copiedNote && <p className="text-sm text-[#6E4B38]">{copiedNote}</p>}
      </div>

      {drift.items.length > 0 && (
        <div className="border-t border-[#E6D8C9] pt-3 space-y-2">
          <p className="text-sm font-medium">
            The sheet and the app disagree on {drift.items.length} thing{drift.items.length > 1 ? 's' : ''}:
          </p>
          <ul className="divide-y divide-[#E6D8C9] text-sm">
            {drift.items.map((it) => (
              <li key={itemId(it)} className="py-2 flex items-center gap-3">
                <span className="min-w-0">
                  <span className="font-medium">{it.family}</span>
                  <span className="block text-[#6E4B38] break-words">{it.label}</span>
                </span>
                <button
                  className="ml-auto shrink-0 text-sm underline text-[#9A3518] active:opacity-70 disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() => handleApply(it)}
                >
                  {busy === itemId(it) ? 'Updating…' : 'Update app'}
                </button>
              </li>
            ))}
          </ul>
          {drift.items.length > 1 && (
            <button
              className="px-4 py-2 rounded-xl border border-[#CC7459] text-[#9A3518] font-medium active:opacity-80 disabled:opacity-40"
              disabled={busy !== null}
              onClick={handleApplyAll}
            >
              {busy === 'all' ? 'Updating…' : `Update all ${drift.items.length}`}
            </button>
          )}
          <p className="text-xs text-[#6E4B38]">Every update is recorded in the person's edit history and can be undone there.</p>
        </div>
      )}
      {drift.items.length === 0 && (
        <p className="text-sm text-[#6E4B38] border-t border-[#E6D8C9] pt-3">✅ The app's records already match this sheet.</p>
      )}

      {(drift.sheetOnly.length > 0 || drift.appOnly.length > 0) && (
        <div className="text-xs text-[#6E4B38] space-y-1 border-t border-[#E6D8C9] pt-3">
          {drift.sheetOnly.length > 0 && <p>In the sheet but not in the app: {drift.sheetOnly.join(', ')} — add them under Employees &amp; loans if they should be.</p>}
          {drift.appOnly.length > 0 && <p>In the app but not paid in this sheet: {drift.appOnly.join(', ')}.</p>}
        </div>
      )}
    </section>
  );
}
