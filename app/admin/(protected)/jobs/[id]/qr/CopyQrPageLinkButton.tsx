"use client";

type CopyQrPageLinkButtonProps = {
  url: string;
};

export default function CopyQrPageLinkButton({
  url,
}: CopyQrPageLinkButtonProps) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      alert("Check-in link copied.");
    } catch {
      alert("Could not copy link.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
    >
      Copy Link
    </button>
  );
}