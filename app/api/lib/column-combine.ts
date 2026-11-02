import { ACARSH_FIELDS, type AcarshField } from "@/app/api/ai/assistant/lead-import/mapping";

export const COMBINEABLE_FIELDS = [
  "contactName",
  "companyName",
  "companyLocation",
  "contactTitle",
  "contactLocation",
  "contactNotes",
  "leadNotes",
  "industryFocus",
] as const;

export type CombineableField = (typeof COMBINEABLE_FIELDS)[number];

export type ColumnCombineSpec = {
  kind: "combine";
  field: CombineableField;
  order: number;
};

export function isCombineableField(value: unknown): value is CombineableField {
  return typeof value === "string" && (COMBINEABLE_FIELDS as readonly string[]).includes(value);
}

export function isColumnCombineSpec(value: unknown): value is ColumnCombineSpec {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as ColumnCombineSpec).kind === "combine" &&
      isCombineableField((value as ColumnCombineSpec).field) &&
      Number.isFinite(Number((value as ColumnCombineSpec).order)),
  );
}

function cellText(value: unknown) {
  if (value == null) return "";
  const text = String(value).replace(/\u0000/g, "").trim();
  if (!text || text === "null" || text === "undefined") return "";
  return text;
}

export function combineColumnValues(parts: unknown[]) {
  return parts
    .map((part) => cellText(part))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function combinePartsForField(
  mapping: Record<string, unknown> | null | undefined,
  field: AcarshField,
): Array<{ column: string; order: number }> {
  const parts: Array<{ column: string; order: number }> = [];
  for (const [column, value] of Object.entries(mapping || {})) {
    if (isColumnCombineSpec(value) && value.field === field) {
      parts.push({ column, order: Number(value.order) || 0 });
    } else if (value === field) {
      parts.push({ column, order: parts.length });
    }
  }
  return parts.sort((a, b) => a.order - b.order || a.column.localeCompare(b.column));
}

export function combinedMappedValue(
  row: Record<string, string>,
  mapping: Record<string, unknown> | null | undefined,
  field: AcarshField,
) {
  const parts = combinePartsForField(mapping, field);
  if (!parts.length) return "";
  return combineColumnValues(parts.map((part) => row[part.column]));
}

export function normalizeCombineMapping(mapping: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...mapping };
  for (const field of COMBINEABLE_FIELDS) {
    const parts = combinePartsForField(next, field);
    if (parts.length <= 1) {
      if (parts.length === 1 && isColumnCombineSpec(next[parts[0].column])) {
        next[parts[0].column] = field;
      }
      continue;
    }
    parts.forEach((part, index) => {
      next[part.column] = { kind: "combine", field, order: index };
    });
  }
  return next;
}

export function assignCombineMapping(mapping: Record<string, unknown>, column: string, field: CombineableField) {
  return normalizeCombineMapping({ ...mapping, [column]: field });
}

export function removeCombineColumn(mapping: Record<string, unknown>, column: string) {
  const next = { ...mapping };
  delete next[column];
  return normalizeCombineMapping(next);
}

export function reorderCombineField(
  mapping: Record<string, unknown>,
  field: CombineableField,
  fromIndex: number,
  toIndex: number,
) {
  const parts = combinePartsForField(mapping, field);
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= parts.length || toIndex >= parts.length) return mapping;
  const nextParts = [...parts];
  const [moved] = nextParts.splice(fromIndex, 1);
  nextParts.splice(toIndex, 0, moved);
  const next: Record<string, unknown> = { ...mapping };
  nextParts.forEach((part, index) => {
    next[part.column] = { kind: "combine", field, order: index };
  });
  return normalizeCombineMapping(next);
}

export function isAcarshFieldName(value: unknown): value is AcarshField {
  return typeof value === "string" && (ACARSH_FIELDS as readonly string[]).includes(value);
}
