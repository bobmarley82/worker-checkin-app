import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AdminRole = "super_admin" | "viewer_admin";

type AdminProfile = {
  id: string;
  full_name: string | null;
  role: AdminRole;
};

export async function getAdminProfile() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/admin/login");
  }

  const typedProfile = profile as AdminProfile;

  return { user, profile: typedProfile };
}

export async function requireViewerAdmin() {
  const { profile } = await getAdminProfile();

  if (
    profile.role !== "super_admin" &&
    profile.role !== "viewer_admin"
  ) {
    redirect("/admin/login");
  }

  return profile;
}

export async function requireSuperAdmin() {
  const { profile } = await getAdminProfile();

  if (profile.role !== "super_admin") {
    redirect("/admin/records");
  }

  return profile;
}