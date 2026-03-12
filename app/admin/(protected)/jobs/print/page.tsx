import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { QRCodeSVG } from "qrcode.react";
import PrintQrButton from "../[id]/qr/PrintQrButton";

type BulkPrintPageProps = {
  searchParams: Promise<{
    jobs?: string | string[];
  }>;
};

export default async function BulkJobQrPrintPage({
  searchParams,
}: BulkPrintPageProps) {
  await requireSuperAdmin();

  const query = await searchParams;
  const supabase = await createClient();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const selectedJobIds = Array.isArray(query.jobs)
    ? query.jobs
    : query.jobs
    ? [query.jobs]
    : [];

  const selectedJobs =
    selectedJobIds.length > 0
      ? jobs?.filter((job) => selectedJobIds.includes(job.id)) ?? []
      : jobs ?? [];

  return (
    <main className="min-h-screen bg-gray-50 p-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-5xl space-y-6 print:max-w-none print:space-y-0">
        <div className="rounded-2xl bg-white p-6 shadow print:hidden">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Bulk QR Print</h1>
              <p className="mt-2 text-gray-800">
                Print QR sheets for multiple jobs in one go.
              </p>
            </div>

            <div className="flex gap-3">
              <Link
                href="/admin/jobs"
                className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
              >
                Back to Jobs
              </Link>

              <PrintQrButton />
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow print:hidden">
          <h2 className="text-lg font-semibold">Select Jobs</h2>
          <p className="mt-2 text-gray-800">
            Choose specific jobs to print, or leave all unchecked to print all
            active jobs.
          </p>

          {error ? (
            <p className="mt-4 text-red-600">{error.message}</p>
          ) : !jobs || jobs.length === 0 ? (
            <p className="mt-4 text-gray-800">No active jobs found.</p>
          ) : (
            <form method="get" className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {jobs.map((job) => (
                  <label
                    key={job.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-300 px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      name="jobs"
                      value={job.id}
                      defaultChecked={selectedJobIds.includes(job.id)}
                    />
                    <span className="font-medium text-gray-900">{job.name}</span>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
                >
                  Apply Selection
                </button>

                <Link
                  href="/admin/jobs/print"
                  className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
                >
                  Print All Active Jobs
                </Link>
              </div>
            </form>
          )}
        </div>

        {selectedJobs.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 shadow print:hidden">
            <p className="text-gray-800">No jobs selected.</p>
          </div>
        ) : (
          <div className="space-y-8 print:space-y-0">
            {selectedJobs.map((job, index) => {
              const qrLink = `${appUrl}/checkin?job=${job.id}`;

              return (
                <section
                  key={job.id}
                  className={`mx-auto max-w-xl rounded-2xl bg-white p-8 shadow print:max-w-none print:rounded-none print:p-4 print:shadow-none ${
                    index > 0 ? "print:break-before-page" : ""
                  }`}
                >
                  <div className="text-center">
                    <h2 className="text-3xl font-bold print:text-2xl">
                      {job.name}
                    </h2>

                    <p className="mt-2 text-gray-800 print:mt-1 print:text-sm">
                      Scan to open worker check-in for this job
                    </p>

                    <div className="mt-8 flex justify-center print:mt-4">
                      <div className="rounded-2xl border border-gray-300 bg-white p-6 print:rounded-none print:border-none print:p-2">
                        <QRCodeSVG value={qrLink} size={260} />
                      </div>
                    </div>

                    <div className="mt-6 break-all text-sm text-gray-800 print:mt-3 print:text-xs">
                      {qrLink}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}