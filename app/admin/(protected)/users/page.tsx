import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth";
import AddAdminForm from "./AddAdminForm";

async function getSuperAdminCount() {
  const admin = createAdminClient();

  const { count, error } = await admin
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function isTargetLastActiveSuperAdmin(userId: string) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("profiles")
    .select("id, role, is_active")
    .eq("id", userId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  if (data.role !== "super_admin" || !data.is_active) {
    return false;
  }

  const superAdminCount = await getSuperAdminCount();
  return superAdminCount <= 1;
}

async function createAdmin(prevState: any, formData: FormData) {
  "use server";

  await requireSuperAdmin();

  const admin = createAdminClient();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();

  if (!email || !fullName || !password) {
    return { error: "All fields are required." };
  }

  if (role !== "super_admin" && role !== "viewer_admin") {
    return { error: "Invalid role." };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    return { error: error?.message ?? "Could not create admin user." };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    full_name: fullName,
    role,
    is_active: true,
  });

  if (profileError) {
    return { error: profileError.message };
  }

  revalidatePath("/admin/users");
  return { success: "Admin created successfully." };
}

async function changeAdminRole(formData: FormData) {
  "use server";

  const currentProfile = await requireSuperAdmin();
  const admin = createAdminClient();

  const userId = String(formData.get("user_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();

  if (!userId) {
    throw new Error("Missing user ID.");
  }

  if (role !== "super_admin" && role !== "viewer_admin") {
    throw new Error("Invalid role.");
  }

  if (currentProfile.id === userId && role !== "super_admin") {
    throw new Error("You cannot remove your own super admin role.");
  }

  if (role !== "super_admin" && (await isTargetLastActiveSuperAdmin(userId))) {
    throw new Error("There must always be at least one active super admin.");
  }

  const { error } = await admin
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/admin/users");
}

async function disableAdmin(formData: FormData) {
  "use server";

  const currentProfile = await requireSuperAdmin();
  const admin = createAdminClient();

  const userId = String(formData.get("user_id") ?? "").trim();

  if (!userId) {
    throw new Error("Missing user ID.");
  }

  if (currentProfile.id === userId) {
    throw new Error("You cannot disable your own account.");
  }

  if (await isTargetLastActiveSuperAdmin(userId)) {
    throw new Error("There must always be at least one active super admin.");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ is_active: false })
    .eq("id", userId);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "876000h",
  });

  if (authError) {
    throw new Error(authError.message);
  }

  revalidatePath("/admin/users");
}

async function reactivateAdmin(formData: FormData) {
  "use server";

  await requireSuperAdmin();

  const admin = createAdminClient();
  const userId = String(formData.get("user_id") ?? "").trim();

  if (!userId) {
    throw new Error("Missing user ID.");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ is_active: true })
    .eq("id", userId);

  if (profileError) {
    throw new Error(profileError.message);
  }

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });

  if (authError) {
    throw new Error(authError.message);
  }

  revalidatePath("/admin/users");
}

export default async function AdminUsersPage() {
  const profile = await requireSuperAdmin();
  const admin = createAdminClient();

  const { data: authUsersData, error: authUsersError } =
    await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, full_name, role, is_active")
    .in("role", ["super_admin", "viewer_admin"])
    .order("full_name");

  const authUsers = authUsersData?.users ?? [];

  const mergedAdmins =
    profiles?.map((p) => {
      const authUser = authUsers.find((u) => u.id === p.id);

      const isLastActiveSuperAdmin =
        p.role === "super_admin" &&
        p.is_active &&
        profiles.filter(
          (x) => x.role === "super_admin" && x.is_active
        ).length === 1;

      return {
        id: p.id,
        full_name: p.full_name,
        role: p.role,
        is_active: p.is_active,
        email: authUser?.email ?? "-",
        created_at: authUser?.created_at ?? null,
        isLastActiveSuperAdmin,
      };
    }) ?? [];

  const errorMessage = authUsersError?.message || profilesError?.message;

  return (
    <div className="space-y-6">


      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Create Admin</h2>
        <AddAdminForm action={createAdmin} />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow">
        <h2 className="text-lg font-semibold">Admin Users</h2>
        <p className="mt-2 text-sm text-gray-600">
          Super admins can manage other admins. Disabled admins can be reactivated.
        The last active super admin cannot be demoted or disabled.
        </p>

        {errorMessage ? (
          <p className="mt-4 text-red-600">{errorMessage}</p>
        ) : mergedAdmins.length === 0 ? (
          <p className="mt-4 text-gray-600">No admin users found.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-700">
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {mergedAdmins.map((adminUser) => {
                  const isSelf = adminUser.id === profile.id;
                  const canChangeRole =
                    adminUser.is_active &&
                    !isSelf &&
                    !adminUser.isLastActiveSuperAdmin;

                  const canDisable =
                    adminUser.is_active &&
                    !isSelf &&
                    !adminUser.isLastActiveSuperAdmin;

                  const canReactivate = !adminUser.is_active;

                  return (
                    <tr key={adminUser.id} className="border-b border-gray-100 text-sm">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {adminUser.full_name ?? "-"}
                      </td>

                      <td className="px-4 py-3 text-gray-700">
                        {adminUser.email}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            adminUser.role === "super_admin"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {adminUser.role === "super_admin"
                            ? "Super Admin"
                            : "Viewer Admin"}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                            adminUser.is_active
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {adminUser.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {canChangeRole ? (
                            <form action={changeAdminRole}>
                              <input type="hidden" name="user_id" value={adminUser.id} />
                              <input
                                type="hidden"
                                name="role"
                                value={
                                  adminUser.role === "super_admin"
                                    ? "viewer_admin"
                                    : "super_admin"
                                }
                              />
                              <button
                                type="submit"
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                              >
                                Make{" "}
                                {adminUser.role === "super_admin"
                                  ? "Viewer"
                                  : "Super"}
                              </button>
                            </form>
                          ) : (
                            <span className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-400">
                              {!adminUser.is_active
                                ? "Role locked"
                                : isSelf
                                ? "Cannot change own role"
                                : adminUser.isLastActiveSuperAdmin
                                ? "Last super admin"
                                : "Role locked"}
                            </span>
                          )}

                          {canDisable ? (
                            <form action={disableAdmin}>
                              <input type="hidden" name="user_id" value={adminUser.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                              >
                                Disable
                              </button>
                            </form>
                          ) : canReactivate ? (
                            <form action={reactivateAdmin}>
                              <input type="hidden" name="user_id" value={adminUser.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-green-300 px-3 py-2 text-sm text-green-700 hover:bg-green-50"
                              >
                                Reactivate
                              </button>
                            </form>
                          ) : (
                            <span className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-400">
                              {isSelf
                                ? "Cannot disable self"
                                : adminUser.isLastActiveSuperAdmin
                                ? "Last super admin"
                                : "Disable locked"}
                            </span>
                          )}
                        </div>
                      </td>
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