"use client";

import { useEffect } from "react";

type Props = {
  formId: string;
};

export default function InjurySubmitGuard({ formId }: Props) {
  useEffect(() => {
    const handler = (e: SubmitEvent) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.id !== formId) return;

      const injuredInput = form.querySelector(
        'input[name="injured"]:checked'
      ) as HTMLInputElement | null;

      const injuredValue = injuredInput?.value ?? "false";

      if (injuredValue === "true") {
        const confirmed = window.confirm(
          "Are you sure you want to report an injury?"
        );

        if (!confirmed) {
          e.preventDefault();
        }
      }
    };

    document.addEventListener("submit", handler);

    return () => {
      document.removeEventListener("submit", handler);
    };
  }, [formId]);

  return null;
}