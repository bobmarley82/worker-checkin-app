import Link from "next/link";

export type AdminRole = "super_admin" | "viewer_admin";

type AdminNavProps = {
  role: AdminRole;
};

export default function AdminNav({ role }: AdminNavProps) {
  return (
    <nav className="flex items-center gap-6 text-sm font-medium">
      <Link
        href="/admin/jobs"
        className="rounded-md px-3 py-2 text-gray-900 transition hover:bg-gray-100"
      >
        Jobs
      </Link>

      <Link
        href="/admin/records"
        className="rounded-md px-3 py-2 text-gray-900 transition hover:bg-gray-100"
      >
        Records
      </Link>

      {role === "super_admin" && (
        <Link
          href="/admin/users"
          className="rounded-md px-3 py-2 text-gray-900 transition hover:bg-gray-100"
        >
          Users
        </Link>
      )}

      <Link
        href="/admin/logout"
        className="rounded-md px-3 py-2 text-gray-900 transition hover:bg-gray-100"
      >
        Logout
      </Link>
    </nav>
  );
}