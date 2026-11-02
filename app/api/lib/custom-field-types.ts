export const CUSTOM_FIELD_ENTITY_TYPES = ["lead", "contact"] as const;
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "boolean"] as const;

export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntityType, string> = {
  lead: "Company / Lead",
  contact: "Contact",
};

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Boolean",
};
