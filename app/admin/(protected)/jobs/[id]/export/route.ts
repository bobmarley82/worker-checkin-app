import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { requireViewerAdmin } from "@/lib/auth";
import {
  formatYmd,
  formatDateTime,
  getTodayYmd,
} from "@/lib/datetime";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function autoFitColumns(rows: Record<string, unknown>[]) {
  if (!rows.length) return [];

  const headers = Object.keys(rows[0]);

  return headers.map((header) => {
    const longestCell = rows.reduce((max, row) => {
      const value = String(row[header] ?? "");
      return Math.max(max, value.length);
    }, header.length);

    return {
      wch: Math.min(longestCell + 2, 50),
    };
  });
}

function getHoursWorked(
  signedAt: string | null,
  signedOutAt: string | null
): string {
  if (!signedAt) return "";

  if (!signedOutAt) return "Still Signed In";

  const start = new Date(signedAt);
  const end = new Date(signedOutAt);

  const diffMs = end.getTime() - start.getTime();

  if (Number.isNaN(diffMs) || diffMs < 0) return "";

  const totalMinutes = Math.round(diffMs / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes}m`;
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

export async function GET(request: Request, context: RouteContext) {
  await requireViewerAdmin();

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);

  const startDate = searchParams.get("start_date")?.trim() ?? "";
  const endDate = searchParams.get("end_date")?.trim() ?? "";

  const supabase = await createClient();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, name, job_number")
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
      signed_at,
      signed_out_at,
      auto_signed_out,
      job_name,
      job_number
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

  const resolvedJobName = job.name;
  const resolvedJobNumber = job.job_number ?? "";
  const jobDisplay = resolvedJobNumber
    ? `${resolvedJobNumber} - ${resolvedJobName}`
    : resolvedJobName;

  const rows =
    (checkins ?? []).map((checkin) => ({
      "Worker Name": checkin.worker_name,
      "Job Number": resolvedJobNumber || checkin.job_number || "",
      "Job Name": resolvedJobName || checkin.job_name || "",
      Job: jobDisplay,
      "Check-In Date": formatYmd(checkin.checkin_date),
      "Signed In": formatDateTime(checkin.signed_at),
      "Signed Out": checkin.signed_out_at
        ? formatDateTime(checkin.signed_out_at)
        : "Open",
      "Hours Worked": getHoursWorked(checkin.signed_at, checkin.signed_out_at),
      Injured: checkin.injured ? "Yes" : "No",
      "Auto Signed Out": checkin.auto_signed_out ? "Yes" : "No",
    })) ?? [];

  const summaryRows = [
    {
      Field: "Export Generated",
      Value: formatDateTime(new Date().toISOString()),
    },
    {
      Field: "Job",
      Value: jobDisplay,
    },
    {
      Field: "Start Date",
      Value: startDate ? formatYmd(startDate) : "All",
    },
    {
      Field: "End Date",
      Value: endDate ? formatYmd(endDate) : "All",
    },
    {
      Field: "Total Records",
      Value: String(rows.length),
    },
  ];

  const workbook = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  const recordsSheet = XLSX.utils.json_to_sheet(rows);

  summarySheet["!cols"] = autoFitColumns(summaryRows);
  recordsSheet["!cols"] = autoFitColumns(rows);

  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, recordsSheet, "Sign-Ins");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  const today = getTodayYmd();
  const safeJobPart = safeFilePart(jobDisplay);
  const filename = `icbi_${safeJobPart}_${startDate || "all"}_to_${endDate || today}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}