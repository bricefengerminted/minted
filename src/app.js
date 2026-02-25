import {
  TARGET_FIELDS,
  parseCsv,
  suggestFieldMappings,
  getMissingRequiredMappings,
  getDuplicateSourceMappings,
  buildMappedRecords,
  validateMappedRecords,
} from "./mapping.js";

const fieldByKey = Object.fromEntries(TARGET_FIELDS.map((field) => [field.key, field]));
const defaultMappings = Object.fromEntries(TARGET_FIELDS.map((field) => [field.key, ""]));

const state = {
  fileName: "",
  headers: [],
  rows: [],
  mappings: { ...defaultMappings },
  suggestions: {},
  mappedRecords: [],
  validation: {
    validRecords: [],
    invalidRecords: [],
    invalidFieldCounts: Object.fromEntries(TARGET_FIELDS.map((field) => [field.key, 0])),
  },
  importedRecords: [],
  showInvalidRows: false,
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  runAiButton: document.querySelector("#runAiButton"),
  uploadStatus: document.querySelector("#uploadStatus"),
  aiSummary: document.querySelector("#aiSummary"),
  mappingSection: document.querySelector("#mappingSection"),
  mappingRows: document.querySelector("#mappingRows"),
  mappingWarnings: document.querySelector("#mappingWarnings"),
  validationSection: document.querySelector("#validationSection"),
  validationSummary: document.querySelector("#validationSummary"),
  invalidToggleButton: document.querySelector("#invalidToggleButton"),
  invalidRowsPanel: document.querySelector("#invalidRowsPanel"),
  invalidRowsBody: document.querySelector("#invalidRowsBody"),
  previewHead: document.querySelector("#previewHead"),
  previewBody: document.querySelector("#previewBody"),
  importButton: document.querySelector("#importButton"),
  importNotice: document.querySelector("#importNotice"),
  importedEmpty: document.querySelector("#importedEmpty"),
  importedTable: document.querySelector("#importedTable"),
  importedBody: document.querySelector("#importedBody"),
};

function createElement(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (typeof text === "string") {
    node.textContent = text;
  }
  return node;
}

function resetWorkingState() {
  state.fileName = "";
  state.headers = [];
  state.rows = [];
  state.mappings = { ...defaultMappings };
  state.suggestions = {};
  state.mappedRecords = [];
  state.validation = {
    validRecords: [],
    invalidRecords: [],
    invalidFieldCounts: Object.fromEntries(TARGET_FIELDS.map((field) => [field.key, 0])),
  };
  state.showInvalidRows = false;

  elements.mappingSection.classList.add("hidden");
  elements.validationSection.classList.add("hidden");
  elements.importButton.disabled = true;
  elements.importNotice.textContent = "";
}

function setUploadStatus(message, tone = "neutral") {
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.classList.remove("tone-neutral", "tone-success", "tone-warning", "tone-error");
  elements.uploadStatus.classList.add(`tone-${tone}`);
}

function renderAiSummary() {
  const suggestions = Object.values(state.suggestions);
  const mapped = suggestions.filter((suggestion) => suggestion.sourceHeader);
  const high = mapped.filter((suggestion) => suggestion.confidence === "high").length;
  const medium = mapped.filter((suggestion) => suggestion.confidence === "medium").length;
  const low = mapped.filter((suggestion) => suggestion.confidence === "low").length;

  elements.aiSummary.textContent = `AI mapped ${mapped.length}/${TARGET_FIELDS.length} fields (${high} high, ${medium} medium, ${low} low confidence).`;
}

function renderMappingWarnings() {
  elements.mappingWarnings.replaceChildren();
  const missingRequired = getMissingRequiredMappings(state.mappings);
  const duplicateMappings = getDuplicateSourceMappings(state.mappings);

  if (missingRequired.length === 0 && duplicateMappings.length === 0) {
    const success = createElement("div", "warning-box warning-ok");
    success.textContent = "Required fields are mapped and no duplicate source columns were detected.";
    elements.mappingWarnings.appendChild(success);
    return;
  }

  if (missingRequired.length > 0) {
    const warning = createElement("div", "warning-box warning-alert");
    warning.textContent = `Required mapping missing: ${missingRequired
      .map((field) => field.label)
      .join(", ")}.`;
    elements.mappingWarnings.appendChild(warning);
  }

  if (duplicateMappings.length > 0) {
    const warning = createElement("div", "warning-box warning-alert");
    warning.textContent = duplicateMappings
      .map((duplicate) => {
        return `Source "${duplicate.sourceHeader}" is assigned to ${duplicate.fields
          .map((field) => field.label)
          .join(" and ")}.`;
      })
      .join(" ");
    elements.mappingWarnings.appendChild(warning);
  }
}

function buildConfidencePill(confidence) {
  const pill = createElement("span", "confidence-pill");
  pill.classList.add(`confidence-${confidence}`);
  pill.textContent = confidence;
  return pill;
}

function renderMappingRows() {
  elements.mappingRows.replaceChildren();

  for (const field of TARGET_FIELDS) {
    const suggestion = state.suggestions[field.key] ?? {
      sourceHeader: "",
      confidence: "low",
      reason: "No suggestion available.",
    };

    const row = createElement("tr");
    const targetCell = createElement("td");
    const fieldLabel = createElement("div", "field-label", field.label);
    targetCell.appendChild(fieldLabel);
    if (field.required) {
      const requiredPill = createElement("span", "required-pill", "Required");
      targetCell.appendChild(requiredPill);
    }

    const suggestionCell = createElement("td");
    if (suggestion.sourceHeader) {
      const title = createElement("div", "suggestion-title", suggestion.sourceHeader);
      suggestionCell.appendChild(title);
      suggestionCell.appendChild(buildConfidencePill(suggestion.confidence));
    } else {
      suggestionCell.appendChild(createElement("div", "suggestion-missing", "No strong suggestion"));
      suggestionCell.appendChild(buildConfidencePill("low"));
    }
    suggestionCell.appendChild(createElement("div", "suggestion-reason", suggestion.reason));

    const mappingCell = createElement("td");
    const select = createElement("select");
    select.dataset.fieldKey = field.key;

    const unmappedOption = createElement("option");
    unmappedOption.value = "";
    unmappedOption.textContent = "-- Do not map --";
    select.appendChild(unmappedOption);

    for (const header of state.headers) {
      const option = createElement("option");
      option.value = header;
      option.textContent = header;
      select.appendChild(option);
    }

    select.value = state.mappings[field.key];
    select.addEventListener("change", (event) => {
      state.mappings[event.currentTarget.dataset.fieldKey] = event.currentTarget.value;
      refreshDerivedState();
    });

    mappingCell.appendChild(select);

    row.appendChild(targetCell);
    row.appendChild(suggestionCell);
    row.appendChild(mappingCell);
    elements.mappingRows.appendChild(row);
  }
}

function renderValidationSummary() {
  const total = state.rows.length;
  const valid = state.validation.validRecords.length;
  const invalid = state.validation.invalidRecords.length;
  const invalidByField = Object.entries(state.validation.invalidFieldCounts)
    .filter(([, count]) => count > 0)
    .map(([fieldKey, count]) => `${fieldByKey[fieldKey].label}: ${count}`)
    .join(", ");

  elements.validationSummary.textContent =
    invalidByField.length > 0
      ? `${valid}/${total} rows are valid. ${invalid} rows contain errors. Invalid by field: ${invalidByField}.`
      : `${valid}/${total} rows are valid. No row-level validation errors were found.`;
}

function renderInvalidRows() {
  const invalid = state.validation.invalidRecords;
  elements.invalidRowsBody.replaceChildren();

  if (invalid.length === 0) {
    const row = createElement("tr");
    const cell = createElement("td", "", "No invalid rows.");
    cell.colSpan = 3;
    row.appendChild(cell);
    elements.invalidRowsBody.appendChild(row);
  } else {
    for (const item of invalid) {
      const row = createElement("tr");
      row.appendChild(createElement("td", "", String(item.rowNumber)));

      const issueCell = createElement("td");
      const list = createElement("ul", "issue-list");
      for (const issue of item.issues) {
        const issueLine = createElement("li", "", `${issue.label}: ${issue.message}`);
        list.appendChild(issueLine);
      }
      issueCell.appendChild(list);
      row.appendChild(issueCell);

      const previewCell = createElement("td");
      const preview = [
        `First Name: ${item.record.firstName || "-"}`,
        `Last Name: ${item.record.lastName || "-"}`,
        `Email: ${item.record.email || "-"}`,
      ].join(" | ");
      previewCell.textContent = preview;
      row.appendChild(previewCell);
      elements.invalidRowsBody.appendChild(row);
    }
  }

  elements.invalidToggleButton.textContent = state.showInvalidRows
    ? "Hide invalid data"
    : `Show invalid data (${invalid.length})`;
  elements.invalidRowsPanel.classList.toggle("hidden", !state.showInvalidRows);
}

function renderValidPreview() {
  const mappedFields = TARGET_FIELDS.filter((field) => state.mappings[field.key]);
  elements.previewHead.replaceChildren();
  elements.previewBody.replaceChildren();

  if (mappedFields.length === 0) {
    const row = createElement("tr");
    const cell = createElement("td", "", "Map at least one field to see preview data.");
    cell.colSpan = 1;
    row.appendChild(cell);
    elements.previewBody.appendChild(row);
    return;
  }

  const headingRow = createElement("tr");
  for (const field of mappedFields) {
    headingRow.appendChild(createElement("th", "", field.label));
  }
  elements.previewHead.appendChild(headingRow);

  const rows = state.validation.validRecords.slice(0, 10);
  if (rows.length === 0) {
    const row = createElement("tr");
    const cell = createElement(
      "td",
      "",
      "No valid records are available with the current mapping and validation rules."
    );
    cell.colSpan = mappedFields.length;
    row.appendChild(cell);
    elements.previewBody.appendChild(row);
    return;
  }

  for (const previewRecord of rows) {
    const row = createElement("tr");
    for (const field of mappedFields) {
      row.appendChild(createElement("td", "", previewRecord[field.key]));
    }
    elements.previewBody.appendChild(row);
  }
}

function renderImportButton() {
  const missingRequired = getMissingRequiredMappings(state.mappings);
  const hasValidRows = state.validation.validRecords.length > 0;
  elements.importButton.disabled = missingRequired.length > 0 || !hasValidRows;
}

function renderImportedContacts() {
  const columns = ["firstName", "lastName", "email", "phone", "company", "city", "state", "country"];
  elements.importedBody.replaceChildren();

  if (state.importedRecords.length === 0) {
    elements.importedEmpty.classList.remove("hidden");
    elements.importedTable.classList.add("hidden");
    return;
  }

  elements.importedEmpty.classList.add("hidden");
  elements.importedTable.classList.remove("hidden");
  for (const record of state.importedRecords) {
    const row = createElement("tr");
    for (const column of columns) {
      row.appendChild(createElement("td", "", record[column] || ""));
    }
    elements.importedBody.appendChild(row);
  }
}

function refreshDerivedState() {
  state.mappedRecords = buildMappedRecords(state.headers, state.rows, state.mappings);
  state.validation = validateMappedRecords(state.mappedRecords);

  renderMappingWarnings();
  renderValidationSummary();
  renderInvalidRows();
  renderValidPreview();
  renderImportButton();
}

function executeAiMapping() {
  const { mappings, suggestions } = suggestFieldMappings(state.headers, state.rows);
  state.mappings = mappings;
  state.suggestions = suggestions;
  renderAiSummary();
  renderMappingRows();
  refreshDerivedState();
}

async function handleFileUpload(file) {
  if (!file) {
    return;
  }

  const csvText = await file.text();
  const parsed = parseCsv(csvText);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    resetWorkingState();
    setUploadStatus("Unable to parse CSV data. Make sure the file has a header row and data rows.", "error");
    return;
  }

  state.fileName = file.name;
  state.headers = parsed.headers;
  state.rows = parsed.rows;
  elements.mappingSection.classList.remove("hidden");
  elements.validationSection.classList.remove("hidden");

  executeAiMapping();
  setUploadStatus(
    `Loaded ${parsed.rows.length} rows from "${file.name}". Review mappings before import.`,
    "success"
  );
}

function initialize() {
  resetWorkingState();
  renderImportedContacts();
  setUploadStatus("Upload a CSV file to begin AI-assisted field mapping.", "neutral");

  elements.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files ?? [];
    await handleFileUpload(file);
  });

  elements.runAiButton.addEventListener("click", () => {
    if (state.headers.length === 0) {
      setUploadStatus("Upload a CSV file first.", "warning");
      return;
    }
    executeAiMapping();
    setUploadStatus("AI mapping was re-run using current file data.", "success");
  });

  elements.invalidToggleButton.addEventListener("click", () => {
    state.showInvalidRows = !state.showInvalidRows;
    renderInvalidRows();
  });

  elements.importButton.addEventListener("click", () => {
    const readyToImport = state.validation.validRecords;
    if (readyToImport.length === 0) {
      elements.importNotice.textContent = "No valid records available to import.";
      return;
    }

    state.importedRecords.push(...readyToImport.map((record) => ({ ...record })));
    elements.importNotice.textContent = `Imported ${readyToImport.length} contacts into your interface.`;
    renderImportedContacts();
  });
}

initialize();
