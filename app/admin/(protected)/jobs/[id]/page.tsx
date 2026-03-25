
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin } from "@/lib/auth";
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
    start_date?: string;
    end_date?: string;
  }>;
};

export default async function JobDetailPage({
  params,
  searchParams,
}: JobDetailPageProps) {
  await requireViewerAdmin();
  const { id } = await params;
  const query = await searchParams;

  const supabase = await createClient();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, name, job_number, is_active, created_at")
    .eq("id", id)
    .single();

  if (jobError || !job) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl bg-white p-6 shadow">
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

  const totalForRange = checkins?.length ?? 0;
  const injuredCount =
    checkins?.filter((checkin) => checkin.injured).length ?? 0;
  const uniqueWorkers = new Set(
    checkins?.map((checkin) => checkin.worker_name) ?? []
  ).size;
  const openCount =
    checkins?.filter((checkin) => !checkin.signed_out_at).length ?? 0;

  const isSingleDay = normalizedStartDate === normalizedEndDate;
  const jobDisplay = job.job_number
    ? `${job.job_number} - ${job.name}`
    : job.name;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/admin/jobs"
              className="inline-flex items-center text-sm text-blue-600 hover:underline"
            >
              ← Back to Jobs
            </Link>

            <h1 className="mt-3 text-2xl font-bold">{jobDisplay}</h1>
            <p className="mt-2 text-gray-800">
              {job.is_active ? "Active job" : "Inactive job"}
            </p>
          </div>

          <div className="min-w-[320px]">
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

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
                >
                  Apply Filter
                </button>

                <Link
                  href={`/admin/jobs/${job.id}`}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
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
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Today
          </Link>

          <Link
            href={`/admin/jobs/${job.id}?start_date=${yesterday}&end_date=${yesterday}`}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Yesterday
          </Link>

          <Link
            href={`/admin/jobs/${job.id}?start_date=${last7Start}&end_date=${today}`}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Last 7 Days
          </Link>

          <Link
            href={`/admin/jobs/${job.id}?start_date=${last30Start}&end_date=${today}`}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            Last 30 Days
          </Link>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Selected Range</h2>
        <p className="mt-2 text-gray-800">
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

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl bg-white p-6 shadow">
          <p className="text-sm text-gray-800">Total sign-ins</p>
          <p className="mt-2 text-3xl font-bold">{totalForRange}</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <p className="text-sm text-gray-800">Unique workers</p>
          <p className="mt-2 text-3xl font-bold">{uniqueWorkers}</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <p className="text-sm text-gray-800">Injured</p>
          <p className="mt-2 text-3xl font-bold">{injuredCount}</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <p className="text-sm text-gray-800">Still signed in</p>
          <p className="mt-2 text-3xl font-bold">{openCount}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Sign-Ins</h2>
        <p className="mt-2 text-gray-800">
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
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-collapse">
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