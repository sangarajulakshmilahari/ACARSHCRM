import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/app/api/lib/auth";
import {
  buildGraphPostAuthUrl,
  buildGraphTokenCookies,
  buildOAuthStateClearCookie,
  exchangeAuthorizationCodeForGraphTokens,
  fetchGraphMailboxIdentity,
  getOAuthStateFromRequest,
  GraphDelegatedAuthError,
  mapMicrosoftOAuthQueryError,
  validateGraphOAuthState,
} from "@/app/api/lib/graph-delegated";

function getCallbackOrigin() {
  const redirectUri = String(process.env.AZURE_AD_REDIRECT_URI || "").trim();
  try {
    if (redirectUri) return new URL(redirectUri).origin;
  } catch {
    // fall through
  }
  return "https://localhost:3001";
}

function redirectToEngage(tab: string, params: Record<string, string>, extraCookies: string[] = []) {
  const response = NextResponse.redirect(
    buildGraphPostAuthUrl({
      origin: getCallbackOrigin(),
      tab,
      params,
    })
  );
  extraCookies.forEach((cookie) => response.headers.append("Set-Cookie", cookie));
  return response;
}

export async function GET(req: NextRequest) {
  try {
    const crmUser = await getAuthUser(req);
    if (!crmUser) {
      return NextResponse.redirect(new URL("/api/auth/login", req.url));
    }

    const oauthError = mapMicrosoftOAuthQueryError(req.nextUrl.searchParams.get("error"));
    const state = String(req.nextUrl.searchParams.get("state") || "").trim();
    const stateCookie = getOAuthStateFromRequest(req);
    const stateCheck = validateGraphOAuthState(stateCookie, state);

    if (oauthError) {
      return redirectToEngage(stateCheck.tab, { graphError: oauthError }, [
        buildOAuthStateClearCookie(),
      ]);
    }

    if (!stateCheck.ok) {
      return redirectToEngage("emailTemplates", { graphError: "invalid_state" }, [
        buildOAuthStateClearCookie(),
      ]);
    }

    const code = String(req.nextUrl.searchParams.get("code") || "").trim();
    if (!code) {
      return redirectToEngage(stateCheck.tab, { graphError: "missing_code" }, [
        buildOAuthStateClearCookie(),
      ]);
    }

    const tokens = await exchangeAuthorizationCodeForGraphTokens({ code });
    let mailbox: string | null = tokens.principal;
    try {
      const identity = await fetchGraphMailboxIdentity(tokens.accessToken);
      mailbox = identity.mailbox || mailbox;
    } catch (lookupError: any) {
      if (lookupError instanceof GraphDelegatedAuthError && lookupError.code === "GRAPH_TOKEN_INVALID") {
        throw lookupError;
      }
      mailbox = mailbox || null;
    }

    console.info("[graph-auth-callback] Microsoft account connected", {
      crmUserId: crmUser.userId,
      hasMailbox: Boolean(mailbox),
    });

    return redirectToEngage(
      stateCheck.tab,
      mailbox ? { graphConnected: "1" } : { graphConnected: "1", graphWarning: "mailbox_identity_missing" },
      [
        buildOAuthStateClearCookie(),
        ...buildGraphTokenCookies({
          ...tokens,
          principal: mailbox,
        }),
      ]
    );
  } catch (error: any) {
    if (error instanceof GraphDelegatedAuthError) {
      console.error("[graph-auth-callback] Graph delegated auth error", {
        code: error.code,
        status: error.status,
      });
      return redirectToEngage("emailTemplates", { graphError: error.code }, [
        buildOAuthStateClearCookie(),
      ]);
    }

    console.error("[graph-auth-callback] Unexpected error", error);
    return redirectToEngage("emailTemplates", { graphError: "unexpected" }, [
      buildOAuthStateClearCookie(),
    ]);
  }
}
