function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractFirstName(contactName: string): string {
  const normalized = String(contactName || "").trim();
  if (!normalized) return "";
  return normalized.split(/\s+/)[0] || "";
}

function replaceLegacyBestRegardsTeam(body: string, senderName: string): string {
  const normalizedSender = String(senderName || "").trim();
  if (!normalizedSender) return body;

  return String(body || "").replace(
    /(\bBest\s*Regards\b\s*,?\s*(?:\r?\n)+)(Adroitent\s+Team)\b/gi,
    `$1${normalizedSender}`
  );
}

export function renderTemplateVariables(
  template: string,
  args: { contactName: string; companyName: string; senderName?: string }
): string {
  const contactName = String(args.contactName || "").trim();
  const companyName = String(args.companyName || "").trim();
  const senderName = String(args.senderName || "").trim();

  return String(template || "")
    .replace(/{{\s*firstName\s*}}/gi, extractFirstName(contactName))
    .replace(/{{\s*companyName\s*}}/gi, companyName)
    .replace(/{{\s*contactName\s*}}/gi, contactName)
    .replace(/{{\s*senderName\s*}}/gi, senderName);
}

export function renderEmailTemplateWithVariables(
  template: string,
  args: { contactName: string; companyName: string; senderName?: string }
): string {
  const rendered = renderTemplateVariables(template, args);
  return replaceLegacyBestRegardsTeam(rendered, String(args.senderName || ""));
}

export function plainTextToEmailHtml(body: string): string {
  return plainTextToEmailHtmlWithInlineImages(body, []);
}

type InlineImageOptions = {
  inlineContentIds?: string[];
};

function plainTextToEmailHtmlWithInlineImages(body: string, inlineContentIds: string[]): string {
  const normalized = String(body || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.trim()) return "";

  const allowedInlineIds = new Set(
    (Array.isArray(inlineContentIds) ? inlineContentIds : [])
      .map((v) => String(v || "").trim())
      .filter(Boolean)
  );

  const INLINE_TOKEN_REGEX = /{{\s*inlineImage\s*:\s*([a-zA-Z0-9._-]{1,120})\s*}}/gi;

  function renderLine(rawLine: string): string {
    const line = String(rawLine || "");
    let cursor = 0;
    let html = "";
    let match: RegExpExecArray | null;
    INLINE_TOKEN_REGEX.lastIndex = 0;

    while ((match = INLINE_TOKEN_REGEX.exec(line))) {
      const full = String(match[0] || "");
      const cid = String(match[1] || "").trim();
      const index = Number(match.index || 0);

      html += escapeHtml(line.slice(cursor, index));

      if (cid && allowedInlineIds.has(cid)) {
        html += `<img src="cid:${escapeHtml(cid)}" alt="Inline image" width="180" style="width:180px;max-width:180px;height:auto;display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;">`;
      } else {
        html += escapeHtml(full);
      }

      cursor = index + full.length;
    }

    html += escapeHtml(line.slice(cursor));
    return html;
  }

  const paragraphs = normalized.split(/\n[ \t]*\n+/);
  const htmlParagraphs = paragraphs
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => {
      const htmlLines = paragraph.split("\n").map((line) => renderLine(line.trimEnd()));
      return `<p>${htmlLines.join("<br>")}</p>`;
    });

  return htmlParagraphs.join("\n");
}

export function plainTextToEmailHtmlWithOptions(body: string, options?: InlineImageOptions): string {
  return plainTextToEmailHtmlWithInlineImages(body, options?.inlineContentIds || []);
}

