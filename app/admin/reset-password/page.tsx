import Link from "next/link";
import PasswordUpdateForm from "@/app/admin/PasswordUpdateForm";

export default function AdminResetPasswordPage() {
  return (
    <main className="admin-shell flex min-h-screen items-center px-4 py-8 sm:px-6">
      <div className="admin-hero mx-auto w-full max-w-md p-6 sm:p-8">
        <p className="admin-kicker">Password Recovery</p>
        <h1 className="admin-title mt-3 text-3xl font-bold">
          Set a New Password
        </h1>
        <p className="admin-copy mt-3 text-sm sm:text-base">
          Create a new password for your admin account using the email reset
          link.
        </p>

        <div className="mt-6">
          <PasswordUpdateForm mode="reset" />
        </div>

        <div className="mt-6">
          <Link href="/admin/login" className="admin-action-secondary w-full">
            Back to Login
          </Link>
        </div>
      </div>
    </main>
  );
}
