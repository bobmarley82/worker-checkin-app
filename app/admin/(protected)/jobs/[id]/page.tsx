import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin } from "@/lib/auth";


type JobDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    start_date?: string;
    end_date?: string;
  }>;
};

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString();
}

function formatDateTime(dateString: string | null) {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString();
}

function toYmd(date: Date) {
  return date.toISOString().split("T")[0];
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export default async function JobDetailPage({
  params,
  searchParams,
}: JobDetailPageProps) {
  const profile = await requireViewerAdmin();
  const { id } = await params;
  const query = await searchParams;

  const supabase = await createClient();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, name, is_active, created_at")
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

  const todayDate = new Date();
  const today = toYmd(todayDate);
  const yesterday = toYmd(addDays(todayDate, -1));
  const last7Start = toYmd(addDays(todayDate, -6));
  const last30Start = toYmd(addDays(todayDate, -29));

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

  const isSingleDay = normalizedStartDate === normalizedEndDate;

  return (
    <div className="space-y-6">


      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/admin/jobs"
              className="text-sm text-blue-600 underline"
            >
              Back to Jobs
            </Link>

            <h1 className="mt-3 text-2xl font-bold">{job.name}</h1>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                  job.is_active
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-200 text-gray-700"
                }`}
              >
                {job.is_active ? "Active" : "Inactive"}
              </span>

              <span className="text-sm text-gray-500">
                Created{" "}
                {job.created_at
                  ? new Date(job.created_at).toLocaleDateString()
                  : "-"}
              </span>
            </div>
          </div>

          <div className="min-w-[280px] space-y-3">
            <form method="get" className="space-y-3">
              <div>
                <label
                  htmlFor="start_date"
                  className="block text-sm font-medium text-gray-700"
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
                  className="block text-sm font-medium text-gray-700"
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

            <Link
              href={`/admin/jobs/${job.id}/export?start_date=${normalizedStartDate}&end_date=${normalizedEndDate}`}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
            >
              Export Excel
            </Link>
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
        <p className="mt-2 text-sm text-gray-600">
          {isSingleDay ? (
            <>
              Showing records for{" "}
              <span className="font-medium">
                {formatDate(normalizedStartDate)}
              </span>
              .
            </>
          ) : (
            <>
              Showing records from{" "}
              <span className="font-medium">
                {formatDate(normalizedStartDate)}
              </span>{" "}
              to{" "}
              <span className="font-medium">
                {formatDate(normalizedEndDate)}
              </span>
              .
            </>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-6 shadow">
          <p className="text-sm text-gray-600">Total sign-ins</p>
          <p className="mt-2 text-3xl font-bold">{totalForRange}</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <p className="text-sm text-gray-600">Unique workers</p>
          <p className="mt-2 text-3xl font-bold">{uniqueWorkers}</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow">
          <p className="text-sm text-gray-600">Injured</p>
          <p className="mt-2 text-3xl font-bold">{injuredCount}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Sign-Ins</h2>
        <p className="mt-2 text-sm text-gray-600">
          {isSingleDay ? (
            <>
              Showing records for <span className="font-medium">{job.name}</span>{" "}
              on{" "}
              <span className="font-medium">
                {formatDate(normalizedStartDate)}
              </span>
              .
            </>
          ) : (
            <>
              Showing records for <span className="font-medium">{job.name}</span>{" "}
              from{" "}
              <span className="font-medium">
                {formatDate(normalizedStartDate)}
              </span>{" "}
              to{" "}
              <span className="font-medium">
                {formatDate(normalizedEndDate)}
              </span>
              .
            </>
          )}
        </p>

        {checkinsError ? (
          <p className="mt-6 text-red-600">{checkinsError.message}</p>
        ) : !checkins || checkins.length === 0 ? (
          <p className="mt-6 text-gray-600">
            No sign-ins found for this date range.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                  <th className="px-4 py-3 font-semibold">Worker</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Injured</th>
                  <th className="px-4 py-3 font-semibold">Signed At</th>
                  <th className="px-4 py-3 font-semibold">Signed In</th>
                  <th className="px-4 py-3 font-semibold">Signed Out</th>
                  <th className="px-4 py-3 font-semibold">Signature</th>
                </tr>
              </thead>
              <tbody>
                {checkins.map((checkin) => (
                  <tr
                    key={checkin.id}
                    className="border-b border-gray-100 text-sm"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {checkin.worker_name}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {formatDate(checkin.checkin_date)}
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
                    <td className="px-4 py-3 text-gray-700">
                      {formatDateTime(checkin.signed_at)}
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