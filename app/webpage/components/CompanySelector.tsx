"use client";

import React from "react";

export type CompanyOption = {
  companyId: number;
  companyName: string;
  roleId: number;
  isDefault: boolean;
};

type CompanySelectorProps = {
  memberships: CompanyOption[];
  selectedCompanyId: number | null;
  disabled?: boolean;
  onChange: (companyId: number) => void;
};

export function shouldRenderCompanySelector(memberships: CompanyOption[]): boolean {
  return memberships.length > 1;
}

export default function CompanySelector({
  memberships,
  selectedCompanyId,
  disabled,
  onChange,
}: CompanySelectorProps): JSX.Element | null {
  if (!shouldRenderCompanySelector(memberships)) return null;

  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "white",
        fontSize: 13,
      }}
    >
      <span style={{ opacity: 0.85, whiteSpace: "nowrap" }}>Company</span>
      <select
        aria-label="Active company"
        value={selectedCompanyId ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next) && next > 0 && next !== selectedCompanyId) {
            onChange(next);
          }
        }}
        style={{
          minWidth: 160,
          maxWidth: 220,
          height: 32,
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.28)",
          background: "rgba(15,31,61,0.85)",
          color: "white",
          padding: "0 8px",
          fontWeight: 600,
        }}
      >
        {memberships.map((row) => (
          <option key={row.companyId} value={row.companyId}>
            {row.companyName}
          </option>
        ))}
      </select>
    </label>
  );
}
