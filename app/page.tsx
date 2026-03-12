import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow">
        <h1 className="text-3xl font-bold">Worker Check-In App</h1>
        <p className="mt-3 text-gray-600">
          Use the links below to access the worker check-in form and admin pages.
        </p>

        <div className="mt-8 space-y-4">
          <Link
            href="/checkin"
            className="block rounded-lg border border-gray-300 px-4 py-3 text-center font-medium hover:bg-gray-50"
          >
            Worker Check-In
          </Link>

          <Link
            href="/admin/records"
            className="block rounded-lg border border-gray-300 px-4 py-3 text-center font-medium hover:bg-gray-50"
          >
            Admin Records
          </Link>

          <Link
            href="/admin/jobs"
            className="block rounded-lg border border-gray-300 px-4 py-3 text-center font-medium hover:bg-gray-50"
          >
            Admin Jobs
          </Link>
        </div>
      </div>
    </main>
  );
}