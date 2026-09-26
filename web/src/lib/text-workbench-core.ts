export type LineOptions = {
  trim: boolean;
  blank: boolean;
  dedupe: boolean;
  fold: boolean;
  filter: string;
  exclude: boolean;
  sort: "keep" | "asc" | "desc" | "length" | "reverse";
  prefix: string;
  suffix: string;
  number: boolean;
  start: number;
  join: "lines" | "space" | "comma";
};
export const LINE_DEFAULTS: LineOptions = {
  trim: true,
  blank: true,
  dedupe: false,
  fold: false,
  filter: "",
  exclude: false,
  sort: "keep",
  prefix: "",
  suffix: "",
  number: false,
  start: 1,
  join: "lines",
};
export function organizeLines(text: string, o: LineOptions, locale: string) {
  const input = text ? text.replace(/\r\n?/g, "\n").split("\n") : [];
  if (input.length > 20000 || text.length > 150000) throw new Error("LIMIT");
  let rows = input.map((x) => (o.trim ? x.trim() : x));
  if (o.blank) rows = rows.filter((x) => x.trim() !== "");
  const key = (x: string) => (o.fold ? x.toLocaleLowerCase(locale) : x);
  if (o.filter)
    rows = rows.filter((x) => key(x).includes(key(o.filter)) !== o.exclude);
  if (o.dedupe) {
    const seen = new Set<string>();
    rows = rows.filter((x) => {
      const k = key(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: o.fold ? "base" : "variant",
  });
  if (o.sort === "reverse") rows.reverse();
  else if (o.sort !== "keep")
    rows.sort((a, b) =>
      o.sort === "length"
        ? Array.from(a).length - Array.from(b).length
        : collator.compare(a, b) * (o.sort === "desc" ? -1 : 1),
    );
  const output = rows
    .map(
      (x, i) =>
        `${o.number ? `${o.start + i}. ` : ""}${o.prefix}${x}${o.suffix}`,
    )
    .join(o.join === "space" ? " " : o.join === "comma" ? "," : "\n");
  return {
    output,
    inputLines: input.length,
    outputLines: rows.length,
    removed: input.length - rows.length,
  };
}
const lower = "零一二三四五六七八九十百千万亿";
const upper = "零壹贰叁肆伍陆柒捌玖拾佰仟万亿";
export function characterCase(text: string, kind: string) {
  if (kind === "upper") return text.toUpperCase();
  if (kind === "lower") return text.toLowerCase();
  if (kind === "title")
    return text
      .toLowerCase()
      .replace(
        /(^|[\s—–-])([a-z])/g,
        (_, a: string, b: string) => a + b.toUpperCase(),
      );
  if (kind === "toggle")
    return Array.from(text)
      .map((x) => (x === x.toUpperCase() ? x.toLowerCase() : x.toUpperCase()))
      .join("");
  if (kind === "financial")
    return Array.from(text)
      .map((x) =>
        x === "两" || x === "兩"
          ? "贰"
          : x === "〇"
            ? "零"
            : lower.includes(x)
              ? upper[lower.indexOf(x)]
              : x,
      )
      .join("");
  const traditional: Record<string, string> = {
    貳: "二",
    參: "三",
    陸: "六",
    萬: "万",
    億: "亿",
  };
  return Array.from(text)
    .map(
      (x) =>
        traditional[x] || (upper.includes(x) ? lower[upper.indexOf(x)] : x),
    )
    .join("");
}
export function characterWidth(text: string, full: boolean) {
  return full
    ? text
        .replace(/[\x21-\x7e]/g, (x) =>
          String.fromCharCode(x.charCodeAt(0) + 0xfee0),
        )
        .replace(/ /g, "　")
    : text
        .replace(/[\uff01-\uff5e]/g, (x) =>
          String.fromCharCode(x.charCodeAt(0) - 0xfee0),
        )
        .replace(/　/g, " ");
}
