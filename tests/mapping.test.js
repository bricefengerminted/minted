import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCsv,
  suggestFieldMappings,
  buildMappedRecords,
  validateMappedRecords,
  getMissingRequiredMappings,
} from "../src/mapping.js";

test("parseCsv handles quotes and duplicate headers", () => {
  const csv = [
    "First Name,Last Name,Email,Email",
    '"Ana","Ng","ana@example.com","ana@example.com"',
    '"Bob","Li","bob@example.com","bob@example.com"',
  ].join("\n");

  const parsed = parseCsv(csv);
  assert.equal(parsed.headers[0], "First Name");
  assert.equal(parsed.headers[2], "Email");
  assert.equal(parsed.headers[3], "Email (2)");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0][0], "Ana");
  assert.equal(parsed.rows[1][2], "bob@example.com");
});

test("suggestFieldMappings maps required fields using header aliases", () => {
  const headers = ["given_name", "surname", "email_address", "mobile"];
  const rows = [
    ["Ari", "Stone", "ari@example.com", "+1 (555) 111-9999"],
    ["Sam", "Long", "sam@example.com", "+1 (555) 222-9999"],
  ];

  const result = suggestFieldMappings(headers, rows);
  assert.equal(result.mappings.firstName, "given_name");
  assert.equal(result.mappings.lastName, "surname");
  assert.equal(result.mappings.email, "email_address");
  assert.equal(result.mappings.phone, "mobile");
});

test("validateMappedRecords returns invalid rows and missing mappings", () => {
  const headers = ["First Name", "Last Name", "Email", "Phone"];
  const rows = [
    ["Alice", "Cooper", "alice@example.com", "555-123-9999"],
    ["Rob", "", "invalid-at-email", "12"],
  ];
  const mappings = {
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    phone: "Phone",
    company: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  };

  const missingRequired = getMissingRequiredMappings(mappings);
  assert.equal(missingRequired.length, 0);

  const mapped = buildMappedRecords(headers, rows, mappings);
  const validation = validateMappedRecords(mapped);

  assert.equal(validation.validRecords.length, 1);
  assert.equal(validation.invalidRecords.length, 1);
  assert.equal(validation.invalidRecords[0].rowNumber, 3);
  assert.equal(validation.invalidRecords[0].issues.length, 3);
});
