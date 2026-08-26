import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/app/api/lib/auth";
import {
  enrichApolloPerson,
  toApolloErrorResponse,
} from "@/app/api/lib/apollo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type EnrichRequestBody = {
  apolloPersonId?: string;
  apolloOrganizationId?: string;
  linkedinUrl?: string;
  contactName?: string;
  companyName?: string;
  companyDomain?: string;
};

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as EnrichRequestBody;
    const person = await enrichApolloPerson({
      apolloPersonId: String(body.apolloPersonId || "").trim() || undefined,
      apolloOrganizationId: String(body.apolloOrganizationId || "").trim() || undefined,
      linkedinUrl: String(body.linkedinUrl || "").trim() || undefined,
      contactName: String(body.contactName || "").trim() || undefined,
      companyName: String(body.companyName || "").trim() || undefined,
      companyDomain: String(body.companyDomain || "").trim() || undefined,
      revealPersonalEmails: false,
      revealPhoneNumber: true,
      phonePollTimeoutMs: 25000,
      phonePollIntervalMs: 2000,
    });

    if (!person) {
      return NextResponse.json({ error: "No contact found for enrichment." }, { status: 404 });
    }

    return NextResponse.json({
      contact: person,
      hasEmail: Boolean(person.workEmail),
      hasPhone: Boolean(person.phone),
      phoneStatus: person.phoneStatus,
      requestId: person.requestId,
    });
  } catch (error) {
    const mapped = toApolloErrorResponse(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

