-- Migration 005 — HR file fields on employees (SQL Editor → paste → Run).
alter table employees
  add column if not exists probation_end  date,
  add column if not exists regularized_on date,
  add column if not exists contact_number text,
  add column if not exists birthday       date;
