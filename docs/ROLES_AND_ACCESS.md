# Roles And Access

## Role Model

Database roles:

- `super_admin`
- `viewer_admin`

Displayed labels in the UI:

- `super_admin` -> `Office/Admin`
- `viewer_admin` -> `Field Supervisor`

Role label mapping lives in `lib/auth.ts`.

## Auth Entry Points

- `getAdminProfile()`
- `requireViewerAdmin()`
- `requireSuperAdmin()`

Current behavior:

- unauthenticated users are redirected to `/admin/login`
- non-super-admin users are redirected away from super-admin-only pages
- current fallback redirect for restricted admin pages is `/admin/jobs`

## Office/Admin Access

Office/Admin users can:

- access all admin jobs
- manage admins
- assign Field Supervisors to jobs
- view all daily reports
- manage job details and location fields
- access exports and QR flows

## Field Supervisor Access

Field Supervisors can:

- access only assigned jobs in the admin area
- create daily reports only for assigned jobs
- view daily reports for jobs assigned to them
- access QR and quick report actions for assigned jobs

Field Supervisors cannot:

- access super-admin-only user management actions
- access unrelated jobs through the admin UI

Job access logic is centralized in `lib/adminJobs.ts`.

## Job Assignment Model

Job assignment data lives in:

- `admin_job_assignments`

Current behavior:

- multiple Field Supervisors can be assigned to the same job
- assignments are managed from user profile/admin pages
- assignment rules are enforced in both page queries and report submission access

## Public Worker Flow

The public worker sign-in/sign-out flow is intentionally separate from admin role access.

Current public behavior:

- workers can sign in to active jobs
- workers can sign out from active jobs
- same-name conflict handling exists for duplicate worker names on the same job

This flow does **not** currently use admin job assignment restrictions.

## Future Multi-Company Note

The current role system is company-agnostic under the hood.

If the app becomes multi-company later, roles will need company scope added to:

- profiles
- jobs
- reports
- records
- assignments
