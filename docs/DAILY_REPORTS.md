# Daily Reports

## Purpose

Daily Reports are tied to jobs and can be created by admins in the admin area.

Current access model:

- Office/Admin can create and view all reports
- Field Supervisors can create reports for assigned jobs
- Field Supervisors can view reports for jobs assigned to them

## Main Pages

- forms hub
- daily report create page
- submissions list
- report detail page
- PDF preview page
- generated PDF download route

## Stored Report Data

Current daily report data includes:

- job number
- job name
- report date
- submitting admin
- worker count source (`auto` or `manual`)
- worker count
- total hours
- worker summary
- work performed
- issues
- coordination items
- safety checklist
- weather snapshot
- attached photos
- admin signature

## Worker Count Modes

### Auto mode

- pulls worker information from sign-ins for the selected job/date
- stores worker summary data with the report

### Manual mode

- stores worker count and total hours only
- does not store worker names for the report

## Weather Behavior

Weather depends on job location fields:

- `location_address`
- `location_city`
- `location_zip`

If those fields are missing, the report UI tells the user weather cannot be collected until the job address is added.

Weather values are stored as a snapshot on the report so they do not change later.

## Photo Behavior

Current photo flow:

1. user selects photos in the report form
2. client compresses images before upload
3. server action uploads them to Supabase Storage
4. report stores storage metadata / paths in `photo_data`
5. report detail and PDF views resolve signed URLs at read time

Older inline/base64 photo records are still supported when reading reports.

## PDF Behavior

There are two PDF-related surfaces:

### PDF preview page

- human-friendly preview page
- used to inspect layout before download/printing

### Generated PDF route

- server-side Puppeteer render
- returns a real PDF file download
- caches successful generated PDFs in Storage

## Current PDF Guardrails

The generated PDF route currently:

- uses a Node runtime
- loads the preview page in Puppeteer
- waits for a readiness marker
- validates expected report text before rendering
- rejects obviously incomplete PDFs
- caches the finished file in Storage

## Current Limitations

- generated PDF output depends on a working Puppeteer environment
- cached PDFs may need invalidation if the layout changes
- report editing/finalization workflow does not exist yet
