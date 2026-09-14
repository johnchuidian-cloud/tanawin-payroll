'use client';

import { useState } from 'react';
import Wordmark from '@/components/Wordmark';
import { supabase } from '@/lib/supabase';

// PIN login, consistent with the other Tanawin apps: pick your name, enter
// YOUR 6-digit PIN. Under the hood each name is a Supabase Auth user
// ("Name:email,Name:email" in NEXT_PUBLIC_LOGIN_USERS); the PIN is that
// user's password (6 digits — Supabase's minimum length).
const LOGIN_USERS: { name: string; email: string }[] = (
  process.env.NEXT_PUBLIC_LOGIN_USERS ??
  (process.env.NEXT_PUBLIC_LOGIN_EMAIL ? `Lexi:${process.env.NEXT_PUBLIC_LOGIN_EMAIL}` : '')
)
  .split(',')
  .map((pair) => {
    const [name, email] = pair.split(':').map((s) => s.trim());
    return { name, email };
  })
  .filter((u) => u.name && u.email);

export default function LoginCard() {
  const [pin, setPin] = useState('');
  const [who, setWho] = useState(LOGIN_USERS.length === 1 ? LOGIN_USERS[0].email : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || busy) return;
    if (!who) {
      setError('Tap your name first.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: who,
      password: pin,
    });
    if (error) {
      setError(
        error.message === 'Invalid login credentials' ? 'Wrong PIN.' : error.message
      );
      setPin('');
    }
    setBusy(false);
  }

  return (
    <div className="max-w-sm mx-auto mt-10">
      {/* Brand block, mirroring Kitchen's login: the reversed JPG logo works
          here on the neutral page background (never on the maroon bar). */}
      <div className="text-center mb-7">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/tanawin-icon.jpg"
          alt="Tanawin"
          className="w-[76px] h-[76px] rounded-[18px] mx-auto mb-3 shadow-md"
        />
        <Wordmark
          className="justify-center text-[30px] text-[#9A3518]"
          flowerClassName="text-[#CC7459]"
        />
        <p className="text-[13px] text-[#6E4B38] font-semibold mt-1">
          Payroll · Tanawin B&amp;B
        </p>
      </div>
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-[#E6D8C9] p-6 space-y-4"
      >
      <div>
        <p className="text-lg font-semibold">Enter your PIN</p>
        <p className="text-sm text-[#6E4B38]">Payroll is confidential.</p>
      </div>
      {LOGIN_USERS.length > 1 && (
        <div className="flex gap-2">
          {LOGIN_USERS.map((u) => (
            <button
              key={u.email}
              type="button"
              className={`flex-1 px-4 py-2.5 rounded-lg border font-medium ${
                who === u.email
                  ? 'bg-[#9A3518] text-[#FBF6EF] border-[#9A3518]'
                  : 'bg-white text-[#9A3518] border-[#CC7459]'
              }`}
              onClick={() => {
                setWho(u.email);
                setError(null);
              }}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="current-password"
        required
        minLength={6}
        maxLength={12}
        placeholder="••••••"
        className="w-full rounded-lg border border-[#CC7459] px-3 py-3 bg-white text-center text-2xl tracking-[0.5em]"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        autoFocus
      />
      {error && (
        <div className="border rounded-lg px-3 py-2 text-sm bg-rose-50 border-rose-300 text-rose-900">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || pin.length < 6}
        className="w-full px-5 py-2.5 rounded-lg bg-[#9A3518] text-[#FBF6EF] font-medium active:opacity-80 disabled:opacity-50"
      >
        {busy ? 'Checking…' : 'Unlock'}
      </button>
      </form>
    </div>
  );
}
