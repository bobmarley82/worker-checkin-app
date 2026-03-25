"use client";

import type { ReactNode } from "react";

type GuardedFormProps = {
  id: string;
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
  confirmOnInjured?: boolean;
  children: ReactNode;
};

export default function GuardedForm({
  id,
  action,
  className,
  confirmOnInjured = false,
  children,
}: GuardedFormProps) {
  return (
    <form
      id={id}
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!confirmOnInjured) return;

        const form = e.currentTarget;
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
            e.stopPropagation();
          }
        }
      }}
    >
      {children}
    </form>
  );
}