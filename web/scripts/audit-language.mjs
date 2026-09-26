// Static source inventory only. Never import or execute application modules.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const root = path.resolve("src");
const rows = [];
const chinese = /[\u3400-\u9fff]/u;
function visitFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    let value, kind;
    if (ts.isJsxText(node)) {
      value = node.text.replace(/\s+/g, " ").trim();
      kind = "jsx-text";
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      value = node.text;
      kind = ts.isJsxAttribute(node.parent) ? "jsx-attribute" : "literal";
    } else if (ts.isTemplateExpression(node)) {
      value =
        node.head.text +
        node.templateSpans.map((s, i) => `{${i}}` + s.literal.text).join("");
      kind = "template";
    }
    if (value && chinese.test(value)) {
      const parent = node.parent;
      const property = ts.isPropertyAssignment(parent)
        ? parent.name.getText(source)
        : ts.isJsxAttribute(parent)
          ? parent.name.text
          : null;
      const bilingual =
        ts.isCallExpression(parent) &&
        parent.expression.getText(source) === "tr" &&
        parent.arguments[0] === node &&
        parent.arguments.length === 2;
      const line =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      rows.push({
        id: crypto
          .createHash("sha256")
          .update(value)
          .digest("hex")
          .slice(0, 16),
        text: value,
        file: path.relative(root, file).replaceAll("\\", "/"),
        line,
        kind,
        property,
        bilingual,
        review: bilingual
          ? "authored-bilingual"
          : kind.startsWith("jsx")
            ? "ui-copy"
            : "classify-ui-vs-data",
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file) && !file.endsWith(".d.ts")) visitFile(file);
  }
}
walk(root);
const output = path.resolve("../_verify/mcp-v64/language-inventory.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      note: "Source inventory, not a translation-completion claim. Literals include domain data and examples; classify before translating. Never mutate user data or internal enum values.",
      occurrences: rows.length,
      uniqueStrings: new Set(rows.map((r) => r.text)).size,
      files: new Set(rows.map((r) => r.file)).size,
      authoredBilingual: rows.filter((r) => r.bilingual).length,
      rows,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    occurrences: rows.length,
    uniqueStrings: new Set(rows.map((r) => r.text)).size,
    files: new Set(rows.map((r) => r.file)).size,
    authoredBilingual: rows.filter((r) => r.bilingual).length,
  }),
);
