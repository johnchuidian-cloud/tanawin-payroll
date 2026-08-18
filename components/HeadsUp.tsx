'use client';

// The heads-up list: things that will matter on an upcoming payday, shown
// BEFORE they become red diffs or missed steps — probations ending, loans
// about to start deducting, leave at risk of year-end forfeit, birthdays.
// Renders nothing when there is nothing to say.
import { useEffect, useState } from 'react';
import { loadMasters } from '@/lib/masters';
import { SectionTitle } from './ui';
import { money } from '@/lib/format';

const DAY = 86400000;
const LOOKAHEAD_DAYS = 21;
const BIRTHDAY_DAYS = 14;

const ymd = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : iso;
};

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default function HeadsUp() {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { employees, loans } = await loadMasters();
        const out: string[] = [];
        const today = new Date();
        const todayIso = today.toISOString().slice(0, 10);
        const horizon = new Date(today.getTime() + LOOKAHEAD_DAYS * DAY).toISOString().slice(0, 10);
        const overdueFloor = new Date(today.getTime() - 30 * DAY).toISOString().slice(0, 10);

        for (const e of employees) {
          // Probation ending → regularization decision due.
          if (e.benefitsClass === 'probation' && !e.regularizedOn) {
            const due = e.probationEnd ?? (e.dateHired ? addMonthsIso(e.dateHired, 3) : null);
            if (due && due >= overdueFloor && due <= horizon) {
              out.push(
                due < todayIso
                  ? `⏰ ${e.family}'s probation ended ${ymd(due)} — regularization decision overdue (salary, contributions, leave allotment).`
                  : `⏰ ${e.family}'s probation ends ${ymd(due)} — decide the regular salary, contributions and leave allotment before the next payroll.`
              );
            }
          }
          // Leave at risk of year-end forfeit (Ani's rule: max 7 encashable,
          // at least 7 must be taken). Only worth saying from October.
          if (today.getMonth() + 1 >= 10 && e.leaveBalance != null && e.leaveBalance > 7) {
            out.push(
              `🌴 ${e.family} has ${e.leaveBalance} leave days — only 7 can be encashed at year-end; ${e.leaveBalance - 7} day(s) at risk of forfeit unless taken.`
            );
          }
          // Birthdays in the next two weeks.
          if (e.birthday) {
            const m = e.birthday.match(/^\d{4}-(\d{2})-(\d{2})/);
            if (m) {
              for (let i = 0; i <= BIRTHDAY_DAYS; i++) {
                const d = new Date(today.getTime() + i * DAY);
                if (d.getMonth() + 1 === Number(m[1]) && d.getDate() === Number(m[2])) {
                  out.push(`🎂 ${e.family}'s birthday — ${Number(m[1])}/${Number(m[2])}.`);
                  break;
                }
              }
            }
          }
        }

        // Loans that begin deducting soon.
        const byId = new Map(employees.map((e) => [e.id, e]));
        for (const l of loans) {
          if (!l.active || !l.startsOn) continue;
          if (l.startsOn >= todayIso && l.startsOn <= horizon) {
            const who = byId.get(l.employeeId)?.family ?? '(former staff)';
            const label = { sss: 'SSS loan', hdmf: 'HDMF loan', advance: 'Tanawin advance' }[l.kind];
            out.push(
              l.perCutoff < 0
                ? `💸 ${who}'s ${label} refund (${money(l.perCutoff)}) goes out on the ${ymd(l.startsOn)} payroll.`
                : `💸 ${who}'s ${label} (${money(l.perCutoff)}/cutoff) starts deducting on the ${ymd(l.startsOn)} payroll.`
            );
          }
        }

        setItems(out);
      } catch {
        // The heads-up box must never add error noise to the landing page.
        setItems([]);
      }
    })();
  }, []);

  if (!items.length) return null;
  return (
    <section className="bg-white rounded-2xl border border-[#E6D8C9] p-4 space-y-2">
      <SectionTitle>Heads up</SectionTitle>
      <ul className="text-sm space-y-1.5">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </section>
  );
}
