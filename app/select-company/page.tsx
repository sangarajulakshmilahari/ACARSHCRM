import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveAuthUserFromAccessToken } from "@/app/api/lib/auth";
import { getPool } from "@/config/db";
import {
  ACTIVE_COMPANY_COOKIE,
  POST_LOGIN_DASHBOARD_PATH,
  loadCompanyMemberships,
  parseRequestedCompanyId,
  resolveCompanySelectionPage,
} from "@/app/api/lib/company-tenancy";
import SelectCompanyClient from "../select-company/SelectCompanyClient";

export default async function SelectCompanyPage() {
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
  const page = resolveCompanySelectionPage(memberships);
  if (page.kind === "redirect-dashboard") {
    redirect(POST_LOGIN_DASHBOARD_PATH);
  }

  return (
    <SelectCompanyClient
      userName={resolvedUser.userName}
      companies={page.companies}
      accessDenied={page.kind === "access-denied"}
    />
  );
}
