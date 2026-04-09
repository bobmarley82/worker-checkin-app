insert into storage.buckets (
  id,
  name,
  public,
  allowed_mime_types
)
values (
  'daily-report-photos',
  'daily-report-photos',
  false,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  allowed_mime_types = excluded.allowed_mime_types;
