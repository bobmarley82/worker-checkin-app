"use client";

type DownloadPdfButtonProps = {
  href: string;
  className?: string;
};

export default function DownloadPdfButton({
  href,
  className,
}: DownloadPdfButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        const url = new URL(href, window.location.origin);
        url.searchParams.set("download", Date.now().toString());
        window.location.assign(url.toString());
      }}
      className={className}
    >
      Download PDF
    </button>
  );
}
