-- Migration 006 — dated employee notes + loan start dates + edit history
-- (SQL Editor → paste → Run). Structure only, no data. Safe to run twice.

-- Loans can be entered the day they're granted, before deductions begin:
-- the engine skips a loan until the disbursement date reaches starts_on.
alter table loans
  add column if not exists starts_on date;

-- Dated notes: append-style logbook per person ("8/10 — loan starts"),
-- chosen over one free-text blob so notes keep their context.
create table if not exists employee_notes (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  note        text not null,
  created_at  timestamptz not null default now()
);

alter table employee_notes enable row level security;
do $$
begin
  create policy "authenticated full access" on employee_notes
    for all to authenticated using (true) with check (true);
exception
  when duplicate_object then null;
end $$;

-- Edit history: who changed what, when — field edits store before/after
-- values so they can be undone (the undo is logged too).
create table if not exists change_log (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete cascade,
  action      text not null,
  actor       text,
  details     jsonb,
  created_at  timestamptz not null default now()
);

alter table change_log enable row level security;
do $$
begin
  create policy "authenticated full access" on change_log
    for all to authenticated using (true) with check (true);
exception
  when duplicate_object then null;
end $$;
