import { Suspense } from "react";
import LeadImportClient from "./LeadImportClient";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: "#1F3A68" }}>Loading Smart Lead & Contact Import…</div>}>
      <LeadImportClient />
    </Suspense>
  );
}
