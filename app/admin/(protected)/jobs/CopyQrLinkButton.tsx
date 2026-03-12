"use client";

type CopyQrLinkButtonProps = {
  url: string;
};

export default function CopyQrLinkButton({ url }: CopyQrLinkButtonProps) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      alert("Check-in link copied.");
    } catch {
      alert("Could not copy link.");
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
    >
      Copy Link
    </button>
  );
}