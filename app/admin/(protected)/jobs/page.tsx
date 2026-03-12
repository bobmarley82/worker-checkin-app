import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin, requireSuperAdmin } from "@/lib/auth";

import AddJobForm from "./AddJobForm";
import CopyQrLinkButton from "./CopyQrLinkButton";

async function addJob(prevState: any, formData: FormData) {
  "use server";

  await requireSuperAdmin();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Job name is required." };
  }

  const { data: existing } = await supabase
    .from("jobs")
    .select("id")
    .ilike("name", name)
    .limit(1);

  if (existing?.length) {
    return { error: "Job already exists." };
  }

  const { error } = await supabase.from("jobs").insert({
    name,
    is_active: true,
    created_by: user?.id,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/jobs");
  revalidatePath("/checkin");

  return { success: "Job added successfully." };
}

async function deactivateJob(formData: FormData) {
  "use server";

  await requireSuperAdmin();

  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "").trim();

  const { error } = await supabase
    .from("jobs")
    .update({ is_active: false })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/jobs");
  revalidatePath("/checkin");
}

async function reactivateJob(formData: FormData) {
  "use server";

  await requireSuperAdmin();

  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "").trim();

  const { error } = await supabase
    .from("jobs")
    .update({ is_active: true })
    .eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/jobs");
  revalidatePath("/checkin");
}

async function deleteJob(formData: FormData) {
  "use server";

  await requireSuperAdmin();

  const supabase = await createClient();

  const jobId = String(formData.get("job_id") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!password) {
    throw new Error("Password required.");
  }

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: user?.email ?? "",
    password,
  });

  if (authError) {
    throw new Error("Incorrect password.");
  }

  const { error } = await supabase.from("jobs").delete().eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/jobs");
  revalidatePath("/checkin");
}

export default async function AdminJobsPage() {
  const profile = await requireViewerAdmin();
  const isSuperAdmin = profile.role === "super_admin";

  const supabase = await createClient();

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, name, is_active, created_at")
    .order("created_at", { ascending: false });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const today = new Date().toISOString().split("T")[0];

  const { data: todaysCheckins, error: todaysCheckinsError } = await supabase
    .from("checkins")
    .select("job_id")
    .eq("checkin_date", today);

  const todayCountsByJob = (todaysCheckins ?? []).reduce<Record<string, number>>(
    (acc, checkin) => {
      acc[checkin.job_id] = (acc[checkin.job_id] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const activeJobs = (jobs ?? []).filter((job) => job.is_active);
  const totalTodayAcrossJobs = Object.values(todayCountsByJob).reduce(
    (sum, count) => sum + count,
    0
  );

  const jobsSortedByTodayActivity = [...activeJobs].sort((a, b) => {
    const aCount = todayCountsByJob[a.id] ?? 0;
    const bCount = todayCountsByJob[b.id] ?? 0;
    return bCount - aCount;
  });

  return (
    <div className="space-y-6">
{isSuperAdmin && (
  <div className="rounded-2xl bg-white p-6 shadow">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold">QR Printing</h2>
        <p className="mt-2 text-gray-800">
          Print QR sheets for one job or multiple jobs at once.
        </p>
      </div>

      <Link
        href="/admin/jobs/print"
        className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
      >
        Bulk Print QR Codes
      </Link>
    </div>
  </div>
)}

      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Today&apos;s Activity</h2>
        <p className="mt-2 text-gray-800">
          Quick view of how many workers checked in today.
        </p>

        {todaysCheckinsError ? (
          <p className="mt-4 text-red-600">{todaysCheckinsError.message}</p>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-800">Total sign-ins today</p>
                <p className="mt-2 text-3xl font-bold">{totalTodayAcrossJobs}</p>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm text-gray-800">Active jobs</p>
                <p className="mt-2 text-3xl font-bold">{activeJobs.length}</p>
              </div>
            </div>

            {activeJobs.length === 0 ? (
              <p className="mt-6 text-gray-800">No active jobs found.</p>
            ) : (
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {jobsSortedByTodayActivity.map((job) => {
                  const todayCount = todayCountsByJob[job.id] ?? 0;

                  return (
                    <Link
                      key={job.id}
                      href={`/admin/jobs/${job.id}`}
                      className="rounded-xl border border-gray-200 bg-gray-50 p-4 transition hover:bg-gray-100"
                    >
                      <p className="text-sm text-gray-800">{job.name}</p>
                      <p className="mt-1 text-2xl font-bold">{todayCount}</p>
                      <p className="mt-1 text-xs text-gray-700">
                        worker{todayCount === 1 ? "" : "s"} checked in today
                      </p>
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">All Jobs</h2>

        {error ? (
          <p className="mt-4 text-red-600">{error.message}</p>
        ) : !jobs || jobs.length === 0 ? (
          <p className="mt-4 text-gray-600">No jobs found.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                  <th className="px-4 py-3 font-semibold">Job Name</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">QR</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  {isSuperAdmin ? (
                    <th className="px-4 py-3 font-semibold">Action</th>
                  ) : null}
                </tr>
              </thead>

              <tbody>
                {jobs.map((job) => {
                  const qrLink = `${appUrl}/checkin?job=${job.id}`;

                  return (
                    <tr key={job.id} className="border-b border-gray-100 text-sm">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <Link
                          href={`/admin/jobs/${job.id}`}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {job.name}
                        </Link>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            job.is_active
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {job.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/jobs/${job.id}/qr`}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                          >
                            QR
                          </Link>

                          <CopyQrLinkButton url={qrLink} />
                        </div>
                      </td>

                      <td className="px-4 py-3 text-gray-700">
                        {job.created_at
                          ? new Date(job.created_at).toLocaleDateString()
                          : "-"}
                      </td>

                      {isSuperAdmin ? (
                        <td className="px-4 py-3 flex gap-2 flex-wrap">
                          {job.is_active ? (
                            <form action={deactivateJob}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-yellow-400 px-3 py-2 text-sm text-yellow-700 hover:bg-yellow-50"
                              >
                                Deactivate
                              </button>
                            </form>
                          ) : (
                            <form action={reactivateJob}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-green-400 px-3 py-2 text-sm text-green-700 hover:bg-green-50"
                              >
                                Reactivate
                              </button>
                            </form>
                          )}

                          <details className="relative">
                            <summary className="cursor-pointer rounded-lg border border-red-400 px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                              Delete
                            </summary>

                            <form
                              action={deleteJob}
                              className="absolute z-10 mt-2 w-64 rounded-lg border bg-white p-4 shadow"
                            >
                              <input type="hidden" name="job_id" value={job.id} />

                              <p className="mb-2 text-sm">
                                Confirm password to delete job.
                              </p>

                              <input
                                type="password"
                                name="password"
                                placeholder="Admin password"
                                className="mb-2 w-full rounded border px-2 py-1"
                                required
                              />

                              <button
                                type="submit"
                                className="w-full rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                              >
                                Confirm Delete
                              </button>
                            </form>
                          </details>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}