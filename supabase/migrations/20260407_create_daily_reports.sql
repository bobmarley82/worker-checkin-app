create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  job_number text,
  job_name text not null,
  report_date date not null,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  admin_name text not null,
  worker_count_source text not null check (worker_count_source in ('auto', 'manual')),
  worker_count integer not null check (worker_count >= 0),
  total_hours numeric(10,2) not null default 0,
  worker_summary jsonb,
  work_performed text not null,
  photo_data jsonb not null default '[]'::jsonb,
  signature_data text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists daily_reports_job_date_idx
  on public.daily_reports (job_id, report_date desc);

create index if not exists daily_reports_created_at_idx
  on public.daily_reports (created_at desc);

alter table public.daily_reports enable row level security;

drop policy if exists "Admins can create daily reports" on public.daily_reports;
create policy "Admins can create daily reports"
  on public.daily_reports
  for insert
  to authenticated
  with check (
    admin_id = auth.uid()
    and exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role in ('super_admin', 'viewer_admin')
    )
  );

drop policy if exists "Super admins can view daily reports" on public.daily_reports;
create policy "Super admins can view daily reports"
  on public.daily_reports
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'super_admin'
    )
  );
