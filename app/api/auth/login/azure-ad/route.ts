import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/app/api/lib/auth";
import {
  buildOAuthStateCookie,
  createGraphOAuthState,
  getGraphOAuthConfigForAuthorize,
  normalizeEngageTab,
} from "@/app/api/lib/graph-delegated";

export async function GET(req: NextRequest) {
  const crmUser = await getAuthUser(req);
  if (!crmUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getGraphOAuthConfigForAuthorize();
  const tab = normalizeEngageTab(req.nextUrl.searchParams.get("tab"));
  const state = createGraphOAuthState(tab);

  const authorizeUrl =
    `${config.authorizeUrl}` +
    `?client_id=${encodeURIComponent(config.clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(config.redirectUri)}` +
    `&response_mode=query` +
    `&scope=${encodeURIComponent(config.scope)}` +
    `&state=${encodeURIComponent(state)}` +
    `&prompt=select_account`;

  const response = NextResponse.redirect(authorizeUrl);
  response.headers.append("Set-Cookie", buildOAuthStateCookie(state));
  return response;
}
