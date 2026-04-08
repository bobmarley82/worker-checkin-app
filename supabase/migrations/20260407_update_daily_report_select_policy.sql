drop policy if exists "Super admins can view daily reports" on public.daily_reports;
drop policy if exists "Admins can view own daily reports" on public.daily_reports;
drop policy if exists "Admins can view accessible daily reports" on public.daily_reports;

create policy "Admins can view accessible daily reports"
  on public.daily_reports
  for select
  to authenticated
  using (
    admin_id = auth.uid()
    or exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'super_admin'
    )
    or exists (
      select 1
      from public.admin_job_assignments
      where admin_id = auth.uid()
        and job_id = daily_reports.job_id
    )
  );
