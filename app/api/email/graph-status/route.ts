import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/app/api/lib/auth";
import {
  buildGraphSessionClearCookies,
  fetchGraphMailboxIdentity,
  getDelegatedGraphSession,
  GraphDelegatedAuthError,
} from "@/app/api/lib/graph-delegated";

function jsonWithCookies(body: unknown, cookies: string[] = [], status = 200) {
  const response = NextResponse.json(body, { status });
  cookies.forEach((cookie) => response.headers.append("Set-Cookie", cookie));
  return response;
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let session;
    try {
      session = await getDelegatedGraphSession(req);
    } catch (error: any) {
      if (error instanceof GraphDelegatedAuthError) {
        const needsReconnect =
          error.code === "GRAPH_TOKEN_REFRESH_FAILED" || error.code === "GRAPH_TOKEN_MISSING";
        return jsonWithCookies(
          {
            connected: false,
            mailbox: null,
            displayName: null,
            needsReconnect,
            error: error.code === "GRAPH_NOT_CONNECTED" ? null : error.safeMessage,
          },
          needsReconnect ? buildGraphSessionClearCookies() : []
        );
      }
      throw error;
    }

    try {
      const identity = await fetchGraphMailboxIdentity(session.accessToken);
      return jsonWithCookies(
        {
          connected: true,
          mailbox: identity.mailbox,
          displayName: identity.displayName,
          needsReconnect: false,
          error: identity.mailbox ? null : "Mailbox address is unavailable for this account.",
        },
        session.setCookieHeaders
      );
    } catch (error: any) {
      if (error instanceof GraphDelegatedAuthError) {
        const needsReconnect =
          error.code === "GRAPH_TOKEN_INVALID" || error.code === "GRAPH_TOKEN_MISSING";
        return jsonWithCookies(
          {
            connected: false,
            mailbox: null,
            displayName: null,
            needsReconnect,
            error: error.safeMessage,
          },
          needsReconnect ? buildGraphSessionClearCookies() : session.setCookieHeaders
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("[graph-status] Unexpected error", error);
    return NextResponse.json(
      { error: "Failed to read Microsoft connection status" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return jsonWithCookies(
      {
        connected: false,
        mailbox: null,
        displayName: null,
        needsReconnect: false,
        error: null,
      },
      buildGraphSessionClearCookies()
    );
  } catch (error) {
    console.error("[graph-status] Disconnect error", error);
    return NextResponse.json({ error: "Failed to disconnect Microsoft account" }, { status: 500 });
  }
}
