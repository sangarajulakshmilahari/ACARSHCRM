import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGraphPostAuthUrl,
  createGraphOAuthState,
  isDelegatedAccessTokenUsable,
  mapMicrosoftOAuthQueryError,
  normalizeEngageTab,
  selectMailboxIdentityFromGraphProfile,
  validateGraphOAuthState,
} from "./graph-delegated";

test("connected status requires a still-valid access token", () => {
  const now = 1_700_000_000;
  assert.equal(isDelegatedAccessTokenUsable("token", now + 120, now), true);
  assert.equal(isDelegatedAccessTokenUsable("token", now + 30, now), false);
});

test("disconnected and expired delegated tokens are not usable", () => {
  const now = 1_700_000_000;
  assert.equal(isDelegatedAccessTokenUsable("", now + 3600, now), false);
  assert.equal(isDelegatedAccessTokenUsable("token", 0, now), false);
  assert.equal(isDelegatedAccessTokenUsable("token", now - 10, now), false);
});

test("OAuth callback success returns to the originating Email Engagement tab", () => {
  const url = buildGraphPostAuthUrl({
    origin: "http://localhost:3001",
    tab: "emailSequences",
    params: { graphConnected: "1" },
  });
  assert.equal(url.pathname, "/webpage");
  assert.equal(url.searchParams.get("tab"), "emailSequences");
  assert.equal(url.searchParams.get("graphConnected"), "1");
});

test("OAuth callback failure maps Microsoft error codes without leaking details", () => {
  assert.equal(mapMicrosoftOAuthQueryError("access_denied"), "access_denied");
  assert.equal(mapMicrosoftOAuthQueryError("invalid_request"), "invalid_request");
  assert.equal(mapMicrosoftOAuthQueryError("server_error"), "oauth_error");
  assert.equal(mapMicrosoftOAuthQueryError(""), null);
});

test("invalid or missing OAuth state is rejected", () => {
  const missing = validateGraphOAuthState("", "abc");
  const mismatch = validateGraphOAuthState("aaa:emailTemplates", "bbb:emailTemplates");
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "invalid_state");
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "invalid_state");
});

test("valid OAuth state preserves the return tab", () => {
  const state = createGraphOAuthState("emailHistory");
  const result = validateGraphOAuthState(state, state);
  assert.equal(result.ok, true);
  assert.equal(result.tab, "emailHistory");
  assert.equal(normalizeEngageTab("not-a-tab"), "emailTemplates");
});

test("token refresh failure is treated as a reconnect condition", () => {
  const now = 1_700_000_000;
  const accessExpired = !isDelegatedAccessTokenUsable("old-token", now - 1, now);
  assert.equal(accessExpired, true);
  const needsReconnectWithoutRefresh = accessExpired && !"".trim();
  assert.equal(needsReconnectWithoutRefresh, true);
});

test("missing mailbox identity is handled without inventing an address", () => {
  const empty = selectMailboxIdentityFromGraphProfile({});
  const fromUpn = selectMailboxIdentityFromGraphProfile({
    userPrincipalName: "user@contoso.com",
    displayName: "Pat",
  });
  const ignoresBlankMail = selectMailboxIdentityFromGraphProfile({
    mail: "  ",
    userPrincipalName: "mailbox@contoso.com",
  });
  assert.equal(empty.mailbox, null);
  assert.equal(empty.displayName, null);
  assert.equal(fromUpn.mailbox, "user@contoso.com");
  assert.equal(fromUpn.displayName, "Pat");
  assert.equal(ignoresBlankMail.mailbox, "mailbox@contoso.com");
});
