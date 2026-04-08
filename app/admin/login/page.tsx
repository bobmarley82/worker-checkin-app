import LoginForm from "./LoginForm";

type AdminLoginPageProps = {
  searchParams: Promise<{
    password_reset?: string;
  }>;
};

export default async function AdminLoginPage({
  searchParams,
}: AdminLoginPageProps) {
  const query = await searchParams;
  const passwordReset = query.password_reset === "1";

  return (
    <main className="admin-shell flex min-h-screen items-center px-4 py-8 sm:px-6">
      <div className="admin-hero mx-auto w-full max-w-md p-6 sm:p-8">
        <p className="admin-kicker">ICBI Connect</p>
        <h1 className="admin-title mt-3 text-3xl font-bold">Admin Login</h1>
        <p className="admin-copy mt-3 text-sm sm:text-base">
          Sign in to access admin pages.
        </p>

        {passwordReset ? (
          <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Your password was updated. Sign in with the new password.
          </div>
        ) : null}

        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
