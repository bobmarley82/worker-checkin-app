import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAdminProfile, requireViewerAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getTodayYmd } from "@/lib/datetime";
import SignatureField from "@/app/checkin/SignatureField";
import SubmitButton from "@/app/checkin/SubmitButton";
import DailyReportPhotoField from "./DailyReportPhotoField";
import DailyReportCoordinationField from "./DailyReportCoordinationField";
import DailyReportIssuesField from "./DailyReportIssuesField";
import {
  buildDailyReportSafetyChecklist,
  buildDailyReportWorkerSummary,
  DAILY_REPORT_SAFETY_FIELDS,
  parseDailyReportIssues,
} from "@/lib/dailyReports";
import {
  adminCanAccessJob,
  getAccessibleJobsForAdmin,
} from "@/lib/adminJobs";
import { getDailyWeatherForJob } from "@/lib/weather";
import {
  removeDailyReportPhotos,
  uploadDailyReportPhotos,
} from "@/lib/dailyReportPhotos";

export const dynamic = "force-dynamic";

type DailyReportPageProps = {
  searchParams: Promise<{
    date?: string;
    error?: string;
    job?: string;
    mode?: string;
    report_id?: string;
    success?: string;
  }>;
};

type WorkerCountSource = "auto" | "manual";

function getWorkerCountSource(value: string | undefined): WorkerCountSource {
  return value === "manual" ? "manual" : "auto";
}

function buildRedirect(params: {
  date?: string;
  error?: string;
  job?: string;
  mode?: WorkerCountSource;
  reportId?: string;
  success?: boolean;
}) {
  const searchParams = new URLSearchParams();

  if (params.date) searchParams.set("date", params.date);
  if (params.error) searchParams.set("error", params.error);
  if (params.job) searchParams.set("job", params.job);
  if (params.mode) searchParams.set("mode", params.mode);
  if (params.reportId) searchParams.set("report_id", params.reportId);
  if (params.success) searchParams.set("success", "1");

  const query = searchParams.toString();
  return query ? `/admin/forms/daily-report?${query}` : "/admin/forms/daily-report";
}

async function submitDailyReport(formData: FormData) {
  "use server";

  const { profile } = await getAdminProfile();
  const supabase = await createClient();

  const jobId = String(formData.get("job_id") ?? "").trim();
  const reportDate = String(formData.get("report_date") ?? "").trim();
  const workerCountSource = getWorkerCountSource(
    String(formData.get("worker_count_source") ?? "auto")
  );
  const manualWorkerCount = Number(formData.get("manual_worker_count") ?? 0);
  const manualTotalHours = Number(formData.get("manual_total_hours") ?? 0);
  const workPerformed = String(formData.get("work_performed") ?? "").trim();
  const issuesJson = String(formData.get("issues_json") ?? "[]");
  const inspectionsReceived = String(
    formData.get("inspections_received") ?? ""
  ).trim();
  const equipmentNotes = String(formData.get("equipment_notes") ?? "").trim();
  const materialDelivery = String(formData.get("material_delivery") ?? "").trim();
  const manpowerNotes = String(formData.get("manpower_notes") ?? "").trim();
  const signatureData = String(formData.get("signature_data") ?? "").trim();
  const safetyChecklist = buildDailyReportSafetyChecklist(formData);
  const photoFiles = formData.getAll("photos");

  if (!jobId) {
    redirect(
      buildRedirect({
        date: reportDate || getTodayYmd(),
        error: "Job is required.",
        mode: workerCountSource,
      })
    );
  }

  if (!reportDate) {
    redirect(
      buildRedirect({
        error: "Date is required.",
        job: jobId,
        mode: workerCountSource,
      })
    );
  }

  if (!workPerformed) {
    redirect(
      buildRedirect({
        date: reportDate,
        error: "Work performed is required.",
        job: jobId,
        mode: workerCountSource,
      })
    );
  }

  if (!signatureData) {
    redirect(
      buildRedirect({
        date: reportDate,
        error: "Signature is required.",
        job: jobId,
        mode: workerCountSource,
      })
    );
  }

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select(
      "id, name, job_number, location_address, location_city, location_zip"
    )
    .eq("id", jobId)
    .single();

  if (jobError || !jobRow) {
    redirect(
      buildRedirect({
        date: reportDate,
        error: "Selected job not found.",
        job: jobId,
        mode: workerCountSource,
      })
    );
  }

  const canAccessJob = await adminCanAccessJob(
    supabase,
    profile.id,
    profile.role,
    jobId
  );

  if (!canAccessJob) {
    redirect(
      buildRedirect({
        date: reportDate,
        error: "You are not assigned to fill out daily reports for this job.",
        job: "",
        mode: workerCountSource,
      })
    );
  }

  let workerCount = 0;
  let totalHours = 0;
  let workerSummary: ReturnType<typeof buildDailyReportWorkerSummary>["summary"] | null =
    null;

  if (workerCountSource === "auto") {
    const { data: checkins, error: checkinsError } = await supabase
      .from("checkins")
      .select("worker_name, signed_at, signed_out_at")
      .eq("job_id", jobId)
      .eq("checkin_date", reportDate)
      .order("worker_name", { ascending: true });

    if (checkinsError) {
      redirect(
        buildRedirect({
          date: reportDate,
          error: checkinsError.message,
          job: jobId,
          mode: workerCountSource,
        })
      );
    }

    const derived = buildDailyReportWorkerSummary(checkins ?? []);
    workerCount = derived.workerCount;
    totalHours = derived.totalHours;
    workerSummary = derived.summary;
  } else {
    if (!Number.isFinite(manualWorkerCount) || manualWorkerCount < 0) {
      redirect(
        buildRedirect({
          date: reportDate,
          error: "Enter a valid worker count.",
          job: jobId,
          mode: workerCountSource,
        })
      );
    }

    if (!Number.isFinite(manualTotalHours) || manualTotalHours < 0) {
      redirect(
        buildRedirect({
          date: reportDate,
          error: "Enter valid total hours.",
          job: jobId,
          mode: workerCountSource,
        })
      );
    }

    workerCount = Math.trunc(manualWorkerCount);
    totalHours = Math.round(manualTotalHours * 100) / 100;
  }

  let issues: string[] = [];

  try {
    issues = parseDailyReportIssues(JSON.parse(issuesJson));
  } catch {
    redirect(
      buildRedirect({
        date: reportDate,
        error: "One or more issues could not be processed.",
        job: jobId,
        mode: workerCountSource,
      })
    );
  }

  const { snapshot: weatherSnapshot } = await getDailyWeatherForJob(
    jobRow,
    reportDate
  );

  const reportId = crypto.randomUUID();

  let photoData = [];

  try {
    photoData = await uploadDailyReportPhotos(reportId, photoFiles);
  } catch (caughtError) {
    redirect(
      buildRedirect({
        date: reportDate,
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "One or more photos could not be uploaded.",
        job: jobId,
        mode: workerCountSource,
      })
    );
  }

  const { error: insertError } = await supabase
    .from("daily_reports")
    .insert({
      id: reportId,
      admin_id: profile.id,
      admin_name: profile.full_name ?? "Admin",
      job_id: jobRow.id,
      job_name: jobRow.name,
      job_number: jobRow.job_number,
      photo_data: photoData,
      report_date: reportDate,
      signature_data: signatureData,
      total_hours: totalHours,
      work_performed: workPerformed,
      issues,
      safety_checklist: safetyChecklist,
      inspections_received: inspectionsReceived || null,
      equipment_notes: equipmentNotes || null,
      material_delivery: materialDelivery || null,
      manpower_notes: manpowerNotes || null,
      worker_count: workerCount,
      worker_count_source: workerCountSource,
      worker_summary: workerSummary,
      weather_snapshot: weatherSnapshot,
    });

  if (insertError) {
    await removeDailyReportPhotos(photoData.map((photo) => photo.path));

    redirect(
      buildRedirect({
        date: reportDate,
        error: insertError?.message ?? "Could not save the daily report.",
        job: jobId,
        mode: workerCountSource,
      })
    );
  }

  revalidatePath("/admin/forms");
  revalidatePath("/admin/forms/daily-report");
  revalidatePath("/admin/forms/daily-report/submissions");

  redirect(
    buildRedirect({
      date: reportDate,
      job: jobId,
      mode: workerCountSource,
      reportId,
      success: true,
    })
  );
}

export default async function DailyReportPage({
  searchParams,
}: DailyReportPageProps) {
  const profile = await requireViewerAdmin();
  const query = await searchParams;
  const supabase = await createClient();

  const selectedDate = query.date?.trim() || getTodayYmd();
  const selectedJobId = query.job?.trim() || "";
  const workerCountSource = getWorkerCountSource(query.mode);
  const errorMessage = query.error ?? "";
  const isSuccess = query.success === "1";
  const reportId = query.report_id ?? "";
  const isSuperAdmin = profile.role === "super_admin";

  const { jobs, error: jobsError } = await getAccessibleJobsForAdmin(
    supabase,
    profile.id,
    profile.role
  );

  const selectedJob = jobs?.find((job) => job.id === selectedJobId) ?? null;

  const workerContext =
    workerCountSource === "auto" && selectedJob
      ? await supabase
          .from("checkins")
          .select("worker_name, signed_at, signed_out_at")
          .eq("job_id", selectedJob.id)
          .eq("checkin_date", selectedDate)
          .order("worker_name", { ascending: true })
      : null;

  const autoWorkerSummary =
    workerContext?.data
      ? buildDailyReportWorkerSummary(workerContext.data)
      : {
          summary: [],
          totalHours: 0,
          workerCount: 0,
        };
  const weatherContext = selectedJob
    ? await getDailyWeatherForJob(selectedJob, selectedDate)
    : null;

  if (isSuccess) {
    return (
      <div className="space-y-6">
        <div className="admin-hero mx-auto max-w-2xl p-6 sm:p-8">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl">
              OK
            </div>
            <h1 className="admin-title mt-4 text-3xl font-bold">Daily Report Submitted</h1>
            <p className="admin-copy mt-2 text-sm">
              Your report has been saved for {selectedDate}.
            </p>
          </div>

          <div className="admin-card mt-6 space-y-3 rounded-xl bg-[rgba(247,244,237,0.72)] p-4 text-sm">
            <div>
              <span className="font-medium text-gray-900">Job:</span>{" "}
              <span className="text-gray-900">
                {selectedJob
                  ? `${selectedJob.job_number ?? "-"} - ${selectedJob.name}`
                  : "-"}
              </span>
            </div>
            <div>
              <span className="font-medium text-gray-900">Date:</span>{" "}
              <span className="text-gray-900">{selectedDate}</span>
            </div>
            <div>
              <span className="font-medium text-gray-900">Submitted By:</span>{" "}
              <span className="text-gray-900">
                {profile.full_name ?? "Admin"}
              </span>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/admin/forms"
              className="admin-action-primary"
            >
              Back to Forms
            </Link>

            <Link
              href="/admin/forms/daily-report"
              className="admin-action-secondary"
            >
              Fill Another Daily Report
            </Link>

            {reportId ? (
              <Link
                href={`/admin/forms/daily-report/submissions/${reportId}`}
                className="admin-action-secondary"
              >
                View Submitted Report
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="admin-hero p-6 sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="admin-kicker">Field Reporting</p>
            <h1 className="admin-title mt-3 text-3xl font-bold">Daily Report</h1>
            <p className="admin-copy mt-3 max-w-3xl text-sm sm:text-base">
              Fill out a daily report for a job and capture labor, work
              performed, photos, and your signature.
            </p>
          </div>

          <Link
            href="/admin/forms/daily-report/submissions"
            className="admin-action-secondary"
          >
            View Submitted Reports
          </Link>
        </div>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Load Report Context</h2>

        {jobsError ? (
          <p className="mt-4 text-red-600">{jobsError.message}</p>
        ) : jobs.length === 0 ? (
          <p className="mt-4 text-gray-800">
            {isSuperAdmin
              ? "No active jobs are available right now."
              : "You have not been assigned to any jobs yet."}
          </p>
        ) : (
          <form method="get" className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="job" className="block text-sm font-medium">
                Job
              </label>
              <select
                id="job"
                name="job"
                defaultValue={selectedJobId}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                required
              >
                <option value="" disabled>
                  Select a job
                </option>
                {jobs?.map((job) => (
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
                required
              />
            </div>

            <div className="md:col-span-2">
              <span className="block text-sm font-medium">
                Worker Count Source
              </span>
              <div className="mt-2 flex flex-wrap gap-6">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    value="auto"
                    defaultChecked={workerCountSource === "auto"}
                  />
                  Autofill from sign-ins
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    value="manual"
                    defaultChecked={workerCountSource === "manual"}
                  />
                  Enter manually
                </label>
              </div>
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="admin-action-primary"
              >
                Load Daily Report
              </button>
            </div>
          </form>
        )}
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {!selectedJob ? (
        <div className="admin-card p-6">
          <p className="admin-copy">
            Select a job, date, and labor mode above to start the daily report.
          </p>
        </div>
      ) : (
        <div className="admin-card p-6 sm:p-7">
          <h2 className="admin-title text-xl font-semibold">Report Details</h2>

          {workerContext?.error ? (
            <p className="mt-4 text-red-600">{workerContext.error.message}</p>
          ) : (
            <form action={submitDailyReport} className="mt-6 space-y-6">
              <input type="hidden" name="job_id" value={selectedJob.id} />
              <input type="hidden" name="report_date" value={selectedDate} />
              <input
                type="hidden"
                name="worker_count_source"
                value={workerCountSource}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium">Job Number</label>
                  <input
                    type="text"
                    value={selectedJob.job_number ?? ""}
                    readOnly
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">Job Name</label>
                  <input
                    type="text"
                    value={selectedJob.name}
                    readOnly
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">Date</label>
                  <input
                    type="text"
                    value={selectedDate}
                    readOnly
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">
                    Filled Out By
                  </label>
                  <input
                    type="text"
                    value={profile.full_name ?? "Admin"}
                    readOnly
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2"
                  />
                </div>
              </div>

              <div className="admin-card rounded-xl bg-[rgba(247,244,237,0.72)] p-4 sm:p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="admin-title text-base font-semibold">Weather</h3>
                    <p className="mt-1 text-sm text-gray-700">
                      Weather is pulled from the job address when a location is
                      available.
                    </p>
                  </div>

                  {weatherContext?.snapshot ? (
                    <span className="inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                      Weather loaded
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                      Weather unavailable
                    </span>
                  )}
                </div>

                {weatherContext?.snapshot ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="admin-stat-card p-4">
                      <p className="text-sm text-gray-700">Conditions</p>
                      <p className="mt-1 font-medium text-gray-900">
                        {weatherContext.snapshot.weather_summary}
                      </p>
                    </div>

                    <div className="admin-stat-card p-4">
                      <p className="text-sm text-gray-700">Temperature</p>
                      <p className="mt-1 font-medium text-gray-900">
                        {weatherContext.snapshot.min_temperature_f !== null &&
                        weatherContext.snapshot.max_temperature_f !== null
                          ? `${weatherContext.snapshot.min_temperature_f.toFixed(
                              1
                            )}F to ${weatherContext.snapshot.max_temperature_f.toFixed(
                              1
                            )}F`
                          : "-"}
                      </p>
                    </div>

                    <div className="admin-stat-card p-4">
                      <p className="text-sm text-gray-700">Precipitation</p>
                      <p className="mt-1 font-medium text-gray-900">
                        {weatherContext.snapshot.precipitation_inches !== null
                          ? `${weatherContext.snapshot.precipitation_inches.toFixed(
                              2
                            )} in`
                          : "-"}
                      </p>
                    </div>

                    <div className="admin-stat-card p-4">
                      <p className="text-sm text-gray-700">Max Wind</p>
                      <p className="mt-1 font-medium text-gray-900">
                        {weatherContext.snapshot.wind_speed_max_mph !== null
                          ? `${weatherContext.snapshot.wind_speed_max_mph.toFixed(
                              1
                            )} mph`
                          : "-"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-amber-800">
                    {weatherContext?.error ??
                      "Weather could not be loaded for this report."}
                  </p>
                )}
              </div>

              {workerCountSource === "auto" ? (
                <div className="admin-card rounded-xl bg-[rgba(247,244,237,0.72)] p-4 sm:p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h3 className="admin-title text-base font-semibold">Workers</h3>
                      <p className="mt-1 text-sm text-gray-700">
                        Pulled from sign-ins for this job on {selectedDate}.
                      </p>
                    </div>

                    <div className="text-sm text-gray-800">
                      <div>
                        Worker count:{" "}
                        <span className="font-semibold">
                          {autoWorkerSummary.workerCount}
                        </span>
                      </div>
                      <div>
                        Total hours:{" "}
                        <span className="font-semibold">
                          {autoWorkerSummary.totalHours.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {autoWorkerSummary.summary.length === 0 ? (
                    <p className="text-sm text-gray-700">
                      No sign-ins found for this job and date.
                    </p>
                  ) : (
                    <div className="admin-table-wrap">
                      <table className="admin-table min-w-full border-collapse">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                            <th className="px-3 py-2 font-semibold">Worker</th>
                            <th className="px-3 py-2 font-semibold">Hours</th>
                            <th className="px-3 py-2 font-semibold">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {autoWorkerSummary.summary.map((worker) => (
                            <tr key={`${worker.worker_name}-${worker.signed_in}`} className="text-sm">
                              <td className="px-3 py-2">{worker.worker_name}</td>
                              <td className="px-3 py-2">
                                {worker.hours_worked_display}
                              </td>
                              <td className="px-3 py-2">
                                {worker.is_open ? "Open" : "Closed"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="manual_worker_count"
                      className="block text-sm font-medium"
                    >
                      Number of Workers
                    </label>
                    <input
                      id="manual_worker_count"
                      name="manual_worker_count"
                      type="number"
                      min="0"
                      step="1"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="manual_total_hours"
                      className="block text-sm font-medium"
                    >
                      Total Hours Worked
                    </label>
                    <input
                      id="manual_total_hours"
                      name="manual_total_hours"
                      type="number"
                      min="0"
                      step="0.25"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                      required
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="work_performed"
                  className="block text-sm font-medium"
                >
                  Work Performed
                </label>
                <textarea
                  id="work_performed"
                  name="work_performed"
                  rows={7}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                  placeholder="Describe the work performed on this job for the day."
                  required
                />
              </div>

              <DailyReportIssuesField />

              <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-slate-900">
                    Safety
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600">
                    Review the daily safety checklist. Each question defaults to
                    N/A until you choose otherwise.
                  </p>
                </div>

                <div className="space-y-3">
                  {DAILY_REPORT_SAFETY_FIELDS.map((field) => (
                    <div
                      key={field.key}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm font-semibold text-slate-900">
                          {field.label}
                        </p>

                        <div className="flex flex-wrap gap-2">
                          {[
                            { label: "Yes", value: "yes" },
                            { label: "No", value: "no" },
                            { label: "N/A", value: "na" },
                          ].map((option) => (
                            <label
                              key={option.value}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                            >
                              <input
                                type="radio"
                                name={field.key}
                                value={option.value}
                                defaultChecked={option.value === "na"}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <DailyReportCoordinationField />

              <DailyReportPhotoField />

              <div>
                <label className="block text-sm font-medium">Signature</label>
                <p className="mt-1 text-sm text-gray-700">
                  Sign to confirm this daily report.
                </p>
                <div className="mt-2">
                  <SignatureField inputName="signature_data" />
                </div>
              </div>

              <SubmitButton label="Submit Daily Report" variant="checkin" />
            </form>
          )}
        </div>
      )}
    </div>
  );
}
