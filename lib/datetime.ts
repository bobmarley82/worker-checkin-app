const APP_TIME_ZONE = "America/Los_Angeles";

export function formatDateTime(dateString: string | null) {
  if (!dateString) return "-";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateString));
}

export function formatYmd(ymd: string | null) {
  if (!ymd) return "-";

  const [year, month, day] = ymd.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

export function toYmd(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export function getTodayYmd() {
  return toYmd(new Date());
}

export function getRelativeYmd(daysFromToday: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return toYmd(date);
}

export function getYesterdayYmd() {
  return getRelativeYmd(-1);
}

export function getLast7DaysStartYmd() {
  return getRelativeYmd(-6);
}

export function getLast30DaysStartYmd() {
  return getRelativeYmd(-29);
}