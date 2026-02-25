export const TARGET_FIELDS = [
  { key: "firstName", label: "First Name", required: true },
  { key: "lastName", label: "Last Name", required: true },
  { key: "email", label: "Email", required: true },
  { key: "phone", label: "Phone", required: false },
  { key: "company", label: "Company", required: false },
  { key: "addressLine1", label: "Address Line 1", required: false },
  { key: "addressLine2", label: "Address Line 2", required: false },
  { key: "city", label: "City", required: false },
  { key: "state", label: "State/Province", required: false },
  { key: "postalCode", label: "Postal Code", required: false },
  { key: "country", label: "Country", required: false },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_REGEX = /^[A-Za-z0-9\- ]{3,12}$/;
const PHONE_DIGIT_REGEX = /\d/g;

const FIELD_SYNONYMS = {
  firstName: [
    "first name",
    "firstname",
    "given name",
    "forename",
    "fname",
    "first",
  ],
  lastName: ["last name", "lastname", "surname", "family name", "lname", "last"],
  email: ["email", "email address", "e-mail", "mail"],
  phone: ["phone", "mobile", "cell", "telephone", "phone number", "mobile number"],
  company: ["company", "organization", "organisation", "business", "employer"],
  addressLine1: ["address", "address 1", "street", "street address", "line1"],
  addressLine2: ["address 2", "line2", "apartment", "suite", "unit"],
  city: ["city", "town", "municipality"],
  state: ["state", "province", "region", "county"],
  postalCode: ["zip", "zip code", "postal", "postal code", "postcode"],
  country: ["country", "nation"],
};

const NORMALIZED_FIELD_SYNONYMS = Object.fromEntries(
  Object.entries(FIELD_SYNONYMS).map(([fieldKey, aliases]) => [
    fieldKey,
    aliases.map((alias) => normalize(alias)),
  ])
);

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureUniqueHeaders(headers) {
  const counts = new Map();
  return headers.map((header, index) => {
    const baseHeader = header || `Column ${index + 1}`;
    const seen = counts.get(baseHeader) ?? 0;
    counts.set(baseHeader, seen + 1);
    if (seen === 0) {
      return baseHeader;
    }
    return `${baseHeader} (${seen + 1})`;
  });
}

export function parseCsv(csvText) {
  if (typeof csvText !== "string" || csvText.trim() === "") {
    return { headers: [], rows: [] };
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      row.push(field);
      field = "";
      if (row.length > 1 || (row[0] ?? "").trim() !== "") {
        rows.push(row.map((cell) => cell.trim()));
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || (row[0] ?? "").trim() !== "") {
      rows.push(row.map((cell) => cell.trim()));
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = ensureUniqueHeaders(rows[0].map((header) => header.trim()));
  const body = rows.slice(1).map((cells) =>
    headers.map((_, index) => {
      return String(cells[index] ?? "").trim();
    })
  );

  return { headers, rows: body };
}

function scoreHeaderMatch(header, fieldKey) {
  const normalizedHeader = normalize(header);
  if (!normalizedHeader) {
    return 0;
  }

  const aliases = NORMALIZED_FIELD_SYNONYMS[fieldKey] ?? [];
  if (aliases.includes(normalizedHeader)) {
    return 1;
  }

  const partialAlias = aliases.find((alias) => {
    return normalizedHeader.includes(alias) || alias.includes(normalizedHeader);
  });
  if (partialAlias) {
    return 0.8;
  }

  const headerTokens = normalizedHeader.split(" ");
  let bestShared = 0;
  for (const alias of aliases) {
    const aliasTokens = alias.split(" ");
    const shared = aliasTokens.filter((token) => headerTokens.includes(token)).length;
    if (shared > 0) {
      bestShared = Math.max(bestShared, shared / Math.max(aliasTokens.length, headerTokens.length));
    }
  }

  if (bestShared === 0) {
    return 0;
  }
  return Math.max(0.35, Math.min(0.7, bestShared));
}

function getNonEmptyRatio(values, predicate) {
  const nonEmpty = values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value !== "");

  if (nonEmpty.length === 0) {
    return 0;
  }

  const matched = nonEmpty.filter((value) => predicate(value)).length;
  return matched / nonEmpty.length;
}

function scoreValueShape(values, fieldKey) {
  switch (fieldKey) {
    case "email":
      return getNonEmptyRatio(values, (value) => EMAIL_REGEX.test(value));
    case "phone":
      return getNonEmptyRatio(values, (value) => {
        const digitCount = (value.match(PHONE_DIGIT_REGEX) ?? []).length;
        return digitCount >= 7;
      });
    case "postalCode":
      return getNonEmptyRatio(values, (value) => ZIP_REGEX.test(value));
    case "state":
      return getNonEmptyRatio(values, (value) => {
        return /^[A-Za-z]{2,30}$/.test(value) || /^[A-Za-z]{2}$/.test(value);
      });
    case "country":
      return getNonEmptyRatio(values, (value) => /^[A-Za-z ]{2,40}$/.test(value));
    case "firstName":
    case "lastName":
      return getNonEmptyRatio(values, (value) => /^[A-Za-z' -]{1,40}$/.test(value));
    case "addressLine1":
      return getNonEmptyRatio(values, (value) => /\d/.test(value) || value.length >= 8);
    case "addressLine2":
      return getNonEmptyRatio(values, (value) => /suite|apt|unit|#|floor|fl/i.test(value));
    case "city":
      return getNonEmptyRatio(values, (value) => /^[A-Za-z' .-]{2,40}$/.test(value));
    case "company":
      return getNonEmptyRatio(values, (value) => /[A-Za-z]/.test(value) && value.length >= 2);
    default:
      return 0;
  }
}

function buildReason(fieldLabel, headerScore, valueScore) {
  if (headerScore >= 0.9 && valueScore >= 0.5) {
    return `${fieldLabel} matched by header name and sample values.`;
  }
  if (headerScore >= 0.8) {
    return `${fieldLabel} matched strongly by header name.`;
  }
  if (valueScore >= 0.7) {
    return `${fieldLabel} inferred mostly from sample value patterns.`;
  }
  return `${fieldLabel} mapped with a weak signal; please review.`;
}

function confidenceFromScore(score) {
  if (score >= 0.8) {
    return "high";
  }
  if (score >= 0.58) {
    return "medium";
  }
  return "low";
}

export function suggestFieldMappings(headers, rows) {
  const mappings = Object.fromEntries(TARGET_FIELDS.map((field) => [field.key, ""]));
  const suggestions = {};

  if (!headers.length) {
    return { mappings, suggestions };
  }

  const sampleRows = rows.slice(0, 50);
  const columns = headers.map((_, headerIndex) =>
    sampleRows.map((row) => String(row[headerIndex] ?? "").trim())
  );

  const candidates = [];
  for (const field of TARGET_FIELDS) {
    for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
      const header = headers[headerIndex];
      const headerScore = scoreHeaderMatch(header, field.key);
      const valueScore = scoreValueShape(columns[headerIndex], field.key);
      const score = headerScore * 0.72 + valueScore * 0.28;

      if (score > 0) {
        candidates.push({
          fieldKey: field.key,
          fieldLabel: field.label,
          header,
          headerIndex,
          score,
          headerScore,
          valueScore,
        });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  const assignedFields = new Set();
  const assignedHeaders = new Set();
  for (const candidate of candidates) {
    if (assignedFields.has(candidate.fieldKey) || assignedHeaders.has(candidate.headerIndex)) {
      continue;
    }

    const field = TARGET_FIELDS.find((value) => value.key === candidate.fieldKey);
    const threshold = field?.required ? 0.3 : 0.38;
    if (candidate.score < threshold) {
      continue;
    }

    mappings[candidate.fieldKey] = candidate.header;
    suggestions[candidate.fieldKey] = {
      sourceHeader: candidate.header,
      score: Number(candidate.score.toFixed(2)),
      confidence: confidenceFromScore(candidate.score),
      reason: buildReason(candidate.fieldLabel, candidate.headerScore, candidate.valueScore),
    };
    assignedFields.add(candidate.fieldKey);
    assignedHeaders.add(candidate.headerIndex);
  }

  for (const field of TARGET_FIELDS) {
    if (!suggestions[field.key]) {
      suggestions[field.key] = {
        sourceHeader: "",
        score: 0,
        confidence: "low",
        reason: `No reliable ${field.label.toLowerCase()} match found.`,
      };
    }
  }

  return { mappings, suggestions };
}

export function getMissingRequiredMappings(mappings) {
  return TARGET_FIELDS.filter((field) => field.required && !mappings[field.key]);
}

export function getDuplicateSourceMappings(mappings) {
  const sourceToFields = new Map();
  for (const field of TARGET_FIELDS) {
    const source = mappings[field.key];
    if (!source) {
      continue;
    }
    const existing = sourceToFields.get(source) ?? [];
    existing.push(field);
    sourceToFields.set(source, existing);
  }

  const duplicates = [];
  for (const [sourceHeader, fields] of sourceToFields.entries()) {
    if (fields.length > 1) {
      duplicates.push({
        sourceHeader,
        fields,
      });
    }
  }
  return duplicates;
}

export function buildMappedRecords(headers, rows, mappings) {
  const headerToIndex = new Map(headers.map((header, index) => [header, index]));

  return rows.map((row, rowIndex) => {
    const source = Object.fromEntries(
      headers.map((header, headerIndex) => [header, String(row[headerIndex] ?? "").trim()])
    );

    const mapped = {
      __rowNumber: rowIndex + 2,
      __source: source,
    };

    for (const field of TARGET_FIELDS) {
      const sourceHeader = mappings[field.key];
      if (!sourceHeader) {
        mapped[field.key] = "";
        continue;
      }

      const sourceIndex = headerToIndex.get(sourceHeader);
      mapped[field.key] = String(row[sourceIndex] ?? "").trim();
    }

    return mapped;
  });
}

function validateMappedValue(fieldKey, value) {
  if (!value) {
    return null;
  }

  switch (fieldKey) {
    case "email":
      return EMAIL_REGEX.test(value) ? null : "Email is not in a valid format.";
    case "phone": {
      const digitCount = (value.match(PHONE_DIGIT_REGEX) ?? []).length;
      return digitCount >= 7 ? null : "Phone must contain at least 7 digits.";
    }
    case "postalCode":
      return ZIP_REGEX.test(value) ? null : "Postal code is not in a valid format.";
    default:
      return null;
  }
}

export function validateMappedRecords(mappedRecords) {
  const validRecords = [];
  const invalidRecords = [];
  const invalidFieldCounts = Object.fromEntries(TARGET_FIELDS.map((field) => [field.key, 0]));

  for (const record of mappedRecords) {
    const issues = [];

    for (const field of TARGET_FIELDS) {
      const value = String(record[field.key] ?? "").trim();
      if (field.required && !value) {
        invalidFieldCounts[field.key] += 1;
        issues.push({
          field: field.key,
          label: field.label,
          message: `${field.label} is required.`,
        });
        continue;
      }

      const validationError = validateMappedValue(field.key, value);
      if (validationError) {
        invalidFieldCounts[field.key] += 1;
        issues.push({
          field: field.key,
          label: field.label,
          message: validationError,
        });
      }
    }

    if (issues.length > 0) {
      invalidRecords.push({
        rowNumber: record.__rowNumber,
        issues,
        record,
      });
    } else {
      validRecords.push(record);
    }
  }

  return {
    validRecords,
    invalidRecords,
    invalidFieldCounts,
  };
}
