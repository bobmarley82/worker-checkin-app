const APP_TIME_ZONE = "America/Los_Angeles";

export function formatDate(dateString: string | null) {
  if (!dateString) return "-";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(new Date(dateString));
}

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



export function formatYmd(ymd: string | null) {
  if (!ymd) return "-";

  const [year, month, day] = ymd.split("-").map(Number);
  const localDate = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(localDate);
}

export function addDaysInLocalYmd(base: Date, days: number) {
  const shifted = new Date(base);
  shifted.setDate(shifted.getDate() + days);
  return toYmd(shifted);
}

export function getTodayYmd() {
  return toYmd(new Date());
}

export function getYesterdayYmd() {
  return addDaysInLocalYmd(new Date(), -1);
}

export function getLast7DaysStartYmd() {
  return addDaysInLocalYmd(new Date(), -6);
}

export function getLast30DaysStartYmd() {
  return addDaysInLocalYmd(new Date(), -29);
}