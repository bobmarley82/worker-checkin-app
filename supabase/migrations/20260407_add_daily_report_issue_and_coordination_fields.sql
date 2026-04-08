alter table if exists public.daily_reports
  add column if not exists issues jsonb not null default '[]'::jsonb,
  add column if not exists inspections_received text,
  add column if not exists equipment_notes text,
  add column if not exists material_delivery text,
  add column if not exists manpower_notes text;
