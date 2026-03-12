import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { QRCodeSVG } from "qrcode.react";
import PrintQrButton from "./PrintQrButton";
import CopyQrPageLinkButton from "./CopyQrPageLinkButton";

type JobQrPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function JobQrPage({ params }: JobQrPageProps) {
  await requireSuperAdmin();

  const { id } = await params;
  const supabase = await createClient();

  const { data: job, error } = await supabase
    .from("jobs")
    .select("id, name, is_active")
    .eq("id", id)
    .single();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (error || !job) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow">
          <p className="text-red-600">Job not found.</p>
          <Link href="/admin/jobs" className="mt-4 inline-block">
            Back to Jobs
          </Link>
        </div>
      </main>
    );
  }

  const qrLink = `${appUrl}/checkin?job=${job.id}`;

  return (
    <main className="min-h-screen bg-gray-50 p-8 print:bg-white print:p-0">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] items-center justify-center print:min-h-0">
        <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow print:w-[7.5in] print:max-w-none print:rounded-none print:p-4 print:shadow-none">
          <div className="print:hidden">
            <Link href="/admin/jobs" className="inline-block">
              Back to Jobs
            </Link>
          </div>

          <div className="mt-4 text-center print:mt-0">
            <h1 className="text-3xl font-bold print:text-2xl">{job.name}</h1>
            <p className="mt-2 text-gray-700 print:mt-1 print:text-sm">
              Scan to open worker check-in for this job
            </p>

            <div className="mt-8 flex justify-center print:mt-4">
              <div className="rounded-2xl border border-gray-300 bg-white p-6 print:rounded-none print:border-none print:p-2">
                <QRCodeSVG value={qrLink} size={320} />
              </div>
            </div>

            <div className="mt-6 break-all text-sm text-gray-700 print:mt-3 print:text-xs">
              {qrLink}
            </div>

            <div className="mt-8 flex justify-center gap-3 print:hidden">
              <PrintQrButton />

              <a
                href={qrLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
              >
                Open Link
              </a>

              <CopyQrPageLinkButton url={qrLink} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}