'use client';

// Suite-wide "Update available" banner (contract set by the Hub, 2026-08-18):
// identical wording in every app; NEVER auto-reloads (a payroll run may be
// half-typed); fails silent — a failed check is "no update", never an error.
//
// Payroll has a build step, so this uses the preferred mechanism: the build
// id is stamped into /version.json at build time AND bundled in here via
// import — comparing the two says exactly "is the page older than the site".
// (The Hub's document-hash variant exists because it has no build step.)
//
// ⚠️ Platform (Hub, learned the hard way): Cloudflare Workers static assets
// serve NO ETag/Last-Modified, and the edge cache returns stale copies to
// repeated identical requests — so ETag checks never fire and every poll
// needs a UNIQUE cache-busting param.
import { useEffect, useState } from 'react';
import { BUILD_ID } from '@/lib/build-id';

const POLL_MS = 5 * 60 * 1000;

export default function UpdateBanner() {
  const [available, setAvailable] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const bust = Date.now().toString(36) + Math.random().toString(36).slice(2);
        const res = await fetch(`/version.json?x=${bust}`, { cache: 'no-store' });
        if (!res.ok || !alive) return;
        const v = (await res.json()) as { build?: string };
        if (v.build && v.build !== BUILD_ID) setAvailable(v.build);
      } catch {
        // offline, 500, blocked — stay quiet
      }
    }
    check();
    const t = setInterval(() => {
      if (!document.hidden) check();
    }, POLL_MS);
    const onVis = () => {
      if (!document.hidden) check(); // the "phone woke up" case
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!available || available === dismissed) return null;
  return (
    <div
      role="status"
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-3 bg-[#FBF6EF] text-[#1F1B16] px-4 py-2.5 text-sm shadow-md"
    >
      <span>Update available</span>
      <button
        className="rounded-lg bg-[#9A3518] text-[#FBF6EF] font-semibold px-3.5 py-1.5 active:opacity-80"
        onClick={() => location.reload()}
      >
        Refresh
      </button>
      <button
        aria-label="Dismiss"
        className="text-[#6E6759] text-lg px-2 py-1 active:opacity-70"
        onClick={() => setDismissed(available)}
      >
        ×
      </button>
    </div>
  );
}
