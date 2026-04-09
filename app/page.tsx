import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <main className="admin-shell flex min-h-screen items-center px-4 py-8 sm:px-6">
      <div className="app-container">
        <section className="admin-hero overflow-hidden p-6 sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div className="max-w-2xl">
              <div className="flex items-center">
                <Image
                  src="/ICBILogo.png"
                  alt="Ironwood Commercial Builders Inc."
                  width={320}
                  height={128}
                  className="h-auto w-[240px] object-contain sm:w-[280px]"
                  priority
                />
              </div>

              <p className="admin-kicker mt-6">Ironwood Commercial Builders</p>
              <h1 className="admin-title mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
                ICBI Connect
              </h1>
              <p className="admin-copy mt-4 max-w-xl text-base sm:text-lg">
                A cleaner way to handle worker sign-ins, job reporting, and field
                coordination from one place.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Link
                href="/checkin"
                className="admin-card group block p-6 transition hover:-translate-y-0.5"
              >
                <p className="admin-kicker">Field Access</p>
                <h2 className="admin-title mt-3 text-2xl font-semibold">
                  Worker Check-In
                </h2>
                <p className="admin-copy mt-3 text-sm sm:text-base">
                  Sign workers in or out quickly from a phone, tablet, or QR code.
                </p>
                <div className="mt-6">
                  <span className="admin-action-primary w-full sm:w-auto">
                    Open Worker Flow
                  </span>
                </div>
              </Link>

              <Link
                href="/admin/jobs"
                className="admin-card group block p-6 transition hover:-translate-y-0.5"
              >
                <p className="admin-kicker">Operations</p>
                <h2 className="admin-title mt-3 text-2xl font-semibold">
                  Admin Dashboard
                </h2>
                <p className="admin-copy mt-3 text-sm sm:text-base">
                  Manage jobs, records, daily reports, users, and field access.
                </p>
                <div className="mt-6">
                  <span className="admin-action-secondary w-full sm:w-auto">
                    Open Dashboard
                  </span>
                </div>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
