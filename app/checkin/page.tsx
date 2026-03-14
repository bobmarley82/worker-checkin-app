import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type CheckinChoicePageProps = {
  searchParams: Promise<{
    job?: string;
  }>;
};

export default async function CheckinChoicePage({
  searchParams,
}: CheckinChoicePageProps) {
  const params = await searchParams;
  const jobId = params.job?.trim() ?? "";

  const supabase = await createClient();

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  const selectedJob = jobs?.find((job) => job.id === jobId) ?? null;

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold">Worker Check-In</h1>
        <p className="mt-2 text-sm text-gray-800">
          Choose whether you want to sign in or sign out.
        </p>

        {selectedJob ? (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Job selected from QR code:{" "}
            <span className="font-semibold">{selectedJob.name}</span>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            No job was selected from a QR code.
          </div>
        )}

        <div className="mt-6 space-y-3">
          <Link
            href={jobId ? `/checkin/sign-in?job=${jobId}` : "/checkin/sign-in"}
            className="block w-full rounded-lg bg-green-300 border px-4 py-3 text-center text-white hover:opacity-90"
          >
            Sign In
          </Link>

          <Link
            href={jobId ? `/checkin/sign-out?job=${jobId}` : "/checkin/sign-out"}
            className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-gray-900 hover:bg-gray-50"
          >
            Sign Out
          </Link>

          <Link
            href="/"
            className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-gray-900 hover:bg-gray-50"
          >
            Go Back
          </Link>
        </div>
      </div>
    </main>
  );
}