'use client';

import { useEffect, useState } from 'react';
import { BUILD_ID } from '@/lib/build-id';
import { addFeedback, listFeedback, type FeedbackItem, type FeedbackKind } from '@/lib/feedback';
import { fmtJsDate } from '@/lib/format';
import { INPUT, SectionTitle } from './ui';

const KINDS: { kind: FeedbackKind; label: string }[] = [
  { kind: 'bug', label: "🐞 Something's wrong" },
  { kind: 'idea', label: '💡 An idea' },
  { kind: 'question', label: '❓ A question' },
];

// 'discrepancy' is never picked by hand — it comes from the "Report this"
// link on a flagged warning card, carrying the warning text along.
const KIND_LABEL = (k: FeedbackKind) => KINDS.find((x) => x.kind === k)?.label ?? '⚑ Flagged discrepancy';

const STATUS_CHIP: Record<FeedbackItem['status'], { label: string; cls: string }> = {
  open: { label: 'waiting', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  'in-progress': { label: 'being worked on', cls: 'bg-sky-100 text-sky-900 border-sky-300' },
  done: { label: 'done ✓', cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  'wont-do': { label: 'answered', cls: 'bg-neutral-100 text-neutral-600 border-neutral-300' },
};

export default function FeedbackPanel({ authorName, onBack }: { authorName: string; onBack: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  function reload() {
    listFeedback()
      .then((list) => {
        setItems(list);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }
  useEffect(reload, []);

  async function handleSend() {
    if (!message.trim() || sending) return;
    setSending(true);
    setNote(null);
    try {
      await addFeedback(authorName, kind, message, { buildId: BUILD_ID });
      setMessage('');
      setNote('✅ Sent! It lands on this list right away and John & Claude pick it up from here — replies appear beside your report.');
      reload();
    } catch (e) {
      setNote(`🚨 ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <button className="text-[#9A3518] font-medium active:opacity-70" onClick={onBack}>
        ← Back
      </button>
      <h2 className="font-bold text-lg">💬 Reports &amp; ideas</h2>

      <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-3">
        <SectionTitle>Tell John &amp; Claude</SectionTitle>
        <div className="flex gap-2 flex-wrap">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              className={`text-sm px-3 py-2 rounded-xl border font-medium ${
                kind === k.kind ? 'bg-[#9A3518] text-[#FBF6EF] border-[#9A3518]' : 'border-[#CC7459] text-[#9A3518] active:bg-[#F5EDE4]'
              }`}
              onClick={() => setKind(k.kind)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <textarea
          className={`${INPUT} min-h-[90px]`}
          placeholder="What happened, or what would help? Write it like a chat message — screenshots can still go to John on WhatsApp."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="px-5 py-2.5 rounded-lg bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80 disabled:opacity-50"
            onClick={handleSend}
            disabled={sending || !message.trim()}
          >
            {sending ? 'Sending…' : 'Send report'}
          </button>
          <span className="text-xs text-[#6E4B38]">Sent as {authorName} · stays private behind this login.</span>
        </div>
        {note && <p className="text-sm text-[#4A3526]">{note}</p>}
      </section>

      <section className="space-y-2">
        <SectionTitle>Past reports</SectionTitle>
        {loadError && (
          <div className="border rounded-xl px-3 py-2 text-sm bg-rose-50 border-rose-300 text-rose-900">🚨 {loadError}</div>
        )}
        {items && items.length === 0 && !loadError && (
          <p className="text-sm text-[#6E4B38] px-1">Nothing yet — the first report starts the list.</p>
        )}
        {(items ?? []).map((f) => (
          <div key={f.id} className="bg-white rounded-2xl border border-[#E6D8C9] p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap text-xs text-[#6E4B38]">
              <span>{KIND_LABEL(f.kind)}</span>
              <span>· {f.author}</span>
              <span>· {fmtJsDate(new Date(f.createdAt))}</span>
              <span className={`ml-auto border rounded-full px-2 py-0.5 font-semibold ${STATUS_CHIP[f.status].cls}`}>
                {STATUS_CHIP[f.status].label}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{f.message}</p>
            {f.reply && (
              <p className="text-sm whitespace-pre-wrap bg-[#FBF6EF] border border-[#E6D8C9] rounded-lg px-3 py-2">
                ↩ <span className="font-medium">Reply:</span> {f.reply}
              </p>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
