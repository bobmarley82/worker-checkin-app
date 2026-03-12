import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLogoutPage() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}