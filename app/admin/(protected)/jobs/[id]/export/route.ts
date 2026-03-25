import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

import {
  formatYmd,
  formatDateTime,
  getTodayYmd,
  getYesterdayYmd,
  getLast7DaysStartYmd,
  getLast30DaysStartYmd,
} from "@/lib/datetime";

export async function GET(request: Request, context: RouteContext) {
  await requireViewerAdmin();

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);

  const startDate = searchParams.get("start_date") ?? "";
  const endDate = searchParams.get("end_date") ?? "";

  const supabase = await createClient();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, name")
    .eq("id", id)
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  let query = supabase
    .from("checkins")
    .select(`
      worker_name,
      checkin_date,
      injured,
      signed_at
    `)
    .eq("job_id", job.id)
    .order("checkin_date", { ascending: false })
    .order("signed_at", { ascending: false });

  if (startDate) {
    query = query.gte("checkin_date", startDate);
  }

  if (endDate) {
    query = query.lte("checkin_date", endDate);
  }

  const { data: checkins, error: checkinsError } = await query;

  if (checkinsError) {
    return NextResponse.json(
      { error: checkinsError.message },
      { status: 500 }
    );
  }

  const rows = (checkins ?? []).map((checkin) => ({
    "Worker Name": checkin.worker_name,
    "Job": job.name,
    "Check-In Date": formatYmd(checkin.checkin_date),
    "Signed At": formatDateTime(checkin.signed_at),
    "Injured": checkin.injured ? "Yes" : "No",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sign-Ins");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  const safeJobName = job.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const filename = `${safeJobName}_signins.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}