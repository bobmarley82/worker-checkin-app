import { formatDateTime } from "@/lib/datetime";

export type DailyReportWorkerSummary = {
  hours_worked: number;
  hours_worked_display: string;
  is_open: boolean;
  signed_in: string | null;
  signed_out: string | null;
  worker_name: string;
};

export type DailyReportIssue = string;
export type DailyReportSafetyAnswer = "yes" | "no" | "na";
export type DailyReportSafetyChecklist = {
  toolbox_talk_completed: DailyReportSafetyAnswer;
  incidents_near_misses: DailyReportSafetyAnswer;
  ppe_worn: DailyReportSafetyAnswer;
  housekeeping_performed: DailyReportSafetyAnswer;
};

export const DAILY_REPORT_SAFETY_FIELDS = [
  {
    key: "toolbox_talk_completed",
    label: "Toolbox Talk Completed?",
  },
  {
    key: "incidents_near_misses",
    label: "Incidents/Near Misses?",
  },
  {
    key: "ppe_worn",
    label: "PPE Worn?",
  },
  {
    key: "housekeeping_performed",
    label: "Housekeeping Performed?",
  },
] as const satisfies ReadonlyArray<{
  key: keyof DailyReportSafetyChecklist;
  label: string;
}>;

const DEFAULT_DAILY_REPORT_SAFETY_CHECKLIST: DailyReportSafetyChecklist = {
  toolbox_talk_completed: "na",
  incidents_near_misses: "na",
  ppe_worn: "na",
  housekeeping_performed: "na",
};

type CheckinRow = {
  signed_at: string | null;
  signed_out_at: string | null;
  worker_name: string;
};

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateWorkedHours(
  signedAt: string | null,
  signedOutAt: string | null
) {
  if (!signedAt) {
    return {
      hours: 0,
      isOpen: false,
    };
  }

  const start = new Date(signedAt);
  const end = signedOutAt ? new Date(signedOutAt) : new Date();
  const diffMs = end.getTime() - start.getTime();

  if (Number.isNaN(diffMs) || diffMs < 0) {
    return {
      hours: 0,
      isOpen: !signedOutAt,
    };
  }

  return {
    hours: roundHours(diffMs / (1000 * 60 * 60)),
    isOpen: !signedOutAt,
  };
}

export function buildDailyReportWorkerSummary(checkins: CheckinRow[]) {
  const summary = checkins
    .map((checkin) => {
      const result = calculateWorkedHours(
        checkin.signed_at,
        checkin.signed_out_at
      );

      return {
        worker_name: checkin.worker_name,
        signed_in: checkin.signed_at,
        signed_out: checkin.signed_out_at,
        hours_worked: result.hours,
        hours_worked_display: result.isOpen
          ? `${result.hours.toFixed(2)} hrs (Open)`
          : `${result.hours.toFixed(2)} hrs`,
        is_open: result.isOpen,
      };
    })
    .sort((a, b) => a.worker_name.localeCompare(b.worker_name));

  const totalHours = roundHours(
    summary.reduce((sum, worker) => sum + worker.hours_worked, 0)
  );

  return {
    summary,
    totalHours,
    workerCount: summary.length,
  };
}

export function parseDailyReportWorkerSummary(value: unknown) {
  if (!Array.isArray(value)) return [] as DailyReportWorkerSummary[];

  return value.filter((item): item is DailyReportWorkerSummary => {
    if (!item || typeof item !== "object") return false;

    const candidate = item as Record<string, unknown>;

    return (
      typeof candidate.worker_name === "string" &&
      typeof candidate.hours_worked === "number" &&
      typeof candidate.hours_worked_display === "string" &&
      typeof candidate.is_open === "boolean" &&
      (typeof candidate.signed_in === "string" || candidate.signed_in === null) &&
      (typeof candidate.signed_out === "string" || candidate.signed_out === null)
    );
  });
}

export function parsePhotoData(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];

  return value.filter((item): item is string => typeof item === "string");
}

export function parseDailyReportIssues(value: unknown) {
  if (!Array.isArray(value)) return [] as DailyReportIssue[];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSafetyAnswer(value: unknown): value is DailyReportSafetyAnswer {
  return value === "yes" || value === "no" || value === "na";
}

export function buildDailyReportSafetyChecklist(formData: FormData) {
  return DAILY_REPORT_SAFETY_FIELDS.reduce<DailyReportSafetyChecklist>(
    (acc, field) => {
      const rawValue = formData.get(field.key);
      acc[field.key] = isSafetyAnswer(rawValue) ? rawValue : "na";
      return acc;
    },
    { ...DEFAULT_DAILY_REPORT_SAFETY_CHECKLIST }
  );
}

export function parseDailyReportSafetyChecklist(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_DAILY_REPORT_SAFETY_CHECKLIST };
  }

  const candidate = value as Record<string, unknown>;

  return DAILY_REPORT_SAFETY_FIELDS.reduce<DailyReportSafetyChecklist>(
    (acc, field) => {
      const rawValue = candidate[field.key];
      acc[field.key] = isSafetyAnswer(rawValue) ? rawValue : "na";
      return acc;
    },
    { ...DEFAULT_DAILY_REPORT_SAFETY_CHECKLIST }
  );
}

export function formatDailyReportSafetyAnswer(value: DailyReportSafetyAnswer) {
  switch (value) {
    case "yes":
      return "Yes";
    case "no":
      return "No";
    default:
      return "N/A";
  }
}

export function formatWorkerSignedTime(value: string | null) {
  return value ? formatDateTime(value) : "-";
}
