import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/app/api/lib/auth";
import {
  getDelegatedGraphSession,
  GraphDelegatedAuthError,
} from "@/app/api/lib/graph-delegated";
import { GraphMailSendError, sendMailWithDelegatedGraphToken } from "@/app/api/lib/graph-mail";
import { plainTextToEmailHtml } from "@/app/utils/email-content";

type TestSendBody = {
  to?: string;
  subject?: string;
  body?: string;
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function isValidEmail(value: string): boolean {
  return emailRegex.test(String(value || "").trim());
}

function sanitizeSubject(subject: string): string {
  return String(subject || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = (await req.json().catch(() => ({}))) as TestSendBody;
    const to = String(raw.to || "").trim();
    const subject = sanitizeSubject(String(raw.subject || ""));
    const body = String(raw.body || "").trim();

    if (!to || !isValidEmail(to)) {
      return NextResponse.json({ error: "Invalid recipient email" }, { status: 400 });
    }

    if (!subject) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }

    if (!body) {
      return NextResponse.json({ error: "Body is required" }, { status: 400 });
    }

    if (subject.length > 500) {
      return NextResponse.json({ error: "Subject is too long" }, { status: 400 });
    }

    if (body.length > 20000) {
      return NextResponse.json({ error: "Body is too long" }, { status: 400 });
    }

    let graphSession;
    try {
      graphSession = await getDelegatedGraphSession(req);
    } catch (error: any) {
      if (error instanceof GraphDelegatedAuthError) {
        return NextResponse.json(
          {
            error: error.safeMessage,
            code: error.code,
          },
          { status: error.status }
        );
      }
      throw error;
    }

    console.info("[email-test-send] Send attempt", {
      crmUserId: authUser.userId,
      graphPrincipal: graphSession.principal,
      subjectLength: subject.length,
      bodyLength: body.length,
    });

    try {
      await sendMailWithDelegatedGraphToken({
        accessToken: graphSession.accessToken,
        to,
        subject,
        htmlBody: plainTextToEmailHtml(body),
      });
    } catch (error: any) {
      if (error instanceof GraphMailSendError) {
        console.error("[email-test-send] Graph send failed", {
          crmUserId: authUser.userId,
          graphPrincipal: graphSession.principal,
          code: error.code,
          status: error.status,
        });

        const failedResponse = NextResponse.json(
          {
            error: error.safeMessage,
            code: error.code,
          },
          { status: error.status }
        );

        for (const header of graphSession.setCookieHeaders) {
          failedResponse.headers.append("Set-Cookie", header);
        }

        return failedResponse;
      }

      throw error;
    }

    const response = NextResponse.json({
      success: true,
      message: "Email sent successfully",
      recipient: to,
    });

    for (const header of graphSession.setCookieHeaders) {
      response.headers.append("Set-Cookie", header);
    }

    console.info("[email-test-send] Graph send success", {
      crmUserId: authUser.userId,
      graphPrincipal: graphSession.principal,
    });

    return response;
  } catch (error) {
    console.error("[email-test-send] Unexpected error", error);
    return NextResponse.json(
      { error: "Failed to send test email" },
      { status: 500 }
    );
  }
}

