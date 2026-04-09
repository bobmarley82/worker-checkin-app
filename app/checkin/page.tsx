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
    <main className="worker-shell flex min-h-screen items-center px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-lg">
        <section className="worker-panel p-6 text-center sm:p-8">
          <div className="flex justify-center">
            <Image
              src="/ICBILogo.png"
              alt="Ironwood Commercial Builders Inc."
              width={280}
              height={112}
              className="h-auto w-[220px] object-contain sm:w-[250px]"
              priority
            />
          </div>

          <p className="admin-kicker mt-6">Worker Access</p>
          <h1 className="admin-title mt-3 text-3xl font-bold">Choose Your Action</h1>
          <p className="admin-copy mt-3 text-sm sm:text-base">
            Start by selecting whether you want to sign in or sign out.
          </p>

          {selectedJob ? (
            <div className="worker-status-success mt-5 rounded-2xl px-4 py-3 text-sm">
              Job selected from QR code:{" "}
              <span className="font-semibold">{selectedJob.name}</span>
            </div>
          ) : (
            <div className="worker-status-warning mt-5 rounded-2xl px-4 py-3 text-sm">
              No job was selected from a QR code. You can still continue and
              choose the job on the next screen.
            </div>
          )}

          <div className="mt-6 space-y-3">
            <Link
              href={jobId ? `/checkin/sign-in?job=${jobId}` : "/checkin/sign-in"}
              className="worker-action-primary"
            >
              Sign In
            </Link>

            <Link
              href={jobId ? `/checkin/sign-out?job=${jobId}` : "/checkin/sign-out"}
              className="worker-action-secondary"
            >
              Sign Out
            </Link>
          </div>

          <div className="mt-5 text-sm">
            <Link href="/" className="admin-subtle hover:text-slate-900">
              Back to Home
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
