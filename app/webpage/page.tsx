import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveAuthUserFromAccessToken } from "@/app/api/lib/auth";
import { getPool } from "@/config/db";
import {
  ACTIVE_COMPANY_COOKIE,
  COMPANY_SELECTION_PATH,
  loadCompanyMemberships,
  parseRequestedCompanyId,
  resolvePostLoginDestination,
} from "@/app/api/lib/company-tenancy";
import WebPageClient from "./WebPageClient";

export default async function Page() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;

  if (!accessToken) {
    redirect("/api/auth/login");
  }

  const selectedCompanyId = parseRequestedCompanyId(cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value);
  const resolvedUser = await resolveAuthUserFromAccessToken(accessToken, {
    requestedCompanyId: selectedCompanyId,
  });
  if (!resolvedUser) {
    redirect("/api/auth/login");
  }

  const pool = await getPool();
  const memberships = await loadCompanyMemberships(pool, resolvedUser.userId);
  const destination = resolvePostLoginDestination({
    memberships,
    selectedCompanyId,
  });
  if (destination.kind !== "dashboard") {
    redirect(COMPANY_SELECTION_PATH);
  }

  return (
    <Suspense>
      <WebPageClient />
    </Suspense>
  );
}
