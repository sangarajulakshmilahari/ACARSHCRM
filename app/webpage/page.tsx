import { Suspense } from "react";
import WebPageClient from "./WebPageClient";

export default function Page() {
  return (
    <Suspense >
      <WebPageClient />
    </Suspense>
  );
}
// fallback={<div>Loading...</div>}