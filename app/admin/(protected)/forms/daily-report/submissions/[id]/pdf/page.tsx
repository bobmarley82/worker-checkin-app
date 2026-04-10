import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminProfile } from "@/lib/auth";
import { adminCanAccessJob } from "@/lib/adminJobs";
import { formatDateTime, formatYmd } from "@/lib/datetime";
import {
  DAILY_REPORT_SAFETY_FIELDS,
  formatDailyReportSafetyAnswer,
  formatWorkerSignedTime,
  parseDailyReportIssues,
  parseDailyReportSafetyChecklist,
  parseDailyReportWorkerSummary,
} from "@/lib/dailyReports";
import { parseDailyWeatherSnapshot } from "@/lib/weather";
import PrintDailyReportButton from "./PrintDailyReportButton";
import { resolveDailyReportPhotos } from "@/lib/dailyReportPhotos";
import DownloadPdfButton from "../DownloadPdfButton";

type DailyReportPdfPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    download?: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function DailyReportPdfPage({
  params,
  searchParams,
}: DailyReportPdfPageProps) {
  const { profile } = await getAdminProfile();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const isDownloadMode = query.download === "1";

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
    <main
      className={
        isDownloadMode
          ? "min-h-screen bg-white"
          : "min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.08),_transparent_32%),linear-gradient(180deg,_#f4f7fb_0%,_#e9eff7_100%)] px-4 py-6 print:bg-white print:p-0 sm:px-6 lg:px-8"
      }
    >
      <div
        className={
          isDownloadMode
            ? "mx-auto max-w-[8.2in]"
            : "mx-auto max-w-6xl space-y-4 print:max-w-none print:space-y-0"
        }
      >
        {isDownloadMode ? (
          <style>{`
            .admin-header,
            .admin-nav,
            .admin-brand {
              display: none !important;
            }

            .admin-shell {
              background: white !important;
              min-height: auto !important;
            }

            .admin-page,
            .app-container.admin-page {
              max-width: none !important;
              padding: 0 !important;
              margin: 0 !important;
            }

            main,
            .admin-shell,
            .admin-page {
              background: white !important;
            }

            nextjs-portal,
            [data-next-badge-root],
            [data-next-mark],
            [data-nextjs-toast] {
              display: none !important;
            }
          `}</style>
        ) : null}

        {!isDownloadMode ? (
          <div className="sticky top-4 z-10 print:hidden">
            <div className="mx-auto flex max-w-[8.75in] flex-col gap-3 rounded-[28px] border border-white/70 bg-white/88 px-4 py-4 shadow-[0_20px_55px_rgba(15,23,42,0.14)] backdrop-blur sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                    Daily Report Preview
                  </p>
                  <h1 className="mt-1 text-xl font-bold text-slate-950 sm:text-2xl">
                    {report.job_number
                      ? `${report.job_number} - ${report.job_name}`
                      : report.job_name}
                  </h1>
                </div>

                <div className="flex flex-wrap gap-2.5">
                  <Link
                    href={`/admin/forms/daily-report/submissions/${report.id}`}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    Back to Report
                  </Link>
                  <DownloadPdfButton
                    href={`/admin/forms/daily-report/submissions/${report.id}/pdf-file`}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  />
                  <PrintDailyReportButton />
                </div>
              </div>

              <p className="text-sm text-slate-600">
                Review the document below, then print or download when it looks right.
              </p>
            </div>
          </div>
        ) : null}

        <article
          data-pdf-ready="true"
          className={
            isDownloadMode
              ? "mx-auto max-w-[8.2in] bg-white p-4"
              : "mx-auto max-w-[8.5in] rounded-[32px] border border-white/80 bg-white px-5 py-6 shadow-[0_28px_80px_rgba(15,23,42,0.16)] print:max-w-none print:rounded-none print:border-0 print:p-4 print:shadow-none sm:px-6"
          }
        >
          <header className="border-b border-slate-200 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                  ICBI Connect
                </p>
                <h1 className="mt-2 text-2xl font-bold text-slate-950">
                  Daily Report
                </h1>
                <p className="mt-2 text-sm text-slate-700">
                  {report.job_number
                    ? `${report.job_number} - ${report.job_name}`
                    : report.job_name}
                </p>
              </div>

              <div className="grid min-w-[240px] gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-slate-500">Report Date</span>
                  <span className="font-semibold text-slate-900">
                    {formatYmd(report.report_date)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-slate-500">Submitted By</span>
                  <span className="font-semibold text-slate-900">
                    {report.admin_name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium text-slate-500">Created</span>
                  <span className="text-right font-semibold text-slate-900">
                    {formatDateTime(report.created_at)}
                  </span>
                </div>
              </div>
            </div>
          </header>

          <section className="mt-4 grid gap-3 md:grid-cols-4 print:break-inside-avoid">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Labor Mode
              </p>
              <p className="mt-1 text-xl font-bold capitalize text-slate-950">
                {report.worker_count_source}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Workers
              </p>
              <p className="mt-1 text-xl font-bold text-slate-950">
                {report.worker_count}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total Hours
              </p>
              <p className="mt-1 text-xl font-bold text-slate-950">
                {report.total_hours.toFixed(2)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Photos
              </p>
              <p className="mt-1 text-xl font-bold text-slate-950">
                {photos.length}
              </p>
            </div>
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-200 p-4 print:break-inside-avoid">
                <h2 className="text-base font-semibold text-slate-950">
                  Work Performed
                </h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {report.work_performed}
                </p>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-slate-200 p-4 print:break-inside-avoid">
                  <h2 className="text-base font-semibold text-slate-950">Issues</h2>
                  {issues.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">No issues were reported.</p>
                  ) : (
                    <div className="mt-3 space-y-2.5">
                      {issues.map((issue, index) => (
                        <div
                          key={`${index}-${issue.slice(0, 24)}`}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Issue {index + 1}
                          </p>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                            {issue}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200 p-4 print:break-inside-avoid">
                  <h2 className="text-base font-semibold text-slate-950">
                    Jobsite Coordination
                  </h2>
                  <div className="mt-3 grid gap-2.5">
                    {[
                      ["Inspections", report.inspections_received?.trim() || "-"],
                      ["Equipment", report.equipment_notes?.trim() || "-"],
                      ["Material Delivery", report.material_delivery?.trim() || "-"],
                      ["Manpower", report.manpower_notes?.trim() || "-"],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {label}
                        </p>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>

            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-200 p-4 print:break-inside-avoid">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">Weather</h2>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                      weatherSnapshot
                        ? "bg-green-100 text-green-700"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {weatherSnapshot ? "Saved" : "Unavailable"}
                  </span>
                </div>

                {weatherSnapshot ? (
                  <div className="mt-3 space-y-2.5">
                    <p className="text-sm text-slate-600">
                      {weatherSnapshot.location_label}
                    </p>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {[
                        ["Conditions", weatherSnapshot.weather_summary],
                        [
                          "Temperature",
                          weatherSnapshot.min_temperature_f !== null &&
                          weatherSnapshot.max_temperature_f !== null
                            ? `${weatherSnapshot.min_temperature_f.toFixed(
                                1
                              )}F to ${weatherSnapshot.max_temperature_f.toFixed(1)}F`
                            : "-",
                        ],
                        [
                          "Precipitation",
                          weatherSnapshot.precipitation_inches !== null
                            ? `${weatherSnapshot.precipitation_inches.toFixed(2)} in`
                            : "-",
                        ],
                        [
                          "Max Wind",
                          weatherSnapshot.wind_speed_max_mph !== null
                            ? `${weatherSnapshot.wind_speed_max_mph.toFixed(1)} mph`
                            : "-",
                        ],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {label}
                          </p>
                          <p className="mt-1.5 text-sm font-medium text-slate-900">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Weather was not saved for this report.
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-slate-200 p-4 print:break-inside-avoid">
                <h2 className="text-base font-semibold text-slate-950">Safety</h2>
                <div className="mt-3 space-y-2.5">
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
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <p className="text-sm font-medium text-slate-700">
                          {field.label}
                        </p>
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${toneClass}`}
                        >
                          {formatDailyReportSafetyAnswer(answer)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4 print:break-inside-avoid">
                <h2 className="text-base font-semibold text-slate-950">Signature</h2>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <Image
                    src={report.signature_data}
                    alt={`Signature for ${report.admin_name}`}
                    width={800}
                    height={240}
                    unoptimized
                    className="h-28 w-full object-contain"
                  />
                </div>
              </section>
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-slate-200 p-4 print:break-inside-avoid">
            <h2 className="text-base font-semibold text-slate-950">Labor</h2>
            {report.worker_count_source === "auto" ? (
              workerSummary.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  No sign-ins were attached to this report.
                </p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-600">
                        <th className="px-3 py-2.5 font-semibold">Worker</th>
                        <th className="px-3 py-2.5 font-semibold">Signed In</th>
                        <th className="px-3 py-2.5 font-semibold">Signed Out</th>
                        <th className="px-3 py-2.5 font-semibold">Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workerSummary.map((worker) => (
                        <tr key={`${worker.worker_name}-${worker.signed_in}`} className="border-b border-slate-100">
                          <td className="px-3 py-2.5 text-slate-900">{worker.worker_name}</td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {formatWorkerSignedTime(worker.signed_in)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {formatWorkerSignedTime(worker.signed_out)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            {worker.hours_worked_display}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <p className="mt-3 text-sm text-slate-600">
                Manual labor mode was used. Worker names were not captured on this report.
              </p>
            )}
          </section>

          {photos.length > 0 ? (
            <section className="mt-4 rounded-2xl border border-slate-200 p-4 print:break-inside-avoid">
              <h2 className="text-base font-semibold text-slate-950">Photos</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {photos.map((photo, index) => (
                  <div
                    key={photo.key}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
                  >
                    <Image
                      src={photo.src}
                      alt={`Daily report photo ${index + 1}`}
                      width={1200}
                      height={900}
                      unoptimized
                      className="h-40 w-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </article>
      </div>
    </main>
  );
}
