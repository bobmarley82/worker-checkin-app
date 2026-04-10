# Migrations

This file summarizes the custom Supabase migrations currently present in `supabase/migrations`.

## 20260407_create_daily_reports.sql

Adds the `daily_reports` table and the initial RLS/policies for report creation and viewing.

## 20260407_create_admin_job_assignments.sql

Adds `admin_job_assignments` and the assignment-driven report access model for Field Supervisors.

## 20260407_update_daily_report_select_policy.sql

Updates report select policy so admins can read reports they are allowed to access by assignment / ownership.

## 20260407_add_job_location_and_report_weather.sql

Adds job location fields used for weather capture:

- `location_address`
- `location_city`
- `location_zip`

Also adds:

- `weather_snapshot` on `daily_reports`

## 20260407_add_daily_report_issue_and_coordination_fields.sql

Adds issue and coordination fields to `daily_reports`, including:

- `issues`
- `inspections_received`
- `equipment_notes`
- `material_delivery`
- `manpower_notes`

## 20260407_add_daily_report_safety_checklist.sql

Adds:

- `safety_checklist`

to `daily_reports`.

## 20260408_create_daily_report_photo_bucket.sql

Creates or updates the `daily-report-photos` Supabase Storage bucket for report images.

## 20260409_create_daily_report_pdf_bucket.sql

Creates or updates the `daily-report-pdfs` Supabase Storage bucket for cached generated PDFs.

## Suggested Practice

When adding future migrations:

- include a clear purpose in the filename
- note any required manual Supabase setup
- keep schema changes and policy changes easy to understand
- update these docs when the workflow meaning changes, not just the schema
