import AdminNav from "@/app/admin/AdminNav";
import { getAdminProfile, getAdminRoleLabel } from "@/lib/auth";
import Image from "next/image";
import Link from "next/link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await getAdminProfile();

  return (
    <main className="admin-shell print:bg-white">
      <div className="admin-header print:hidden">
        <div className="app-container admin-header-inner">
          <Link href="/" className="admin-brand">
            <Image
              src="/ICBILogo.png"
              alt="Ironwood Commercial Builders Inc."
              width={260}
              height={80}
              priority
              className="h-16 w-auto object-contain sm:h-20"
            />
            <div className="admin-brand-copy hidden sm:block">
              <p className="admin-kicker">ICBI Connect</p>
              <p className="mt-1 text-sm">
                {getAdminRoleLabel(profile.role)} workspace
              </p>
            </div>
          </Link>

          <AdminNav role={profile.role} />
        </div>
      </div>

      <div className="app-container admin-page space-y-5 md:space-y-6">
        {children}
      </div>
    </main>
  );
}
