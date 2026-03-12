import AdminNav from "@/app/admin/AdminNav";
import { getAdminProfile } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await getAdminProfile();

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="border-b border-gray-200 bg-white print:hidden">
        <div className="app-container flex items-center justify-between p-4">
          <div className="text-lg font-semibold">Worker Check-In Admin</div>
          <AdminNav role={profile.role} />
        </div>
      </div>

      <div className="app-container space-y-6 p-6">{children}</div>
    </main>
  );
}