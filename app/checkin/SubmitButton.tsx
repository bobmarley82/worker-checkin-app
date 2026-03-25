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

  const baseClasses =
    "block w-full rounded-lg px-4 py-3 text-white font-medium transition";

  const variantClasses =
    variant === "checkout"
      ? "bg-red-700 hover:bg-red-800"
      : "bg-green-600 hover:bg-green-700";

  return (
    <button
      type="submit"
      disabled={pending}
      className={`${baseClasses} ${variantClasses} ${
        pending ? "opacity-70 cursor-not-allowed" : ""
      }`}
    >
      {pending ? `${label}...` : label}
    </button>
  );
}