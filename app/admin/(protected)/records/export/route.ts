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

export async function GET(request: Request) {
  await requireViewerAdmin();

  const { searchParams } = new URL(request.url);

  const startDate = searchParams.get("start_date")?.trim() ?? "";
  const endDate = searchParams.get("end_date")?.trim() ?? "";
  const jobId = searchParams.get("job_id")?.trim() ?? "";
  const worker = searchParams.get("worker")?.trim() ?? "";

  const supabase = await createClient();

  let query = supabase
    .from("checkins")
    .select(`
      worker_name,
      job_id,
      job_name,
      job_number,
      checkin_date,
      injured,
      signed_at,
      signed_out_at,
      auto_signed_out,
      jobs (
        name,
        job_number
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
      const relatedJob = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;

      const resolvedJobName = relatedJob?.name ?? row.job_name ?? "";
      const resolvedJobNumber = relatedJob?.job_number ?? row.job_number ?? "";

      const jobDisplay = resolvedJobNumber
        ? `${resolvedJobNumber} - ${resolvedJobName}`
        : resolvedJobName;

      return {
        Worker: row.worker_name,
        "Job Number": resolvedJobNumber || "",
        "Job Name": resolvedJobName || "",
        Job: jobDisplay || "",
        "Check-In Date": formatYmd(row.checkin_date),
        "Signed In": formatDateTime(row.signed_at),
        "Signed Out": row.signed_out_at
          ? formatDateTime(row.signed_out_at)
          : "Open",
        "Hours Worked": getHoursWorked(row.signed_at, row.signed_out_at),
        Injured: row.injured ? "Yes" : "No",
        "Auto Signed Out": row.auto_signed_out ? "Yes" : "No",
      };
    }) ?? [];

  const summaryRows = [
    {
      Field: "Export Generated",
      Value: formatDateTime(new Date().toISOString()),
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
      Field: "Job Filter",
      Value: jobId || "All",
    },
    {
      Field: "Worker Filter",
      Value: worker || "All",
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
  XLSX.utils.book_append_sheet(workbook, recordsSheet, "Records");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });

  const today = getTodayYmd();
  const filenameParts = [
    "icbi_records",
    startDate || "all",
    "to",
    endDate || today,
  ];

  if (worker) {
    filenameParts.push("worker", safeFilePart(worker));
  }

  if (jobId) {
    filenameParts.push("job", safeFilePart(jobId));
  }

  const filename = `${filenameParts.join("_")}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}