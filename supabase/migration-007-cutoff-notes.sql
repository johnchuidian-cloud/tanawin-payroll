-- migration-007: cutoff notes (2026-09-25)
-- Phase 1 of the input/notes work: the "why" behind every number gets a
-- place to live, so nothing needs a sheet screenshot to be explained.
--   payroll_runs.note      one free-text note about the whole cutoff
--   payslips.note          free text about one person that cutoff
--   payslips.line_items    labeled additions/deductions, shape:
--                          {"adds":[{"label":"back pay","amount":1200}],
--                           "deducts":[{"label":"uniform share","amount":600}]}
-- No new tables, no new policies: both tables already sit behind RLS
-- (default deny, authenticated-only) from schema.sql — new columns inherit.
-- Structure only, no data. Safe to re-run.

alter table payroll_runs add column if not exists note text;
alter table payslips     add column if not exists note text;
alter table payslips     add column if not exists line_items jsonb;
