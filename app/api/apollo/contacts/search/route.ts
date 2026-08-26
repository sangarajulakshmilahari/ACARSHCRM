import { NextRequest, NextResponse } from "next/server";

import { getAuthUser } from "@/app/api/lib/auth";
import { searchApolloPeople, toApolloErrorResponse } from "@/app/api/lib/apollo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchRequestBody = {
  companyName?: string;
  contactName?: string;
  contactTitle?: string;
  linkedinUrl?: string;
  page?: number;
  perPage?: number;
};

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as SearchRequestBody;
    const companyName = String(body.companyName || "").trim();
    const contactName = String(body.contactName || "").trim();
    const contactTitle = String(body.contactTitle || "").trim();
    const linkedinUrl = String(body.linkedinUrl || "").trim();

    if (!companyName && !contactName && !linkedinUrl) {
      return NextResponse.json(
        {
          error:
            "Enter at least Company Name, Contact Name, or LinkedIn URL to search Apollo contacts.",
        },
        { status: 400 },
      );
    }

    const people = await searchApolloPeople({
      companyName,
      contactName,
      contactTitle,
      linkedinUrl,
      page: Number(body.page || 1),
      perPage: Number(body.perPage || 10),
    });

    return NextResponse.json({
      results: people,
      count: people.length,
    });
  } catch (error) {
    const mapped = toApolloErrorResponse(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

