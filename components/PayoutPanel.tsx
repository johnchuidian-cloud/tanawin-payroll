'use client';

// Payout summary for a run: the Paywise list (with copyable amounts and the
// ready-to-upload .xls) and Ani's manual GCash/BPI list.
import { useEffect, useState } from 'react';
import { money } from '@/lib/format';
import { loadMasters, type MasterEmployee } from '@/lib/masters';
import { buildPaywiseXls, manualRows, paywiseRows, type PaywiseRow } from '@/lib/paywise';
import { supabase } from '@/lib/supabase';
import type { Payslip, SheetDate } from '@/lib/types';

export default function PayoutPanel({
  payslips,
  disbursement,
}: {
  payslips: Payslip[];
  disbursement: SheetDate | null;
}) {
  const [employees, setEmployees] = useState<MasterEmployee[] | null>(null);
  const [settings, setSettings] = useState<{ sourceAccount: string; time: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setUnavailable(true);
      return;
    }
    loadMasters()
      .then(async (m) => {
        setEmployees(m.employees);
        const { data } = await supabase!
          .from('app_settings')
          .select('key, value')
          .in('key', ['paywise_source_account', 'paywise_time']);
        const kv = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
        setSettings({
          sourceAccount: kv.paywise_source_account ?? '',
          time: kv.paywise_time ?? '06:00 AM',
        });
      })
      .catch(() => setUnavailable(true));
  }, []);

  if (unavailable || !employees) return null;

  const pw = paywiseRows(payslips, employees);
  const manual = manualRows(payslips, employees);
  if (!pw.rows.length && !manual.length) return null;

  async function copyAmounts(rows: PaywiseRow[], withNames: boolean) {
    const text = rows
      .map((r) => (withNames ? `${r.name}\t${r.account}\t${r.amount.toFixed(2)}` : r.amount.toFixed(2)))
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNote('✅ Copied — paste into your file.');
    } catch {
      setNote('🚨 Could not copy — select and copy manually.');
    }
  }

  function downloadXls() {
    if (!disbursement || !settings) return;
    if (!settings.sourceAccount) {
      setNote('🚨 Paywise source account is not set (app_settings) — file not generated.');
      return;
    }
    const { blob, filename } = buildPaywiseXls(pw.rows, disbursement, settings);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setNote(`✅ ${filename} downloaded — upload it to Paywise as-is.`);
  }

  const total = (rows: PaywiseRow[]) => rows.reduce((a, r) => a + r.amount, 0);

  return (
    <section className="bg-white rounded-xl border border-[#E6D8C9] p-4 space-y-4">
      <h2 className="font-semibold text-lg">💸 Payout summary</h2>
      {note && <div className="text-sm text-[#6E4B38]">{note}</div>}
      {pw.missingAccount.length > 0 && (
        <div className="border rounded-lg px-3 py-2 text-sm bg-amber-50 border-amber-300 text-amber-900">
          ⚠️ No PNB account on file for: {pw.missingAccount.join(', ')} — not in the Paywise
          file. Add their account on the Employees screen or pay them manually.
        </div>
      )}

      {pw.rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-medium">
              🏦 PNB Paywise — {pw.rows.length} employees · total {money(total(pw.rows))}
            </p>
            {disbursement && (
              <button
                className="text-sm px-3 py-1.5 rounded-lg bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80"
                onClick={downloadXls}
              >
                ⬇ Paywise upload file (.xls)
              </button>
            )}
            <button
              className="text-sm px-3 py-1.5 rounded-lg border border-[#CC7459] text-[#9A3518] active:opacity-70"
              onClick={() => copyAmounts(pw.rows, false)}
            >
              Copy amounts only
            </button>
          </div>
          <ul className="text-sm divide-y divide-[#E6D8C9]">
            {pw.rows.map((r) => (
              <li key={r.account} className="py-1.5 flex justify-between gap-3">
                <span>
                  {r.name} <span className="text-[#6E4B38]">· {r.account}</span>
                </span>
                <span className="font-medium">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {manual.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">
            📱 Manual — GCash/BPI via Ani — {manual.length}{' '}
            {manual.length === 1 ? 'person' : 'people'} · total {money(total(manual))}
          </p>
          <ul className="text-sm divide-y divide-[#E6D8C9]">
            {manual.map((r) => (
              <li key={r.name} className="py-1.5 flex justify-between gap-3">
                <span>{r.name}</span>
                <span className="font-medium">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
