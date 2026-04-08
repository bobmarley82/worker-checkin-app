
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin, requireSuperAdmin } from "@/lib/auth";
import { getAccessibleJobsForAdmin } from "@/lib/adminJobs";
import DeleteCheckinButton from "./DeleteCheckinButton";

export const dynamic = "force-dynamic";

type AdminRecordsPageProps = {
  searchParams: Promise<{
    start_date?: string;
    end_date?: string;
    job_id?: string;
    worker?: string;
  }>;
};

import {
  formatYmd,
  formatDateTime,
  getTodayYmd,
  getYesterdayYmd,
  getLast7DaysStartYmd,
  getLast30DaysStartYmd,
} from "@/lib/datetime";

async function deleteCheckin(
  prevState: { error?: string; success?: string },
  formData: FormData
) {
  "use server";

  await requireSuperAdmin();

  const supabase = await createClient();

  const checkinId = String(formData.get("checkin_id") ?? "");
  const confirmText = String(formData.get("confirm_text") ?? "").trim();

  if (!checkinId) {
    return { error: "Missing check-in id.", success: "" };
  }

  if (confirmText !== "DELETE") {
    return { error: "Type DELETE to confirm.", success: "" };
  }

  const { error } = await supabase.from("checkins").delete().eq("id", checkinId);

  if (error) {
    return { error: error.message, success: "" };
  }

  revalidatePath("/admin/records");

  return { error: "", success: "Record deleted." };
}

export default async function AdminRecordsPage({
  searchParams,
}: AdminRecordsPageProps) {
  const profile = await requireViewerAdmin();
  const isSuperAdmin = profile.role === "super_admin";
  const query = await searchParams;
  const supabase = await createClient();

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
  const selectedJobId = query.job_id?.trim() ?? "";
  const workerSearch = query.worker?.trim() ?? "";

  const { jobs, error: jobsError } = await getAccessibleJobsForAdmin(
    supabase,
    profile.id,
    profile.role,
    { includeInactive: true }
  );
  const accessibleJobIds = jobs.map((job) => job.id);

  let checkinsQuery = supabase
    .from("checkins")
    .select(
      `
      id,
      worker_name,
      job_id,
      job_name,
      job_number,
      checkin_date,
      injured,
      signed_at,
      signed_out_at,
      auto_signed_out,
      signature_data,
      jobs (
        name,
        job_number
      )
    `
    )
    .gte("checkin_date", normalizedStartDate)
    .lte("checkin_date", normalizedEndDate)
    .order("checkin_date", { ascending: false })
    .order("signed_at", { ascending: false });

  if (!isSuperAdmin) {
    checkinsQuery =
      accessibleJobIds.length > 0
        ? checkinsQuery.in("job_id", accessibleJobIds)
        : checkinsQuery.eq("job_id", "00000000-0000-0000-0000-000000000000");
  }

  if (selectedJobId) {
    checkinsQuery = checkinsQuery.eq("job_id", selectedJobId);
  }

  if (workerSearch) {
    checkinsQuery = checkinsQuery.ilike("worker_name", `%${workerSearch}%`);
  }

  const { data: checkins, error: checkinsError } = await checkinsQuery;

  const totalSignins = checkins?.length ?? 0;
  const uniqueWorkers = new Set(
    checkins?.map((checkin) => checkin.worker_name) ?? []
  ).size;
  const injuredCount =
    checkins?.filter((checkin) => checkin.injured).length ?? 0;
  const openCount =
    checkins?.filter((checkin) => !checkin.signed_out_at).length ?? 0;

  const isSingleDay = normalizedStartDate === normalizedEndDate;

  const selectedJob = jobs?.find((job) => job.id === selectedJobId);
  const selectedJobName = selectedJob
    ? selectedJob.job_number
      ? `${selectedJob.job_number} - ${selectedJob.name}`
      : selectedJob.name
    : "";

  const rangeBase = `/admin/records`;

  const buildRangeLink = (
    start: string,
    end: string,
    jobId?: string,
    worker?: string
  ) => {
    const params = new URLSearchParams({
      start_date: start,
      end_date: end,
    });

    if (jobId) {
      params.set("job_id", jobId);
    }

    if (worker) {
      params.set("worker", worker);
    }

    return `${rangeBase}?${params.toString()}`;
  };

  const exportParams = new URLSearchParams({
    start_date: normalizedStartDate,
    end_date: normalizedEndDate,
  });

  if (selectedJobId) {
    exportParams.set("job_id", selectedJobId);
  }

  if (workerSearch) {
    exportParams.set("worker", workerSearch);
  }

  const exportHref = `/admin/records/export?${exportParams.toString()}`;

  return (
    <div className="space-y-6">
      <div className="admin-hero p-6 sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="admin-kicker">History</p>
            <h1 className="admin-title mt-3 text-3xl font-bold">Records Archive</h1>
            <p className="admin-copy mt-3 max-w-3xl text-sm sm:text-base">
              {isSuperAdmin
                ? "View sign-ins across all jobs by date range, job, and worker."
                : "View sign-ins for jobs assigned to you by date range, job, and worker."}
            </p>
          </div>

          <div className="w-full xl:max-w-md">
            <form method="get" className="space-y-3">
              <div>
                <label
                  htmlFor="worker"
                  className="block text-sm font-medium text-gray-900"
                >
                  Worker name
                </label>
                <input
                  id="worker"
                  name="worker"
                  type="text"
                  defaultValue={workerSearch}
                  placeholder="Search worker name"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                />
              </div>

              <div>
                <label
                  htmlFor="job_id"
                  className="block text-sm font-medium text-gray-900"
                >
                  Job
                </label>
                <select
                  id="job_id"
                  name="job_id"
                  defaultValue={selectedJobId}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                >
                  <option value="">All Jobs</option>
                  {jobs?.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.job_number ? `${job.job_number} - ${job.name}` : job.name}
                      {!job.is_active ? " (Inactive)" : ""}
                    </option>
                  ))}
                </select>
              </div>

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
                  href="/admin/records"
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
            href={buildRangeLink(
              today,
              today,
              selectedJobId || undefined,
              workerSearch || undefined
            )}
            className="admin-action-subtle text-sm"
          >
            Today
          </Link>

          <Link
            href={buildRangeLink(
              yesterday,
              yesterday,
              selectedJobId || undefined,
              workerSearch || undefined
            )}
            className="admin-action-subtle text-sm"
          >
            Yesterday
          </Link>

          <Link
            href={buildRangeLink(
              last7Start,
              today,
              selectedJobId || undefined,
              workerSearch || undefined
            )}
            className="admin-action-subtle text-sm"
          >
            Last 7 Days
          </Link>

          <Link
            href={buildRangeLink(
              last30Start,
              today,
              selectedJobId || undefined,
              workerSearch || undefined
            )}
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

      <div className="admin-card p-6">
        <h2 className="admin-title text-xl font-semibold">Selected Filters</h2>
        <p className="admin-copy mt-2">
          {selectedJobName ? (
            <>
              Job: <span className="font-medium">{selectedJobName}</span>
              {workerSearch ? (
                <>
                  {" "}
                  · Worker: <span className="font-medium">{workerSearch}</span>
                </>
              ) : null}{" "}
              {isSingleDay ? (
                <>
                  on{" "}
                  <span className="font-medium">
                    {formatYmd(normalizedStartDate)}
                  </span>
                </>
              ) : (
                <>
                  from{" "}
                  <span className="font-medium">
                    {formatYmd(normalizedStartDate)}
                  </span>{" "}
                  to{" "}
                  <span className="font-medium">
                    {formatYmd(normalizedEndDate)}
                  </span>
                </>
              )}
              .
            </>
          ) : (
            <>
              {isSuperAdmin ? "All jobs" : "All assigned jobs"}
              {workerSearch ? (
                <>
                  {" "}
                  · Worker: <span className="font-medium">{workerSearch}</span>
                </>
              ) : null}{" "}
              {isSingleDay ? (
                <>
                  on{" "}
                  <span className="font-medium">
                    {formatYmd(normalizedStartDate)}
                  </span>
                </>
              ) : (
                <>
                  from{" "}
                  <span className="font-medium">
                    {formatYmd(normalizedStartDate)}
                  </span>{" "}
                  to{" "}
                  <span className="font-medium">
                    {formatYmd(normalizedEndDate)}
                  </span>
                </>
              )}
              .
            </>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Total sign-ins</p>
          <p className="mt-2 text-3xl font-bold">{totalSignins}</p>
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

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Records</h2>
        <p className="admin-copy mt-2">
          {isSuperAdmin
            ? "Historical sign-ins across all jobs."
            : "Historical sign-ins for jobs assigned to you."}
        </p>

        {jobsError ? (
          <p className="mt-6 text-red-600">{jobsError.message}</p>
        ) : checkinsError ? (
          <p className="mt-6 text-red-600">{checkinsError.message}</p>
        ) : !checkins || checkins.length === 0 ? (
          <div className="admin-empty mt-6 px-4 py-5 text-sm">
            No records found for this filter.
          </div>
        ) : (
          <div className="admin-table-wrap mt-6">
            <table className="admin-table min-w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-800">
                  {isSuperAdmin ? (
                    <th className="px-4 py-3 font-semibold">Actions</th>
                  ) : null}
                  <th className="px-4 py-3 font-semibold">Worker</th>
                  <th className="px-4 py-3 font-semibold">Job</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Injured</th>
                  <th className="px-4 py-3 font-semibold">Signed In</th>
                  <th className="px-4 py-3 font-semibold">Signed Out</th>
                  <th className="px-4 py-3 font-semibold">Signature</th>
                </tr>
              </thead>
              <tbody>
                {checkins.map((checkin, index) => {
                  const relatedJob = Array.isArray(checkin.jobs)
                    ? checkin.jobs[0]
                    : checkin.jobs;

                  const relatedJobName = relatedJob?.name;
                  const relatedJobNumber = relatedJob?.job_number;

                  const jobName = relatedJobName ?? checkin.job_name ?? "-";
                  const jobNumber = relatedJobNumber ?? checkin.job_number ?? "";
                  const jobDisplay = jobNumber
                    ? `${jobNumber} - ${jobName}`
                    : jobName;

                  return (
                    <tr
                      key={checkin.id}
                      className={`text-sm ${
                        index % 2 === 0 ? "bg-white" : "bg-gray-50/60"
                      } hover:bg-gray-50`}
                    >
                      {isSuperAdmin ? (
                        <td className="px-4 py-3 align-top">
                          <DeleteCheckinButton
                            checkinId={checkin.id}
                            action={deleteCheckin}
                          />
                        </td>
                      ) : null}

                      <td className="px-4 py-3 font-medium text-gray-900">
                        {checkin.worker_name}
                      </td>

                      <td className="px-4 py-3 text-gray-900">{jobDisplay}</td>

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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
