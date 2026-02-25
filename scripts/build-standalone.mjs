import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const htmlPath = path.join(root, "index.html");
const cssPath = path.join(root, "styles.css");
const mappingPath = path.join(root, "src", "mapping.js");
const appPath = path.join(root, "src", "app.js");
const outputPath = path.join(root, "address-book-standalone.html");

function stripModuleSyntax(mappingSource, appSource) {
  const mappingWithoutExports = mappingSource.replace(/^export\s+/gm, "");
  const appWithoutImport = appSource.replace(
    /import\s*\{[\s\S]*?\}\s*from\s*"\.\/mapping\.js";\n?/,
    ""
  );

  return `${mappingWithoutExports}\n\n${appWithoutImport}`;
}

function inlineAssets(htmlSource, cssSource, jsSource) {
  const stylesheetTagRegex = /<link rel="stylesheet" href="\.\/styles\.css" \/>/;
  const scriptTagRegex = /<script type="module" src="\.\/src\/app\.js"><\/script>/;

  if (!stylesheetTagRegex.test(htmlSource)) {
    throw new Error("Could not find stylesheet link tag in index.html.");
  }
  if (!scriptTagRegex.test(htmlSource)) {
    throw new Error("Could not find app module script tag in index.html.");
  }

  return htmlSource
    .replace(stylesheetTagRegex, `<style>\n${cssSource}\n</style>`)
    .replace(scriptTagRegex, `<script>\n${jsSource}\n</script>`);
}

async function buildStandaloneHtml() {
  const [htmlSource, cssSource, mappingSource, appSource] = await Promise.all([
    readFile(htmlPath, "utf8"),
    readFile(cssPath, "utf8"),
    readFile(mappingPath, "utf8"),
    readFile(appPath, "utf8"),
  ]);

  const combinedJs = stripModuleSyntax(mappingSource, appSource);
  const standaloneHtml = inlineAssets(htmlSource, cssSource, combinedJs);
  await writeFile(outputPath, standaloneHtml, "utf8");
  console.log(`Created ${path.basename(outputPath)} at ${outputPath}`);
}

buildStandaloneHtml().catch((error) => {
  console.error("Failed to build standalone HTML:", error.message);
  process.exitCode = 1;
});
