-- migration-009: in-app feedback (2026-11-03)
-- Maya reports bugs/ideas/questions from inside the app, at the moment she
-- hits them, with the app context attached. The developer side reads and
-- answers them through scripts/feedback.mjs; her report list shows each
-- report's status and the reply, closing the loop in the same place.
-- Structure only, no data. Safe to re-run.

create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  author      text not null,                  -- login name shown in the app
  kind        text not null default 'bug',    -- 'bug' | 'idea' | 'question'
  message     text not null,
  context     jsonb,                          -- { view, buildId } captured at send
  status      text not null default 'open',   -- 'open' | 'in-progress' | 'done' | 'wont-do'
  reply       text,                           -- the developer's answer, shown in-app
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Same trust model as the rest of the app: default deny, authenticated only.
alter table feedback enable row level security;
create policy "authenticated all feedback" on feedback
  for all to authenticated using (true) with check (true);
