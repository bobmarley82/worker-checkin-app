import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin, requireViewerAdmin } from "@/lib/auth";
import { adminCanAccessJob } from "@/lib/adminJobs";
import {
  formatYmd,
  formatDateTime,
  getTodayYmd,
  getYesterdayYmd,
  getLast7DaysStartYmd,
  getLast30DaysStartYmd,
} from "@/lib/datetime";

export const dynamic = "force-dynamic";

type JobDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    edit_location?: string;
    start_date?: string;
    end_date?: string;
  }>;
};

async function updateJobLocation(formData: FormData) {
  "use server";

  await requireSuperAdmin();

  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "").trim();

  if (!jobId) {
    throw new Error("Job not found.");
  }

  const locationAddress = String(formData.get("location_address") ?? "").trim();
  const locationCity = String(formData.get("location_city") ?? "").trim();
  const locationZip = String(formData.get("location_zip") ?? "").trim();

  const { error } = await supabase
    .from("jobs")
    .update({
      location_address: locationAddress || null,
      location_city: locationCity || null,
      location_zip: locationZip || null,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin/forms/daily-report");
}

export default async function JobDetailPage({
  params,
  searchParams,
}: JobDetailPageProps) {
  const profile = await requireViewerAdmin();
  const { id } = await params;
  const query = await searchParams;
  const isSuperAdmin = profile.role === "super_admin";

  const supabase = await createClient();
  const admin = createAdminClient();
  const canAccessJob = await adminCanAccessJob(
    supabase,
    profile.id,
    profile.role,
    id
  );

  if (!canAccessJob) {
    return (
      <div className="space-y-6">
        <div className="admin-card p-6">
          <p className="text-red-600">Job not found.</p>
          <Link
            href="/admin/jobs"
            className="mt-4 inline-block text-blue-600 underline"
          >
            Back to Jobs
          </Link>
        </div>
      </div>
    );
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select(
      "id, name, job_number, location_address, location_city, location_zip, is_active, created_at"
    )
    .eq("id", id)
    .single();

  if (jobError || !job) {
    return (
      <div className="space-y-6">
        <div className="admin-card p-6">
          <p className="text-red-600">Job not found.</p>
          <Link
            href="/admin/jobs"
            className="mt-4 inline-block text-blue-600 underline"
          >
            Back to Jobs
          </Link>
        </div>
      </div>
    );
  }

  const today = getTodayYmd();
  const yesterday = getYesterdayYmd();
  const last7Start = getLast7DaysStartYmd();
  const last30Start = getLast30DaysStartYmd();

  const startDate =
    query.start_date && query.start_date.trim() ? query.start_date : today;

  const endDate =
    query.end_date && query.end_date.trim() ? query.end_date : startDate;

  const normalizedStartDate = startDate <= endDate ? startDate : endDate;
  const normalizedEndDate = startDate <= endDate ? endDate : startDate;

  const { data: checkins, error: checkinsError } = await supabase
    .from("checkins")
    .select(`
      id,
      worker_name,
      checkin_date,
      injured,
      signed_at,
      signed_out_at,
      auto_signed_out,
      signature_data
    `)
    .eq("job_id", job.id)
    .gte("checkin_date", normalizedStartDate)
    .lte("checkin_date", normalizedEndDate)
    .order("checkin_date", { ascending: false })
    .order("signed_at", { ascending: false });

  const [{ data: assignedViewerAdmins, error: assignmentsError }, { data: reports, error: reportsError }] =
    await Promise.all([
      admin
        .from("admin_job_assignments")
        .select(
          `
          admin_id,
          assigned_at,
          profiles!admin_job_assignments_admin_id_fkey!inner (
            id,
            full_name,
            role,
            is_active
          )
        `
        )
        .eq("job_id", job.id)
        .order("assigned_at", { ascending: true }),
      admin
        .from("daily_reports")
        .select(
          "id, admin_id, admin_name, report_date, worker_count_source, worker_count, total_hours, created_at"
        )
        .eq("job_id", job.id)
        .gte("report_date", normalizedStartDate)
        .lte("report_date", normalizedEndDate)
        .order("report_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);

  const totalForRange = checkins?.length ?? 0;
  const injuredCount =
    checkins?.filter((checkin) => checkin.injured).length ?? 0;
  const uniqueWorkers = new Set(
    checkins?.map((checkin) => checkin.worker_name) ?? []
  ).size;
  const openCount =
    checkins?.filter((checkin) => !checkin.signed_out_at).length ?? 0;
  const viewerAdmins =
    (assignedViewerAdmins ?? [])
      .map((assignment) =>
        Array.isArray(assignment.profiles)
          ? assignment.profiles[0]
          : assignment.profiles
      )
      .filter(
        (candidate): candidate is {
          id: string;
          full_name: string | null;
          is_active: boolean;
          role: string;
        } =>
          Boolean(candidate) &&
          typeof candidate.id === "string" &&
          candidate.role === "viewer_admin"
      ) ?? [];

  const isSingleDay = normalizedStartDate === normalizedEndDate;
  const jobDisplay = job.job_number
    ? `${job.job_number} - ${job.name}`
    : job.name;

  const exportParams = new URLSearchParams();

  if (normalizedStartDate) {
    exportParams.set("start_date", normalizedStartDate);
  }

  if (normalizedEndDate) {
    exportParams.set("end_date", normalizedEndDate);
  }

  const exportHref = `/admin/jobs/${job.id}/export?${exportParams.toString()}`;
  const hasSavedLocation = Boolean(
    job.location_address?.trim() ||
      job.location_city?.trim() ||
      job.location_zip?.trim()
  );
  const hasWeatherLocation = Boolean(
    job.location_address?.trim() &&
      job.location_city?.trim() &&
      job.location_zip?.trim()
  );
  const isEditingLocation = query.edit_location === "1";
  const locationParams = new URLSearchParams();

  if (normalizedStartDate) {
    locationParams.set("start_date", normalizedStartDate);
  }

  if (normalizedEndDate) {
    locationParams.set("end_date", normalizedEndDate);
  }

  const locationViewHref = locationParams.toString()
    ? `/admin/jobs/${job.id}?${locationParams.toString()}`
    : `/admin/jobs/${job.id}`;
  locationParams.set("edit_location", "1");
  const locationEditHref = `/admin/jobs/${job.id}?${locationParams.toString()}`;

  return (
    <div className="space-y-6">
      <div className="admin-hero p-6 sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <Link
              href="/admin/jobs"
              className="admin-subtle inline-flex items-center text-sm"
            >
              Back to Jobs
            </Link>

            <p className="admin-kicker mt-4">Job Overview</p>
            <h1 className="admin-title mt-3 text-3xl font-bold">{jobDisplay}</h1>
            <p className="admin-copy mt-3">
              {job.is_active ? "Active job" : "Inactive job"}
            </p>
          </div>

          <div className="w-full xl:max-w-sm">
            <form method="get" className="space-y-3">
              <div>
                <label
                  htmlFor="start_date"
                  className="block text-sm font-medium text-gray-900"
                >
                  Start date
                </label>
                <input
                  id="start_date"
                  name="start_date"
                  type="date"
                  defaultValue={normalizedStartDate}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                />
              </div>

              <div>
                <label
                  htmlFor="end_date"
                  className="block text-sm font-medium text-gray-900"
                >
                  End date
                </label>
                <input
                  id="end_date"
                  name="end_date"
                  type="date"
                  defaultValue={normalizedEndDate}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="submit"
                  className="admin-action-primary flex-1"
                >
                  Apply Filter
                </button>

                <Link
                  href={`/admin/jobs/${job.id}`}
                  className="admin-action-secondary"
                >
                  Reset
                </Link>
              </div>
            </form>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href={`/admin/jobs/${job.id}?start_date=${today}&end_date=${today}`}
            className="admin-action-subtle text-sm"
          >
            Today
          </Link>

          <Link
            href={`/admin/jobs/${job.id}?start_date=${yesterday}&end_date=${yesterday}`}
            className="admin-action-subtle text-sm"
          >
            Yesterday
          </Link>

          <Link
            href={`/admin/jobs/${job.id}?start_date=${last7Start}&end_date=${today}`}
            className="admin-action-subtle text-sm"
          >
            Last 7 Days
          </Link>

          <Link
            href={`/admin/jobs/${job.id}?start_date=${last30Start}&end_date=${today}`}
            className="admin-action-subtle text-sm"
          >
            Last 30 Days
          </Link>

          <Link
            href={exportHref}
            className="admin-action-secondary text-sm"
          >
            Export Excel
          </Link>
        </div>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Job Location</h2>
            <p className="mt-2 text-gray-800">
              Daily reports use this address to collect weather information.
            </p>
          </div>

          {hasWeatherLocation ? (
            <span className="inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
              Weather ready
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Weather setup incomplete
            </span>
          )}
        </div>

        {isSuperAdmin && (!hasSavedLocation || isEditingLocation) ? (
          <form action={updateJobLocation} className="mt-6 space-y-4">
            <input type="hidden" name="job_id" value={job.id} />

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="location_zip"
                  className="block text-sm font-medium text-gray-900"
                >
                  ZIP Code
                </label>
                <input
                  id="location_zip"
                  name="location_zip"
                  type="text"
                  defaultValue={job.location_zip ?? ""}
                  placeholder="95206"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                />
              </div>

              <div>
                <label
                  htmlFor="location_city"
                  className="block text-sm font-medium text-gray-900"
                >
                  City
                </label>
                <input
                  id="location_city"
                  name="location_city"
                  type="text"
                  defaultValue={job.location_city ?? ""}
                  placeholder="Stockton"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                />
              </div>

              <div className="md:col-span-2">
                <label
                  htmlFor="location_address"
                  className="block text-sm font-medium text-gray-900"
                >
                  Full Address
                </label>
                <input
                  id="location_address"
                  name="location_address"
                  type="text"
                  defaultValue={job.location_address ?? ""}
                  placeholder="123 Main St"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700"
              >
                Save Location
              </button>

              {hasSavedLocation ? (
                <Link
                  href={locationViewHref}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Cancel
                </Link>
              ) : null}

              <p className="text-sm text-gray-700">
                Leave the location blank if you do not want weather on reports
                yet.
              </p>
            </div>
          </form>
        ) : !hasSavedLocation ? (
          <p className="mt-6 text-gray-800">
            No job location has been added yet.
          </p>
        ) : (
          <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Address
                  </p>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {[
                      job.location_address?.trim(),
                      job.location_city?.trim(),
                      job.location_zip?.trim(),
                    ]
                      .filter(Boolean)
                      .join(", ") || "-"}
                  </p>
                </div>
              </div>

              {isSuperAdmin ? (
                <Link
                  href={locationEditHref}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Edit Location
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="admin-card p-6">
        <h2 className="admin-title text-xl font-semibold">Selected Range</h2>
        <p className="admin-copy mt-2">
          {isSingleDay ? (
            <>
              Showing records for{" "}
              <span className="font-medium">{formatYmd(normalizedStartDate)}</span>.
            </>
          ) : (
            <>
              Showing records from{" "}
              <span className="font-medium">{formatYmd(normalizedStartDate)}</span>{" "}
              to{" "}
              <span className="font-medium">{formatYmd(normalizedEndDate)}</span>.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Total sign-ins</p>
          <p className="mt-2 text-3xl font-bold">{totalForRange}</p>
        </div>

        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Unique workers</p>
          <p className="mt-2 text-3xl font-bold">{uniqueWorkers}</p>
        </div>

        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Injured</p>
          <p className="mt-2 text-3xl font-bold">{injuredCount}</p>
        </div>

        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Still signed in</p>
          <p className="mt-2 text-3xl font-bold">{openCount}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="admin-card p-6 sm:p-7">
          <h2 className="admin-title text-xl font-semibold">Assigned Field Supervisors</h2>
          <p className="admin-copy mt-2">
            Field Supervisors currently assigned to this job for daily reports.
          </p>

          {assignmentsError ? (
            <p className="mt-4 text-red-600">{assignmentsError.message}</p>
          ) : viewerAdmins.length === 0 ? (
            <p className="mt-4 text-gray-800">
              No Field Supervisors are assigned to this job yet.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              {viewerAdmins.map((viewerAdmin) => (
                <span
                  key={viewerAdmin.id}
                  className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-900"
                >
                  {viewerAdmin.full_name ?? "Field Supervisor"}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="admin-card p-6 sm:p-7">
          <h2 className="admin-title text-xl font-semibold">Daily Reports</h2>
          <p className="admin-copy mt-2">
            Daily reports for this job in the selected date range.
          </p>

          {reportsError ? (
            <p className="mt-4 text-red-600">{reportsError.message}</p>
          ) : !reports || reports.length === 0 ? (
            <p className="mt-4 text-gray-800">
              No daily reports found for this date range.
            </p>
          ) : (
            <div className="admin-table-wrap mt-4">
              <table className="admin-table min-w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                  <th className="px-4 py-3 font-semibold">Date Created</th>
                  <th className="px-4 py-3 font-semibold">Submitted By</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id} className="border-b border-gray-100 text-sm">
                    <td className="px-4 py-3 text-gray-900">
                      {formatDateTime(report.created_at)}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      {report.admin_name}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/forms/daily-report/submissions/${report.id}`}
                          className="rounded-lg border border-gray-300 px-3 py-2 hover:bg-gray-50"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Sign-Ins</h2>
        <p className="admin-copy mt-2">
          {isSingleDay ? (
            <>
              Showing records for <span className="font-medium">{jobDisplay}</span> on{" "}
              <span className="font-medium">
                {formatYmd(normalizedStartDate)}
              </span>
              .
            </>
          ) : (
            <>
              Showing records for <span className="font-medium">{jobDisplay}</span>{" "}
              from{" "}
              <span className="font-medium">
                {formatYmd(normalizedStartDate)}
              </span>{" "}
              to{" "}
              <span className="font-medium">
                {formatYmd(normalizedEndDate)}
              </span>
              .
            </>
          )}
        </p>

        {checkinsError ? (
          <p className="mt-6 text-red-600">{checkinsError.message}</p>
        ) : !checkins || checkins.length === 0 ? (
          <p className="mt-6 text-gray-800">
            No sign-ins found for this date range.
          </p>
        ) : (
          <div className="admin-table-wrap mt-6">
            <table className="admin-table min-w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-800">
                  <th className="px-4 py-3 font-semibold">Worker</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Injured</th>
                  <th className="px-4 py-3 font-semibold">Signed In</th>
                  <th className="px-4 py-3 font-semibold">Signed Out</th>
                  <th className="px-4 py-3 font-semibold">Signature</th>
                </tr>
              </thead>
              <tbody>
                {checkins.map((checkin, index) => (
                  <tr
                    key={checkin.id}
                    className={`text-sm ${
                      index % 2 === 0 ? "bg-white" : "bg-gray-50/60"
                    } hover:bg-gray-50`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {checkin.worker_name}
                    </td>

                    <td className="px-4 py-3 text-gray-900">
                      {formatYmd(checkin.checkin_date)}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          checkin.injured
                            ? "bg-red-100 text-red-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {checkin.injured ? "Yes" : "No"}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-gray-900">
                      {formatDateTime(checkin.signed_at)}
                    </td>

                    <td className="px-4 py-3">
                      {checkin.signed_out_at ? (
                        <div className="space-y-1">
                          <div className="text-gray-900">
                            {formatDateTime(checkin.signed_out_at)}
                          </div>

                          {checkin.auto_signed_out ? (
                            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                              Auto-signed out
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                          Open
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {checkin.signature_data ? (
                        <img
                          src={checkin.signature_data}
                          alt={`Signature for ${checkin.worker_name}`}
                          className="h-12 w-24 rounded border border-gray-200 bg-white object-contain"
                        />
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
