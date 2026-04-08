import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignatureField from "../SignatureField";
import SubmitButton from "../SubmitButton";
import WorkerNameInput from "../WorkerNameInput";
import { toYmd } from "@/lib/datetime";
import { sendInjuryAlert } from "@/lib/sendInjuryAlert";
import GuardedForm from "../GuardedForm";
import {
  formatWorkerName,
  getWorkerBaseKey,
  normalizeWorkerLabel,
  normalizeWorkerNameKey,
  splitWorkerName,
} from "@/lib/workerName";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<{
    success?: string;
    worker_name?: string;
    worker_label?: string;
    job_name?: string;
    injured?: string;
    date?: string;
    job?: string;
    error?: string;
    same_name_conflict?: string;
    same_person?: string;
    collision_names?: string;
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

function buildSignInRedirect(params: {
  error?: string;
  jobId?: string;
  workerName?: string;
  workerLabel?: string;
  sameNameConflict?: boolean;
  samePerson?: string;
  collisionNames?: string[];
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

  if (params.workerLabel) {
    searchParams.set("worker_label", params.workerLabel);
  }

  if (params.sameNameConflict) {
    searchParams.set("same_name_conflict", "1");
  }

  if (params.samePerson) {
    searchParams.set("same_person", params.samePerson);
  }

  if (params.collisionNames?.length) {
    searchParams.set("collision_names", JSON.stringify(params.collisionNames));
  }

  const query = searchParams.toString();
  return query ? `/checkin/sign-in?${query}` : "/checkin/sign-in";
}

async function submitSignIn(formData: FormData) {
  "use server";

  const supabase = await createClient();

  const submittedWorkerName = String(formData.get("worker_name") ?? "");
  const workerIdentity = splitWorkerName(submittedWorkerName);
  const workerBaseName = workerIdentity.baseName;
  const promptWorkerLabel = normalizeWorkerLabel(
    String(formData.get("worker_label") ?? workerIdentity.workerLabel)
  );
  const displayWorkerName = formatWorkerName(workerBaseName, promptWorkerLabel);
  const samePerson = String(formData.get("same_person") ?? "")
    .trim()
    .toLowerCase();
  const jobId = String(formData.get("job_id") ?? "").trim();
  const injuredValue = String(formData.get("injured") ?? "false");
  const signatureData = String(formData.get("signature_data") ?? "").trim();
  const injured = injuredValue === "true";

  if (!workerBaseName) {
    redirect(
      buildSignInRedirect({
        error: "Worker name is required.",
        jobId,
      })
    );
  }

  if (!jobId) {
    redirect(
      buildSignInRedirect({
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
      buildSignInRedirect({
        error: "Selected job not found.",
        jobId,
      })
    );
  }

  if (!signatureData) {
    redirect(
      buildSignInRedirect({
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

  const sameNameOpenCheckins = Array.from(
    new Set(
      (openCheckins ?? [])
        .map((checkin) => checkin.worker_name)
        .filter((name): name is string => Boolean(name))
        .filter((name) => getWorkerBaseKey(name) === getWorkerBaseKey(workerBaseName))
    )
  );

  const exactOpenCheckin = sameNameOpenCheckins.find(
    (name) => normalizeWorkerNameKey(name) === normalizeWorkerNameKey(displayWorkerName)
  );

  if (exactOpenCheckin) {
    redirect(
      buildSignInRedirect({
        error: "You are already signed in for this job.",
        jobId,
        workerName: workerBaseName,
        sameNameConflict: sameNameOpenCheckins.length > 0,
        collisionNames: sameNameOpenCheckins,
      })
    );
  }

  if (sameNameOpenCheckins.length > 0 && !promptWorkerLabel) {
    if (samePerson !== "yes" && samePerson !== "no") {
      redirect(
        buildSignInRedirect({
          jobId,
          workerName: workerBaseName,
          sameNameConflict: true,
          collisionNames: sameNameOpenCheckins,
        })
      );
    }

    if (samePerson === "yes") {
      redirect(
        buildSignInRedirect({
          error: "You are already signed in for this job.",
          jobId,
          workerName: workerBaseName,
          sameNameConflict: true,
          samePerson,
          collisionNames: sameNameOpenCheckins,
        })
      );
    }

    redirect(
      buildSignInRedirect({
        error: "Enter Jr, Sr, or a short label so we can tell you apart.",
        jobId,
        workerName: workerBaseName,
        workerLabel: promptWorkerLabel,
        sameNameConflict: true,
        samePerson,
        collisionNames: sameNameOpenCheckins,
      })
    );
  }

  const now = new Date();
  const signedAt = now.toISOString();
  const today = toYmd(now);

  const { error } = await supabase.from("checkins").insert({
    worker_name: displayWorkerName,
    job_id: jobId,
    job_name: jobName,
    checkin_date: today,
    signed_at: signedAt,
    injured,
    signature_data: signatureData,
    auto_signed_out: false,
  });

  if (error) {
    redirect(
      buildSignInRedirect({
        error: error.message,
        jobId,
        workerName: workerBaseName,
        workerLabel: promptWorkerLabel,
      })
    );
  }

  if (injured) {
    await sendInjuryAlert({
      workerName: displayWorkerName,
      jobName: fullJobName,
      injured,
      actionType: "sign-in",
      timestamp: signedAt,
    });
  }

  await supabase.from("workers").upsert(
    {
      name: displayWorkerName,
      is_active: true,
    },
    { onConflict: "name" }
  );

  const params = new URLSearchParams({
    success: "1",
    worker_name: displayWorkerName,
    job_name: jobName,
    injured: injured ? "Yes" : "No",
    date: today,
    job: jobId,
  });

  redirect(`/checkin/sign-in?${params.toString()}`);
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const isSuccess = params.success === "1";
  const preselectedJobId = params.job ?? "";
  const workerNameDefault = params.worker_name ?? "";
  const workerLabelDefault = params.worker_label ?? "";
  const errorMessage = params.error ?? "";
  const sameNameConflict = params.same_name_conflict === "1";
  const samePersonDefault = params.same_person ?? "";
  const collisionNames = parseNameList(params.collision_names);

  if (isSuccess) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow">
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl">
              ✓
            </div>

            <h1 className="mt-4 text-2xl font-bold">You&#39;re Signed In</h1>

            <p className="mt-2 text-sm text-gray-800">
              Your sign-in was submitted successfully.
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
              className="block w-full rounded-lg bg-green-600 px-4 py-3 text-center text-white hover:bg-green-700"
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
        <h1 className="text-2xl font-bold">Worker Sign In</h1>
        <p className="mt-2 text-sm text-gray-800">
          Complete the form below to sign in for today.
        </p>

        {selectedJob ? (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
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
            id="sign-in-form"
            action={submitSignIn}
            className="mt-6 space-y-5"
            confirmOnInjured
          >
            <WorkerNameInput
              workers={workerNames}
              defaultValue={workerNameDefault}
            />

            {sameNameConflict ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-medium">
                  There is already a sign-in for this name on this job. Is that
                  you?
                </p>

                {collisionNames.length > 0 ? (
                  <p className="mt-2 text-amber-900">
                    Open right now: {collisionNames.join(", ")}
                  </p>
                ) : null}

                <div className="mt-3 flex gap-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="same_person"
                      value="yes"
                      defaultChecked={samePersonDefault === "yes"}
                    />
                    Yes
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="same_person"
                      value="no"
                      defaultChecked={samePersonDefault === "no"}
                    />
                    No
                  </label>
                </div>

                <div className="mt-4">
                  <label
                    htmlFor="worker_label"
                    className="block text-sm font-medium"
                  >
                    If not, add a short label
                  </label>
                  <input
                    id="worker_label"
                    name="worker_label"
                    type="text"
                    defaultValue={workerLabelDefault}
                    placeholder="Jr, Sr, Dad, Son"
                    maxLength={30}
                    className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 outline-none focus:border-amber-500"
                  />
                  <p className="mt-2 text-xs text-amber-900">
                    Only use this if you selected No.
                  </p>
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
                Sign inside the box below.
              </p>
              <div className="mt-2">
                <SignatureField inputName="signature_data" />
              </div>
            </div>

            <SubmitButton label="Sign-In" variant="checkin" />
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
