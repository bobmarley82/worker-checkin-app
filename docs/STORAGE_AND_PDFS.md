# Storage And PDFs

## Current Storage Buckets

### `daily-report-photos`

Purpose:

- stores uploaded report photos

Current path pattern:

- `daily-reports/{reportId}/{filename}`

Used by:

- `lib/dailyReportPhotos.ts`

Notes:

- uploads are done with the admin/service client
- signed URLs are created when reports are viewed
- photo uploads are compressed in the browser before submission

### `daily-report-pdfs`

Purpose:

- stores cached generated daily report PDFs

Current path pattern:

- `{reportId}-v2.pdf`

Used by:

- `lib/dailyReportPdfCache.ts`
- generated PDF route

Notes:

- cache version is currently controlled in the PDF route
- bumping the version causes old cached PDFs to be ignored

## Photo Read/Write Flow

Write path:

- report form -> `uploadDailyReportPhotos()` -> Supabase Storage

Read path:

- report detail / PDF page -> `resolveDailyReportPhotos()` -> signed URLs

Cleanup helpers exist in:

- `removeDailyReportPhotos()`

## Generated PDF Flow

Main route:

- `app/admin/(protected)/forms/daily-report/submissions/[id]/pdf-file/route.ts`

Flow:

1. validate user and report access
2. check cached PDF in Storage
3. if cached, return it
4. if not cached, open preview page in Puppeteer
5. wait for readiness marker and expected content
6. generate PDF
7. cache PDF in Storage
8. return PDF download response

## Important Response Behavior

The PDF response now:

- returns `application/pdf`
- returns `Content-Disposition: attachment`
- uses `no-store` / `no-cache` headers

The UI download button also adds a fresh query token so repeated downloads work without refreshing the page.

## Environment / Runtime Notes

This system depends on:

- valid Supabase service role access on the server
- a Node-compatible runtime for Puppeteer
- correct app origin / URL handling so the preview page can be loaded during PDF generation

## Future Multi-Company Note

If the app becomes multi-company later, storage paths should be moved under company-scoped prefixes such as:

- `companies/{companyId}/daily-report-photos/...`
- `companies/{companyId}/daily-report-pdfs/...`
