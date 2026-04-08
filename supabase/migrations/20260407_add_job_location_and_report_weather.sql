alter table if exists public.jobs
  add column if not exists location_address text,
  add column if not exists location_city text,
  add column if not exists location_zip text;

alter table if exists public.daily_reports
  add column if not exists weather_snapshot jsonb;
