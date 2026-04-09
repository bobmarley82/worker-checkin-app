import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin } from "@/lib/auth";
import { formatYmd, formatDateTime } from "@/lib/datetime";
import { getAccessibleJobsForAdmin } from "@/lib/adminJobs";

type DailyReportSubmissionsPageProps = {
  searchParams: Promise<{
    date?: string;
    job?: string;
    page?: string;
  }>;
};

export const dynamic = "force-dynamic";

const REPORTS_PAGE_SIZE = 20;

export default async function DailyReportSubmissionsPage({
  searchParams,
}: DailyReportSubmissionsPageProps) {
  const profile = await requireViewerAdmin();
  const query = await searchParams;
  const supabase = await createClient();

  const selectedDate = query.date?.trim() ?? "";
  const selectedJobId = query.job?.trim() ?? "";
  const currentPage = Math.max(
    1,
    Number.parseInt(query.page?.trim() ?? "1", 10) || 1
  );
  const isSuperAdmin = profile.role === "super_admin";
  const rangeFrom = (currentPage - 1) * REPORTS_PAGE_SIZE;
  const rangeTo = rangeFrom + REPORTS_PAGE_SIZE - 1;

  const { jobs, error: jobsError } = await getAccessibleJobsForAdmin(
    supabase,
    profile.id,
    profile.role
  );
  const accessibleJobIds = jobs.map((job) => job.id);

  let reportsQuery = supabase
    .from("daily_reports")
    .select(
      "id, job_id, job_number, job_name, report_date, admin_name, worker_count_source, worker_count, total_hours, created_at",
      { count: "exact" }
    )
    .range(rangeFrom, rangeTo)
    .order("created_at", { ascending: false });

  if (!isSuperAdmin) {
    reportsQuery =
      accessibleJobIds.length === 0
        ? reportsQuery.in("job_id", ["00000000-0000-0000-0000-000000000000"])
        : reportsQuery.in("job_id", accessibleJobIds);
  }

  if (selectedDate) {
    reportsQuery = reportsQuery.eq("report_date", selectedDate);
  }

  if (selectedJobId) {
    reportsQuery = reportsQuery.eq("job_id", selectedJobId);
  }

  const { data: reports, error, count } = await reportsQuery;
  const pageError = jobsError?.message || error?.message;
  const totalReports = count ?? 0;
  const totalPages =
    totalReports > 0 ? Math.ceil(totalReports / REPORTS_PAGE_SIZE) : 1;
  const pageStart = totalReports === 0 ? 0 : rangeFrom + 1;
  const pageEnd = totalReports === 0 ? 0 : rangeFrom + (reports?.length ?? 0);

  function buildPageHref(page: number) {
    const params = new URLSearchParams();

    if (selectedJobId) {
      params.set("job", selectedJobId);
    }

    if (selectedDate) {
      params.set("date", selectedDate);
    }

    if (page > 1) {
      params.set("page", String(page));
    }

    const search = params.toString();
    return search
      ? `/admin/forms/daily-report/submissions?${search}`
      : "/admin/forms/daily-report/submissions";
  }

  return (
    <div className="space-y-6">
      <div className="admin-hero p-6 sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="admin-kicker">Reporting Archive</p>
            <h1 className="admin-title mt-3 text-3xl font-bold">
              Daily Report Submissions
            </h1>
            <p className="admin-copy mt-3 max-w-3xl text-sm sm:text-base">
              {isSuperAdmin
                ? "Review completed daily reports across all jobs."
                : "Review completed daily reports for jobs assigned to you, including reports submitted by other assigned admins."}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/admin/forms/daily-report"
              className="admin-action-primary"
            >
              Fill Daily Report
            </Link>

            <Link
              href="/admin/forms"
              className="admin-action-secondary"
            >
              Back to Forms
            </Link>
          </div>
        </div>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <form method="get" className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label htmlFor="job" className="block text-sm font-medium">
              Job
            </label>
            <select
              id="job"
              name="job"
              defaultValue={selectedJobId}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            >
              <option value="">All Jobs</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.job_number ? `${job.job_number} - ${job.name}` : job.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="date" className="block text-sm font-medium">
              Date
            </label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={selectedDate}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="admin-action-primary"
            >
              Apply
            </button>
            <Link
              href="/admin/forms/daily-report/submissions"
              className="admin-action-secondary"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Reports</h2>

        {pageError ? (
          <p className="mt-4 text-red-600">{pageError}</p>
        ) : !reports || reports.length === 0 ? (
          <div className="admin-empty mt-5 px-4 py-5 text-sm">
            No daily reports found.
          </div>
        ) : (
          <>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="admin-copy text-sm">
                Showing <span className="font-medium text-slate-900">{pageStart}</span>-
                <span className="font-medium text-slate-900">{pageEnd}</span> of{" "}
                <span className="font-medium text-slate-900">{totalReports}</span> reports.
              </p>

              <div className="flex gap-2">
                <Link
                  href={buildPageHref(currentPage - 1)}
                  aria-disabled={currentPage <= 1}
                  className={`admin-action-secondary text-sm ${
                    currentPage <= 1 ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  Previous
                </Link>
                <Link
                  href={buildPageHref(currentPage + 1)}
                  aria-disabled={currentPage >= totalPages}
                  className={`admin-action-secondary text-sm ${
                    currentPage >= totalPages ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  Next
                </Link>
              </div>
            </div>

            <div className="admin-table-wrap mt-5">
              <table className="admin-table min-w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                    <th className="px-4 py-3 font-semibold">Job</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Submitted By</th>
                    <th className="px-4 py-3 font-semibold">Labor Mode</th>
                    <th className="px-4 py-3 font-semibold">Workers</th>
                    <th className="px-4 py-3 font-semibold">Hours</th>
                    <th className="px-4 py-3 font-semibold">Created</th>
                    <th className="px-4 py-3 font-semibold">View</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr key={report.id} className="border-b border-gray-100 text-sm">
                      <td className="px-4 py-3 text-gray-900">
                        {report.job_number
                          ? `${report.job_number} - ${report.job_name}`
                          : report.job_name}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {formatYmd(report.report_date)}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {report.admin_name}
                      </td>
                      <td className="px-4 py-3 text-gray-900 capitalize">
                        {report.worker_count_source}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{report.worker_count}</td>
                      <td className="px-4 py-3 text-gray-900">
                        {report.total_hours.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {formatDateTime(report.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/forms/daily-report/submissions/${report.id}`}
                          className="admin-action-subtle text-sm"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
