import type { UrlReport } from "./net-query-tools";

/** Pure local parsing: no requests, DNS lookup, jobs, or worker dependency. */
export function parseLocalUrl(input: string): UrlReport {
  const raw = input.trim();
  if (!raw) throw new Error("请输入完整的网址（要带 http:// 或 https://）");
  if (raw.length > 65536) throw new Error("网址过长，最多支持65536个字符");
  if (!/^https?:\/\/[^/?#]+/i.test(raw)) throw new Error("无效的网址：需要完整的 http:// 或 https:// 地址");
  if (/[\u0000-\u0020\u007f\\]/.test(raw)) throw new Error("无效的网址：不能包含空格、控制字符或反斜杠");
  if (/%(?![\da-f]{2})/i.test(raw)) throw new Error("无效的百分号编码：%后需要两位十六进制数");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("无效的网址：请检查主机名、IPv6括号和端口"); }
  if (!url.hostname || !["http:", "https:"].includes(url.protocol)) throw new Error("无效的HTTP网址");
  const hashAt = raw.indexOf("#");
  const beforeHash = hashAt < 0 ? raw : raw.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const rawQuery = queryAt < 0 ? "" : beforeHash.slice(queryAt + 1);
  const decode = (value: string) => {
    try { return decodeURIComponent(value.replace(/\+/g, " ")); }
    catch { throw new Error("查询参数包含无效的UTF-8编码"); }
  };
  const params = rawQuery.split("&").filter(part => part !== "").map(part => {
    const eq = part.indexOf("=");
    const name = decode(eq < 0 ? part : part.slice(0, eq));
    const value = eq < 0 ? "" : part.slice(eq + 1);
    const decoded = decode(value);
    return { name, raw: value, decoded, differs: value !== decoded };
  });
  const field = (label: string, value: string) => ({ label, value, empty: value === "" });
  return {
    raw, rawQuery, params, encoded: encodeURIComponent(raw),
    fields: [field("协议", url.protocol), field("用户名", url.username), field("密码", url.password),
      field("主机名", url.hostname), field("端口（显式非默认）", url.port), field("路径", url.pathname),
      field("查询串", rawQuery), field("锚点", hashAt < 0 ? "" : raw.slice(hashAt + 1))],
    normalized: [field("规范化网址（WHATWG）", url.href), field("主机名", url.hostname),
      field("路径", url.pathname), field("查询串", url.search), field("锚点", url.hash)],
  };
}
