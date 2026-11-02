import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildApolloEnrichmentMessages,
  isSamplePlaceholder,
  mergeEnrichedContactIntoForm,
} from "./apolloUi";

const blankForm = {
  CompanyName: "",
  ContactName: "",
  ContactTitle: "",
  ContactEmail: "",
  ContactPhone: "",
  ContactLocation: "",
  LinkedInURL: "",
};

test("sample placeholders are not treated as real contact values", () => {
  assert.equal(isSamplePlaceholder("+91 98765 43210", "phone"), true);
  assert.equal(isSamplePlaceholder("email@company.com", "email"), true);
  assert.equal(isSamplePlaceholder("+1 202 555 0100", "phone"), false);
});

test("existing user-entered phone is preserved when Apollo returns no number", () => {
  const merged = mergeEnrichedContactIntoForm(
    { ...blankForm, ContactPhone: "+1 202 555 0100", ContactEmail: "owner@example.test" },
    { name: "Ada Lovelace", workEmail: null, phone: null },
  );
  assert.equal(merged.ContactPhone, "+1 202 555 0100");
  assert.equal(merged.ContactEmail, "owner@example.test");
  assert.equal(merged.ContactName, "Ada Lovelace");
});

test("sample placeholder phones are replaced or cleared instead of looking enriched", () => {
  const replaced = mergeEnrichedContactIntoForm(
    { ...blankForm, ContactPhone: "+91 98765 43210" },
    { phone: "+15550199" },
  );
  assert.equal(replaced.ContactPhone, "+15550199");

  const cleared = mergeEnrichedContactIntoForm(
    { ...blankForm, ContactPhone: "+91 98765 43210" },
    { phone: null },
  );
  assert.equal(cleared.ContactPhone, "");
});

test("success messages require actual enriched fields", () => {
  const success = buildApolloEnrichmentMessages({
    hasName: true,
    hasEmail: true,
    hasPhone: true,
    phoneStatus: "found",
  });
  assert.match(success.statusMessage, /Work email and phone number applied/);
  assert.equal(success.errorMessage, "");

  const emailOnly = buildApolloEnrichmentMessages({
    hasName: true,
    hasEmail: true,
    hasPhone: false,
    phoneStatus: "not_requested",
  });
  assert.match(emailOnly.statusMessage, /Phone reveal disabled/);
  assert.doesNotMatch(emailOnly.statusMessage, /Contact enriched successfully/);
  assert.doesNotMatch(emailOnly.statusMessage, /Phone number was not requested/);

  const pending = buildApolloEnrichmentMessages({
    hasName: true,
    hasEmail: true,
    hasPhone: false,
    phoneStatus: "pending",
  });
  assert.match(pending.statusMessage, /Phone lookup pending/);

  const timeout = buildApolloEnrichmentMessages({
    hasName: true,
    hasEmail: true,
    hasPhone: false,
    phoneStatus: "timeout",
  });
  assert.match(timeout.statusMessage, /timed out/);

  const none = buildApolloEnrichmentMessages({
    hasName: false,
    hasEmail: false,
    hasPhone: false,
    phoneStatus: "not_requested",
  });
  assert.equal(none.statusMessage, "");
  assert.match(none.errorMessage, /did not return contact details/);
});
