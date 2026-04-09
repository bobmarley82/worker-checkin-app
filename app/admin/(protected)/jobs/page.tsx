import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin, requireSuperAdmin } from "@/lib/auth";
import { getAccessibleJobsForAdmin } from "@/lib/adminJobs";

import AddJobForm from "./AddJobForm";
import CopyQrLinkButton from "./CopyQrLinkButton";

type JobFormState = {
  error?: string;
  success?: string;
} | null;

async function addJob(prevState: JobFormState, formData: FormData) {
  "use server";

  void prevState;

  await requireSuperAdmin();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const name = String(formData.get("name") ?? "").trim();
  const jobNumber = String(formData.get("job_number") ?? "").trim();

  if (!name) {
    return { error: "Job name is required." };
  }

  if (!jobNumber) {
    return { error: "Job number is required." };
  }

  const { data: existingName } = await supabase
    .from("jobs")
    .select("id")
    .ilike("name", name)
    .limit(1);

  if (existingName?.length) {
    return { error: "Job already exists." };
  }

  const { data: existingJobNumber } = await supabase
    .from("jobs")
    .select("id")
    .eq("job_number", jobNumber)
    .limit(1);

  if (existingJobNumber?.length) {
    return { error: "Job number already exists." };
  }

  const { error } = await supabase.from("jobs").insert({
    name,
    job_number: jobNumber,
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

  const { jobs, error } = await getAccessibleJobsForAdmin(
    supabase,
    profile.id,
    profile.role,
    { includeInactive: true }
  );
  const accessibleJobIds = jobs.map((job) => job.id);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const today = new Date().toLocaleDateString("en-CA");

  let todaysCheckinsQuery = supabase
    .from("checkins")
    .select("job_id")
    .eq("checkin_date", today);

  if (!isSuperAdmin) {
    todaysCheckinsQuery =
      accessibleJobIds.length > 0
        ? todaysCheckinsQuery.in("job_id", accessibleJobIds)
        : todaysCheckinsQuery.eq(
            "job_id",
            "00000000-0000-0000-0000-000000000000"
          );
  }

  const { data: todaysCheckins, error: todaysCheckinsError } =
    await todaysCheckinsQuery;

  const todayCountsByJob = (todaysCheckins ?? []).reduce<Record<string, number>>(
    (acc, checkin) => {
      acc[checkin.job_id] = (acc[checkin.job_id] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const activeJobs = (jobs ?? []).filter((job) => job.is_active);
  const jobsSortedByCreatedAt = [...jobs].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });
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
      {isSuperAdmin ? (
        <div className="admin-card p-6 sm:p-7">
          <p className="admin-kicker">Setup</p>
          <h2 className="admin-title mt-3 text-2xl font-semibold">Add Job</h2>
          <AddJobForm action={addJob} />
        </div>
      ) : null}

      {isSuperAdmin && (
        <div className="admin-card p-6 sm:p-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="admin-kicker">Utilities</p>
              <h2 className="admin-title mt-3 text-2xl font-semibold">QR Printing</h2>
              <p className="admin-copy mt-3">
                Print QR sheets for one job or multiple jobs at once.
              </p>
            </div>

            <Link
              href="/admin/jobs/print"
              className="admin-action-secondary"
            >
              Bulk Print QR Codes
            </Link>
          </div>
        </div>
      )}

      <div className="admin-hero p-6 sm:p-8">
        <p className="admin-kicker">Operations</p>
        <h1 className="admin-title mt-3 text-3xl font-bold">Jobs</h1>
        <p className="admin-copy mt-3 max-w-3xl text-sm sm:text-base">
          Track active jobs, launch check-in links, and jump into reporting
          quickly from one place.
        </p>
      </div>

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">Today&apos;s Activity</h2>
        <p className="admin-copy mt-2">
          Quick view of how many workers checked in today.
        </p>

        {todaysCheckinsError ? (
          <p className="mt-4 text-red-600">{todaysCheckinsError.message}</p>
        ) : (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="admin-stat-card p-4">
                <p className="admin-subtle text-sm">Total sign-ins today</p>
                <p className="mt-2 text-3xl font-bold">{totalTodayAcrossJobs}</p>
              </div>

              <div className="admin-stat-card p-4">
                <p className="admin-subtle text-sm">Active jobs</p>
                <p className="mt-2 text-3xl font-bold">{activeJobs.length}</p>
              </div>
            </div>

            {activeJobs.length === 0 ? (
              <p className="mt-6 text-gray-800">No active jobs found.</p>
            ) : (
              <div className="mt-6 hidden gap-3 sm:grid-cols-2 lg:grid">
                {jobsSortedByTodayActivity.map((job) => {
                  const todayCount = todayCountsByJob[job.id] ?? 0;

                  return (
                    <Link
                      key={job.id}
                      href={`/admin/jobs/${job.id}`}
                      className="admin-stat-card p-4 transition hover:-translate-y-0.5"
                    >
                      <p className="admin-subtle text-xs">
                        Job #{job.job_number ?? "-"}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-gray-900">
                        {job.name}
                      </p>
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

      <div className="admin-card p-6 sm:p-7">
        <h2 className="admin-title text-xl font-semibold">All Jobs</h2>

        {error ? (
          <p className="mt-4 text-red-600">{error.message}</p>
        ) : jobs.length === 0 ? (
          <p className="mt-4 text-gray-600">
            {isSuperAdmin
              ? "No jobs found."
              : "No jobs are assigned to you yet."}
          </p>
        ) : (
          <>
            <div className="mt-5 space-y-3 md:hidden">
              {jobsSortedByCreatedAt.map((job) => {
                const qrLink = `${appUrl}/checkin?job=${job.id}`;
                const reportHref = `/admin/forms/daily-report?job=${job.id}&date=${today}&mode=auto`;

                return (
                  <div key={job.id} className="admin-stat-card space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="admin-subtle text-xs">
                          Job #{job.job_number ?? "-"}
                        </p>
                        <Link
                          href={`/admin/jobs/${job.id}`}
                          className="mt-1 block text-lg font-semibold text-slate-900"
                        >
                          {job.name}
                        </Link>
                      </div>

                      <span
                        className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          job.is_active
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {job.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-600">
                      Created{" "}
                      <span className="font-medium text-slate-900">
                        {job.created_at
                          ? new Date(job.created_at).toLocaleDateString()
                          : "-"}
                      </span>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      {job.is_active ? (
                        <Link
                          href={reportHref}
                          className="admin-action-subtle w-full text-sm"
                        >
                          Create Report
                        </Link>
                      ) : (
                        <div className="rounded-full border border-dashed border-slate-200 px-4 py-3 text-center text-sm text-slate-400">
                          Report unavailable
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Link
                          href={`/admin/jobs/${job.id}/qr`}
                          className="admin-action-subtle flex-1 text-sm"
                        >
                          QR
                        </Link>

                        <div className="flex-1">
                          <CopyQrLinkButton url={qrLink} />
                        </div>
                      </div>
                    </div>

                    {isSuperAdmin ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {job.is_active ? (
                          <form action={deactivateJob} className="w-full">
                            <input type="hidden" name="job_id" value={job.id} />
                            <button
                              type="submit"
                              className="w-full rounded-full border border-yellow-400 px-3 py-2 text-sm text-yellow-700 hover:bg-yellow-50"
                            >
                              Deactivate
                            </button>
                          </form>
                        ) : (
                          <form action={reactivateJob} className="w-full">
                            <input type="hidden" name="job_id" value={job.id} />
                            <button
                              type="submit"
                              className="w-full rounded-full border border-green-400 px-3 py-2 text-sm text-green-700 hover:bg-green-50"
                            >
                              Reactivate
                            </button>
                          </form>
                        )}

                        <details className="relative">
                          <summary className="cursor-pointer rounded-full border border-red-400 px-3 py-2 text-center text-sm text-red-700 hover:bg-red-50">
                            Delete
                          </summary>

                          <form
                            action={deleteJob}
                            className="mt-2 space-y-2 rounded-xl border border-red-100 bg-white p-3 shadow"
                          >
                            <input type="hidden" name="job_id" value={job.id} />

                            <p className="text-sm text-slate-700">
                              Confirm password to delete job.
                            </p>

                            <input
                              type="password"
                              name="password"
                              placeholder="Admin password"
                              className="w-full rounded-lg border border-gray-300 px-3 py-2"
                              required
                            />

                            <button
                              type="submit"
                              className="w-full rounded-full bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700"
                            >
                              Confirm Delete
                            </button>
                          </form>
                        </details>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="admin-table-wrap mt-5 hidden md:block">
            <table className="admin-table min-w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                  <th className="px-4 py-3 font-semibold">Job #</th>
                  <th className="px-4 py-3 font-semibold">Job Name</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Daily Report</th>
                  <th className="px-4 py-3 font-semibold">QR</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  {isSuperAdmin ? (
                    <th className="px-4 py-3 font-semibold">Action</th>
                  ) : null}
                </tr>
              </thead>

              <tbody>
                {jobsSortedByCreatedAt.map((job) => {
                  const qrLink = `${appUrl}/checkin?job=${job.id}`;
                  const reportHref = `/admin/forms/daily-report?job=${job.id}&date=${today}&mode=auto`;

                  return (
                    <tr key={job.id} className="border-b border-gray-100 text-sm">
                      <td className="px-4 py-3 text-gray-900">
                        {job.job_number ?? "-"}
                      </td>

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
                        {job.is_active ? (
                          <Link
                            href={reportHref}
                            className="admin-action-subtle text-sm"
                          >
                            Create Report
                          </Link>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/jobs/${job.id}/qr`}
                            className="admin-action-subtle text-sm"
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
                                className="rounded-full border border-yellow-400 px-3 py-2 text-sm text-yellow-700 hover:bg-yellow-50"
                              >
                                Deactivate
                              </button>
                            </form>
                          ) : (
                            <form action={reactivateJob}>
                              <input type="hidden" name="job_id" value={job.id} />
                              <button
                                type="submit"
                                className="rounded-full border border-green-400 px-3 py-2 text-sm text-green-700 hover:bg-green-50"
                              >
                                Reactivate
                              </button>
                            </form>
                          )}

                          <details className="relative">
                            <summary className="cursor-pointer rounded-full border border-red-400 px-3 py-2 text-sm text-red-700 hover:bg-red-50">
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
          </>
        )}
      </div>
    </div>
  );
}
