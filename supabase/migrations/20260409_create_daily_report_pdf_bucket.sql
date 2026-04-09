insert into storage.buckets (
  id,
  name,
  public,
  allowed_mime_types
)
values (
  'daily-report-pdfs',
  'daily-report-pdfs',
  false,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  allowed_mime_types = excluded.allowed_mime_types;
