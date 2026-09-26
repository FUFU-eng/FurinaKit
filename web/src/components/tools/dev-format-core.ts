/** Validate JSON, but never serialize its Number values: preserve every token. */
export function formatJsonExact(input: string, minify = false): string {
  JSON.parse(input);
  const tokens = input.match(/"(?:\\[\s\S]|[^"\\])*"|[^\s{}\[\],:]+|[{}\[\],:]/g) ?? [];
  if (minify) return tokens.join("");
  let depth = 0;
  let output = "";
  const newline = () => "\n" + "  ".repeat(depth);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{" || token === "[") {
      output += token;
      if (tokens[i + 1] === (token === "{" ? "}" : "]")) output += tokens[++i];
      else { depth++; output += newline(); }
    } else if (token === "}" || token === "]") {
      depth--; output += newline() + token;
    } else if (token === ",") output += token + newline();
    else if (token === ":") output += ": ";
    else output += token;
  }
  return output;
}

export function jsonToTypeScript(input: string): string {
  const value: unknown = JSON.parse(input);
  function typeOf(v: unknown, depth = 0): string {
    if (depth > 100) throw new Error("嵌套超过100层，无法生成类型");
    if (v === null) return "null";
    if (Array.isArray(v)) {
      const types = [...new Set(v.map(item => typeOf(item, depth + 1)))];
      return types.length ? `Array<${types.join(" | ")}>` : "unknown[]";
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      if (!entries.length) return "{}";
      return `{\n${entries.map(([k, val]) => `${"  ".repeat(depth + 1)}${JSON.stringify(k)}: ${typeOf(val, depth + 1)};`).join("\n")}\n${"  ".repeat(depth)}}`;
    }
    return typeof v;
  }
  const type = typeOf(value);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? `interface Root ${type}` : `type Root = ${type};`;
}

export async function formatCode(input: string, language: "js" | "html"): Promise<string> {
  const prettier = await import("prettier/standalone");
  const plugins = language === "js"
    ? await Promise.all([import("prettier/plugins/babel"), import("prettier/plugins/estree")])
    : [await import("prettier/plugins/html")];
  return (await prettier.format(input, {
    parser: language === "js" ? "babel" : "html", plugins: plugins.map(plugin => plugin.default),
    tabWidth: 2, htmlWhitespaceSensitivity: "strict", embeddedLanguageFormatting: "off",
  })).trimEnd();
}
