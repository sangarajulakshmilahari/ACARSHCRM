import { getPool } from "@/config/db";
import { getAuthUser } from "@/app/api/lib/auth";
import { canUserViewLeadById } from "@/app/api/lib/lead-access";
import { createOpportunityContactHandlers } from "@/app/api/lib/opportunity-contacts-route";

const handlers = createOpportunityContactHandlers({
  getPool,
  getAuthUser,
  canUserViewLeadById,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
