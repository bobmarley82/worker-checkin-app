import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin } from "@/lib/auth";

import {
  formatYmd,
  formatDateTime,
  getTodayYmd,
  getYesterdayYmd,
  getLast7DaysStartYmd,
  getLast30DaysStartYmd,
} from "@/lib/datetime";

export async function GET(request: Request) {
  await requireViewerAdmin();

  const { searchParams } = new URL(request.url);

  const startDate = searchParams.get("start_date") ?? "";
  const endDate = searchParams.get("end_date") ?? "";
  const jobId = searchParams.get("job_id") ?? "";
  const worker = searchParams.get("worker") ?? "";

  const supabase = await createClient();

  let query = supabase
    .from("checkins")
    .select(`
      worker_name,
      job_id,
      checkin_date,
      job_name,
      injured,
      signed_at,
      signed_out_at,
      auto_signed_out,
      jobs (
        name
      )
    `)
    .order("checkin_date", { ascending: false })
    .order("signed_at", { ascending: false });

  if (startDate) {
    query = query.gte("checkin_date", startDate);
  }

  if (endDate) {
    query = query.lte("checkin_date", endDate);
  }

  if (jobId) {
    query = query.eq("job_id", jobId);
  }

  if (worker) {
    query = query.ilike("worker_name", `%${worker}%`);
  }

  const { data: checkins, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows =
    checkins?.map((row) => {
      const relatedJobName = Array.isArray(row.jobs)
        ? row.jobs[0]?.name
        : row.jobs?.name;

      const jobName = relatedJobName ?? row.job_name ?? "";

      return {
        Worker: row.worker_name,
        Job: jobName,
        "Check-In Date": formatYmd(row.checkin_date),
        "Signed In": formatDateTime(row.signed_at),
        "Signed Out": row.signed_out_at
          ? formatDateTime(row.signed_out_at)
          : "Open",
        "Auto Signed Out": row.auto_signed_out ? "Yes" : "No",
        Injured: row.injured ? "Yes" : "No",
      };
    }) ?? [];

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Records");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="records_archive.xlsx"',
    },
  });
}