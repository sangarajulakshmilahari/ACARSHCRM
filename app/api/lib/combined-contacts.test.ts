import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyCombinedContactTransform,
  parseCombinedContactCell,
  parseCombinedContactSegment,
} from "./combined-contacts";

test("parses name <email>, name (email), and standalone email", () => {
  const angle = parseCombinedContactSegment("Venkata Naresh Karuturi <Venkata.Karuturi@Suneratech.com>");
  assert.equal(angle.valid, true);
  assert.equal(angle.name, "Venkata Naresh Karuturi");
  assert.equal(angle.email.toLowerCase(), "venkata.karuturi@suneratech.com");

  const paren = parseCombinedContactSegment("Jane Doe (jane@acme.com)");
  assert.equal(paren.valid, true);
  assert.equal(paren.name, "Jane Doe");
  assert.equal(paren.email, "jane@acme.com");

  const standalone = parseCombinedContactSegment("only@acme.com");
  assert.equal(standalone.email, "only@acme.com");
  assert.equal(standalone.valid, false);
  assert.equal(standalone.issues.some((item) => /name missing/i.test(item)), true);
});

test("splits multiple contacts on semicolons and line breaks without mixing pairs", () => {
  const contacts = parseCombinedContactCell(
    "Venu Chanda <Venu.Chanda@Suneratech.com>; Hassan Mohammad Basha <HassanBasha@Suneratech.com>\nPat Lee <pat@acme.com>",
  );
  assert.equal(contacts.length, 3);
  assert.equal(contacts[0]?.name, "Venu Chanda");
  assert.equal(contacts[0]?.email.toLowerCase(), "venu.chanda@suneratech.com");
  assert.equal(contacts[1]?.name, "Hassan Mohammad Basha");
  assert.equal(contacts[2]?.name, "Pat Lee");
  assert.equal(contacts.every((item) => item.valid), true);
});

test("missing names, invalid emails, and ambiguous multi-email entries are flagged instead of guessed", () => {
  const missingName = parseCombinedContactSegment("<nobody@acme.com>");
  assert.equal(missingName.valid, false);
  assert.match(missingName.issues[0] || "", /name missing/i);

  const invalidEmail = parseCombinedContactSegment("Sam Jones <not-an-email>");
  assert.equal(invalidEmail.valid, false);
  assert.match(invalidEmail.issues[0] || "", /not a valid email/i);

  const ambiguous = parseCombinedContactSegment("Sam <a@acme.com> also <b@acme.com>");
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.valid, false);
  assert.equal(ambiguous.email, "");
});

test("extract transforms stay single-value and split keeps every valid contact", () => {
  const cell = "Venu Chanda <Venu.Chanda@Suneratech.com>; Hassan Mohammad Basha <HassanBasha@Suneratech.com>";
  const nameOnly = applyCombinedContactTransform(cell, "extract_contact_name");
  assert.equal(nameOnly.contactName, "");
  assert.match(nameOnly.issues[0] || "", /multiple contacts/i);

  const emailOnly = applyCombinedContactTransform("Jane Doe <jane@acme.com>", "extract_email");
  assert.equal(emailOnly.contactEmail, "jane@acme.com");

  const split = applyCombinedContactTransform(cell, "split_contacts");
  assert.equal(split.contacts.filter((item) => item.valid).length, 2);
  assert.equal(split.contactName, "Venu Chanda");
});
