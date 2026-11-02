// Brazilian payroll calculators (simplified CLT). Values follow the last
// published official tables (INSS progressive 2025/2026 and IRRF monthly
// effective May/2025). Update only this file when the government publishes
// new brackets — nothing else hardcodes rates.

export const OVERTIME_MULTIPLIER = 1.5;
export const NIGHT_ADDITION_MULTIPLIER = 0.2;
export const FGTS_RATE = 0.08;
export const EMPLOYER_INSS_RATE = 0.2;

export const INSS_BRACKETS_2026: { upToCents: number; rate: number }[] = [
  { upToCents: 151800, rate: 0.075 },
  { upToCents: 279388, rate: 0.09 },
  { upToCents: 419083, rate: 0.12 },
  { upToCents: 815741, rate: 0.14 },
];

export const IRRF_BRACKETS_2026: {
  upToCents: number;
  rate: number;
  deductCents: number;
}[] = [
  { upToCents: 242880, rate: 0, deductCents: 0 },
  { upToCents: 282665, rate: 0.075, deductCents: 18216 },
  { upToCents: 375105, rate: 0.15, deductCents: 39416 },
  { upToCents: 466468, rate: 0.225, deductCents: 67549 },
  { upToCents: Number.MAX_SAFE_INTEGER, rate: 0.275, deductCents: 90873 },
];

export function round(cents: number) {
  return Math.round(cents);
}

export function calculateInss(cents: number): number {
  const remit = Math.max(0, cents);
  let remainder = remit;
  let total = 0;
  let previous = 0;
  for (const bracket of INSS_BRACKETS_2026) {
    if (remainder <= 0) break;
    const slice = Math.min(remainder, bracket.upToCents - previous);
    total += slice * bracket.rate;
    remainder -= slice;
    previous = bracket.upToCents;
  }
  return total;
}

export function inssEmployee(cents: number) {
  return round(calculateInss(cents));
}

export function fgts(cents: number) {
  return round(cents * FGTS_RATE);
}

export function employerInss(cents: number) {
  return round(cents * EMPLOYER_INSS_RATE);
}

export function calculateIrrf(baseCents: number): number {
  const value = Math.max(0, baseCents);
  for (const bracket of IRRF_BRACKETS_2026) {
    if (value <= bracket.upToCents) {
      return Math.max(0, value * bracket.rate - bracket.deductCents);
    }
  }
  return 0;
}

export function irrf(taxableBaseCents: number) {
  return round(calculateIrrf(taxableBaseCents));
}

export function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60; // overnight shift block
  return Math.max(0, diff);
}

export function scheduleMinutes(blocks: { start: string; end: string }[]) {
  return (blocks ?? []).reduce(
    (sum, block) => sum + minutesBetween(block.start, block.end),
    0
  );
}

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string) {
  let formatter = dayFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    dayFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

function partsToUtcWall(parts: Intl.DateTimeFormatPart[]) {
  const get = (type: string) =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  const day = get("day");
  const month = get("month");
  const year = get("year");
  let hour = get("hour");
  if (hour === 24) hour = 0;
  return Date.UTC(year, month - 1, day, hour, get("minute"), get("second"));
}

// Local wall-clock (inclusive of the day `${date}` within `timezone`), given
// as UTC epoch of the day, maps to the exact instant.
export function wallClockToInstant(
  utcDayStart: number,
  minutes: number,
  timezone: string
): Date {
  const formatter = formatterFor(timezone);
  const parts = formatter.formatToParts(new Date(utcDayStart));
  const get = (type: string) =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  let day = get("day");
  let month = get("month");
  let year = get("year");
  const addedHour = Math.floor(minutes / 60);
  const dayAdvance = (get("hour") === 24 ? 1 : 0) + Math.floor(addedHour / 24);
  const hour = addedHour % 24;
  const minute = minutes % 60;
  const result = new Date(
    Date.UTC(year, month - 1, day + dayAdvance, hour, minute, 0)
  );
  return result;
}

// Night premium window: 22:00 of a day through 05:00 of the next day, in the
// tenant timezone (DST-aware).
export function nightMinutesBetween(
  startedAt: Date,
  endedAt: Date,
  timezone: string
): number {
  const DAY = 86400000;
  let minutes = 0;
  const startFloor = Math.floor(startedAt.getTime() / DAY) * DAY;
  const endCeil = Math.ceil(endedAt.getTime() / DAY) * DAY;
  for (let day = startFloor - DAY; day <= endCeil; day += DAY) {
    const nightStart = wallClockToInstant(day, 22 * 60, timezone).getTime();
    const nightEnd = wallClockToInstant(day + DAY, 5 * 60, timezone).getTime();
    const lo = Math.max(startedAt.getTime(), nightStart);
    const hi = Math.min(endedAt.getTime(), nightEnd);
    if (hi > lo) minutes += Math.floor((hi - lo) / 60000);
  }
  return minutes;
}

export function hoursDecimal(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100;
}
