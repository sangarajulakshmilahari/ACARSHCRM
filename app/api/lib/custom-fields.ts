import { ACARSH_FIELDS, FIELD_LABELS, type AcarshField } from "@/app/api/ai/assistant/lead-import/mapping";
import { LeadImportStateError, type LeadImportPreviewRow } from "@/app/api/lib/lead-import-core";
import { requireCompanyId } from "@/app/api/lib/company-tenancy";
import {
  isCombinedContactMapping,
  type CombinedContactMappingSpec,
} from "@/app/api/lib/combined-contacts";
import {
  isColumnCombineSpec,
  normalizeCombineMapping,
  type ColumnCombineSpec,
} from "@/app/api/lib/column-combine";
import {
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_ENTITY_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldEntityType,
  type CustomFieldType,
} from "@/app/api/lib/custom-field-types";

export {
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_ENTITY_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_FIELD_TYPES,
  type CustomFieldEntityType,
  type CustomFieldType,
};

export const CUSTOM_FIELD_NAME_MAX = 80;
export const CUSTOM_FIELD_VALUE_MAX = 4000;

export type CustomFieldDefinition = {
  customFieldId: number;
  companyId: number;
  entityType: CustomFieldEntityType;
  fieldName: string;
  fieldKey: string;
  fieldType: CustomFieldType;
  isRequired: boolean;
};

export type CustomFieldPublic = {
  customFieldId: number;
  entityType: CustomFieldEntityType;
  fieldName: string;
  fieldType: CustomFieldType;
  isRequired: boolean;
};

export type CustomFieldValueView = {
  customFieldId: number;
  fieldName: string;
  fieldType: CustomFieldType;
  entityType: CustomFieldEntityType;
  entityId: number;
  value: string;
};

export type CustomMappingSpec =
  | { kind: "custom"; customFieldId: number }
  | {
      kind: "new";
      name: string;
      entityType: CustomFieldEntityType;
      fieldType: CustomFieldType;
      required?: boolean;
    };

export type ImportMappingValue = AcarshField | CustomMappingSpec | CombinedContactMappingSpec | ColumnCombineSpec;

export type CustomPreviewValue = {
  column: string;
  fieldName: string;
  entityType: CustomFieldEntityType;
  fieldType: CustomFieldType;
  rawValue: string;
  normalizedValue: string | null;
  valid: boolean;
  message?: string;
};

export type ResolvedCustomMapping = {
  column: string;
  customFieldId: number | null;
  fieldName: string;
  fieldKey: string;
  entityType: CustomFieldEntityType;
  fieldType: CustomFieldType;
  isRequired: boolean;
  kind: "custom" | "new";
};

const STANDARD_FIELD_KEYS = new Set<string>([
  ...ACARSH_FIELDS,
  ...Object.values(FIELD_LABELS).map((label) => customFieldKey(label)),
]);

export function isAcarshMappingField(value: unknown): value is AcarshField {
  return typeof value === "string" && (ACARSH_FIELDS as readonly string[]).includes(value);
}

export function customFieldKey(name: string) {
  return String(name || "")
    .toLowerCase()
    .replace(/[_./\\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCustomFieldEntityType(value: unknown): value is CustomFieldEntityType {
  return typeof value === "string" && (CUSTOM_FIELD_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isCustomFieldType(value: unknown): value is CustomFieldType {
  return typeof value === "string" && (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

export function isCustomMappingSpec(value: unknown): value is CustomMappingSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as CustomMappingSpec;
  if (spec.kind === "custom") {
    return Number.isInteger(Number(spec.customFieldId)) && Number(spec.customFieldId) > 0;
  }
  if (spec.kind === "new") {
    return Boolean(String(spec.name || "").trim()) && isCustomFieldEntityType(spec.entityType) && isCustomFieldType(spec.fieldType);
  }
  return false;
}

export function isMissingCustomFieldTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; errno?: number; message?: string };
  const message = String(value.message || (error instanceof Error ? error.message : ""));
  return (
    value.code === "ER_NO_SUCH_TABLE" ||
    value.errno === 1146 ||
    (/doesn't exist/i.test(message) && /customfield/i.test(message))
  );
}

export function normalizeCustomFieldName(raw: unknown): string {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, CUSTOM_FIELD_NAME_MAX);
}

export function validateCustomFieldName(raw: unknown): string {
  const name = normalizeCustomFieldName(raw);
  if (!name) throw new LeadImportStateError("Custom field name is required.");
  if (name.length < 2) throw new LeadImportStateError("Custom field name must be at least 2 characters.");
  const key = customFieldKey(name);
  if (!key) throw new LeadImportStateError("Custom field name must include letters or numbers.");
  if (STANDARD_FIELD_KEYS.has(key) || STANDARD_FIELD_KEYS.has(key.replace(/\s+/g, ""))) {
    throw new LeadImportStateError(`"${name}" matches a standard ACARSH field. Map it to that field instead.`);
  }
  return name;
}

export function guessCustomFieldEntity(column: string): CustomFieldEntityType {
  const key = customFieldKey(column);
  if (/\b(contact|person|email|phone|mobile|title|designation|linkedin)\b/.test(key)) return "contact";
  return "lead";
}

export function parseCustomFieldValue(
  fieldType: CustomFieldType,
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const text = String(raw ?? "").replace(/\u0000/g, "").trim();
  if (!text) return { ok: true, value: null };
  if (fieldType === "text") {
    return { ok: true, value: text.slice(0, CUSTOM_FIELD_VALUE_MAX) };
  }
  if (fieldType === "number") {
    const normalized = text.replace(/,/g, "");
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
      return { ok: false, error: `"${text}" is not a valid number` };
    }
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return { ok: false, error: `"${text}" is not a valid number` };
    return { ok: true, value: String(amount) };
  }
  if (fieldType === "boolean") {
    const key = text.toLowerCase();
    if (["true", "yes", "y", "1"].includes(key)) return { ok: true, value: "true" };
    if (["false", "no", "n", "0"].includes(key)) return { ok: true, value: "false" };
    return { ok: false, error: `"${text}" is not a valid yes/no value` };
  }
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:[t\s].*)?$/i);
  if (iso) {
    const date = new Date(`${iso[1]}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return { ok: false, error: `"${text}" is not a valid date` };
    return { ok: true, value: iso[1] };
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return { ok: false, error: `"${text}" is not a valid date` };
  return { ok: true, value: parsed.toISOString().slice(0, 10) };
}

export function splitImportMapping(mapping: Record<string, ImportMappingValue | ""> | null | undefined): {
  standard: Record<string, AcarshField>;
  custom: Array<{ column: string; spec: CustomMappingSpec }>;
  combined: Array<{ column: string; spec: CombinedContactMappingSpec }>;
  combine: Array<{ column: string; spec: ColumnCombineSpec }>;
} {
  const standard: Record<string, AcarshField> = {};
  const custom: Array<{ column: string; spec: CustomMappingSpec }> = [];
  const combined: Array<{ column: string; spec: CombinedContactMappingSpec }> = [];
  const combine: Array<{ column: string; spec: ColumnCombineSpec }> = [];
  for (const [column, value] of Object.entries(mapping || {})) {
    if (!value) continue;
    if (isAcarshMappingField(value)) standard[column] = value;
    else if (isCustomMappingSpec(value)) custom.push({ column, spec: value });
    else if (isCombinedContactMapping(value)) combined.push({ column, spec: value });
    else if (isColumnCombineSpec(value)) combine.push({ column, spec: value });
  }
  return { standard, custom, combined, combine };
}

export function parseImportMapping(raw: unknown): Record<string, ImportMappingValue> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ImportMappingValue> = {};
  for (const [column, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isAcarshMappingField(value)) out[column] = value;
    else if (isColumnCombineSpec(value)) {
      out[column] = { kind: "combine", field: value.field, order: Number(value.order) || 0 };
    } else if (isCombinedContactMapping(value)) {
      out[column] = { kind: "combined_contact", transform: value.transform };
    } else if (isCustomMappingSpec(value)) {
      if (value.kind === "custom") {
        out[column] = { kind: "custom", customFieldId: Number(value.customFieldId) };
      } else {
        out[column] = {
          kind: "new",
          name: normalizeCustomFieldName(value.name),
          entityType: value.entityType,
          fieldType: value.fieldType,
          required: value.required === true,
        };
      }
    }
  }
  return normalizeCombineMapping(out) as Record<string, ImportMappingValue>;
}

export function publicCustomField(definition: CustomFieldDefinition): CustomFieldPublic {
  return {
    customFieldId: definition.customFieldId,
    entityType: definition.entityType,
    fieldName: definition.fieldName,
    fieldType: definition.fieldType,
    isRequired: definition.isRequired,
  };
}

function rowFromDb(row: any): CustomFieldDefinition | null {
  const customFieldId = Number(row?.CustomFieldId);
  const companyId = Number(row?.CompanyId);
  const entityType = String(row?.EntityType || "");
  const fieldType = String(row?.FieldType || "");
  if (!Number.isInteger(customFieldId) || customFieldId <= 0) return null;
  if (!Number.isInteger(companyId) || companyId <= 0) return null;
  if (!isCustomFieldEntityType(entityType) || !isCustomFieldType(fieldType)) return null;
  return {
    customFieldId,
    companyId,
    entityType,
    fieldName: String(row?.FieldName || ""),
    fieldKey: String(row?.FieldKey || customFieldKey(row?.FieldName || "")),
    fieldType,
    isRequired: Number(row?.IsRequired) === 1,
  };
}

export async function listCustomFieldDefinitions(pool: any, companyId: number): Promise<CustomFieldDefinition[]> {
  const scopedCompanyId = requireCompanyId({ companyId });
  try {
    const [rows]: any = await pool.query(
      `SELECT CustomFieldId, CompanyId, EntityType, FieldName, FieldKey, FieldType, IsRequired
       FROM CustomFieldDefinitions
       WHERE CompanyId = ?
       ORDER BY EntityType, FieldName`,
      [scopedCompanyId],
    );
    return (Array.isArray(rows) ? rows : []).map(rowFromDb).filter((row): row is CustomFieldDefinition => Boolean(row));
  } catch (error) {
    if (isMissingCustomFieldTable(error)) return [];
    throw error;
  }
}

export async function getCustomFieldDefinition(
  pool: any,
  companyId: number,
  customFieldId: number,
): Promise<CustomFieldDefinition | null> {
  const scopedCompanyId = requireCompanyId({ companyId });
  const fieldId = Number(customFieldId);
  if (!Number.isInteger(fieldId) || fieldId <= 0) return null;
  const [rows]: any = await pool.query(
    `SELECT CustomFieldId, CompanyId, EntityType, FieldName, FieldKey, FieldType, IsRequired
     FROM CustomFieldDefinitions
     WHERE CustomFieldId = ? AND CompanyId = ?
     LIMIT 1`,
    [fieldId, scopedCompanyId],
  );
  return rowFromDb(rows?.[0]) || null;
}

async function findCustomFieldDefinition(
  pool: any,
  companyId: number,
  entityType: CustomFieldEntityType,
  fieldKey: string,
): Promise<CustomFieldDefinition | null> {
  const [rows]: any = await pool.query(
    `SELECT CustomFieldId, CompanyId, EntityType, FieldName, FieldKey, FieldType, IsRequired
     FROM CustomFieldDefinitions
     WHERE CompanyId = ? AND EntityType = ? AND FieldKey = ?
     LIMIT 1`,
    [companyId, entityType, fieldKey],
  );
  return rowFromDb(rows?.[0]) || null;
}

export async function getOrCreateCustomFieldDefinition(
  conn: any,
  options: {
    companyId: number;
    userId: number;
    name: string;
    entityType: CustomFieldEntityType;
    fieldType: CustomFieldType;
    isRequired?: boolean;
  },
): Promise<CustomFieldDefinition> {
  const companyId = requireCompanyId({ companyId: options.companyId });
  const name = validateCustomFieldName(options.name);
  const fieldKey = customFieldKey(name);
  const existing = await findCustomFieldDefinition(conn, companyId, options.entityType, fieldKey);
  if (existing) {
    if (existing.fieldType !== options.fieldType) {
      throw new LeadImportStateError(
        `Custom field "${existing.fieldName}" already exists as ${CUSTOM_FIELD_TYPE_LABELS[existing.fieldType]} for ${CUSTOM_FIELD_ENTITY_LABELS[existing.entityType]}.`,
      );
    }
    return existing;
  }
  try {
    const [result]: any = await conn.query(
      `INSERT INTO CustomFieldDefinitions
        (CompanyId, EntityType, FieldName, FieldKey, FieldType, IsRequired, CreatedByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        options.entityType,
        name,
        fieldKey,
        options.fieldType,
        options.isRequired ? 1 : 0,
        options.userId,
      ],
    );
    const created = await getCustomFieldDefinition(conn, companyId, Number(result?.insertId));
    if (!created) throw new LeadImportStateError("Unable to create the custom field.");
    return created;
  } catch (error) {
    const mysql = error as { code?: string; errno?: number };
    if (mysql?.code === "ER_DUP_ENTRY" || mysql?.errno === 1062) {
      const raced = await findCustomFieldDefinition(conn, companyId, options.entityType, fieldKey);
      if (raced) return raced;
    }
    throw error;
  }
}

export async function validateImportCustomMappings(options: {
  pool: any;
  companyId: number;
  mapping: Record<string, ImportMappingValue>;
}): Promise<ResolvedCustomMapping[]> {
  const companyId = requireCompanyId({ companyId: options.companyId });
  const { custom } = splitImportMapping(options.mapping);
  if (!custom.length) return [];
  const definitions = await listCustomFieldDefinitions(options.pool, companyId);
  const usedKeys = new Map<string, string>();
  const usedIds = new Map<number, string>();
  const resolved: ResolvedCustomMapping[] = [];

  for (const item of custom) {
    if (item.spec.kind === "custom") {
      const spec = item.spec;
      const definition = definitions.find((row) => row.customFieldId === Number(spec.customFieldId));
      if (!definition) {
        throw new LeadImportStateError("A selected custom field was not found for this company.");
      }
      const previous = usedIds.get(definition.customFieldId) || usedKeys.get(`${definition.entityType}:${definition.fieldKey}`);
      if (previous) {
        throw new LeadImportStateError(`Custom field "${definition.fieldName}" is mapped more than once.`);
      }
      usedIds.set(definition.customFieldId, item.column);
      usedKeys.set(`${definition.entityType}:${definition.fieldKey}`, item.column);
      resolved.push({
        column: item.column,
        customFieldId: definition.customFieldId,
        fieldName: definition.fieldName,
        fieldKey: definition.fieldKey,
        entityType: definition.entityType,
        fieldType: definition.fieldType,
        isRequired: definition.isRequired,
        kind: "custom",
      });
      continue;
    }

    const spec = item.spec;
    const name = validateCustomFieldName(spec.name);
    const fieldKey = customFieldKey(name);
    const identity = `${spec.entityType}:${fieldKey}`;
    const previous = usedKeys.get(identity);
    if (previous) {
      throw new LeadImportStateError(`Custom field "${name}" is mapped more than once.`);
    }
    const existing = definitions.find((row) => row.entityType === spec.entityType && row.fieldKey === fieldKey);
    if (existing && existing.fieldType !== spec.fieldType) {
      throw new LeadImportStateError(
        `Custom field "${existing.fieldName}" already exists as ${CUSTOM_FIELD_TYPE_LABELS[existing.fieldType]} for ${CUSTOM_FIELD_ENTITY_LABELS[existing.entityType]}.`,
      );
    }
    if (existing) usedIds.set(existing.customFieldId, item.column);
    usedKeys.set(identity, item.column);
    resolved.push({
      column: item.column,
      customFieldId: existing?.customFieldId || null,
      fieldName: existing?.fieldName || name,
      fieldKey,
      entityType: spec.entityType,
      fieldType: existing?.fieldType || spec.fieldType,
      isRequired: existing ? existing.isRequired : spec.required === true,
      kind: existing ? "custom" : "new",
    });
  }
  return resolved;
}

export async function resolveImportCustomMappings(options: {
  conn: any;
  companyId: number;
  userId: number;
  mapping: Record<string, ImportMappingValue>;
}): Promise<ResolvedCustomMapping[]> {
  const pending = await validateImportCustomMappings({
    pool: options.conn,
    companyId: options.companyId,
    mapping: options.mapping,
  });
  const resolved: ResolvedCustomMapping[] = [];
  for (const item of pending) {
    if (item.customFieldId) {
      resolved.push(item);
      continue;
    }
    const created = await getOrCreateCustomFieldDefinition(options.conn, {
      companyId: options.companyId,
      userId: options.userId,
      name: item.fieldName,
      entityType: item.entityType,
      fieldType: item.fieldType,
      isRequired: item.isRequired,
    });
    resolved.push({ ...item, customFieldId: created.customFieldId, kind: "custom", fieldName: created.fieldName });
  }
  return resolved;
}

export function applyCustomFieldPreview(
  rows: LeadImportPreviewRow[],
  sourceRows: Array<Record<string, string>>,
  mappings: ResolvedCustomMapping[],
): LeadImportPreviewRow[] {
  if (!mappings.length) return rows;
  return rows.map((row, index) => {
    const source = sourceRows[index] || {};
    const customValues: CustomPreviewValue[] = [];
    const reasons = [...(row.reasons || [])];
    for (const mapping of mappings) {
      const rawValue = String(source[mapping.column] || "").trim();
      if (!rawValue && mapping.isRequired) {
        customValues.push({
          column: mapping.column,
          fieldName: mapping.fieldName,
          entityType: mapping.entityType,
          fieldType: mapping.fieldType,
          rawValue,
          normalizedValue: null,
          valid: false,
          message: `${mapping.fieldName} is required`,
        });
        reasons.push(`${mapping.fieldName} is required`);
        continue;
      }
      const parsed = parseCustomFieldValue(mapping.fieldType, rawValue);
      if (!parsed.ok) {
        customValues.push({
          column: mapping.column,
          fieldName: mapping.fieldName,
          entityType: mapping.entityType,
          fieldType: mapping.fieldType,
          rawValue,
          normalizedValue: null,
          valid: false,
          message: `${mapping.fieldName}: ${parsed.error}`,
        });
        reasons.push(`${mapping.fieldName}: ${parsed.error}`);
        continue;
      }
      const hasContactParent = Boolean(row.contactName) || (row.extractedContacts || []).some((item) => item.name);
      if (mapping.entityType === "contact" && parsed.value && !hasContactParent) {
        customValues.push({
          column: mapping.column,
          fieldName: mapping.fieldName,
          entityType: mapping.entityType,
          fieldType: mapping.fieldType,
          rawValue,
          normalizedValue: parsed.value,
          valid: false,
          message: `${mapping.fieldName} has no parent contact`,
        });
        reasons.push(`${mapping.fieldName} has no parent contact`);
        continue;
      }
      if (mapping.entityType === "lead" && parsed.value && !row.companyName) {
        customValues.push({
          column: mapping.column,
          fieldName: mapping.fieldName,
          entityType: mapping.entityType,
          fieldType: mapping.fieldType,
          rawValue,
          normalizedValue: parsed.value,
          valid: false,
          message: `${mapping.fieldName} has no parent company`,
        });
        reasons.push(`${mapping.fieldName} has no parent company`);
        continue;
      }
      customValues.push({
        column: mapping.column,
        fieldName: mapping.fieldName,
        entityType: mapping.entityType,
        fieldType: mapping.fieldType,
        rawValue,
        normalizedValue: parsed.value,
        valid: true,
      });
    }
    const hasInvalidCustom = customValues.some((item) => !item.valid);
    let status = row.status;
    if (hasInvalidCustom && (status === "new" || status === "existing_company_new_contact")) {
      status = "needs_attention";
    }
    return { ...row, status, reasons, customValues };
  });
}

export async function writeCustomFieldValues(options: {
  conn: any;
  companyId: number;
  leadId: number;
  contactId: number;
  createdLead: boolean;
  source: Record<string, string>;
  mappings: ResolvedCustomMapping[];
}): Promise<void> {
  const companyId = requireCompanyId({ companyId: options.companyId });
  for (const mapping of options.mappings) {
    const fieldId = Number(mapping.customFieldId);
    if (!Number.isInteger(fieldId) || fieldId <= 0) continue;
    const entityId = mapping.entityType === "lead" ? options.leadId : options.contactId;
    if (!Number.isInteger(entityId) || entityId <= 0) continue;
    if (mapping.entityType === "lead" && !options.createdLead) continue;
    const parsed = parseCustomFieldValue(mapping.fieldType, options.source[mapping.column]);
    if (!parsed.ok || parsed.value == null) continue;
    await options.conn.query(
      `INSERT INTO CustomFieldValues
        (CompanyId, CustomFieldId, EntityType, EntityId, ValueText)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ValueText = VALUES(ValueText)`,
      [companyId, fieldId, mapping.entityType, entityId, parsed.value],
    );
  }
}

export async function loadLeadCustomFieldValues(
  conn: any,
  leadId: number,
  contactIds: number[],
): Promise<{ lead: CustomFieldValueView[]; contacts: Record<number, CustomFieldValueView[]> }> {
  const empty = { lead: [] as CustomFieldValueView[], contacts: {} as Record<number, CustomFieldValueView[]> };
  try {
    const ids = [leadId, ...contactIds.filter((id) => Number.isInteger(id) && id > 0)];
    if (!ids.length) return empty;
    const [rows]: any = await conn.query(
      `SELECT d.CustomFieldId, d.FieldName, d.FieldType, d.EntityType, v.EntityId, v.ValueText
       FROM CustomFieldValues v
       INNER JOIN CustomFieldDefinitions d
         ON d.CustomFieldId = v.CustomFieldId
        AND d.CompanyId = v.CompanyId
       INNER JOIN Leads l
         ON l.LeadId = ?
        AND l.CompanyId = v.CompanyId
       WHERE (
            (v.EntityType = 'lead' AND v.EntityId = l.LeadId)
         OR (v.EntityType = 'contact' AND v.EntityId IN (${ids.map(() => "?").join(", ")}))
       )
       ORDER BY d.FieldName`,
      [leadId, ...ids],
    );
    const lead: CustomFieldValueView[] = [];
    const contacts: Record<number, CustomFieldValueView[]> = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const entityType = String(row.EntityType || "");
      if (!isCustomFieldEntityType(entityType) || !isCustomFieldType(String(row.FieldType || ""))) continue;
      const view: CustomFieldValueView = {
        customFieldId: Number(row.CustomFieldId),
        fieldName: String(row.FieldName || ""),
        fieldType: row.FieldType,
        entityType,
        entityId: Number(row.EntityId),
        value: String(row.ValueText || ""),
      };
      if (entityType === "lead") lead.push(view);
      else {
        const list = contacts[view.entityId] || [];
        list.push(view);
        contacts[view.entityId] = list;
      }
    }
    return { lead, contacts };
  } catch (error) {
    if (isMissingCustomFieldTable(error)) return empty;
    throw error;
  }
}
