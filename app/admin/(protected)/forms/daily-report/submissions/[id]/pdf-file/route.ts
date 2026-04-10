import { createClient } from "@/lib/supabase/server";
import { adminCanAccessJob } from "@/lib/adminJobs";
import { getPdfBrowser } from "@/lib/pdfBrowser";
import {
  cacheDailyReportPdf,
  getCachedDailyReportPdf,
} from "@/lib/dailyReportPdfCache";
import { formatYmd } from "@/lib/datetime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_VALID_PDF_BYTES = 15 * 1024;
const PDF_CACHE_VERSION = "v2";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function sanitizeFilenamePart(value: string | null | undefined) {
  return (value ?? "report")
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function buildPdfResponse(
  file: Blob | Uint8Array<ArrayBufferLike>,
  fileName: string
) {
  const bytes =
    file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file;

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const supabase = await createClient();
  const requestUrl = new URL(request.url);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || (profile.role !== "super_admin" && profile.role !== "viewer_admin")) {
    return new Response("Forbidden", { status: 403 });
  }

  const { data: report, error } = await supabase
    .from("daily_reports")
    .select("id, job_id, job_number, job_name, report_date, admin_id, admin_name")
    .eq("id", id)
    .single();

  if (error || !report) {
    return new Response("Not found", { status: 404 });
  }

  const canAccess = await adminCanAccessJob(
    supabase,
    profile.id,
    profile.role,
    report.job_id
  );

  if (!canAccess && report.admin_id !== profile.id) {
    return new Response("Forbidden", { status: 403 });
  }

  const fileStem = [
    sanitizeFilenamePart(report.job_number || report.job_name),
    sanitizeFilenamePart(report.report_date),
    "daily-report",
  ]
    .filter(Boolean)
    .join("-");
  const fileName = `${fileStem || "daily-report"}.pdf`;
  const cachePath = `${report.id}-${PDF_CACHE_VERSION}.pdf`;

  const cachedPdf = await getCachedDailyReportPdf(cachePath);

  if (cachedPdf) {
    return buildPdfResponse(cachedPdf, fileName);
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || requestUrl.origin;
  const previewUrl = `${origin}/admin/forms/daily-report/submissions/${report.id}/pdf?download=1&v=${PDF_CACHE_VERSION}`;
  const cookieHeader = request.headers.get("cookie") ?? "";

  const browser = await getPdfBrowser();
  const page = await browser.newPage();

  try {
    if (cookieHeader) {
      await page.setExtraHTTPHeaders({
        cookie: cookieHeader,
      });
    }

    await page.setViewport({
      width: 1200,
      height: 1600,
      deviceScaleFactor: 1,
    });

    const response = await page.goto(previewUrl, {
      waitUntil: "domcontentloaded",
    });

    if (!response || !response.ok()) {
      return new Response("Could not load PDF preview.", { status: 502 });
    }

    await page.emulateMediaType("screen");
    await page.waitForSelector('[data-pdf-ready="true"]', { timeout: 15000 });
    await page.waitForFunction(
      ({ adminName, jobName, reportDateLabel }) => {
        const text = document.body.innerText || "";

        return (
          text.includes("Daily Report") &&
          text.includes(adminName) &&
          text.includes(jobName) &&
          text.includes(reportDateLabel)
        );
      },
      {
        timeout: 15000,
      },
      {
        adminName: report.admin_name ?? report.admin_id,
        jobName: report.job_name,
        reportDateLabel: formatYmd(report.report_date),
      }
    );

    const pdfBuffer = await page.pdf({
      format: "Letter",
      margin: {
        top: "0.35in",
        right: "0.35in",
        bottom: "0.35in",
        left: "0.35in",
      },
      printBackground: true,
    });

    if (pdfBuffer.byteLength < MIN_VALID_PDF_BYTES) {
      return new Response("Generated PDF looked incomplete. Please try again.", {
        status: 502,
      });
    }

    await cacheDailyReportPdf(cachePath, pdfBuffer);

    return buildPdfResponse(pdfBuffer, fileName);
  } finally {
    await page.close();
  }
}
