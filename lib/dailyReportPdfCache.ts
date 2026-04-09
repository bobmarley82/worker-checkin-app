import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const DAILY_REPORT_PDF_BUCKET = "daily-report-pdfs";

export async function getCachedDailyReportPdf(path: string) {
  const supabaseAdmin = createAdminClient();
  const { data, error } = await supabaseAdmin.storage
    .from(DAILY_REPORT_PDF_BUCKET)
    .download(path);

  if (error || !data) {
    return null;
  }

  return data;
}

export async function cacheDailyReportPdf(path: string, pdfBuffer: Uint8Array) {
  const supabaseAdmin = createAdminClient();

  await supabaseAdmin.storage.from(DAILY_REPORT_PDF_BUCKET).upload(path, pdfBuffer, {
    contentType: "application/pdf",
    upsert: true,
  });
}
