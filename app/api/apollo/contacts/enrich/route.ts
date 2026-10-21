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

function toCleanString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as EnrichRequestBody;
    const payload = {
      apolloPersonId: toCleanString(body.apolloPersonId),
      apolloOrganizationId: toCleanString(body.apolloOrganizationId),
      linkedinUrl: toCleanString(body.linkedinUrl),
      contactName: toCleanString(body.contactName),
      companyName: toCleanString(body.companyName),
      companyDomain: toCleanString(body.companyDomain),
    };

    if (process.env.NODE_ENV !== "production") {
      console.info("[apollo-enrich] request", {
        hasApolloPersonId: Boolean(payload.apolloPersonId),
        hasApolloOrganizationId: Boolean(payload.apolloOrganizationId),
        hasLinkedinUrl: Boolean(payload.linkedinUrl),
        hasContactName: Boolean(payload.contactName),
        hasCompanyName: Boolean(payload.companyName),
        hasCompanyDomain: Boolean(payload.companyDomain),
        apolloPersonIdPreview: payload.apolloPersonId
          ? `${payload.apolloPersonId.slice(0, 8)}...`
          : null,
      });
    }

    if (
      !payload.apolloPersonId &&
      !payload.linkedinUrl &&
      !(payload.contactName && (payload.companyName || payload.companyDomain))
    ) {
      return NextResponse.json(
        {
          error:
            "Apollo enrichment needs a valid Apollo contact id, LinkedIn URL, or contact name with company details.",
          details: {
            missing: [
              "apolloPersonId",
              "linkedinUrl",
              "contactName+companyName",
              "contactName+companyDomain",
            ],
          },
        },
        { status: 400 },
      );
    }

    const person = await enrichApolloPerson({
      apolloPersonId: payload.apolloPersonId,
      apolloOrganizationId: payload.apolloOrganizationId,
      linkedinUrl: payload.linkedinUrl,
      contactName: payload.contactName,
      companyName: payload.companyName,
      companyDomain: payload.companyDomain,
      revealPersonalEmails: false,
      revealPhoneNumber: false,
    });

    if (process.env.NODE_ENV !== "production") {
      console.info("[apollo-enrich] response", {
        found: Boolean(person),
        personId: person?.apolloPersonId ?? null,
        hasWorkEmail: Boolean(person?.workEmail),
        hasPhone: Boolean(person?.phone),
        phoneStatus: person?.phoneStatus ?? null,
        requestId: person?.requestId ?? null,
      });
    }

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
    if (process.env.NODE_ENV !== "production") {
      console.error("[apollo-enrich] error", {
        name: (error as any)?.name,
        message: (error as any)?.message,
        statusCode: (error as any)?.statusCode,
        meta: (error as any)?.meta,
      });
    }
    const mapped = toApolloErrorResponse(error);
    return NextResponse.json(
      {
        error: mapped.message,
        details: (mapped as any)?.meta || null,
      },
      { status: mapped.status },
    );
  }
}

