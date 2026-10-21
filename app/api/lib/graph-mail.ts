import { Client } from "@microsoft/microsoft-graph-client";
import { ClientSecretCredential } from "@azure/identity";

export class GraphMailSendError extends Error {
  status: number;
  code: string;
  safeMessage: string;

  constructor(status: number, code: string, safeMessage: string) {
    super(safeMessage);
    this.status = status;
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

type SendMailInput = {
  accessToken: string;
  to: string;
  subject: string;
  htmlBody: string;
  attachments?: GraphMailAttachment[];
};

type SendMailAppInput = {
  to: string;
  subject: string;
  htmlBody: string;
  attachments?: GraphMailAttachment[];
};

export type GraphSentMessageIds = {
  graphMessageId: string | null;
  conversationId: string | null;
  internetMessageId: string | null;
};

export type GraphMailAttachment = {
  name: string;
  contentType: string;
  contentBytes: string;
  isInline?: boolean;
  contentId?: string;
};

function mapGraphAttachments(items: GraphMailAttachment[] | undefined) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return undefined;

  return list.map((item) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: item.name,
    contentType: item.contentType,
    contentBytes: item.contentBytes,
    isInline: Boolean(item.isInline),
    contentId: item.contentId || undefined,
  }));
}

function getScopeList(accessToken: string): string[] {
  try {
    const payloadPart = accessToken.split(".")[1] || "";
    if (!payloadPart) return [];
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "="
    );
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const scp = String(payload?.scp || "").trim();
    return scp ? scp.split(/\s+/).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function hasMailSendScope(accessToken: string): boolean {
  const scopes = getScopeList(accessToken);
  return scopes.some((scope) => scope.toLowerCase() === "mail.send");
}

function mapGraphError(err: any): GraphMailSendError {
  const status = Number(err?.statusCode || err?.status || 500);
  const graphCode =
    String(err?.code || err?.body?.error?.code || err?.response?.body?.error?.code || "") ||
    "GRAPH_SEND_FAILED";

  if (status === 401) {
    return new GraphMailSendError(
      401,
      graphCode,
      "Microsoft token is invalid or expired. Reconnect Microsoft account."
    );
  }

  if (status === 403) {
    return new GraphMailSendError(
      403,
      graphCode,
      "Mail.Send permission is missing or mailbox access is denied."
    );
  }

  if (status === 404) {
    return new GraphMailSendError(
      404,
      graphCode,
      "Microsoft mailbox was not found for the authenticated user."
    );
  }

  if (status === 429) {
    return new GraphMailSendError(
      429,
      graphCode,
      "Microsoft Graph rate limit exceeded. Try again shortly."
    );
  }

  if (status >= 500) {
    return new GraphMailSendError(
      502,
      graphCode,
      "Microsoft Graph service is currently unavailable."
    );
  }

  return new GraphMailSendError(
    Math.max(400, Math.min(status, 500)),
    graphCode,
    "Failed to send email via Microsoft Graph."
  );
}

export async function sendMailWithDelegatedGraphToken(
  input: SendMailInput
): Promise<void> {
  if (!hasMailSendScope(input.accessToken)) {
    throw new GraphMailSendError(
      403,
      "MISSING_MAIL_SEND_SCOPE",
      "Connected Microsoft token does not include Mail.Send permission."
    );
  }

  const client = Client.init({
    authProvider: (done) => {
      done(null, input.accessToken);
    },
  });

  try {
    await client.api("/me/sendMail").post({
      message: {
        subject: input.subject,
        body: {
          contentType: "HTML",
          content: input.htmlBody,
        },
        toRecipients: [
          {
            emailAddress: {
              address: input.to,
            },
          },
        ],
        attachments: mapGraphAttachments(input.attachments),
      },
      saveToSentItems: true,
    });
  } catch (err: any) {
    throw mapGraphError(err);
  }
}

function resolveApplicationGraphConfig() {
  const tenantId = String(
    process.env.AZURE_AD_TENANT_ID || process.env.AZURE_TENANT_ID || ""
  ).trim();
  const clientId = String(
    process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_CLIENT_ID || ""
  ).trim();
  const clientSecret = String(
    process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || ""
  ).trim();
  const senderUser = String(
    process.env.AZURE_GRAPH_USER_ID ||
      process.env.GRAPH_USER_ID ||
      process.env.GRAPH_USER_EMAIL ||
      process.env.SMTP_USER ||
      ""
  ).trim();

  if (!tenantId || !clientId || !clientSecret || !senderUser) {
    throw new GraphMailSendError(
      500,
      "GRAPH_APP_CONFIG_MISSING",
      "Graph app mail configuration is missing"
    );
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    senderUser,
  };
}

export function getApplicationGraphMailboxUser(): string {
  return resolveApplicationGraphConfig().senderUser;
}

export async function getApplicationGraphClient(): Promise<{
  client: Client;
  senderUser: string;
}> {
  const cfg = resolveApplicationGraphConfig();
  const credential = new ClientSecretCredential(
    cfg.tenantId,
    cfg.clientId,
    cfg.clientSecret
  );
  const token = await credential.getToken("https://graph.microsoft.com/.default");
  const accessToken = String(token?.token || "").trim();
  if (!accessToken) {
    throw new GraphMailSendError(
      500,
      "GRAPH_APP_TOKEN_MISSING",
      "Failed to acquire application Graph token"
    );
  }

  return {
    senderUser: cfg.senderUser,
    client: Client.init({
      authProvider: (done) => done(null, accessToken),
    }),
  };
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

async function readSentMessageIds(
  client: Client,
  senderUser: string,
  draft: any
): Promise<GraphSentMessageIds> {
  const draftIds: GraphSentMessageIds = {
    graphMessageId: stringOrNull(draft?.id),
    conversationId: stringOrNull(draft?.conversationId),
    internetMessageId: stringOrNull(draft?.internetMessageId),
  };

  const userPath = `/users/${encodeURIComponent(senderUser)}`;
  if (draftIds.graphMessageId) {
    try {
      const sent = await client
        .api(`${userPath}/messages/${encodeURIComponent(draftIds.graphMessageId)}`)
        .header("Prefer", 'IdType="ImmutableId"')
        .select("id,conversationId,internetMessageId")
        .get();
      return {
        graphMessageId: stringOrNull(sent?.id) || draftIds.graphMessageId,
        conversationId: stringOrNull(sent?.conversationId) || draftIds.conversationId,
        internetMessageId: stringOrNull(sent?.internetMessageId) || draftIds.internetMessageId,
      };
    } catch {
      // Message id may change after send; fall through to sent-items lookup.
    }
  }

  if (draftIds.conversationId) {
    try {
      const listed = await client
        .api(`${userPath}/mailFolders/sentitems/messages`)
        .header("Prefer", 'IdType="ImmutableId"')
        .filter(`conversationId eq '${draftIds.conversationId.replace(/'/g, "''")}'`)
        .select("id,conversationId,internetMessageId")
        .top(1)
        .orderby("sentDateTime DESC")
        .get();
      const sent = Array.isArray(listed?.value) ? listed.value[0] : null;
      if (sent) {
        return {
          graphMessageId: stringOrNull(sent?.id) || draftIds.graphMessageId,
          conversationId: stringOrNull(sent?.conversationId) || draftIds.conversationId,
          internetMessageId: stringOrNull(sent?.internetMessageId) || draftIds.internetMessageId,
        };
      }
    } catch {
      // Keep draft-time identifiers.
    }
  }

  return draftIds;
}

export async function sendMailWithApplicationGraph(
  input: SendMailAppInput
): Promise<GraphSentMessageIds> {
  const { client, senderUser } = await getApplicationGraphClient();
  const userPath = `/users/${encodeURIComponent(senderUser)}`;

  try {
    const draft = await client
      .api(`${userPath}/messages`)
      .header("Prefer", 'IdType="ImmutableId"')
      .post({
        subject: input.subject,
        body: {
          contentType: "HTML",
          content: input.htmlBody,
        },
        toRecipients: [
          {
            emailAddress: {
              address: input.to,
            },
          },
        ],
        attachments: mapGraphAttachments(input.attachments),
      });

    const draftId = stringOrNull(draft?.id);
    if (!draftId) {
      throw new GraphMailSendError(502, "GRAPH_DRAFT_ID_MISSING", "Failed to create Graph draft message");
    }

    await client.api(`${userPath}/messages/${encodeURIComponent(draftId)}/send`).post({});
    return await readSentMessageIds(client, senderUser, draft);
  } catch (err: any) {
    if (err instanceof GraphMailSendError) throw err;
    throw mapGraphError(err);
  }
}

