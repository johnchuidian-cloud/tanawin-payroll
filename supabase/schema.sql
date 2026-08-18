-- Tanawin Payroll — run this once in the NEW tanawin-payroll Supabase project
-- (SQL Editor → paste → Run). Never in Finance's project: salary data gets its
-- own project, own keys, own blast radius.

-- one row per uploaded workbook
create table payroll_runs (
  id                uuid primary key default gen_random_uuid(),
  period_start      date not null,
  period_end        date not null,
  disbursement_date date not null,
  total_days        numeric,
  employee_count    int  not null,
  source_filename   text,
  created_at        timestamptz not null default now()
);

-- employee master, synced from the `log` tab on each upload
create table employees (
  id           uuid primary key default gen_random_uuid(),
  family_name  text not null unique,   -- the match key, lowercased
  given_name   text,
  employee_no  text,                   -- display only; NOT a join key
  team         text,
  email        text not null,
  date_hired   date,
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- one row per employee per run — the payslip itself
create table payslips (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references payroll_runs(id) on delete cascade,
  employee_id      uuid not null references employees(id),
  -- header
  family_name      text not null,      -- snapshot; names change, records must not
  given_name       text,
  department       text,
  days_in_period   numeric,
  daily_rate       numeric,
  basic_monthly    numeric,
  allowance_monthly numeric,
  total_monthly_comp numeric,
  benefits         text,
  -- earnings
  e_basic          numeric,
  e_allowance      numeric,
  e_overtime       numeric,
  e_meal           numeric,
  e_holiday        numeric,
  e_adjustments    numeric,
  e_tips           numeric,
  total_earnings   numeric,
  -- deductions
  d_unpaid_leaves  numeric,
  d_sss            numeric,
  d_philhealth     numeric,
  d_hdmf           numeric,
  d_sss_loan       numeric,
  d_hdmf_loan      numeric,
  d_cash_advance   numeric,
  d_others         numeric,
  total_deductions numeric,
  net_pay          numeric,
  leaves_remaining numeric,
  -- v2 hooks (write nothing to these in v1)
  ack_token        text unique,
  sent_at          timestamptz,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  unique (run_id, employee_id)
);

-- audit trail
create table run_warnings (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references payroll_runs(id) on delete cascade,
  severity   text not null,   -- 'info' | 'warning' | 'error'
  message    text not null,
  created_at timestamptz not null default now()
);

-- Staff-only, single-user (Lexi). Default deny: RLS on, anon gets nothing.
-- The only access path is an authenticated Supabase Auth user (Lexi's login,
-- created by hand in Dashboard → Authentication → Add user).
alter table payroll_runs enable row level security;
alter table employees    enable row level security;
alter table payslips     enable row level security;
alter table run_warnings enable row level security;

create policy "authenticated full access" on payroll_runs
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on employees
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on payslips
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on run_warnings
  for all to authenticated using (true) with check (true);
