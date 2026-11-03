-- Migration 004 — private file storage for run files (uploaded workbooks,
-- generated payroll registers, sent payslip zips). Run in SQL Editor.

insert into storage.buckets (id, name, public)
values ('run-files', 'run-files', false)
on conflict (id) do nothing;

create policy "authenticated read run-files" on storage.objects
  for select to authenticated using (bucket_id = 'run-files');
create policy "authenticated insert run-files" on storage.objects
  for insert to authenticated with check (bucket_id = 'run-files');
create policy "authenticated update run-files" on storage.objects
  for update to authenticated using (bucket_id = 'run-files');
create policy "authenticated delete run-files" on storage.objects
  for delete to authenticated using (bucket_id = 'run-files');
