import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminProfile } from "@/lib/auth";
import { formatYmd, formatDateTime } from "@/lib/datetime";
import {
  DAILY_REPORT_SAFETY_FIELDS,
  formatDailyReportSafetyAnswer,
  parseDailyReportSafetyChecklist,
  formatWorkerSignedTime,
  parseDailyReportIssues,
  parseDailyReportWorkerSummary,
} from "@/lib/dailyReports";
import { adminCanAccessJob } from "@/lib/adminJobs";
import { parseDailyWeatherSnapshot } from "@/lib/weather";
import { resolveDailyReportPhotos } from "@/lib/dailyReportPhotos";
import DownloadPdfButton from "./DownloadPdfButton";

type DailyReportDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function DailyReportDetailPage({
  params,
}: DailyReportDetailPageProps) {
  const { profile } = await getAdminProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: report, error } = await supabase
    .from("daily_reports")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !report) {
    notFound();
  }

  const canAccess = await adminCanAccessJob(
    supabase,
    profile.id,
    profile.role,
    report.job_id
  );

  if (!canAccess && report.admin_id !== profile.id) {
    notFound();
  }

  const workerSummary = parseDailyReportWorkerSummary(report.worker_summary);
  const issues = parseDailyReportIssues(report.issues);
  const safetyChecklist = parseDailyReportSafetyChecklist(report.safety_checklist);
  const photos = await resolveDailyReportPhotos(report.photo_data);
  const weatherSnapshot = parseDailyWeatherSnapshot(report.weather_snapshot);

  return (
    <div className="space-y-6">
      <div className="admin-hero p-6 sm:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <Link
              href="/admin/forms/daily-report/submissions"
              className="admin-subtle text-sm"
            >
              Back to Submitted Reports
            </Link>
            <p className="admin-kicker mt-4">Submitted Report</p>
            <h1 className="admin-title mt-3 text-3xl font-bold">Daily Report</h1>
            <p className="admin-copy mt-3 text-sm sm:text-base">
              {report.job_number
                ? `${report.job_number} - ${report.job_name}`
                : report.job_name}
            </p>
          </div>

          <div className="space-y-3 xl:min-w-[320px]">
            <div className="flex flex-wrap gap-3 xl:justify-end">
                <Link
                  href={`/admin/forms/daily-report/submissions/${report.id}/pdf`}
                  className="admin-action-secondary text-sm"
                >
                  PDF View
                </Link>
                <DownloadPdfButton
                  href={`/admin/forms/daily-report/submissions/${report.id}/pdf-file`}
                  className="admin-action-secondary text-sm"
                />
            </div>

            <div className="admin-card rounded-xl bg-[rgba(247,244,237,0.72)] px-4 py-3 text-sm text-gray-800">
              <div>
                Report date:{" "}
                <span className="font-medium">{formatYmd(report.report_date)}</span>
              </div>
              <div className="mt-1">
                Submitted by:{" "}
                <span className="font-medium">{report.admin_name}</span>
              </div>
              <div className="mt-1">
                Created:{" "}
                <span className="font-medium">
                  {formatDateTime(report.created_at)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Labor Mode</p>
          <p className="mt-2 text-2xl font-bold capitalize">
            {report.worker_count_source}
          </p>
        </div>

        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Workers</p>
          <p className="mt-2 text-2xl font-bold">{report.worker_count}</p>
        </div>

        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Total Hours</p>
          <p className="mt-2 text-2xl font-bold">
            {report.total_hours.toFixed(2)}
          </p>
        </div>

        <div className="admin-stat-card p-5">
          <p className="admin-subtle text-sm">Photos</p>
          <p className="mt-2 text-2xl font-bold">{photos.length}</p>
        </div>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="admin-title text-xl font-semibold">Weather</h2>
            <p className="admin-copy mt-2">
              Weather snapshot saved with this report.
            </p>
          </div>

          {weatherSnapshot ? (
            <span className="inline-flex rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
              Saved
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Not available
            </span>
          )}
        </div>

        {weatherSnapshot ? (
          <>
            <p className="mt-4 text-sm text-gray-700">
              {weatherSnapshot.location_label}
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="admin-stat-card p-4">
                <p className="text-sm text-gray-700">Conditions</p>
                <p className="mt-1 font-medium text-gray-900">
                  {weatherSnapshot.weather_summary}
                </p>
              </div>

              <div className="admin-stat-card p-4">
                <p className="text-sm text-gray-700">Temperature</p>
                <p className="mt-1 font-medium text-gray-900">
                  {weatherSnapshot.min_temperature_f !== null &&
                  weatherSnapshot.max_temperature_f !== null
                    ? `${weatherSnapshot.min_temperature_f.toFixed(
                        1
                      )}F to ${weatherSnapshot.max_temperature_f.toFixed(1)}F`
                    : "-"}
                </p>
              </div>

              <div className="admin-stat-card p-4">
                <p className="text-sm text-gray-700">Precipitation</p>
                <p className="mt-1 font-medium text-gray-900">
                  {weatherSnapshot.precipitation_inches !== null
                    ? `${weatherSnapshot.precipitation_inches.toFixed(2)} in`
                    : "-"}
                </p>
              </div>

              <div className="admin-stat-card p-4">
                <p className="text-sm text-gray-700">Max Wind</p>
                <p className="mt-1 font-medium text-gray-900">
                  {weatherSnapshot.wind_speed_max_mph !== null
                    ? `${weatherSnapshot.wind_speed_max_mph.toFixed(1)} mph`
                    : "-"}
                </p>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-4 text-gray-800">
            Weather was not saved for this report. Add the job address, city,
            and ZIP code on the job page to include weather on future reports.
          </p>
        )}
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Work Performed</h2>
        <p className="mt-4 whitespace-pre-wrap text-gray-900">
          {report.work_performed}
        </p>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Issues</h2>

        {issues.length === 0 ? (
          <p className="mt-4 text-gray-800">No issues were reported.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {issues.map((issue, index) => (
              <div
                key={`${index}-${issue.slice(0, 24)}`}
                className="rounded-xl border border-gray-200 bg-gray-50 p-4"
              >
                <p className="text-sm font-medium text-gray-700">
                  Issue {index + 1}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-gray-900">
                  {issue}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Jobsite Coordination Items</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="admin-stat-card p-4">
            <p className="text-sm font-medium text-gray-700">
              Inspections Received
            </p>
            <p className="mt-2 whitespace-pre-wrap text-gray-900">
              {report.inspections_received?.trim() || "-"}
            </p>
          </div>

          <div className="admin-stat-card p-4">
            <p className="text-sm font-medium text-gray-700">Equipment Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-gray-900">
              {report.equipment_notes?.trim() || "-"}
            </p>
          </div>

          <div className="admin-stat-card p-4">
            <p className="text-sm font-medium text-gray-700">
              Material Delivery
            </p>
            <p className="mt-2 whitespace-pre-wrap text-gray-900">
              {report.material_delivery?.trim() || "-"}
            </p>
          </div>

          <div className="admin-stat-card p-4">
            <p className="text-sm font-medium text-gray-700">Manpower Notes</p>
            <p className="mt-2 whitespace-pre-wrap text-gray-900">
              {report.manpower_notes?.trim() || "-"}
            </p>
          </div>
        </div>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Safety</h2>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {DAILY_REPORT_SAFETY_FIELDS.map((field) => {
            const answer = safetyChecklist[field.key];
            const toneClass =
              answer === "yes"
                ? "bg-green-100 text-green-700"
                : answer === "no"
                  ? "bg-red-100 text-red-700"
                  : "bg-slate-200 text-slate-700";

            return (
              <div
                key={field.key}
                className="admin-stat-card p-4"
              >
                <p className="text-sm font-medium text-gray-700">{field.label}</p>
                <span
                  className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-medium ${toneClass}`}
                >
                  {formatDailyReportSafetyAnswer(answer)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Labor</h2>

        {report.worker_count_source === "auto" ? (
          workerSummary.length === 0 ? (
            <p className="mt-4 text-gray-800">
              No sign-ins were attached to this report.
            </p>
          ) : (
            <div className="admin-table-wrap mt-4">
              <table className="admin-table min-w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                    <th className="px-4 py-3 font-semibold">Worker</th>
                    <th className="px-4 py-3 font-semibold">Signed In</th>
                    <th className="px-4 py-3 font-semibold">Signed Out</th>
                    <th className="px-4 py-3 font-semibold">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {workerSummary.map((worker) => (
                    <tr
                      key={`${worker.worker_name}-${worker.signed_in}`}
                      className="border-b border-gray-100 text-sm"
                    >
                      <td className="px-4 py-3 text-gray-900">
                        {worker.worker_name}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {formatWorkerSignedTime(worker.signed_in)}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {formatWorkerSignedTime(worker.signed_out)}
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {worker.hours_worked_display}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <p className="mt-4 text-gray-800">
            Manual labor mode was used. Worker names were not captured on this
            report.
          </p>
        )}
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Photos</h2>

        {photos.length === 0 ? (
          <p className="mt-4 text-gray-800">No photos were attached.</p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {photos.map((photo, index) => (
              <div
                key={photo.key}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
              >
                <Image
                  src={photo.src}
                  alt={`Daily report photo ${index + 1}`}
                  width={1200}
                  height={900}
                  unoptimized
                  className="h-64 w-full object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Signature</h2>
        <div className="admin-stat-card mt-4 p-4">
          <Image
            src={report.signature_data}
            alt={`Signature for ${report.admin_name}`}
            width={800}
            height={240}
            unoptimized
            className="h-32 w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}
