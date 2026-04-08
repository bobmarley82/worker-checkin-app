"use client";

export default function PrintDailyReportButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-black px-4 py-2 text-white hover:opacity-90"
    >
      Print / Save PDF
    </button>
  );
}
