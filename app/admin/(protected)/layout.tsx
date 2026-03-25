import AdminNav from "@/app/admin/AdminNav";
import { getAdminProfile } from "@/lib/auth";
import Image from "next/image";
import Link from "next/link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await getAdminProfile();

  return (
    <main className="min-h-screen bg-gray-100">
      
      {/* HEADER */}
      <div className="border-b border-gray-200 bg-white print:hidden">
        <div className="app-container flex items-center justify-between px-4 py-3">

          {/* 🔥 LOGO (replaces text) */}
          <Link href="/" className="flex items-center">
            <Image
              src="/ICBILogo.png"
              alt="Ironwood Commercial Builders Inc."
              width={260}
              height={80}
              priority
              className="h-24 w-auto object-contain"
            />
          </Link>

          {/* NAV */}
          <AdminNav role={profile.role} />
        </div>
      </div>

      {/* PAGE CONTENT */}
      <div className="app-container space-y-6 p-6">
        {children}
      </div>
    </main>
  );
}