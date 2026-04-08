"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type AdminRole = "super_admin" | "viewer_admin";

type AdminNavProps = {
  role: AdminRole;
};

function isActivePath(pathname: string, href: string) {
  if (href === "/admin/logout") {
    return false;
  }

  if (href === "/admin/forms") {
    return pathname === href || pathname.startsWith("/admin/forms/");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminNav({ role }: AdminNavProps) {
  const pathname = usePathname();

  const navItems = [
    { href: "/admin/jobs", label: "Jobs" },
    { href: "/admin/records", label: "Records" },
    { href: "/admin/forms", label: "Forms" },
    ...(role === "super_admin"
      ? [{ href: "/admin/users", label: "Users" }]
      : []),
    { href: "/admin/account", label: "Account" },
    { href: "/admin/logout", label: "Logout" },
  ];

  return (
    <nav className="admin-nav text-sm font-medium">
      {navItems.map((item) => {
        const isActive = isActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-nav-link ${
              isActive ? "admin-nav-link-active" : ""
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
