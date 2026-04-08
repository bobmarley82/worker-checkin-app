import Link from "next/link";
import { requireViewerAdmin } from "@/lib/auth";

export default async function AdminFormsPage() {
  await requireViewerAdmin();

  return (
    <div className="space-y-6">
      <div className="admin-hero p-6 sm:p-8">
        <p className="admin-kicker">Reporting</p>
        <h1 className="admin-title mt-3 text-3xl font-bold">Forms</h1>
        <p className="admin-copy mt-3 max-w-2xl text-sm sm:text-base">
          Fill out job forms and keep the reporting workflow in one place.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="admin-card p-6 sm:p-7">
          <p className="admin-kicker">
            Job Form
          </p>
          <h2 className="admin-title mt-3 text-2xl font-semibold">Daily Report</h2>
          <p className="admin-copy mt-3 text-sm sm:text-base">
            Create a dated report for a job with labor totals, work performed,
            photos, and your signature, then review reports for jobs you can
            access.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/admin/forms/daily-report"
              className="admin-action-primary"
            >
              Fill Daily Report
            </Link>

            <Link
              href="/admin/forms/daily-report/submissions"
              className="admin-action-secondary"
            >
              View Submitted Reports
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
