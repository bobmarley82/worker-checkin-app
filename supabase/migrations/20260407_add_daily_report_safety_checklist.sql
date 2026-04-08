alter table if exists public.daily_reports
  add column if not exists safety_checklist jsonb not null default '{}'::jsonb;
