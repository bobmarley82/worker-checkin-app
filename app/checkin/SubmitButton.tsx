"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  label?: string;
  variant?: "checkin" | "checkout";
};

export default function SubmitButton({
  label = "Submit Check-In",
  variant = "checkin",
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  const variantClasses =
    variant === "checkout"
      ? "bg-[linear-gradient(135deg,#9a3b32,#7d2b24)] shadow-[0_14px_24px_rgba(125,43,36,0.2)]"
      : "bg-[linear-gradient(135deg,#1d6b57,#154c41)] shadow-[0_14px_24px_rgba(21,76,65,0.18)]";

  return (
    <button
      type="submit"
      disabled={pending}
      className={`block w-full rounded-2xl border border-black/10 px-4 py-3 text-white font-semibold transition ${variantClasses} ${
        pending ? "opacity-70 cursor-not-allowed" : ""
      }`}
    >
      {pending ? `${label}...` : label}
    </button>
  );
}
