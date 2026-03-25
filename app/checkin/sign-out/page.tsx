
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import SubmitButton from "../SubmitButton";
import SignatureField from "../SignatureField";
import WorkerNameInput from "../WorkerNameInput";
import { toYmd } from "@/lib/datetime";
import { sendInjuryAlert } from "@/lib/sendInjuryAlert";
export const dynamic = "force-dynamic";

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

async function submitSignOut(formData: FormData) {
  "use server";

  const supabase = await createClient();

  const rawWorkerName = String(formData.get("worker_name") ?? "");
  const workerName = normalizeWorkerName(rawWorkerName);

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

  const { error } = await supabase.rpc("sign_out_worker", {
    p_job_id: jobId,
    p_worker_name: rawWorkerName,
    p_injured: injured,
    p_signout_signature_data: signoutSignatureData,
  });

  if (error) {
    redirect(
      `/checkin/sign-out?error=${encodeURIComponent(error.message)}&job=${encodeURIComponent(
        jobId
      )}`
    );
  }

  if (injured) {
  await sendInjuryAlert({
    workerName,
    jobName,
    injured,
    actionType: "sign-out",
    timestamp: new Date().toISOString(),
  });
}

  revalidatePath("/admin/records");
  revalidatePath("/admin/jobs");

  const now = new Date();

  const params = new URLSearchParams({
    success: "1",
    worker_name: workerName,
    job_name: jobName,
    injured: injured ? "Yes" : "No",
    date: toYmd(now),
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

            <div>
              <span className="font-medium text-gray-900">Date:</span>{" "}
              <span className="text-gray-900">{params.date ?? "-"}</span>
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
              href={
                preselectedJobId ? `/checkin?job=${preselectedJobId}` : "/checkin"
              }
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
    supabase
      .from("jobs")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("workers")
      .select("name")
      .eq("is_active", true)
      .order("name"),
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
          <form id="sign-out-form" action={submitSignOut} className="mt-6 space-y-5">
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

            <SubmitButton label="Sign-Out" variant="checkout" />

            <div className="mt-4">
              <Link
                href={preselectedJobId ? `/checkin?job=${preselectedJobId}` : "/checkin"}
                className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-center text-gray-900 hover:bg-gray-50"
              >
                Back
              </Link>
            </div>
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

      document.addEventListener("submit", function (e) {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (form.id !== "sign-out-form") return;

        const injuredInput = form.querySelector('input[name="injured"]:checked');
        const injuredValue = injuredInput ? injuredInput.value : "false";

        if (injuredValue === "true") {
          const confirmed = window.confirm(
            "Are you sure you want to report an injury?"
          );

          if (!confirmed) {
            e.preventDefault();
          }
        }
      });
    `,
  }}
/>