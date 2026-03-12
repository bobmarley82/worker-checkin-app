"use client";

import { QRCodeSVG } from "qrcode.react";

type JobQrCodeProps = {
  url: string;
  jobName: string;
};

export default function JobQrCode({ url, jobName }: JobQrCodeProps) {
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      alert("QR link copied.");
    } catch {
      alert("Could not copy link.");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <p className="mb-3 text-sm font-medium text-gray-800">{jobName}</p>

      <div className="flex justify-center rounded-lg bg-white p-3">
        <QRCodeSVG value={url} size={140} />
      </div>

      <div className="mt-3 space-y-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-lg border border-gray-300 px-3 py-2 text-center text-sm hover:bg-gray-100"
        >
          Open Check-In Link
        </a>

        <button
          type="button"
          onClick={copyLink}
          className="block w-full rounded-lg bg-black px-3 py-2 text-sm text-white hover:opacity-90"
        >
          Copy Link
        </button>
      </div>
    </div>
  );
}