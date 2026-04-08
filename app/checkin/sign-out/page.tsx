import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import SubmitButton from "../SubmitButton";
import SignatureField from "../SignatureField";
import WorkerNameInput from "../WorkerNameInput";
import { toYmd } from "@/lib/datetime";
import { sendInjuryAlert } from "@/lib/sendInjuryAlert";
import GuardedForm from "../GuardedForm";
import {
  formatWorkerName,
  getWorkerBaseKey,
  normalizeWorkerNameKey,
  splitWorkerName,
} from "@/lib/workerName";

export const dynamic = "force-dynamic";

type SignOutPageProps = {
  searchParams: Promise<{
    success?: string;
    worker_name?: string;
    selected_worker_name?: string;
    candidate_names?: string;
    job_name?: string;
    injured?: string;
    date?: string;
    job?: string;
    error?: string;
  }>;
};

function parseNameList(value?: string) {
  if (!value) return [] as string[];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function buildSignOutRedirect(params: {
  error?: string;
  jobId?: string;
  workerName?: string;
  selectedWorkerName?: string;
  candidateNames?: string[];
}) {
  const searchParams = new URLSearchParams();

  if (params.error) {
    searchParams.set("error", params.error);
  }

  if (params.jobId) {
    searchParams.set("job", params.jobId);
  }

  if (params.workerName) {
    searchParams.set("worker_name", params.workerName);
  }

  if (params.selectedWorkerName) {
    searchParams.set("selected_worker_name", params.selectedWorkerName);
  }

  if (params.candidateNames?.length) {
    searchParams.set("candidate_names", JSON.stringify(params.candidateNames));
  }

  const query = searchParams.toString();
  return query ? `/checkin/sign-out?${query}` : "/checkin/sign-out";
}

async function submitSignOut(formData: FormData) {
  "use server";

  const supabase = await createClient();

  const submittedWorkerName = String(formData.get("worker_name") ?? "");
  const workerIdentity = splitWorkerName(submittedWorkerName);
  const workerBaseName = workerIdentity.baseName;
  const requestedWorkerName = formatWorkerName(
    workerBaseName,
    workerIdentity.workerLabel
  );
  const selectedWorkerName = String(formData.get("selected_worker_name") ?? "");
  const jobId = String(formData.get("job_id") ?? "").trim();
  const injuredValue = String(formData.get("injured") ?? "false");
  const signoutSignatureData = String(
    formData.get("signout_signature_data") ?? ""
  ).trim();
  const injured = injuredValue === "true";

  if (!workerBaseName) {
    redirect(
      buildSignOutRedirect({
        error: "Worker name is required.",
        jobId,
      })
    );
  }

  if (!jobId) {
    redirect(
      buildSignOutRedirect({
        error: "Job is required.",
      })
    );
  }

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("name, job_number")
    .eq("id", jobId)
    .single();

  if (jobError || !jobRow) {
    redirect(
      buildSignOutRedirect({
        error: "Selected job not found.",
        jobId,
      })
    );
  }

  if (!signoutSignatureData) {
    redirect(
      buildSignOutRedirect({
        error: "Signature is required.",
        jobId,
        workerName: workerBaseName,
      })
    );
  }

  const jobName = jobRow.name;
  const fullJobName = jobRow.job_number
    ? `${jobRow.job_number} - ${jobRow.name}`
    : jobRow.name;

  const { data: openCheckins } = await supabase
    .from("checkins")
    .select("worker_name")
    .eq("job_id", jobId)
    .is("signed_out_at", null);

  const sameNameCandidates = Array.from(
    new Set(
      (openCheckins ?? [])
        .map((checkin) => checkin.worker_name)
        .filter((name): name is string => Boolean(name))
        .filter((name) => getWorkerBaseKey(name) === getWorkerBaseKey(workerBaseName))
    )
  );

  let resolvedWorkerName = requestedWorkerName;

  const exactCandidate = sameNameCandidates.find(
    (name) => normalizeWorkerNameKey(name) === normalizeWorkerNameKey(requestedWorkerName)
  );

  if (exactCandidate) {
    resolvedWorkerName = exactCandidate;
  } else if (sameNameCandidates.length === 1) {
    resolvedWorkerName = sameNameCandidates[0];
  } else if (sameNameCandidates.length > 1) {
    const selectedCandidate = sameNameCandidates.find(
      (name) => normalizeWorkerNameKey(name) === normalizeWorkerNameKey(selectedWorkerName)
    );

    if (!selectedCandidate) {
      redirect(
        buildSignOutRedirect({
          error: "Choose which sign-in is yours from the list below.",
          jobId,
          workerName: workerBaseName,
          candidateNames: sameNameCandidates,
        })
      );
    }

    resolvedWorkerName = selectedCandidate;
  }

  const { error } = await supabase.rpc("sign_out_worker", {
    p_job_id: jobId,
    p_worker_name: resolvedWorkerName,
    p_injured: injured,
    p_signout_signature_data: signoutSignatureData,
  });

  if (error) {
    redirect(
      buildSignOutRedirect({
        error: error.message,
        jobId,
        workerName: workerBaseName,
      })
    );
  }

  if (injured) {
    await sendInjuryAlert({
      workerName: resolvedWorkerName,
      jobName: fullJobName,
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
    worker_name: resolvedWorkerName,
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
  const workerNameDefault = params.worker_name ?? "";
  const errorMessage = params.error ?? "";
  const candidateNames = parseNameList(params.candidate_names);
  const selectedWorkerNameDefault = params.selected_worker_name ?? "";

  if (isSuccess) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-2xl">
              ✓
            </div>

            <h1 className="mt-4 text-2xl font-bold">You&#39;re Signed Out</h1>

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
          <GuardedForm
            id="sign-out-form"
            action={submitSignOut}
            className="mt-6 space-y-5"
            confirmOnInjured
          >
            <WorkerNameInput
              workers={workerNames}
              defaultValue={workerNameDefault}
            />

            {candidateNames.length > 1 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-medium">
                  There are multiple open sign-ins for this name on this job.
                  Choose yours.
                </p>

                <div className="mt-3 space-y-2">
                  {candidateNames.map((candidate) => (
                    <label
                      key={candidate}
                      className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
                    >
                      <input
                        type="radio"
                        name="selected_worker_name"
                        value={candidate}
                        defaultChecked={selectedWorkerNameDefault === candidate}
                      />
                      <span>{candidate}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

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
          </GuardedForm>
        )}
      </div>
    </main>
  );
}
