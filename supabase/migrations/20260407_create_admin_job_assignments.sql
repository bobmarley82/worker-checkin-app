create table if not exists public.admin_job_assignments (
  admin_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  assigned_at timestamptz not null default timezone('utc', now()),
  assigned_by uuid references public.profiles(id) on delete set null,
  primary key (admin_id, job_id)
);

create index if not exists admin_job_assignments_job_id_idx
  on public.admin_job_assignments (job_id);

alter table public.admin_job_assignments enable row level security;

drop policy if exists "Viewer admins can view own assignments" on public.admin_job_assignments;
create policy "Viewer admins can view own assignments"
  on public.admin_job_assignments
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
  );

drop policy if exists "Super admins can manage assignments" on public.admin_job_assignments;
create policy "Super admins can manage assignments"
  on public.admin_job_assignments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'super_admin'
    )
  );

drop policy if exists "Admins can create daily reports" on public.daily_reports;
create policy "Admins can create daily reports"
  on public.daily_reports
  for insert
  to authenticated
  with check (
    admin_id = auth.uid()
    and (
      exists (
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
    )
  );
