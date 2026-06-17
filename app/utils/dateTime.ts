export type DateValue = string | number | Date | null | undefined;

function toValidDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocaleDate(
  value: DateValue,
  options?: Intl.DateTimeFormatOptions,
  fallback = "—"
): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatLocaleDateTime(
  value: DateValue,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
  fallback = "—"
): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatLocaleMonthYear(value: DateValue, fallback = "—"): string {
  return formatLocaleDate(value, { month: "short", year: "numeric" }, fallback);
}
