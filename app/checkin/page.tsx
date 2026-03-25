import Link from "next/link";
import Image from "next/image";
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
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow text-center">
        
        {/* Logo */}
        <div className="flex justify-center mb-4">
          <Image
            src="/ICBILogo.png"
            alt="Ironwood Commercial Builders Inc."
            width={300}
            height={120}
            className="h-auto w-[260px] object-contain"
            priority
          />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold">Worker Check-In</h1>
        <p className="mt-2 text-sm text-gray-600">
          Choose whether you want to sign in or sign out.
        </p>

        {/* Job status */}
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

        {/* Buttons */}
        <div className="mt-6 space-y-3">
          <Link
            href={jobId ? `/checkin/sign-in?job=${jobId}` : "/checkin/sign-in"}
            className="block w-full rounded-lg bg-green-600 px-4 py-3 text-white font-medium hover:opacity-90"
          >
            Sign In
          </Link>

          <Link
            href={jobId ? `/checkin/sign-out?job=${jobId}` : "/checkin/sign-out"}
            className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 font-medium hover:bg-gray-50"
          >
            Sign Out
          </Link>

          <Link
            href="/"
            className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 font-medium hover:bg-gray-50"
          >
            Go Back
          </Link>
        </div>
      </div>
    </main>
  );
}