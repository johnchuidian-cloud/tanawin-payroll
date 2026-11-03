'use client';

import { useState } from 'react';
import { BUILD_ID } from '@/lib/build-id';
import { addFeedback, currentAuthorName } from '@/lib/feedback';
import { INPUT } from './ui';

// One-tap reporting on a flagged discrepancy: the exact warning text travels
// with Maya's explanation, so nobody re-types or screenshots the red card.
// These explained flags are the raw material for future "clear it" toggles.
export default function ReportFlag({ flagText }: { flagText: string }) {
  const [open, setOpen] = useState(false);
  const [explain, setExplain] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (state === 'sending') return;
    setState('sending');
    setError(null);
    try {
      const author = await currentAuthorName();
      const body = explain.trim()
        ? `⚑ ${flagText}\n\nLexi's note: ${explain.trim()}`
        : `⚑ ${flagText}\n\n(no explanation yet — flagged as-is)`;
      await addFeedback(author, 'discrepancy', body, { flag: flagText, buildId: BUILD_ID });
      setState('sent');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (state === 'sent') {
    return <p className="mt-1.5 text-xs">✅ Reported — it's on the 💬 Reports list and John &amp; Claude will look at it.</p>;
  }
  if (!open) {
    return (
      <button className="mt-1.5 block text-xs underline active:opacity-70" onClick={() => setOpen(true)}>
        💬 Report this to John &amp; Claude…
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <textarea
        className={`${INPUT} min-h-[56px] text-sm`}
        placeholder='What do you know about this one? e.g. "the 600 is a uniform share" — sending with no explanation is fine too.'
        value={explain}
        onChange={(e) => setExplain(e.target.value)}
        autoFocus
      />
      <div className="flex items-center gap-3 text-xs">
        <button
          className="px-3 py-1.5 rounded-lg bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80 disabled:opacity-50"
          onClick={send}
          disabled={state === 'sending'}
        >
          {state === 'sending' ? 'Sending…' : 'Send report'}
        </button>
        <button className="underline active:opacity-70" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="text-xs">🚨 {error}</p>}
    </div>
  );
}
