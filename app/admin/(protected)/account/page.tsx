import PasswordUpdateForm from "@/app/admin/PasswordUpdateForm";
import { requireViewerAdmin } from "@/lib/auth";

export default async function AdminAccountPage() {
  const profile = await requireViewerAdmin();

  return (
    <div className="space-y-6">
      <div className="admin-hero p-6 sm:p-8">
        <p className="admin-kicker">Account</p>
        <h1 className="admin-title mt-3 text-3xl font-bold">Change Password</h1>
        <p className="admin-copy mt-3 max-w-2xl text-sm sm:text-base">
          Update the password for {profile.full_name ?? "your admin account"}.
        </p>
      </div>

      <div className="admin-card mx-auto max-w-2xl p-6 sm:p-7">
        <PasswordUpdateForm mode="account" />
      </div>
    </div>
  );
}
