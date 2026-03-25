import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow text-center">
        
        {/* Logo */}
        <div className="flex justify-center">
          <Image
            src="/ICBILogo.png"
            alt="Ironwood Commercial Builders Inc."
            width={300}
            height={120}
            className="h-auto w-[260px] object-contain"
            priority
          />
        </div>

        {/* Title */}
        <h1 className="mt-6 text-2xl font-bold">ICBI Connect</h1>
        <p className="mt-2 text-sm text-gray-600">
          Select how you want to continue.
        </p>

        {/* Buttons */}
        <div className="mt-8 space-y-4">
          <Link
            href="/checkin"
            className="block w-full rounded-lg bg-green-600 px-4 py-3 text-white font-medium hover:opacity-90"
          >
            Worker Check-In
          </Link>

          <Link
            href="/admin/jobs"
            className="block w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 font-medium hover:bg-gray-50"
          >
            Admin Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}