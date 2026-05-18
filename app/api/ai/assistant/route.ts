import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/config/db";

const DEFAULT_ACARSH_API = "http://43.204.14.136:8200";

type SessionRequestBody = {
  type: "session";
  userId: number;
};

type BootstrapRequestBody = {
  type: "bootstrap";
};

type ChatRequestBody = {
  type: "chat";
  userId?: number;
  sessionId?: string;
  message: string;
};

async function getLoggedInUser(req: NextRequest): Promise<{
  userId: number;
  userName: string;
} | null> {
  const encodedUser = req.cookies.get("user")?.value;
  let userName = encodedUser ? decodeURIComponent(encodedUser) : "";
  let email = "";
  let keycloakId = "";

  const token = req.cookies.get("access_token")?.value;
  if (token) {
    try {
      const payloadPart = token.split(".")[1] || "";
      const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
      );
      const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      keycloakId = String(payload?.sub || "");
      userName = userName || String(payload?.preferred_username || "");
      email = String(payload?.email || "");
    } catch {
      // ignore token decode failure and fall through to null return below
    }
  }

  if (!keycloakId && !userName && !email) return null;

  const pool = await getPool();
  const conn = await pool.getConnection();
  try {
    const [rows]: any = await conn.query(
      `SELECT UserId, UserName
       FROM Users
       WHERE KeycloakId = ? OR UserName = ? OR Email = ?
       LIMIT 1`,
      [keycloakId, userName || email, email || userName],
    );

    if (!rows?.length) return null;
    return {
      userId: Number(rows[0].UserId),
      userName: String(rows[0].UserName || userName),
    };
  } finally {
    conn.release();
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as
      | SessionRequestBody
      | BootstrapRequestBody
      | ChatRequestBody;
    const apiBase =
      process.env.ACARSH_API_URL?.trim() ||
      process.env.NEXT_PUBLIC_ACARSH_API_URL?.trim() ||
      DEFAULT_ACARSH_API;

    if (body?.type === "session") {
      const userId = Number(body.userId);
      if (!Number.isFinite(userId) || userId <= 0) {
        return NextResponse.json(
          { detail: "Valid userId is required." },
          { status: 400 },
        );
      }

      const res = await fetch(`${apiBase}/crm/chat/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json(
          { detail: data?.detail || "User not found. Check the ID and try again." },
          { status: res.status || 400 },
        );
      }

      return NextResponse.json({
        session_id: data.session_id,
        user: {
          name: data?.user?.name || `User ${userId}`,
          role: (data?.user?.role || "agent").toLowerCase(),
        },
      });
    }

    if (body?.type === "bootstrap") {
      const loggedIn = await getLoggedInUser(req);
      if (!loggedIn) {
        return NextResponse.json(
          { detail: "No logged-in user found." },
          { status: 401 },
        );
      }

      const res = await fetch(`${apiBase}/crm/chat/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: loggedIn.userId }),
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json(
          { detail: data?.detail || "Unable to start chat session." },
          { status: res.status || 400 },
        );
      }

      return NextResponse.json({
        session_id: data.session_id,
        user: {
          name: data?.user?.name || loggedIn.userName,
          role: (data?.user?.role || "agent").toLowerCase(),
        },
      });
    }

    if (body?.type === "chat") {
      const loggedIn = await getLoggedInUser(req);
      const userId = Number(body.userId || loggedIn?.userId);
      let sessionId = String(body.sessionId || "").trim();
      const message = String(body.message || "").trim();

      if (!Number.isFinite(userId) || userId <= 0) {
        return NextResponse.json(
          { detail: "Valid userId is required." },
          { status: 400 },
        );
      }
      if (!sessionId) {
        const sessionRes = await fetch(`${apiBase}/crm/chat/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
          cache: "no-store",
        });
        const sessionData = await sessionRes.json().catch(() => ({}));
        if (!sessionRes.ok || !sessionData?.session_id) {
          return NextResponse.json(
            { detail: sessionData?.detail || "Unable to start chat session." },
            { status: sessionRes.status || 400 },
          );
        }
        sessionId = String(sessionData.session_id);
      }
      if (!message) {
        return NextResponse.json(
          { detail: "message is required." },
          { status: 400 },
        );
      }

      const res = await fetch(`${apiBase}/crm/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_id: userId,
          message,
        }),
        cache: "no-store",
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json(
          { detail: data?.detail || "Assistant request failed." },
          { status: res.status || 500 },
        );
      }

      return NextResponse.json({
        session_id: data.session_id,
        reply: data.reply || "",
        tool_calls: Array.isArray(data.tool_calls) ? data.tool_calls : [],
      });
    }

    return NextResponse.json(
      { detail: "Invalid request type. Use 'bootstrap', 'session', or 'chat'." },
      { status: 400 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { detail: error?.message || "Unexpected server error." },
      { status: 500 },
    );
  }
}

