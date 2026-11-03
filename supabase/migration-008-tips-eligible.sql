-- migration-008: tips-pool eligibility (2026-11-03)
-- A person can now be excluded from the tips / ticket-sales pool while still
-- being paid normally (first case: a regular going part-time). Excluded
-- people get no tips share AND no longer dilute the pool's division.
-- Dailies were already excluded by type; this flag covers everyone else.
-- Structure only, no data. Safe to re-run. RLS inherited from the table.

alter table employees add column if not exists tips_eligible boolean not null default true;
