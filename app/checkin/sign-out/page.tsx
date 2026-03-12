import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SubmitButton from "../SubmitButton";
import SignatureField from "../SignatureField";
import WorkerNameInput from "../WorkerNameInput";
import { revalidatePath } from "next/cache";

type SignOutPageProps = {
  searchParams: Promise<{
    success?: string;
    worker_name?: string;
    job_name?: string;
    injured?: string;
    date?: string;
    job?: string;
    error?: string;
  }>;
};

function normalizeWorkerName(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeForMatch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function autoSignOutStaleCheckins() {
  const supabase = await createClient();

  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  const { data: staleRows } = await supabase
    .from("checkins")
    .select("id, signed_at")
    .is("signed_out_at", null)
    .lte("signed_at", cutoff);

  if (!staleRows?.length) return;

  for (const row of staleRows) {
    const signedAt = row.signed_at;
    if (!signedAt) continue;

    const autoOutAt = new Date(
      new Date(signedAt).getTime() + 12 * 60 * 60 * 1000
    ).toISOString();

    await supabase
      .from("checkins")
      .update({
        signed_out_at: autoOutAt,
        auto_signed_out: true,
      })
      .eq("id", row.id);
  }
}

async function submitSignOut(formData: FormData) {
  "use server";

  const supabase = await createClient();

  await autoSignOutStaleCheckins();

  const rawWorkerName = String(formData.get("worker_name") ?? "");
  const workerName = normalizeWorkerName(rawWorkerName);
  const workerNameForMatch = normalizeForMatch(rawWorkerName);

  const jobId = String(formData.get("job_id") ?? "").trim();
  const jobName = String(formData.get("job_name") ?? "").trim();
  const injuredValue = String(formData.get("injured") ?? "false");
  const signoutSignatureData = String(
    formData.get("signout_signature_data") ?? ""
  ).trim();
  const injured = injuredValue === "true";

  if (!workerName) {
    redirect(
      `/checkin/sign-out?error=${encodeURIComponent("Worker name is required.")}${
        jobId ? `&job=${encodeURIComponent(jobId)}` : ""
      }`
    );
  }

  if (!jobId) {
    redirect(
      `/checkin/sign-out?error=${encodeURIComponent("Job is required.")}`
    );
  }

  if (!signoutSignatureData) {
    redirect(
      `/checkin/sign-out?error=${encodeURIComponent(
        "Signature is required."
      )}&job=${encodeURIComponent(jobId)}`
    );
  }

  const { data: openCheckins, error: openCheckinsError } = await supabase
  .from("checkins")
  .select("id, worker_name, signed_at")
  .eq("job_id", jobId)
  .is("signed_out_at", null)
  .order("signed_at", { ascending: false });

if (openCheckinsError) {
  redirect(
    `/checkin/sign-out?error=${encodeURIComponent(
      openCheckinsError.message
    )}&job=${encodeURIComponent(jobId)}`
  );
}

const matchingOpenCheckins =
  openCheckins?.filter(
    (checkin) =>
      normalizeForMatch(checkin.worker_name ?? "") === workerNameForMatch
  ) ?? [];

if (matchingOpenCheckins.length === 0) {
  redirect(
    `/checkin/sign-out?error=${encodeURIComponent(
      "No active sign-in found for this worker on this job."
    )}&job=${encodeURIComponent(jobId)}`
  );
}

// Because results are already ordered newest first by signed_at,
// the first exact match is the newest open row for that worker/job.
const newestOpenCheckin = matchingOpenCheckins[0];

const signedOutAt = new Date().toISOString();

const { error } = await supabase
  .from("checkins")
  .update({
    signed_out_at: signedOutAt,
    injured,
    auto_signed_out: false,
    signout_signature_data: signoutSignatureData,
  })
  .eq("id", newestOpenCheckin.id)
  .is("signed_out_at", null);

if (error) {
  redirect(
    `/checkin/sign-out?error=${encodeURIComponent(error.message)}&job=${encodeURIComponent(
      jobId
    )}`
  );
}


// refresh admin pages
revalidatePath("/admin/records");
revalidatePath("/admin/jobs");

  const params = new URLSearchParams({
    success: "1",
    worker_name: workerName,
    job_name: jobName,
    injured: injured ? "Yes" : "No",
    date: signedOutAt,
    job: jobId,
  });

  redirect(`/checkin/sign-out?${params.toString()}`);
}

export default async function SignOutPage({ searchParams }: SignOutPageProps) {
  const params = await searchParams;
  const isSuccess = params.success === "1";
  const preselectedJobId = params.job ?? "";
  const errorMessage = params.error ?? "";

  if (isSuccess) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl">
              ✓
            </div>

            <h1 className="mt-4 text-2xl font-bold">You’re Signed Out</h1>

            <p className="mt-2 text-sm text-gray-800">
              Your sign-out was submitted successfully.
            </p>
          </div>

          <div className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
            <div>
              <span className="font-medium text-gray-900">Name:</span>{" "}
              <span className="text-gray-900">{params.worker_name ?? "-"}</span>
            </div>

            <div>
              <span className="font-medium text-gray-900">Job:</span>{" "}
              <span className="text-gray-900">{params.job_name ?? "-"}</span>
            </div>

            <div>
              <span className="font-medium text-gray-900">Injured:</span>{" "}
              <span className="text-gray-900">{params.injured ?? "-"}</span>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <Link
              href="/"
              className="block w-full rounded-lg bg-blue-600 px-4 py-3 text-center text-white hover:bg-blue-700"
            >
              Done
            </Link>

            <Link
              href={preselectedJobId ? `/checkin?job=${preselectedJobId}` : "/checkin"}
              className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-gray-900 hover:bg-gray-50"
            >
              Back
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const supabase = await createClient();

  const [{ data: jobs, error }, { data: workers }] = await Promise.all([
    supabase.from("jobs").select("id, name").eq("is_active", true).order("name"),
    supabase.from("workers").select("name").eq("is_active", true).order("name"),
  ]);

  const workerNames = workers?.map((worker) => worker.name) ?? [];
  const selectedJob =
    jobs?.find((job) => job.id === preselectedJobId) ?? null;

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold">Worker Sign Out</h1>
        <p className="mt-2 text-sm text-gray-800">
          Complete the form below to sign out.
        </p>

        {selectedJob ? (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Job selected from QR code:{" "}
            <span className="font-semibold">{selectedJob.name}</span>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 text-red-600">{error.message}</p>
        ) : (
          <form action={submitSignOut} className="mt-6 space-y-5">
            <WorkerNameInput workers={workerNames} />

            <div>
              <label htmlFor="job_id" className="block text-sm font-medium">
                Job
              </label>
              <select
                id="job_id"
                name="job_id"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                defaultValue={selectedJob?.id ?? ""}
                required
              >
                <option value="" disabled>
                  Select a job
                </option>
                {jobs?.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>

              <input
                type="hidden"
                name="job_name"
                id="job_name"
                defaultValue={selectedJob?.name ?? ""}
              />
            </div>

            <div>
              <span className="block text-sm font-medium">Are you injured?</span>
              <div className="mt-2 flex gap-6">
                <label className="flex items-center gap-2">
                  <input type="radio" name="injured" value="false" defaultChecked />
                  No
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="injured" value="true" />
                  Yes
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium">Signature</label>
              <p className="mt-1 text-sm text-gray-700">
                Sign inside the box below to confirm sign out.
              </p>
              <div className="mt-2">
                <SignatureField inputName="signout_signature_data" />
              </div>
            </div>

            <SubmitButton />
          </form>
        )}
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.addEventListener("change", function (e) {
              const target = e.target;
              if (target && target.id === "job_id") {
                const select = target;
                const hidden = document.getElementById("job_name");
                const selectedText = select.options[select.selectedIndex]?.text || "";
                if (hidden) hidden.value = selectedText;
              }
            });
          `,
        }}
      />
    </main>
  );
}