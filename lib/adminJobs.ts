import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AdminRole } from "@/lib/auth";

type DatabaseClient = SupabaseClient<Database>;

export type AccessibleJob = {
  created_at: string;
  id: string;
  is_active: boolean;
  job_number: string | null;
  location_address: string | null;
  location_city: string | null;
  location_zip: string | null;
  name: string;
};

export async function getAccessibleJobsForAdmin(
  supabase: DatabaseClient,
  adminId: string,
  role: AdminRole,
  options?: {
    includeInactive?: boolean;
  }
) {
  const includeInactive = options?.includeInactive ?? false;

  if (role === "super_admin") {
    let query = supabase
      .from("jobs")
      .select(
        "id, name, job_number, location_address, location_city, location_zip, is_active, created_at"
      )
      .order("job_number", { ascending: true })
      .order("name", { ascending: true });

    if (!includeInactive) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;

    return {
      jobs: (data ?? []) as AccessibleJob[],
      error,
    };
  }

  let query = supabase
    .from("admin_job_assignments")
    .select(
      `
      job_id,
      jobs!inner (
        id,
        name,
        job_number,
        location_address,
        location_city,
        location_zip,
        is_active,
        created_at
      )
    `
    )
    .eq("admin_id", adminId);

  if (!includeInactive) {
    query = query.eq("jobs.is_active", true);
  }

  const { data, error } = await query;

  const jobs =
    (data ?? [])
      .map((row) => (Array.isArray(row.jobs) ? row.jobs[0] : row.jobs))
      .filter(
        (job): job is AccessibleJob =>
          Boolean(job) &&
          typeof job.id === "string" &&
          typeof job.name === "string"
      )
      .sort((a, b) => {
        const jobNumberCompare = (a.job_number ?? "").localeCompare(
          b.job_number ?? ""
        );

        return jobNumberCompare !== 0
          ? jobNumberCompare
          : a.name.localeCompare(b.name);
      }) ?? [];

  return { jobs, error };
}

export async function adminCanAccessJob(
  supabase: DatabaseClient,
  adminId: string,
  role: AdminRole,
  jobId: string
) {
  if (role === "super_admin") {
    return true;
  }

  const { data, error } = await supabase
    .from("admin_job_assignments")
    .select("job_id")
    .eq("admin_id", adminId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}
