import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { type AdminRole, getAdminRoleLabel, requireSuperAdmin } from "@/lib/auth";
import { formatDateTime, formatYmd } from "@/lib/datetime";

type AdminProfileDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

async function saveAssignedJobs(formData: FormData) {
  "use server";

  const currentProfile = await requireSuperAdmin();
  const admin = createAdminClient();

  const targetAdminId = String(formData.get("target_admin_id") ?? "").trim();

  if (!targetAdminId) {
    throw new Error("Missing admin ID.");
  }

  const { data: targetProfile, error: targetError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", targetAdminId)
    .single();

  if (targetError || !targetProfile) {
    throw new Error("Admin not found.");
  }

  if (targetProfile.role !== "viewer_admin") {
    throw new Error("Job assignments can only be changed for Field Supervisors.");
  }

  const selectedJobIds = Array.from(formData.getAll("job_ids"))
    .map((value) => String(value).trim())
    .filter(Boolean);

  const { error: deleteError } = await admin
    .from("admin_job_assignments")
    .delete()
    .eq("admin_id", targetAdminId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  if (selectedJobIds.length > 0) {
    const { error: insertError } = await admin
      .from("admin_job_assignments")
      .insert(
        selectedJobIds.map((jobId) => ({
          admin_id: targetAdminId,
          assigned_by: currentProfile.id,
          job_id: jobId,
        }))
      );

    if (insertError) {
      throw new Error(insertError.message);
    }
  }

  revalidatePath(`/admin/users/${targetAdminId}`);
  revalidatePath("/admin/users");
}

export default async function AdminProfileDetailPage({
  params,
}: AdminProfileDetailPageProps) {
  await requireSuperAdmin();
  const { id } = await params;
  const admin = createAdminClient();

  const [{ data: authUsersData, error: authUsersError }, { data: profile, error: profileError }, { data: jobs, error: jobsError }, { data: assignments, error: assignmentsError }, { data: reports, error: reportsError }] =
    await Promise.all([
      admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      }),
      admin
        .from("profiles")
        .select("id, full_name, role, is_active")
        .eq("id", id)
        .single(),
      admin
        .from("jobs")
        .select("id, name, job_number, is_active")
        .order("job_number", { ascending: true })
        .order("name", { ascending: true }),
      admin
        .from("admin_job_assignments")
        .select("job_id")
        .eq("admin_id", id),
      admin
        .from("daily_reports")
        .select(
          "id, job_id, job_number, job_name, report_date, worker_count_source, worker_count, total_hours, created_at"
        )
        .eq("admin_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (profileError || !profile) {
    notFound();
  }

  const authUser = authUsersData?.users.find((user) => user.id === profile.id);
  const selectedJobIds = new Set(assignments?.map((assignment) => assignment.job_id) ?? []);
  const activeJobs = (jobs ?? []).filter((job) => job.is_active);
  const assignedJobs = activeJobs.filter((job) => selectedJobIds.has(job.id));
  const pageError =
    authUsersError?.message ||
    jobsError?.message ||
    assignmentsError?.message ||
    reportsError?.message;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-6 shadow">
        <Link
          href="/admin/users"
          className="text-sm text-blue-600 hover:underline"
        >
          Back to Admin Users
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {profile.full_name ?? "Admin Profile"}
            </h1>
            <p className="mt-2 text-gray-800">{authUser?.email ?? "-"}</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800">
            <div>
              Role:{" "}
              <span className="font-medium capitalize">
                {getAdminRoleLabel(profile.role as AdminRole)}
              </span>
            </div>
            <div className="mt-1">
              Status:{" "}
              <span className="font-medium">
                {profile.is_active ? "Active" : "Disabled"}
              </span>
            </div>
            <div className="mt-1">
              Created:{" "}
              <span className="font-medium">
                {authUser?.created_at ? formatDateTime(authUser.created_at) : "-"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {pageError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      ) : null}

      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Assigned Jobs</h2>

        {profile.role !== "viewer_admin" ? (
          <p className="mt-4 text-gray-800">
            Office/Admin users can access all jobs and do not need job assignments.
          </p>
        ) : (
          <>
            <p className="mt-2 text-gray-800">
              Choose which jobs this Field Supervisor can use when filling out daily
              reports.
            </p>

            <form action={saveAssignedJobs} className="mt-6 space-y-4">
              <input type="hidden" name="target_admin_id" value={profile.id} />

              {activeJobs.length === 0 ? (
                <p className="text-gray-800">No active jobs found.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {activeJobs.map((job) => (
                    <label
                      key={job.id}
                      className="flex items-center gap-3 rounded-lg border border-gray-300 px-4 py-3"
                    >
                      <input
                        type="checkbox"
                        name="job_ids"
                        value={job.id}
                        defaultChecked={selectedJobIds.has(job.id)}
                      />
                      <span className="text-sm text-gray-900">
                        {job.job_number ? `${job.job_number} - ${job.name}` : job.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <button
                type="submit"
                className="rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
              >
                Save Assigned Jobs
              </button>
            </form>
          </>
        )}

        {profile.role === "viewer_admin" ? (
          <div className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Current Assignments
            </h3>

            {assignedJobs.length === 0 ? (
              <p className="mt-3 text-gray-800">No jobs assigned yet.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {assignedJobs.map((job) => (
                  <span
                    key={job.id}
                    className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700"
                  >
                    {job.job_number ? `${job.job_number} - ${job.name}` : job.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Submitted Reports</h2>
        <p className="mt-2 text-gray-800">
          Daily reports this admin has completed.
        </p>

        {!reports || reports.length === 0 ? (
          <p className="mt-4 text-gray-800">No reports submitted yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                  <th className="px-4 py-3 font-semibold">Job</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Mode</th>
                  <th className="px-4 py-3 font-semibold">Workers</th>
                  <th className="px-4 py-3 font-semibold">Hours</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id} className="border-b border-gray-100 text-sm">
                    <td className="px-4 py-3 text-gray-900">
                      {report.job_number
                        ? `${report.job_number} - ${report.job_name}`
                        : report.job_name}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      {formatYmd(report.report_date)}
                    </td>
                    <td className="px-4 py-3 text-gray-900 capitalize">
                      {report.worker_count_source}
                    </td>
                    <td className="px-4 py-3 text-gray-900">{report.worker_count}</td>
                    <td className="px-4 py-3 text-gray-900">
                      {report.total_hours.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      {formatDateTime(report.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/forms/daily-report/submissions/${report.id}`}
                        className="rounded-lg border border-gray-300 px-3 py-2 hover:bg-gray-50"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
