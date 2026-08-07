// Small shared UI primitives for the Tanawin look — people rows, chips,
// labeled fields, dates, and the sticky bottom action bar.
'use client';

import { useRef, useState, type ReactNode } from 'react';

export function Avatar({ name, muted = false }: { name: string; muted?: boolean }) {
  return (
    <span
      className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg shrink-0 ${
        muted ? 'bg-[#E6D8C9] text-[#6E4B38]' : 'bg-[#9A3518] text-[#FBF6EF]'
      }`}
    >
      {(name[0] ?? '?').toUpperCase()}
    </span>
  );
}

const CHIP_STYLES: Record<string, string> = {
  regular: 'bg-[#F5EDE4] text-[#9A3518] border-[#CC7459]',
  trainee: 'bg-amber-50 text-amber-900 border-amber-300',
  daily: 'bg-[#eef3ee] text-[#5F7A5F] border-[#5F7A5F]/40',
  paywise: 'bg-white text-[#3D2317] border-[#E6D8C9]',
  manual: 'bg-white text-[#3D2317] border-[#E6D8C9]',
  inactive: 'bg-neutral-100 text-neutral-500 border-neutral-300',
};

export function Chip({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <span
      className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border whitespace-nowrap ${
        CHIP_STYLES[kind] ?? CHIP_STYLES.paywise
      }`}
    >
      {children}
    </span>
  );
}

export const CHANNEL_LABEL = { paywise: '🏦 Paywise', manual: '📱 GCash/BPI' } as const;

export function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[13px] text-[#6E4B38] font-medium">{label}</span>
      {children}
    </label>
  );
}

export const INPUT =
  'mt-1 w-full rounded-xl border border-[#E6D8C9] px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#9A3518]/40 focus:border-[#CC7459]';

// Date entry as YYYY/MM/DD text (uniform year/month/day app-wide, matching the
// workbook file naming — Lexi, 2026-08-04). Typed text instead of the native
// date picker, which renders in the phone's locale and contradicted the app.
// Value in/out is ISO (YYYY-MM-DD) or '' while incomplete.
const isoToDisplay = (iso: string) =>
  iso ? `${iso.slice(0, 4)}/${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : '';

function displayToIso(text: string): string | null {
  if (text.trim() === '') return '';
  const m = text.trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function DateField({
  value,
  onChange,
}: {
  value: string; // ISO (YYYY-MM-DD) or ''
  onChange: (iso: string) => void;
}) {
  const [text, setText] = useState(isoToDisplay(value));
  const lastValue = useRef(value);
  // External change (quick-fill buttons): re-sync the visible text — but not
  // while the user's own typing is what produced the new value.
  if (value !== lastValue.current) {
    lastValue.current = value;
    if (displayToIso(text) !== value) setText(isoToDisplay(value));
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="YYYY/MM/DD"
      className={INPUT}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const iso = displayToIso(e.target.value);
        if (iso !== null) onChange(iso);
      }}
    />
  );
}

export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-5 px-5 py-3 bg-[#FBF6EF]/95 backdrop-blur border-t border-[#E6D8C9] flex flex-wrap gap-3 items-center">
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-semibold text-[#9A3518] flex items-center gap-1.5">
      <span className="text-[#CC7459] text-xs">✸</span>
      {children}
    </h3>
  );
}
