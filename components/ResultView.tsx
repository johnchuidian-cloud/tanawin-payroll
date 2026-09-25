'use client';

import { useEffect, useRef, useState } from 'react';
import PayoutPanel from './PayoutPanel';
import PayslipCard from './PayslipCard';
import { buildPayslipZip, buildSinglePayslip, type ExportFormat } from '@/lib/exportZip';
import { fmtDate, fmtDateCompact, fmtJsDate, payslipFilename } from '@/lib/format';
import {
  deleteRun,
  downloadRunFile,
  listRunFiles,
  updateRunNote,
  uploadRunFile,
  type RunFile,
} from '@/lib/persist';
import type { Payslip, RunWarning, SheetDate } from '@/lib/types';
import { SectionTitle } from './ui';

export interface ResultMeta {
  periodStart: SheetDate | null;
  periodEnd: SheetDate | null;
  disbursementDate: SheetDate | null;
  sourceFilename: string;
  uploadedAt?: string; // set when viewing an archived run
}

const SEVERITY_STYLE: Record<RunWarning['severity'], string> = {
  error: 'bg-rose-50 border-rose-300 text-rose-900',
  warning: 'bg-amber-50 border-amber-300 text-amber-900',
  info: 'bg-neutral-100 border-neutral-300 text-neutral-700',
};

const SEVERITY_ICON: Record<RunWarning['severity'], string> = {
  error: '🚨',
  warning: '⚠️',
  info: 'ℹ️',
};

const slipKey = (s: Payslip) => `${s.family}|${s.given}`;

export default function ResultView({
  meta,
  payslips,
  warnings,
  savedNote,
  runNote = null,
  onBack,
  backLabel = '← Back to archive',
  extraAction,
  belowActions,
  runId = null,
  onDeleted,
}: {
  meta: ResultMeta;
  payslips: Payslip[];
  warnings: RunWarning[];
  savedNote: string | null;
  runNote?: string | null;
  onBack: () => void;
  backLabel?: string;
  extraAction?: React.ReactNode;
  belowActions?: React.ReactNode;
  runId?: string | null;
  onDeleted?: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [zipProgress, setZipProgress] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [files, setFiles] = useState<RunFile[]>([]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  // The run note is editable in place once the run is archived — late
  // context ("turns out the 600 was uniform share") belongs on the record.
  const [note, setNote] = useState<string | null>(runNote);
  const [noteDraft, setNoteDraft] = useState<string | null>(null); // non-null = editing
  const [noteError, setNoteError] = useState<string | null>(null);
  const [singleBusy, setSingleBusy] = useState<string | null>(null); // slipKey being exported
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  // One payslip, one file — no zip, nothing generated for anyone else,
  // nothing attached to storage. The everyday path for re-issues.
  async function handleDownloadOne(slip: Payslip) {
    if (singleBusy) return;
    setExportError(null);
    setSingleBusy(slipKey(slip));
    try {
      const { blob, filename } = await buildSinglePayslip({
        format,
        slip,
        periodStart: meta.periodStart,
        periodEnd: meta.periodEnd,
        disbursement: meta.disbursementDate,
        node: cardRefs.current.get(slipKey(slip)) ?? null,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setSingleBusy(null);
    }
  }

  async function saveNote() {
    if (noteDraft == null || !runId) return;
    setNoteError(null);
    try {
      await updateRunNote(runId, noteDraft);
      setNote(noteDraft.trim() || null);
      setNoteDraft(null);
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!runId) return;
    listRunFiles(runId).then(setFiles).catch(() => {});
  }, [runId]);

  // Opening a different run reuses this mounted component — resync the note.
  useEffect(() => {
    setNote(runNote);
    setNoteDraft(null);
    setNoteError(null);
  }, [runNote, runId]);

  async function openFile(f: RunFile) {
    try {
      const blob = await downloadRunFile(f.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFileNote(`🚨 ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleDelete() {
    if (!runId || !onDeleted) return;
    if (
      !window.confirm(
        'Delete this run from the archive? Its payslips and attached files are removed permanently. Only do this for mistaken uploads or tests.'
      )
    )
      return;
    try {
      await deleteRun(runId);
      onDeleted();
    } catch (e) {
      setFileNote(`🚨 ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleDownload() {
    if (zipProgress) return;
    setExportError(null);
    try {
      setZipProgress('Preparing…');
      const { blob, filename } = await buildPayslipZip({
        format,
        payslips,
        periodStart: meta.periodStart,
        periodEnd: meta.periodEnd,
        disbursement: meta.disbursementDate,
        getNode: (slip) => cardRefs.current.get(slipKey(slip)) ?? null,
        onProgress: (done, total) =>
          setZipProgress(`Generating ${format.toUpperCase()} ${done} of ${total}…`),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      // Keep ONE copy of exactly what was sent, attached to the run — the
      // first full download. Repeat downloads don't re-upload the whole zip
      // (storage bloat for no new information).
      if (runId) {
        const archived = `payslips-${format}-${fmtDateCompact(meta.disbursementDate)}.zip`;
        if (files.some((f) => f.name === archived)) {
          setFileNote(`📎 ${archived} is already on this run's files — not re-uploaded.`);
        } else {
          const up = await uploadRunFile(runId, archived, blob);
          if (up.ok) {
            setFileNote(`📎 ${archived} attached to this run's files.`);
            listRunFiles(runId).then(setFiles).catch(() => {});
          }
        }
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setZipProgress(null);
    }
  }

  return (
    <div className="space-y-5">
      <button
        className="text-[#9A3518] font-medium active:opacity-70"
        onClick={onBack}
      >
        {backLabel}
      </button>

      {/* run summary */}
      <section className="bg-white rounded-xl border border-[#E6D8C9] p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-lg font-semibold">
            ✅ {payslips.length} payslip{payslips.length === 1 ? '' : 's'}{' '}
            {meta.uploadedAt ? 'archived' : 'ready'}
          </span>
          <span className="text-sm text-[#6E4B38]">
            pay period {fmtDate(meta.periodStart)} → {fmtDate(meta.periodEnd)} · disbursement{' '}
            {fmtDate(meta.disbursementDate)}
            {meta.sourceFilename ? ` · ${meta.sourceFilename}` : ''}
            {meta.uploadedAt
              ? ` · uploaded ${fmtJsDate(new Date(meta.uploadedAt))}`
              : ''}
          </span>
        </div>

        {savedNote && <div className="text-sm text-[#6E4B38]">{savedNote}</div>}

        {/* run-level note */}
        {noteDraft != null ? (
          <div className="space-y-2">
            <textarea
              className="w-full border border-[#CC7459] rounded-lg px-3 py-2 text-sm min-h-[64px]"
              value={noteDraft}
              onChange={(ev) => setNoteDraft(ev.target.value)}
              placeholder='Anything about this payroll — e.g. "Aug 21 special holiday applied to everyone".'
              autoFocus
            />
            <div className="flex gap-3 text-sm">
              <button className="px-4 py-1.5 rounded-lg bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80" onClick={saveNote}>
                Save note
              </button>
              <button className="text-[#6E4B38] underline active:opacity-70" onClick={() => { setNoteDraft(null); setNoteError(null); }}>
                Cancel
              </button>
            </div>
            {noteError && (
              <div className="border rounded-lg px-3 py-2 text-sm bg-rose-50 border-rose-300 text-rose-900">🚨 {noteError}</div>
            )}
          </div>
        ) : note ? (
          <div className="border rounded-lg px-3 py-2 text-sm bg-[#FBF6EF] border-[#E6D8C9] text-[#4A3526]">
            📝 {note}
            {runId && (
              <button className="ml-2 text-[#9A3518] underline active:opacity-70" onClick={() => setNoteDraft(note)}>
                Edit
              </button>
            )}
          </div>
        ) : runId ? (
          <button className="text-sm text-[#9A3518] underline active:opacity-70 text-left" onClick={() => setNoteDraft('')}>
            📝 Add a note to this payroll…
          </button>
        ) : null}

        {warnings.map((w, i) => (
          <div key={i} className={`border rounded-lg px-3 py-2 text-sm ${SEVERITY_STYLE[w.severity]}`}>
            {SEVERITY_ICON[w.severity]} {w.message}
          </div>
        ))}

        {belowActions}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-[#6E4B38]">Format:</span>
            {(['pdf', 'png'] as const).map((f) => (
              <label key={f} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  className="accent-[#9A3518]"
                  checked={format === f}
                  onChange={() => setFormat(f)}
                />
                <span className="uppercase">{f}</span>
              </label>
            ))}
          </div>
          <button
            className="px-5 py-2.5 rounded-lg bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80 disabled:opacity-50"
            onClick={handleDownload}
            disabled={!!zipProgress || payslips.length === 0}
          >
            {zipProgress ??
              `Download ${payslips.length} ${format.toUpperCase()}s + email list (.zip)`}
          </button>
          {extraAction}
        </div>
        {exportError && (
          <div className="border rounded-lg px-3 py-2 text-sm bg-rose-50 border-rose-300 text-rose-900">
            🚨 {exportError}
          </div>
        )}
      </section>

      <PayoutPanel payslips={payslips} disbursement={meta.disbursementDate} />

      {/* attached files: the uploaded workbook, generated register, sent payslip zips */}
      {runId && (files.length > 0 || fileNote) && (
        <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-2">
          <SectionTitle>Files on record</SectionTitle>
          {fileNote && <p className="text-sm text-[#6E4B38]">{fileNote}</p>}
          <ul className="divide-y divide-[#E6D8C9] text-sm">
            {files.map((f) => (
              <li key={f.path} className="py-2 flex items-center gap-3">
                <span className="truncate">📄 {f.name}</span>
                <button
                  className="ml-auto text-[#9A3518] underline active:opacity-70 shrink-0"
                  onClick={() => openFile(f)}
                >
                  Download
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {runId && onDeleted && meta.uploadedAt && (
        <button className="text-sm underline text-[#6E4B38] active:opacity-70" onClick={handleDelete}>
          Delete this run from the archive…
        </button>
      )}

      {/* payslip previews (also the capture source for PNG export) */}
      <section className="space-y-6">
        {payslips.map((slip) => (
          <div key={slipKey(slip)}>
            <p className="text-sm text-[#6E4B38] mb-1 px-1">
              <span className="font-medium">
                {payslipFilename(slip.family, slip.given, meta.disbursementDate).replace(
                  /\.pdf$/,
                  `.${format}`
                )}
              </span>{' '}
              → {slip.email}
              <button
                className="ml-3 text-[#9A3518] underline active:opacity-70 disabled:opacity-50"
                onClick={() => handleDownloadOne(slip)}
                disabled={!!singleBusy || !!zipProgress}
              >
                {singleBusy === slipKey(slip) ? 'Preparing…' : `⬇ ${format.toUpperCase()}`}
              </button>
            </p>
            {/* internal context: labeled amounts + note. Never on the payslip itself. */}
            {(slip.adjustItems?.length || slip.deductItems?.length || slip.note) && (
              <p className="text-[13px] text-[#4A3526] mb-1 px-1">
                {(slip.adjustItems ?? []).map((it, i) => (
                  <span key={`a${i}`} className="mr-3">
                    ➕ {it.label || 'addition'} ₱{it.amount.toFixed(2)}
                  </span>
                ))}
                {(slip.deductItems ?? []).map((it, i) => (
                  <span key={`d${i}`} className="mr-3">
                    ➖ {it.label || 'deduction'} ₱{it.amount.toFixed(2)}
                  </span>
                ))}
                {slip.note && <span>📝 {slip.note}</span>}
              </p>
            )}
            <div className="overflow-x-auto">
              <div
                className="w-fit"
                ref={(el) => {
                  if (el) cardRefs.current.set(slipKey(slip), el);
                  else cardRefs.current.delete(slipKey(slip));
                }}
              >
                <PayslipCard slip={slip} periodStart={meta.periodStart} periodEnd={meta.periodEnd} />
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
