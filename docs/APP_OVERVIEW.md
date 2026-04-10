# App Overview

## Purpose

ICBI Connect is a Next.js + Supabase construction operations app centered around:

- worker check-in / sign-out
- admin job management
- daily reports
- report exports / PDFs
- role-based job access for admins

## Stack

- Next.js 16
- React 19
- Supabase Auth + Postgres + Storage
- Tailwind CSS 4
- Puppeteer for generated PDFs
- `xlsx` for exports
- `qrcode.react` for job QR codes
- `react-signature-canvas` for signatures
- `nodemailer` / SMTP for injury alerts

## Current Major Modules

### Public worker flow

- landing page
- check-in page
- sign-in form
- sign-out form
- duplicate-name handling for workers with the same name on the same job
- injury email alerts on sign-in and sign-out when selected

### Admin area

- login / account / password reset
- jobs list and job detail
- records archive
- forms hub
- daily report creation
- daily report submissions list
- daily report detail
- PDF preview and generated PDF download
- user/admin management

## Current Roles

Internal role values remain:

- `super_admin`
- `viewer_admin`

User-facing labels are:

- `Office/Admin`
- `Field Supervisor`

## Important Current Constraints

- The app is currently single-company in structure.
- The app is not yet multi-tenant under the hood.
- Report photos are stored in Supabase Storage.
- Generated PDFs are cached in Supabase Storage.
- Field Supervisors are restricted to assigned jobs in the admin area.
- Public worker check-in/sign-out is not restricted by admin job assignment.

## Key Shared Helpers

- `lib/auth.ts`
- `lib/adminJobs.ts`
- `lib/dailyReports.ts`
- `lib/dailyReportPhotos.ts`
- `lib/dailyReportPdfCache.ts`
- `lib/weather.ts`

## Current Operational Dependencies

- Supabase project with required tables, policies, and storage buckets
- Vercel or another Node-capable Next.js host
- SMTP settings for injury alert emails
- Puppeteer-compatible runtime for generated PDFs
