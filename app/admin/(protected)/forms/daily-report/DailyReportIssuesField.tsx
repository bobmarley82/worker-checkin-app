"use client";

import { useId, useState } from "react";

type DailyReportIssuesFieldProps = {
  inputName?: string;
};

type IssueRow = {
  id: number;
  value: string;
};

export default function DailyReportIssuesField({
  inputName = "issues_json",
}: DailyReportIssuesFieldProps) {
  const baseId = useId();
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [nextId, setNextId] = useState(1);

  function updateIssue(id: number, value: string) {
    setIssues((current) =>
      current.map((issue) => (issue.id === id ? { ...issue, value } : issue))
    );
  }

  function addIssue() {
    setIssues((current) => [...current, { id: nextId, value: "" }]);
    setNextId((current) => current + 1);
  }

  function removeIssue(id: number) {
    setIssues((current) => current.filter((issue) => issue.id !== id));
  }

  const normalizedIssues = issues
    .map((issue) => issue.value.trim())
    .filter(Boolean);

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">Issues</h3>
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
              Optional
            </span>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Add any issues, blockers, delays, or concerns from the day only if
            they need to be reported.
          </p>
        </div>

        <button
          type="button"
          onClick={addIssue}
          className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-100"
        >
          + Add Issue
        </button>
      </div>

      <input type="hidden" name={inputName} value={JSON.stringify(normalizedIssues)} />

      {issues.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-4 text-sm text-slate-500">
          No issues added.
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue, index) => (
            <div
              key={issue.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={`${baseId}-${issue.id}`}
                  className="text-sm font-semibold text-slate-900"
                >
                  Issue {index + 1}
                </label>

                <button
                  type="button"
                  onClick={() => removeIssue(issue.id)}
                  className="rounded-full px-3 py-1 text-sm font-medium text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                >
                  Remove
                </button>
              </div>

              <textarea
                id={`${baseId}-${issue.id}`}
                rows={3}
                value={issue.value}
                onChange={(event) => updateIssue(issue.id, event.target.value)}
                className="mt-3 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-slate-900 focus:bg-white"
                placeholder="Describe the issue."
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
