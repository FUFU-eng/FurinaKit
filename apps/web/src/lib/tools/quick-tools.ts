/**
 * FurinaKit —— 第二批「同步工具」的服务端处理器（8 个）。
 *
 * 三条贯穿全文件的约束，都是有原因的：
 * 1. 只用 Node 内置模块。桌面版是离线打包的，任何一个新 npm 依赖都会让安装包变大、
 *    甚至让 electron-builder 的 asar 打包路径失效，所以 EXIF 解析、SVG 优化、位图字体
 *    全部手写。
 * 2. 所有面向用户的失败都 `throw new Error("中文提示")`。路由层是直接把 `error.message`
 *    当成前端提示回吐的（见 app/api/tools/[toolId]/route.ts 的 catch），英文报错用户看不懂。
 * 3. 网络类操作必须有超时。同步工具会一直占着这个 HTTP 请求，没有超时就是永久挂起，
 *    用户只能强杀进程。
 *
 * 类型从 registry 里 `import type` 取：type-only import 在编译期被完全擦除，
 * 所以 registry -> quick-tools（值） 与 quick-tools -> registry（类型）之间
 * 不存在运行时循环依赖。
 */
import { promises as dnsPromises } from "node:dns";
import { isIP } from "node:net";
import { connect as openTls, type DetailedPeerCertificate, type TLSSocket } from "node:tls";
import { domainToASCII } from "node:url";
import type { SyncHandler } from "./registry";

// ───────────────────────────── 公共工具 ─────────────────────────────

/**
 * 网络类操作的统一超时：超过这个时间直接给出中文提示，而不是让请求挂着。
 * 取区间上限 10 秒：跨境的站点（github 之类）握手经常要 5~8 秒，
 * 卡在 8 秒会把本来能成功的查询误判成失败。
 */
const NET_TIMEOUT_MS = 10000;
/** DNS 要并发发 6 类查询，公共解析器偶尔会慢，单独放宽到 9 秒。 */
const DNS_TIMEOUT_MS = 9000;

const TEXT_MIME = "text/plain; charset=utf-8";

function rule(): string {
  return "─".repeat(34);
}

/**
 * 给 Promise 套一层超时。
 *
 * 注意 dns 模块的 promise 接口没有 timeout 选项（底层 c-ares 请求发出后无法取消），
 * 所以只能在外面兜一层：超时就报错，底层请求让它自生自灭，反正不能再拖住请求。
 */
function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB（${bytes} 字节）`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB（${bytes} 字节）`;
}

/** 把任意字符串收敛成 ASCII 安全字符。 */
function safeName(name: string | undefined, fallback: string): string {
  const raw = (name ?? "").trim();
  if (!raw) return fallback;
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+/, "")
    .slice(0, 60);
  return cleaned || fallback;
}

/**
 * 结果文件名会被路由直接塞进 Content-Disposition 响应头。
 * HTTP 头只允许 latin1 字符，中文文件名会让 Node 抛 ERR_INVALID_CHAR（500），
 * 所以这里必须去掉扩展名后重新清洗，而不是原样沿用用户传的名字。
 */
function stemName(name: string | undefined, fallback: string): string {
  const raw = (name ?? "").trim();
  if (!raw) return fallback;
  const base = raw.split(/[\\/]/).pop() ?? "";
  const noExt = base.replace(/\.[^.]+$/, "");
  return safeName(noExt, fallback);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // 手写的不完整百分号转义（例如 "%zz"）会抛 URIError，这里退化成原样显示。
    return value;
  }
}

/** 把网络错误翻译成用户能看懂的中文；认不出来时保留原始 code。 */
function describeNetError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  switch (code) {
    case "ENOTFOUND":
      return "域名不存在，无法解析";
    case "EAI_AGAIN":
      return "DNS 服务器暂时无法响应，请稍后重试";
    case "ECONNREFUSED":
      return "目标端口拒绝连接";
    case "ECONNRESET":
      return "连接被对方重置";
    case "ETIMEDOUT":
      return "连接超时";
    case "EHOSTUNREACH":
      return "目标主机不可达";
    case "ENETUNREACH":
      return "网络不可达";
    default:
      return code ? `${message}（${code}）` : message;
  }
}

type HostInput = { host: string; port?: number };

/**
 * 把用户随手粘进来的东西清洗成纯主机名。
 *
 * 为什么要按 "最后一个 @" 切一刀：`https://example.com@evil.com/` 这种写法里，
 * 真正的 host 是 evil.com，example.com 只是 userinfo。如果不处理，
 * 用户以为自己查的是 example.com，实际连的是攻击者的域名。
 * 同理，协议、路径、查询串、锚点全部丢掉，端口单独取出来备用。
 */
function parseHostInput(raw: string): HostInput {
  let s = (raw ?? "").trim().replace(/\s+/g, "");
  if (!s) throw new Error("请输入域名");
  // 协议相对写法 //host/path：先剥掉前导双斜杠，否则下面按 "/" 截断只会得到空串
  if (s.startsWith("//")) s = s.slice(2);
  const schemeAt = s.indexOf("://");
  if (schemeAt !== -1) s = s.slice(schemeAt + 3);
  // 反斜杠也当分隔符：`http://a.com\@evil.com` 这类写法会把 userinfo 混进结果
  const cut = s.search(/[/?#\\]/);
  if (cut !== -1) s = s.slice(0, cut);
  const at = s.lastIndexOf("@");
  if (at !== -1) s = s.slice(at + 1);
  if (!s) throw new Error("请输入域名");

  if (s.startsWith("[")) {
    // IPv6 字面量必须带方括号，直接按 ":" 切端口会把地址本身切碎
    const end = s.indexOf("]");
    if (end === -1) throw new Error("域名格式不正确：IPv6 地址缺少右方括号");
    const host = s.slice(1, end).toLowerCase();
    const rest = s.slice(end + 1);
    const portText = rest.startsWith(":") ? rest.slice(1) : "";
    return { host, port: normalizePort(portText) };
  }

  let host = s;
  let port: number | undefined;
  const colon = host.lastIndexOf(":");
  if (colon !== -1) {
    const maybePort = host.slice(colon + 1);
    if (/^\d+$/.test(maybePort)) {
      port = normalizePort(maybePort);
      host = host.slice(0, colon);
    }
  }
  // 结尾的点是 FQDN 的合法写法（example.com.），用户输入时留着既难看又可能影响匹配
  host = host.replace(/\.+$/, "").toLowerCase();
  if (!host) throw new Error("请输入域名");

  if (isIP(host)) {
    const v4 = host.split(".");
    if (v4.length === 4 && v4.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
      return { host, port };
    }
    throw new Error(`域名格式不正确：「${raw.trim()}」不是有效的 IP 地址`);
  }

  // 中文域名走 punycode，否则 dns/tls 拿到的是一串无法解析的 UTF-8
  const ascii = domainToASCII(host);
  if (!ascii) throw new Error(`域名格式不正确：「${raw.trim()}」不是有效的域名`);
  if (!/^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/.test(ascii)) {
    throw new Error(`域名格式不正确：「${raw.trim()}」不是有效的域名`);
  }
  return { host: ascii, port };
}

function normalizePort(text: string): number | undefined {
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error("端口号不正确，应该是 1~65535 之间的整数");
  }
  return value;
}

// ───────────────────────────── 1. DNS 查询 ─────────────────────────────

type DnsSection = { title: string; values: string[] };

/**
 * 逐类查询并汇总。
 *
 * 用 allSettled 而不是 all：MX / CNAME / TXT 对很多正常域名本来就不存在，
 * 任何一个失败都不该让整份报告失败；只有「连 A/AAAA/NS 都没有」才说明域名真有问题。
 */
export const dnsLookup: SyncHandler = async ({ fields }) => {
  const { host } = parseHostInput(fields.domain ?? "");

  const queries: { title: string; run: () => Promise<string[]> }[] = [
    {
      title: "A 记录（IPv4 地址）",
      run: async () => {
        const rows = await dnsPromises.resolve4(host);
        return rows.map((ip) => String(ip));
      },
    },
    {
      title: "AAAA 记录（IPv6 地址）",
      run: async () => (await dnsPromises.resolve6(host)).map((ip) => String(ip)),
    },
    {
      title: "CNAME 记录（别名）",
      run: async () => dnsPromises.resolveCname(host),
    },
    {
      title: "MX 记录（邮件服务器）",
      run: async () => {
        const rows = await dnsPromises.resolveMx(host);
        // 按优先级排序才好看：优先级数字越小越优先
        return rows
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((row) => {
            const exchange = row.exchange.trim();
            // exchange 为空或 "." 是 RFC 7505 的 null MX：域名明确声明不接收邮件。
            // 直接打印会留下一行莫名其妙的 "0  "，所以补一句说明。
            return exchange === "" || exchange === "."
              ? `${row.priority}  （该域名声明不接收邮件，RFC 7505 null MX）`
              : `${row.priority}  ${exchange}`;
          });
      },
    },
    {
      title: "NS 记录（域名服务器）",
      run: async () => dnsPromises.resolveNs(host),
    },
    {
      title: "TXT 记录（文本）",
      run: async () => {
        const rows = await dnsPromises.resolveTxt(host);
        // 一条 TXT 记录会按 255 字节被切成多段，拼回去才是人看到的那条记录
        return rows.map((chunks) => chunks.join(""));
      },
    },
  ];

  const settled = await withTimeout(
    Promise.allSettled(queries.map((query) => query.run())),
    DNS_TIMEOUT_MS,
    `DNS 查询超时（${DNS_TIMEOUT_MS / 1000} 秒内没有任何响应），请检查网络或更换 DNS 服务器`,
  );

  const sections: DnsSection[] = settled.map((result, index) => ({
    title: queries[index]?.title ?? "查询",
    values: result.status === "fulfilled" ? result.value.filter((value) => value.length > 0) : [],
  }));

  const found = sections.some((section) => section.values.length > 0);
  if (!found) {
    throw new Error("该域名没有任何可解析的记录（请检查域名是否正确）");
  }

  const lines: string[] = [
    "DNS 查询报告",
    `域名：${host}`,
    `查询时间：${new Date().toISOString()}`,
    `查询方式：系统默认 DNS 解析器（并发查询 6 类记录）`,
    rule(),
  ];
  for (const section of sections) {
    lines.push(`【${section.title}】`);
    if (section.values.length === 0) {
      lines.push("  未查询到");
    } else {
      for (const value of section.values) lines.push(`  ${value}`);
    }
    lines.push("");
  }
  lines.push("说明：CNAME / MX / TXT 对很多域名本来就不存在，「未查询到」属于正常结果。");

  return {
    kind: "text",
    text: lines.join("\n"),
    filename: `${safeName(host, "domain")}-dns.txt`,
    mimeType: TEXT_MIME,
  };
};

// ───────────────────────────── 2. SSL 证书检查 ─────────────────────────────

type TlsProbe = {
  // 用 DetailedPeerCertificate：只有它带 issuerCertificate，报告里要显示上一级签发者。
  // 没有可用证书时（例如连上了非 TLS 服务）会是 undefined。
  cert: DetailedPeerCertificate | undefined;
  authorized: boolean;
  authorizationError: string;
};

/**
 * 连一次 TLS 拿证书。
 *
 * rejectUnauthorized 为 false 时不代表「不做校验」：Node 依然会跑一遍链校验，
 * 只是不因此中断握手，结果放在 socket.authorized / authorizationError 里。
 * 所以同一个连接既能拿到证书，也能知道校验结论。
 */
function tlsProbe(host: string, port: number, rejectUnauthorized: boolean, timeoutMs: number): Promise<TlsProbe> {
  return new Promise<TlsProbe>((resolve, reject) => {
    let done = false;
    let socket: TLSSocket | undefined;
    // 用对象包一层保存定时器句柄：finish 在定时器创建之前就定义好了，
    // 直接引用 const 会有暂时性死区（openTls 同步抛错时 finish 立刻就会被调用）。
    const timeoutBox: { handle?: NodeJS.Timeout } = {};

    const finish = (action: () => void): void => {
      if (done) return;
      done = true;
      if (timeoutBox.handle) clearTimeout(timeoutBox.handle);
      // 不 destroy 的话 keep-alive 的 socket 会拖住事件循环，请求结束了进程也不退
      if (socket) socket.destroy();
      action();
    };

    try {
      socket = openTls(
        {
          host,
          port,
          // servername 传 IP 会被 Node 判为非法 SNI，IP 直连时必须留空
          servername: isIP(host) ? undefined : host,
          rejectUnauthorized,
          timeout: timeoutMs,
        },
        () => {
          const cert = socket ? socket.getPeerCertificate(true) : undefined;
          const rawError: unknown = socket ? socket.authorizationError : undefined;
          const authorizationError =
            typeof rawError === "string"
              ? rawError
              : rawError instanceof Error
                ? rawError.message
                : "";
          finish(() =>
            resolve({
              cert,
              authorized: socket ? socket.authorized : false,
              authorizationError,
            }),
          );
        },
      );
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      return;
    }

    // 自己再兜一层硬超时：只依赖 socket 的 timeout 事件不够保险，
    // 真挂住的话这个同步请求就永远不返回了。
    timeoutBox.handle = setTimeout(() => {
      finish(() => reject(new Error(`连接超时（${timeoutMs / 1000} 秒）`)));
    }, timeoutMs);

    socket.on("error", (error: Error) => {
      finish(() => reject(error));
    });
    socket.on("timeout", () => {
      finish(() => reject(new Error(`连接超时（${timeoutMs / 1000} 秒）`)));
    });
  });
}

/** 链校验失败的原因码翻译成人话。 */
function describeVerifyError(code: string): string {
  if (code.includes("SELF_SIGNED")) return "自签名证书，不在系统信任的 CA 列表里";
  if (code.includes("UNABLE_TO_VERIFY_LEAF_SIGNATURE")) return "无法验证叶子证书，通常是缺少中间证书";
  if (code.includes("UNABLE_TO_GET_ISSUER_CERT")) return "找不到签发者证书（根证书不受信任）";
  if (code.includes("CERT_HAS_EXPIRED")) return "证书已过期";
  if (code.includes("ALTNAME_INVALID")) return "证书里的域名和访问的域名不匹配";
  if (code.includes("CERT_REVOKED")) return "证书已被吊销";
  if (code.includes("CERT_UNTRUSTED")) return "证书不受信任";
  if (code.includes("ERR_TLS_CERT")) return "证书校验未通过";
  return code || "未知原因";
}

/** Node 的 tls 不暴露签名算法，只能自己走一遍最外层的 DER 结构把 OID 读出来。 */
function readSignatureOid(der: Buffer | undefined): string {
  if (!der || der.length < 16) return "";
  try {
    const readLength = (at: number): number => {
      const first = der[at];
      if (first === undefined) return -1;
      if (first < 0x80) return first;
      const bytes = first & 0x7f;
      if (bytes === 0 || bytes > 4) return -1;
      let length = 0;
      for (let i = 0; i < bytes; i += 1) {
        const byte = der[at + 1 + i];
        if (byte === undefined) return -1;
        length = length * 256 + byte;
      }
      return length;
    };

    // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
    if (der[0] !== 0x30) return "";
    const certLength = readLength(1);
    if (certLength < 0) return "";
    let cursor = 1 + (der[1] !== undefined && der[1] < 0x80 ? 1 : 1 + (der[1] & 0x7f));

    // 跳过 tbsCertificate（只按长度跳，不进去解析）
    if (der[cursor] !== 0x30) return "";
    const tbsLength = readLength(cursor + 1);
    if (tbsLength < 0) return "";
    cursor += 1 + (der[cursor + 1] !== undefined && (der[cursor + 1] as number) < 0x80 ? 1 : 1 + ((der[cursor + 1] as number) & 0x7f));
    cursor += tbsLength;

    // 接下来就是 signatureAlgorithm：SEQUENCE { OID, ... }
    if (der[cursor] !== 0x30) return "";
    const algLength = readLength(cursor + 1);
    if (algLength < 0) return "";
    cursor += 1 + ((der[cursor + 1] as number) < 0x80 ? 1 : 1 + ((der[cursor + 1] as number) & 0x7f));
    if (der[cursor] !== 0x06) return "";
    const oidLength = readLength(cursor + 1);
    if (oidLength <= 0) return "";
    cursor += 2;
    if (cursor + oidLength > der.length) return "";

    const bytes: number[] = [];
    for (let i = 0; i < oidLength; i += 1) bytes.push(der[cursor + i] as number);
    if (bytes.length === 0) return "";

    // OID 解码：首字节 = 40 * a + b，之后每字节 7 位、最高位是续位标志
    const parts: number[] = [Math.floor(bytes[0] / 40), bytes[0] % 40];
    let value = 0;
    for (let i = 1; i < bytes.length; i += 1) {
      value = value * 128 + (bytes[i] & 0x7f);
      if ((bytes[i] & 0x80) === 0) {
        parts.push(value);
        value = 0;
      }
    }
    return parts.join(".");
  } catch {
    // 证书结构畸形时宁可少一行信息，也不要让整个工具失败
    return "";
  }
}

const SIGNATURE_NAMES: Record<string, string> = {
  "1.2.840.113549.1.1.4": "MD5 with RSA",
  "1.2.840.113549.1.1.5": "SHA-1 with RSA",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.113549.1.1.11": "SHA-256 with RSA",
  "1.2.840.113549.1.1.12": "SHA-384 with RSA",
  "1.2.840.113549.1.1.13": "SHA-512 with RSA",
  "1.2.840.10045.4.3.2": "ECDSA with SHA-256",
  "1.2.840.10045.4.3.3": "ECDSA with SHA-384",
  "1.2.840.10045.4.3.4": "ECDSA with SHA-512",
  "1.3.101.112": "Ed25519",
  "1.3.101.113": "Ed448",
  "1.2.156.10197.1.501": "SM3 with SM2（国密）",
};

function describeSignature(oid: string): string {
  if (!oid) return "未能读取（证书结构异常）";
  const name = SIGNATURE_NAMES[oid];
  return name ? `${name}（${oid}）` : oid;
}

/** subject / issuer 是 { CN: ..., O: ... } 这样的对象，拼成一行更好读。 */
function describeName(name: unknown): string {
  if (!name || typeof name !== "object") return "（未提供）";
  const pairs = Object.entries(name as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .map(([key, value]) => `${key}=${String(value)}`);
  return pairs.length > 0 ? pairs.join(", ") : "（未提供）";
}

/** subjectaltname 是 "DNS:a.com, DNS:b.com, IP Address:1.2.3.4" 这种字符串，拆开更清楚。 */
function parseSanList(san: string | undefined): string[] {
  if (!san) return [];
  const out: string[] = [];
  const pattern = /(DNS|IP Address|IP|email|URI):([^,]+)/g;
  let match = pattern.exec(san);
  while (match !== null) {
    out.push(`${match[1]}:${match[2].trim()}`);
    match = pattern.exec(san);
  }
  return out;
}

function parseCertDate(text: string | undefined): Date | undefined {
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export const sslChecker: SyncHandler = async ({ fields }) => {
  const { host, port } = parseHostInput(fields.domain ?? "");
  const target = port ?? 443;

  // 两次连接并行发：一次只拿证书（不信也继续），一次让 Node 做完整的链校验。
  // 串行会把最坏耗时翻倍，而这两件事互不依赖。
  const [looseResult, strictResult] = await Promise.allSettled([
    tlsProbe(host, target, false, NET_TIMEOUT_MS),
    tlsProbe(host, target, true, NET_TIMEOUT_MS),
  ]);

  if (looseResult.status === "rejected") {
    throw new Error(
      `无法连接到该域名的 ${target} 端口（可能没有开启 HTTPS）：${describeNetError(looseResult.reason)}`,
    );
  }

  const { cert } = looseResult.value;
  if (!cert || !cert.subject) {
    throw new Error("已连上端口，但没有读取到任何证书（该端口可能不是 HTTPS 服务）");
  }

  const notBefore = parseCertDate(cert.valid_from);
  const notAfter = parseCertDate(cert.valid_to);
  const now = Date.now();
  const expired = notAfter ? notAfter.getTime() < now : false;
  const remainingDays = notAfter ? Math.floor((notAfter.getTime() - now) / 86400000) : undefined;

  // 链校验结论优先用第二次（真校验）的结果；它连不上时退回到第一次连接里的校验信息
  let trusted: boolean;
  let trustDetail: string;
  if (strictResult.status === "fulfilled") {
    trusted = strictResult.value.authorized;
    trustDetail = trusted
      ? "通过（证书链可以追溯到系统信任的根 CA）"
      : `未通过：${describeVerifyError(strictResult.value.authorizationError)}`;
  } else {
    const reason = strictResult.reason;
    const code =
      reason && typeof reason === "object" && "code" in reason
        ? String((reason as { code?: unknown }).code ?? "")
        : "";
    trusted = false;
    trustDetail = code
      ? `未通过：${describeVerifyError(code)}（${code}）`
      : `未通过：${reason instanceof Error ? reason.message : String(reason)}`;
  }

  let status: string;
  if (expired && !trusted) {
    status = `已过期且不受信任（${trustDetail}）`;
  } else if (expired) {
    const days = remainingDays === undefined ? 0 : Math.abs(remainingDays);
    status = `已过期（已过期约 ${days} 天）`;
  } else if (!trusted) {
    status = `不受信任（${trustDetail}）`;
  } else {
    status = remainingDays === undefined ? "有效" : `有效（剩余 ${remainingDays} 天）`;
  }

  const sanList = parseSanList(cert.subjectaltname);
  const oid = readSignatureOid(cert.raw);

  const lines: string[] = [
    "SSL 证书检查报告",
    `状态：${status}`,
    rule(),
    `域名：${host}:${target}`,
    `证书主体(CN)：${cert.subject?.CN ?? "（未提供）"}`,
    `证书主体全称：${describeName(cert.subject)}`,
    `颁发者：${describeName(cert.issuer)}`,
    `有效期起：${cert.valid_from || "（未提供）"}${notBefore ? `（本地时间 ${notBefore.toLocaleString("zh-CN", { hour12: false })}）` : ""}`,
    `有效期止：${cert.valid_to || "（未提供）"}${notAfter ? `（本地时间 ${notAfter.toLocaleString("zh-CN", { hour12: false })}）` : ""}`,
    `剩余天数：${remainingDays === undefined ? "（无法计算，证书时间字段缺失）" : `${remainingDays} 天`}`,
    `是否已过期：${expired ? "是" : "否"}`,
    `证书链是否可验证：${trustDetail}`,
    `签名算法：${describeSignature(oid)}`,
    `序列号：${cert.serialNumber || "（未提供）"}`,
    `SHA-256 指纹：${cert.fingerprint256 || "（未提供）"}`,
    `SAN 里的域名（共 ${sanList.length} 个）：`,
  ];
  if (sanList.length === 0) {
    lines.push("  （证书未声明 SAN 扩展）");
  } else {
    for (const item of sanList) lines.push(`  ${item}`);
  }
  if (cert.issuerCertificate && "subject" in cert.issuerCertificate) {
    lines.push("", `签发链上一级：${describeName(cert.issuerCertificate.subject)}`);
  }

  return {
    kind: "text",
    text: lines.join("\n"),
    filename: `${safeName(host, "domain")}-ssl.txt`,
    mimeType: TEXT_MIME,
  };
};

// ───────────────────────────── 3. URL 解析 ─────────────────────────────

function defaultPortHint(protocol: string): string {
  if (protocol === "http:") return "80（协议默认，未显式指定）";
  if (protocol === "https:") return "443（协议默认，未显式指定）";
  return "（未指定）";
}

export const urlParser: SyncHandler = async ({ fields }) => {
  const raw = (fields.url ?? "").trim();
  if (!raw) throw new Error("请输入完整的网址（要带 http:// 或 https://）");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // 这里不替用户自动补 https://：他到底想要 http 还是 https 只有他知道，
    // 猜错了会把解析结果带偏，所以直接把要求说清楚。
    throw new Error("请输入完整的网址（要带 http:// 或 https://）");
  }

  const lines: string[] = [
    "URL 解析结果",
    rule(),
    `原始输入：${raw}`,
    `协议：${url.protocol}`,
    `主机名：${url.hostname || "（无）"}`,
    `端口：${url.port ? url.port : defaultPortHint(url.protocol)}`,
    `路径：${url.pathname || "/"}`,
    `查询字符串：${url.search || "（无）"}`,
    `锚点：${url.hash || "（无）"}`,
    `用户名：${url.username ? `${safeDecode(url.username)}（原始：${url.username}）` : "（无）"}`,
    `密码：${url.password ? `${safeDecode(url.password)}（原始：${url.password}）` : "（无）"}`,
  ];

  const search = url.searchParams;
  lines.push("", `查询参数（共 ${[...search.keys()].length} 个）：`);
  if ([...search.keys()].length === 0) {
    lines.push("  （没有查询参数）");
  } else {
    // URLSearchParams 会把 "+" 解成空格，用户往往想看到原样那一份，所以两份都列出来
    const rawPairs = url.search.startsWith("?") ? url.search.slice(1).split("&") : [];
    let index = 0;
    search.forEach((value, key) => {
      const rawPair = rawPairs[index] ?? "";
      const eq = rawPair.indexOf("=");
      const rawValue = eq === -1 ? "" : rawPair.slice(eq + 1);
      lines.push(`  ${key} = ${value === "" ? "（空值）" : value}`);
      lines.push(`      原始未解码值：${rawValue === "" ? "（空）" : rawValue}`);
      index += 1;
    });
  }

  lines.push(
    "",
    "各组件重新编码后的结果：",
    `  origin：${url.origin}`,
    `  host：${url.host}`,
    `  hostname：${url.hostname}`,
    `  pathname：${url.pathname}`,
    `  search：${url.search || "（无）"}`,
    `  hash：${url.hash || "（无）"}`,
    `  href（规范化后的完整网址）：${url.href}`,
    "",
    rule(),
    "encodeURIComponent 编码后的整串（可直接复制）：",
    encodeURIComponent(raw),
  );

  return {
    kind: "text",
    text: lines.join("\n"),
    filename: "url-parsed.txt",
    mimeType: TEXT_MIME,
  };
};

// ───────────────────────────── 4. Lorem 占位文本 ─────────────────────────────

const LOREM_WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do",
  "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua", "enim",
  "ad", "minim", "veniam", "quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi",
  "aliquip", "ex", "ea", "commodo", "consequat", "duis", "aute", "irure", "in", "reprehenderit",
  "voluptate", "velit", "esse", "cillum", "eu", "fugiat", "nulla", "pariatur", "excepteur",
  "sint", "occaecat", "cupidatat", "non", "proident", "sunt", "culpa", "qui", "officia",
  "deserunt", "mollit", "anim", "id", "est", "laborum", "curabitur", "pretium", "tincidunt",
  "lacus", "facilisi", "blandit", "volutpat", "accumsan", "sagittis",
];

const LOREM_OPENER = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

const LOREM_TYPES = new Set(["paragraph", "sentence", "word"]);

function randomWord(): string {
  const index = Math.floor(Math.random() * LOREM_WORDS.length);
  return LOREM_WORDS[index] ?? "lorem";
}

function buildSentence(): string {
  // 6~18 个词：太短不像正文，太长又不像句子
  const length = 6 + Math.floor(Math.random() * 13);
  const words: string[] = [];
  for (let i = 0; i < length; i += 1) {
    let word = randomWord();
    // 连续两个一样的词一眼就能看出是随机拼的，重摇一次
    if (i > 0 && word === words[i - 1]) word = randomWord();
    words.push(word);
  }
  const sentence = words.join(" ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
}

/** 段落 4~6 句。 */
function buildParagraph(): string {
  const count = 4 + Math.floor(Math.random() * 3);
  const sentences: string[] = [];
  for (let i = 0; i < count; i += 1) sentences.push(buildSentence());
  return sentences.join(" ");
}

export const loremGen: SyncHandler = async ({ fields }) => {
  // 空输入（字段没传）才用默认 3；显式填了 0 就按"夹取"规则变成 1，
  // 这两种情况必须分开，否则用户填 0 会被当成"没填"。
  const rawCount = (fields.count ?? "").trim();
  const requested = rawCount === "" ? 3 : Number(rawCount);
  const count = Math.min(20, Math.max(1, Math.round(Number.isFinite(requested) ? requested : 3)));
  const type = LOREM_TYPES.has(fields.type ?? "") ? (fields.type as string) : "paragraph";

  let text: string;
  if (type === "word") {
    const words: string[] = [];
    for (let i = 0; i < count; i += 1) words.push(randomWord());
    text = words.join(" ");
  } else if (type === "sentence") {
    const sentences: string[] = [];
    for (let i = 0; i < count; i += 1) sentences.push(buildSentence());
    text = sentences.join(" ");
  } else {
    const paragraphs: string[] = [];
    for (let i = 0; i < count; i += 1) paragraphs.push(buildParagraph());
    // 第一段用经典开头，看起来才像真正的 Lorem Ipsum 而不是随机词
    if (paragraphs.length > 0) {
      const first = paragraphs[0] ?? "";
      const rest = first.split(".").slice(1).join(".").trim();
      paragraphs[0] = rest ? `${LOREM_OPENER} ${rest}` : LOREM_OPENER;
    }
    text = paragraphs.join("\n\n");
  }

  return {
    kind: "text",
    text,
    filename: `lorem-${type}-${count}.txt`,
    mimeType: TEXT_MIME,
  };
};

// ───────────────────────────── 5. CSS 渐变生成器 ─────────────────────────────

const GRADIENT_TYPES = new Set(["linear", "radial", "conic"]);
const LINEAR_DIRECTIONS = ["to right", "to bottom", "to bottom right", "45deg", "135deg"];

const TAILWIND_LINEAR: Record<string, string> = {
  "to right": "bg-gradient-to-r",
  "to bottom": "bg-gradient-to-b",
  "to bottom right": "bg-gradient-to-br",
};

/**
 * 颜色校验：生成器工具容错优先，非法输入回退到默认色而不是报错。
 * 返回 null 表示"这个值没法用"，由调用方决定回退。
 */
function normalizeHex(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const withHash = text.startsWith("#") ? text : `#${text}`;
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(withHash)) {
    return null;
  }
  const body = withHash.slice(1).toLowerCase();
  // 三位/四位缩写展开成完整写法，省得后面拼 CSS 时还要考虑两种长度
  if (body.length === 3 || body.length === 4) {
    return `#${body.split("").map((ch) => ch + ch).join("")}`;
  }
  return `#${body}`;
}

export const cssGradient: SyncHandler = async ({ fields }) => {
  const notes: string[] = [];
  const raw1 = (fields.color1 ?? "").trim();
  const raw2 = (fields.color2 ?? "").trim();
  const parsed1 = normalizeHex(raw1);
  const parsed2 = normalizeHex(raw2);
  const color1 = parsed1 ?? "#6366f1";
  const color2 = parsed2 ?? "#ec4899";
  // 回退是静默的，但要告诉用户"你填的颜色没被采用"，否则他会以为工具坏了
  if (raw1 && !parsed1) notes.push(`颜色 1「${raw1}」不是合法的 hex 颜色，已回退为默认值 ${color1}`);
  if (raw2 && !parsed2) notes.push(`颜色 2「${raw2}」不是合法的 hex 颜色，已回退为默认值 ${color2}`);

  const type = GRADIENT_TYPES.has(fields.type ?? "") ? (fields.type as string) : "linear";
  const direction = LINEAR_DIRECTIONS.includes(fields.direction ?? "")
    ? (fields.direction as string)
    : "to right";

  let css: string;
  if (type === "radial") css = `radial-gradient(circle, ${color1}, ${color2})`;
  else if (type === "conic") css = `conic-gradient(from 0deg at 50% 50%, ${color1}, ${color2})`;
  else css = `linear-gradient(${direction}, ${color1}, ${color2})`;

  const gradientLiteral = css.replace(/\s+/g, "");
  const tailwind =
    type === "linear" && TAILWIND_LINEAR[direction]
      ? `${TAILWIND_LINEAR[direction]} from-[${color1}] to-[${color2}]`
      : `bg-[${gradientLiteral}]`;

  const lines: string[] = [
    "CSS 渐变",
    rule(),
    "可直接复制的 CSS：",
    `  background: ${css};`,
    "",
    "分开声明也可以：",
    `  background-image: ${css};`,
    "",
    "Tailwind 写法：",
    `  ${tailwind}`,
  ];
  if (type !== "linear" || !TAILWIND_LINEAR[direction]) {
    lines.push(`  （Tailwind 3.x 没有内置的 ${type === "linear" ? direction : type} 方向类，这里用的是任意值写法）`);
  }
  lines.push(
    "",
    `使用参数：类型=${type}，方向=${type === "linear" ? direction : "（该类型不使用方向）"}，色标=${color1} → ${color2}`,
  );
  if (notes.length > 0) {
    lines.push("", "注意：");
    for (const note of notes) lines.push(`  ${note}`);
  }

  return { kind: "text", text: lines.join("\n"), filename: "css-gradient.txt", mimeType: TEXT_MIME };
};

// ───────────────────────────── 6. 图片 EXIF ─────────────────────────────

/** EXIF 解析专用：结构越界时中断当前 IFD，而不是让整个工具崩掉。 */
class ExifParseError extends Error {}

function need(buf: Buffer, offset: number, length: number): void {
  if (!Number.isInteger(offset) || offset < 0 || length < 0 || offset + length > buf.length) {
    throw new ExifParseError("EXIF 数据越界");
  }
}

function readU16(buf: Buffer, offset: number, le: boolean): number {
  need(buf, offset, 2);
  return le ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
}

function readU32(buf: Buffer, offset: number, le: boolean): number {
  need(buf, offset, 4);
  return le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}

/** 读"下一个 IFD 指针"这类非关键字段时用宽版本：越界就当作没有。 */
function safeU32(buf: Buffer, offset: number, le: boolean): number {
  if (offset < 0 || offset + 4 > buf.length) return 0;
  return le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

/** 单个 IFD 的条目上限。正常文件最多几十条，超过说明文件畸形，直接放弃以免死循环。 */
const MAX_IFD_ENTRIES = 512;
/** 解引用 IFD 链的深度上限，防"指针指回自己"的构造文件造成无限循环。 */
const MAX_IFD_DEPTH = 4;
/** 单个字段的显示长度上限，MakerNote 之类的二进制字段可能几十 KB。 */
const MAX_VALUE_LENGTH = 300;

type RawEntry = {
  tag: number;
  type: number;
  count: number;
  numbers: number[];
  ascii: string;
  bytes: Buffer;
};

type Group = { title: string; lines: string[]; rawCount: number };

const TAG_IFD0: Record<number, string> = {
  0x0100: "图像宽度",
  0x0101: "图像高度",
  0x0102: "每像素位数",
  0x0103: "压缩方式",
  0x0106: "光度解释",
  0x010e: "图像描述",
  0x010f: "相机制造商",
  0x0110: "相机型号",
  0x0111: "数据存放位置",
  0x0112: "方向",
  0x0115: "采样率",
  0x011a: "X 分辨率",
  0x011b: "Y 分辨率",
  0x011c: "平面配置",
  0x0128: "分辨率单位",
  0x0131: "生成软件",
  0x0132: "文件修改时间",
  0x013b: "作者",
  0x013e: "白点",
  0x013f: "主色",
  0x0201: "缩略图偏移",
  0x0202: "缩略图长度",
  0x0211: "YCbCr 系数",
  0x0213: "YCbCr 定位",
  0x0214: "参考黑白",
  0x8298: "版权",
  0x8769: "Exif 子目录指针",
  0x8825: "GPS 子目录指针",
  0x9c9b: "标题（XP）",
  0x9c9c: "备注（XP）",
  0x9c9d: "作者（XP）",
  0x9c9e: "关键词（XP）",
  0x9c9f: "主题（XP）",
};

const TAG_EXIF: Record<number, string> = {
  0x829a: "曝光时间",
  0x829d: "光圈值",
  0x8822: "曝光程序",
  0x8824: "光谱灵敏度",
  0x8827: "ISO 感光度",
  0x8828: "OECF",
  0x8830: "感光度类型",
  0x8831: "标准输出感光度",
  0x8832: "推荐曝光指数",
  0x8833: "ISO 速度",
  0x9000: "Exif 版本",
  0x9003: "原始拍摄时间",
  0x9004: "数字化时间",
  0x9010: "原始时区偏移",
  0x9011: "数字化时区偏移",
  0x9101: "分量配置",
  0x9102: "压缩后每像素位数",
  0x9201: "快门速度（APEX）",
  0x9202: "光圈（APEX）",
  0x9203: "亮度（APEX）",
  0x9204: "曝光补偿",
  0x9205: "最大光圈（APEX）",
  0x9206: "被摄体距离",
  0x9207: "测光模式",
  0x9208: "光源",
  0x9209: "闪光灯",
  0x920a: "焦距",
  0x9214: "被摄体区域",
  0x927c: "厂商备注（MakerNote）",
  0x9286: "用户备注",
  0x9290: "秒以下时间",
  0x9291: "秒以下原始时间",
  0x9292: "秒以下数字化时间",
  0xa000: "FlashPix 版本",
  0xa001: "色彩空间",
  0xa002: "有效像素宽",
  0xa003: "有效像素高",
  0xa004: "相关音频文件",
  0xa005: "互操作性子目录指针",
  0xa20e: "焦平面 X 分辨率",
  0xa20f: "焦平面 Y 分辨率",
  0xa210: "焦平面分辨率单位",
  0xa215: "曝光指数",
  0xa217: "感光方式",
  0xa300: "文件来源",
  0xa301: "场景类型",
  0xa302: "CFA 图案",
  0xa401: "自定义渲染",
  0xa402: "曝光模式",
  0xa403: "白平衡",
  0xa404: "数字变焦比",
  0xa405: "35mm 等效焦距",
  0xa406: "场景拍摄类型",
  0xa407: "增益控制",
  0xa408: "对比度",
  0xa409: "饱和度",
  0xa40a: "锐度",
  0xa40c: "主体距离范围",
  0xa420: "图像唯一 ID",
  0xa430: "相机所有者",
  0xa431: "机身序列号",
  0xa432: "镜头规格",
  0xa433: "镜头制造商",
  0xa434: "镜头型号",
  0xa435: "镜头序列号",
  0xa460: "合成图像",
  0xa500: "伽马",
};

const TAG_GPS: Record<number, string> = {
  0x0000: "GPS 版本",
  0x0001: "纬度参考",
  0x0002: "纬度",
  0x0003: "经度参考",
  0x0004: "经度",
  0x0005: "高度参考",
  0x0006: "高度",
  0x0007: "时间（UTC）",
  0x0008: "卫星",
  0x0009: "状态",
  0x000a: "测量模式",
  0x000b: "精度（度）",
  0x000c: "速度参考",
  0x000d: "速度",
  0x000e: "速度方向参考",
  0x000f: "速度方向",
  0x0010: "图像方向参考",
  0x0011: "图像方向",
  0x0012: "地图基准",
  0x001d: "日期（UTC）",
  0x001f: "定位来源",
};

const ENUMS: Record<number, Record<number, string>> = {
  0x0112: {
    1: "正常",
    2: "水平镜像",
    3: "旋转 180°",
    4: "垂直镜像",
    5: "水平镜像后顺时针 90°",
    6: "顺时针 90°",
    7: "水平镜像后顺时针 270°",
    8: "顺时针 270°",
  },
  0x0128: { 1: "无单位", 2: "英寸", 3: "厘米" },
  0x8822: { 0: "未定义", 1: "手动", 2: "程序自动", 3: "光圈优先", 4: "快门优先", 5: "创意程序", 6: "动作程序", 7: "人像模式", 8: "风景模式" },
  0x9207: { 0: "未知", 1: "平均", 2: "中央重点平均", 3: "点测光", 4: "多点测光", 5: "图案测光", 6: "局部测光", 255: "其他" },
  0x9208: {
    0: "未知",
    1: "日光",
    2: "荧光灯",
    3: "白炽灯",
    4: "闪光灯",
    9: "晴天",
    10: "阴天",
    11: "阴影",
    12: "日光荧光灯",
    13: "日光白荧光灯",
    14: "冷白荧光灯",
    15: "白暖荧光灯",
    17: "标准光 A",
    18: "标准光 B",
    19: "标准光 C",
    20: "D55",
    21: "D65",
    22: "D75",
    23: "D50",
    24: "ISO 演播室钨丝灯",
    255: "其他",
  },
  0x9209: {
    0x0000: "未使用闪光灯",
    0x0001: "使用了闪光灯",
    0x0005: "使用了闪光灯（未检测到反射光）",
    0x0007: "使用了闪光灯（检测到反射光）",
    0x0009: "强制闪光",
    0x000d: "强制闪光（未检测到反射光）",
    0x000f: "强制闪光（检测到反射光）",
    0x0010: "未使用闪光灯（强制关闭）",
    0x0018: "未使用闪光灯（自动）",
    0x0019: "使用了闪光灯（自动）",
    0x001d: "使用了闪光灯（自动，未检测到反射光）",
    0x001f: "使用了闪光灯（自动，检测到反射光）",
    0x0020: "未使用闪光灯（无闪光灯功能）",
    0x0041: "使用了闪光灯（红眼消除）",
    0x0045: "使用了闪光灯（红眼消除，未检测到反射光）",
    0x0047: "使用了闪光灯（红眼消除，检测到反射光）",
    0x0049: "强制闪光（红眼消除）",
    0x004d: "强制闪光（红眼消除，未检测到反射光）",
    0x004f: "强制闪光（红眼消除，检测到反射光）",
    0x0059: "使用了闪光灯（自动，红眼消除）",
    0x005d: "使用了闪光灯（自动，红眼消除，未检测到反射光）",
    0x005f: "使用了闪光灯（自动，红眼消除，检测到反射光）",
  },
  0xa001: { 1: "sRGB", 2: "Adobe RGB", 65535: "未标定" },
  0xa217: { 1: "未定义", 2: "单芯片彩色区域传感器", 3: "双芯片彩色区域传感器", 4: "三芯片彩色区域传感器", 5: "彩色序列区域传感器", 7: "三线性传感器", 8: "彩色序列线性传感器" },
  0xa401: { 0: "标准处理", 1: "自定义处理" },
  0xa402: { 0: "自动曝光", 1: "手动曝光", 2: "自动包围曝光" },
  0xa403: { 0: "自动白平衡", 1: "手动白平衡" },
  0xa406: { 0: "标准", 1: "风景", 2: "人像", 3: "夜景" },
  0xa407: { 0: "无增益控制", 1: "低增益增强", 2: "高增益增强", 3: "低增益降噪", 4: "高增益降噪" },
  0xa408: { 0: "标准", 1: "柔和", 2: "强烈" },
  0xa409: { 0: "标准", 1: "低饱和", 2: "高饱和" },
  0xa40a: { 0: "标准", 1: "柔和", 2: "强烈" },
};

/** XP* 系列是 UTF-16LE 编码的，直接当 ASCII 读会全是乱码。 */
const XP_TAGS = new Set([0x9c9b, 0x9c9c, 0x9c9d, 0x9c9e, 0x9c9f]);

function decodeEntry(tag: number, type: number, count: number, bytes: Buffer, le: boolean): RawEntry {
  const entry: RawEntry = { tag, type, count, numbers: [], ascii: "", bytes };

  if (type === 2) {
    entry.ascii = bytes.toString("latin1").replace(/\0+$/, "");
    return entry;
  }
  if (XP_TAGS.has(tag)) {
    // UTF-16LE 文本：去掉结尾的一串 0x0000
    entry.ascii = bytes.toString("ucs2").replace(/\0+$/, "");
    return entry;
  }
  const size = TYPE_SIZE[type] ?? 0;
  for (let i = 0; i < count; i += 1) {
    const at = i * size;
    if (at + size > bytes.length) break;
    switch (type) {
      case 1:
      case 6:
        entry.numbers.push(bytes.readUInt8(at));
        break;
      case 3:
      case 8:
        entry.numbers.push(le ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at));
        break;
      case 4:
      case 9:
        entry.numbers.push(le ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at));
        break;
      case 5:
      case 10: {
        const numerator = le ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
        const denominator = le ? bytes.readUInt32LE(at + 4) : bytes.readUInt32BE(at + 4);
        // 分母为 0 的畸形数据不能让结果变成 Infinity
        entry.numbers.push(denominator === 0 ? 0 : numerator / denominator);
        break;
      }
      case 11:
        entry.numbers.push(le ? bytes.readFloatLE(at) : bytes.readFloatBE(at));
        break;
      case 12:
        entry.numbers.push(le ? bytes.readDoubleLE(at) : bytes.readDoubleBE(at));
        break;
      default:
        return entry;
    }
  }
  return entry;
}

function readIfd(tiff: Buffer, offset: number, le: boolean): { entries: RawEntry[]; next: number } {
  if (offset <= 0 || offset + 2 > tiff.length) throw new ExifParseError("IFD 偏移越界");
  const total = readU16(tiff, offset, le);
  if (total > MAX_IFD_ENTRIES) throw new ExifParseError("IFD 条目数量异常");
  const entries: RawEntry[] = [];
  for (let i = 0; i < total; i += 1) {
    const base = offset + 2 + i * 12;
    // 单条越界就整段放弃：继续读下去只会把后面的字节错位解释成别的 tag
    need(tiff, base, 12);
    const tag = readU16(tiff, base, le);
    const type = readU16(tiff, base + 2, le);
    const count = readU32(tiff, base + 4, le);
    const size = TYPE_SIZE[type];
    if (!size || count > 65535) continue;
    const byteLength = size * count;
    const valueOffset = byteLength <= 4 ? base + 8 : safeU32(tiff, base + 8, le);
    if (valueOffset <= 0 || valueOffset + byteLength > tiff.length) continue;
    entries.push(decodeEntry(tag, type, count, tiff.subarray(valueOffset, valueOffset + byteLength), le));
  }
  return { entries, next: safeU32(tiff, offset + 2 + total * 12, le) };
}

function readIfdSafe(tiff: Buffer, offset: number, le: boolean, notes: string[], label: string): RawEntry[] {
  try {
    return readIfd(tiff, offset, le).entries;
  } catch (error) {
    // 结构坏了就放弃这一段，其余 IFD 还能正常显示——用户宁可看到半份信息
    notes.push(`${label} 解析中断：${error instanceof Error ? error.message : "数据异常"}`);
    return [];
  }
}

function rationalText(entry: RawEntry, le: boolean): string {
  if (entry.bytes.length < 8) return entry.numbers.map((n) => String(n)).join(", ");
  const numerator = le ? entry.bytes.readUInt32LE(0) : entry.bytes.readUInt32BE(0);
  const denominator = le ? entry.bytes.readUInt32LE(4) : entry.bytes.readUInt32BE(4);
  return `${numerator}/${denominator}`;
}

function clip(text: string): string {
  if (text.length <= MAX_VALUE_LENGTH) return text;
  return `${text.slice(0, MAX_VALUE_LENGTH)}…（共 ${text.length} 字符，已截断）`;
}

function findNumbers(entries: RawEntry[], tag: number): number[] | undefined {
  const found = entries.find((entry) => entry.tag === tag);
  return found && found.numbers.length > 0 ? found.numbers : undefined;
}

function formatEntry(entry: RawEntry, le: boolean): string {
  const { tag, numbers } = entry;

  if (entry.ascii) return clip(entry.ascii);
  if (tag === 0x927c) return `已省略（${entry.bytes.length} 字节二进制数据）`;
  if (tag === 0x02bc || tag === 0x9286) return clip(`已省略二进制内容（${entry.bytes.length} 字节）`);
  // UNDEFINED 不参与数值解码，必须在"空值"判断之前处理：
  // ExifVersion / 分量配置 / FlashPix 版本都是这一类型，否则只会显示成（空）。
  if (entry.type === 7) {
    if (entry.bytes.length === 0) return "（空）";
    const ascii = entry.bytes.toString("latin1").replace(/[^\x20-\x7e]/g, "");
    const hex = entry.bytes.toString("hex").replace(/(..)/g, "$1 ").trim();
    return ascii.length >= 2 ? `${ascii}（hex: ${hex}）` : `hex: ${hex}`;
  }
  if (numbers.length === 0) return "（空）";

  const first = numbers[0] ?? 0;
  switch (tag) {
    case 0x829a: {
      const seconds = first;
      // 快门速度的原始分数（1/125）比小数（0.008）直观得多，短曝光优先显示分数
      return seconds > 0 && seconds < 1 ? `${rationalText(entry, le)} 秒` : `${seconds} 秒`;
    }
    case 0x829d:
      return `f/${first.toFixed(1)}`;
    case 0x9205:
      return `APEX ${first.toFixed(2)}（约 f/${Math.pow(Math.SQRT2, first).toFixed(1)}）`;
    case 0x920a:
      return `${first} mm`;
    case 0xa405:
      return `${first} mm（35mm 等效）`;
    case 0x9204:
      return `${first >= 0 ? "+" : ""}${first.toFixed(2)} EV`;
    case 0xa404:
      return `${first.toFixed(2)} 倍`;
    case 0x0002:
    case 0x0004:
      return numbers.map((n) => n.toFixed(6)).join(", ");
    default:
      break;
  }

  const enumMap = ENUMS[tag];
  if (enumMap && numbers.length === 1) {
    const label = enumMap[first];
    if (label) return `${label}（${first}）`;
  }
  if (entry.type === 5 || entry.type === 10) {
    // 单个有理数把原始分数也带上（1/125、43/1），多个时只列数值免得一行太长
    if (numbers.length === 1) return `${numbers[0]}（${rationalText(entry, le)}）`;
    return numbers.join(", ");
  }
  return numbers.length > 8
    ? `${numbers.slice(0, 8).join(", ")} …（共 ${numbers.length} 项）`
    : numbers.join(", ");
}

function buildGroup(title: string, entries: RawEntry[], tagMap: Record<number, string>, le: boolean): Group {
  const lines: string[] = [];
  for (const entry of entries) {
    // 指针类 tag 本身没有展示价值，它们指向的内容已经单独成组了
    if (entry.tag === 0x8769 || entry.tag === 0x8825 || entry.tag === 0xa005) continue;
    const name = tagMap[entry.tag] ?? `未知标签 0x${entry.tag.toString(16).padStart(4, "0")}`;
    lines.push(`  ${name}：${formatEntry(entry, le)}`);
  }
  return { title, lines, rawCount: entries.length };
}

type GpsSummary = { latitude?: number; longitude?: number; altitude?: number };

function summarizeGps(entries: RawEntry[]): GpsSummary {
  const summary: GpsSummary = {};
  const lat = findNumbers(entries, 0x0002);
  const lon = findNumbers(entries, 0x0004);
  const latRef = entries.find((entry) => entry.tag === 0x0001)?.ascii.toUpperCase() ?? "N";
  const lonRef = entries.find((entry) => entry.tag === 0x0003)?.ascii.toUpperCase() ?? "E";
  const alt = findNumbers(entries, 0x0006);
  const altRef = entries.find((entry) => entry.tag === 0x0005)?.numbers[0] ?? 0;

  if (lat && lat.length >= 3) {
    const value = (lat[0] ?? 0) + (lat[1] ?? 0) / 60 + (lat[2] ?? 0) / 3600;
    summary.latitude = latRef.startsWith("S") ? -value : value;
  }
  if (lon && lon.length >= 3) {
    const value = (lon[0] ?? 0) + (lon[1] ?? 0) / 60 + (lon[2] ?? 0) / 3600;
    summary.longitude = lonRef.startsWith("W") ? -value : value;
  }
  if (alt && alt.length >= 1) {
    summary.altitude = altRef === 1 ? -(alt[0] ?? 0) : (alt[0] ?? 0);
  }
  return summary;
}

function toDms(value: number, positive: string, negative: string): string {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFull = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFull);
  const seconds = (minutesFull - minutes) * 60;
  const hemisphere = value >= 0 ? positive : negative;
  return `${degrees}° ${minutes}' ${seconds.toFixed(2)}" ${hemisphere}`;
}

type ImageFacts = {
  format: string;
  width?: number;
  height?: number;
  bytes: number;
};

/** JPEG 的尺寸在 SOF 段，EXIF 与它无关，所以即使没有 EXIF 也要能读出来。 */
function readJpeg(buffer: Buffer): { facts: ImageFacts; exif?: Buffer } {
  const facts: ImageFacts = { format: "JPEG", bytes: buffer.length };
  let exif: Buffer | undefined;
  let offset = 2;
  let guard = 0;
  while (offset + 4 <= buffer.length && guard < 4096) {
    guard += 1;
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1] ?? 0;
    // 0xFF 后面跟 0xFF 是填充字节，跳过继续找真正的 marker
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // 无长度字段的 marker
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // 进入压缩数据，后面不会再有元数据段
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    const dataStart = offset + 4;
    if (marker === 0xe1 && length >= 8 + 6 && buffer.toString("latin1", dataStart, dataStart + 6) === "Exif\0\0") {
      exif = buffer.subarray(dataStart + 6, offset + 2 + length);
    }
    // SOF0~SOF15（不含 DHT=C4、JPG=C8、DAC=CC）里带尺寸
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (dataStart + 5 <= buffer.length) {
        facts.height = buffer.readUInt16BE(dataStart + 1);
        facts.width = buffer.readUInt16BE(dataStart + 3);
      }
    }
    offset += 2 + length;
  }
  return { facts, exif };
}

function readPng(buffer: Buffer): { facts: ImageFacts; exif?: Buffer } {
  const facts: ImageFacts = { format: "PNG", bytes: buffer.length };
  if (buffer.length >= 24) {
    facts.width = buffer.readUInt32BE(16);
    facts.height = buffer.readUInt32BE(20);
  }
  // PNG 1.5 之后允许 eXIf 块，里面直接放 TIFF 结构；老图片也常有 zTXt 里的 XML，
  // 那种不是标准 EXIF，这里不猜。
  let offset = 8;
  let guard = 0;
  let exif: Buffer | undefined;
  while (offset + 12 <= buffer.length && guard < 4096) {
    guard += 1;
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length) break;
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (type === "eXIf") exif = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return { facts, exif };
}

function readGif(buffer: Buffer): ImageFacts {
  const facts: ImageFacts = { format: "GIF", bytes: buffer.length };
  if (buffer.length >= 10) {
    facts.width = buffer.readUInt16LE(6);
    facts.height = buffer.readUInt16LE(8);
  }
  return facts;
}

function detectImage(buffer: Buffer): { facts: ImageFacts; exif?: Buffer } {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return readJpeg(buffer);
  }
  if (buffer.length >= 8 && buffer.toString("latin1", 0, 8) === "\x89PNG\r\n\x1a\n") {
    return readPng(buffer);
  }
  if (buffer.length >= 8 && (buffer.toString("latin1", 0, 4) === "II*\0" || buffer.toString("latin1", 0, 4) === "MM\0*")) {
    // TIFF 文件本身就是一段 TIFF 结构，直接从 0 开始当 EXIF 解析
    return { facts: { format: "TIFF", bytes: buffer.length }, exif: buffer };
  }
  if (buffer.length >= 6 && (buffer.toString("latin1", 0, 4) === "GIF8")) {
    return { facts: readGif(buffer) };
  }
  if (buffer.length >= 12 && buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") {
    return { facts: { format: "WebP", bytes: buffer.length } };
  }
  return { facts: { format: "未知", bytes: buffer.length } };
}

export const imageExif: SyncHandler = async ({ files, filenames }) => {
  const file = files[0];
  if (!file || file.length === 0) {
    throw new Error("上传的图片是空文件，请重新选择一张图片");
  }

  const { facts, exif } = detectImage(file);
  if (facts.format === "未知") {
    throw new Error("无法识别的图片格式，只支持读取 JPEG / PNG / TIFF / WebP / GIF 的 EXIF 信息");
  }

  const lines: string[] = ["图片信息", rule(), `文件名：${filenames[0] ?? "（未知）"}`, `格式：${facts.format}`, `大小：${formatBytes(facts.bytes)}`];
  if (facts.width && facts.height) lines.push(`尺寸：${facts.width} × ${facts.height} 像素`);

  const groups: Group[] = [];
  const notes: string[] = [];
  let le = true;

  if (exif) {
    try {
      if (exif.length < 8) throw new ExifParseError("EXIF 数据段太短");
      const order = exif.toString("latin1", 0, 2);
      if (order === "II") le = true;
      else if (order === "MM") le = false;
      else throw new ExifParseError("字节序标识不是 II 或 MM");
      const magic = readU16(exif, 2, le);
      if (magic !== 42) throw new ExifParseError("TIFF 魔数不是 42");
      const ifd0Offset = safeU32(exif, 4, le);

      const visited = new Set<number>();
      let offset = ifd0Offset;
      let depth = 0;
      let exifPointer = 0;
      let gpsPointer = 0;
      while (offset > 0 && depth < MAX_IFD_DEPTH && !visited.has(offset)) {
        visited.add(offset);
        const current = readIfdSafe(exif, offset, le, notes, depth === 0 ? "IFD0" : `IFD${depth}`);
        if (depth === 0) {
          groups.push(buildGroup("主图像信息（IFD0）", current, TAG_IFD0, le));
          exifPointer = findNumbers(current, 0x8769)?.[0] ?? 0;
          gpsPointer = findNumbers(current, 0x8825)?.[0] ?? 0;
        } else {
          groups.push(buildGroup(`附加 IFD${depth}`, current, TAG_IFD0, le));
        }
        offset = safeU32(exif, offset + 2 + readU16(exif, offset, le) * 12, le);
        depth += 1;
      }

      if (exifPointer > 0) {
        const exifEntries = readIfdSafe(exif, exifPointer, le, notes, "Exif 子目录");
        if (exifEntries.length > 0) groups.push(buildGroup("拍摄参数（Exif 子目录）", exifEntries, TAG_EXIF, le));
      }
      if (gpsPointer > 0) {
        const gpsEntries = readIfdSafe(exif, gpsPointer, le, notes, "GPS 子目录");
        if (gpsEntries.length > 0) {
          const group = buildGroup("GPS 定位信息", gpsEntries, TAG_GPS, le);
          const gps = summarizeGps(gpsEntries);
          if (gps.latitude !== undefined && gps.longitude !== undefined) {
            group.lines.push(
              `  十进制度数：${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`,
              `  纬度：${toDms(gps.latitude, "N", "S")}`,
              `  经度：${toDms(gps.longitude, "E", "W")}`,
            );
          }
          if (gps.altitude !== undefined) group.lines.push(`  海拔：${gps.altitude.toFixed(1)} 米`);
          groups.push(group);
        }
      }
    } catch (error) {
      notes.push(`EXIF 解析失败：${error instanceof Error ? error.message : "数据异常"}`);
    }
  }

  const hasContent = groups.some((group) => group.lines.length > 0);
  if (!hasContent) {
    const body = [
      "这张图片没有 EXIF 信息（可能是 PNG 格式，或已被压缩工具清除）",
      rule(),
      ...lines.slice(2),
    ];
    if (notes.length > 0) body.push("", "解析备注：", ...notes.map((note) => `  ${note}`));
    return {
      kind: "text",
      text: body.join("\n"),
      filename: `${stemName(filenames[0], "image")}-exif.txt`,
      mimeType: TEXT_MIME,
    };
  }

  const report: string[] = [...lines, rule()];
  // 关键的几项先单独提一行，省得用户在一堆 tag 里翻
  const allTags = groups.flatMap((group) => group.lines);
  const pick = (keyword: string): string | undefined => {
    const hit = allTags.find((line) => line.includes(keyword));
    return hit ? hit.trim() : undefined;
  };
  const summary = [pick("相机制造商"), pick("相机型号"), pick("镜头型号"), pick("原始拍摄时间")]
    .filter((item): item is string => Boolean(item))
    .join(" / ");
  if (summary) report.push(`摘要：${summary}`);

  for (const group of groups) {
    if (group.lines.length === 0) continue;
    report.push("", `【${group.title}】共 ${group.rawCount} 项`);
    report.push(...group.lines);
  }
  if (notes.length > 0) {
    report.push("", "解析备注：");
    for (const note of notes) report.push(`  ${note}`);
  }

  return {
    kind: "text",
    text: report.join("\n"),
    filename: `${stemName(filenames[0], "image")}-exif.txt`,
    mimeType: TEXT_MIME,
  };
};

// ───────────────────────────── 7. SVG 优化 ─────────────────────────────

/**
 * 这些元素的字符数据是有意义的空白，动一下就可能改变显示效果：
 * text/tspan 不用说；style/script 里的换行可能是语法的一部分；
 * foreignObject 里是 HTML，空白同样会被浏览器折叠成可见空格。
 */
const WHITESPACE_SENSITIVE = new Set([
  "text",
  "tspan",
  "textpath",
  "tref",
  "title",
  "desc",
  "style",
  "script",
  "foreignobject",
  "pre",
]);

function localName(name: string): string {
  const colon = name.indexOf(":");
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

/** 找到标签的结束 ">"，属性值里的 ">" 要跳过，否则会把一个标签切成两半。 */
function findTagEnd(source: string, start: number): number {
  let quote = "";
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
    // 标签内部再出现 "<" 说明结构已经畸形，放弃后续优化比猜下去安全
    if (ch === "<") return -1;
  }
  return -1;
}

/**
 * 标签内部的空白压缩：属性之间多个空白/换行合成一个，引号里的内容原样保留。
 * XML 规定属性之间可以有任意空白，所以这是纯粹的体积优化。
 */
function collapseTagWhitespace(tag: string): string {
  let out = "";
  let quote = "";
  let pendingSpace = false;
  for (const ch of tag) {
    if (quote) {
      out += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      out += ch;
      pendingSpace = false;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      if (out !== "" && !out.endsWith("<") && !out.endsWith("/") && ch !== ">") out += " ";
      pendingSpace = false;
    }
    out += ch;
  }
  return out.replace(/\s+\/>$/, "/>");
}

function optimizeSvgSource(input: string): string {
  let source = input;
  // BOM 不参与渲染，留着只是白白占 3 个字节
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);

  // 注释：XML 注释本来就不渲染
  source = source.replace(/<!--[\s\S]*?-->/g, "");
  // metadata：RDF/编辑器描述，任何渲染器都不看
  source = source.replace(/<metadata\b[^>]*\/>/gi, "");
  source = source.replace(/<metadata\b[^>]*>[\s\S]*?<\/metadata\s*>/gi, "");
  // 编辑器命名空间声明。刻意保留 xmlns / xmlns:xlink —— xlink:href 还在用它们
  source = source.replace(
    /\s+xmlns:(?:inkscape|sodipodi|sketch|adobe|figma|vectornator|dc|cc|rdf|i|graph|osb)\s*=\s*(?:"[^"]*"|'[^']*')/gi,
    "",
  );
  // 编辑器私有属性（inkscape:label、sodipodi:nodetypes 之类）对渲染没有任何作用
  source = source.replace(
    /\s+(?:inkscape|sodipodi|sketch):[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*')/gi,
    "",
  );

  let output = "";
  let index = 0;
  let protectDepth = 0;
  let guard = 0;

  while (index < source.length && guard < 200000) {
    guard += 1;
    const lt = source.indexOf("<", index);
    if (lt === -1) {
      const tail = source.slice(index);
      output += protectDepth > 0 ? tail : collapseFreeText(tail);
      break;
    }
    const freeText = source.slice(index, lt);
    output += protectDepth > 0 ? freeText : collapseFreeText(freeText);

    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      const stop = end === -1 ? source.length : end + 3;
      output += source.slice(lt, stop);
      index = stop;
      continue;
    }

    const gt = findTagEnd(source, lt);
    if (gt === -1) {
      // 找不到标签结尾就把剩下的原样拼回去，宁可没优化也不能弄坏文件
      output += source.slice(lt);
      break;
    }
    const rawTag = source.slice(lt, gt + 1);
    output += protectDepth > 0 ? rawTag : collapseTagWhitespace(rawTag);

    const isClose = /^<\s*\//.test(rawTag);
    const selfClosing = /\/\s*>$/.test(rawTag);
    const nameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(rawTag);
    const name = nameMatch ? localName(nameMatch[1] ?? "") : "";
    if (protectDepth > 0) {
      if (isClose) protectDepth -= 1;
      else if (!selfClosing) protectDepth += 1;
    } else if (!isClose && !selfClosing && WHITESPACE_SENSITIVE.has(name)) {
      protectDepth = 1;
    }
    index = gt + 1;
  }

  // 根元素之外的空白节点不参与渲染，顺手去掉
  return output.trim();
}

/**
 * 非受保护区域里的纯空白文本节点直接删掉（SVG 不渲染文本元素之外的字符数据）。
 * 夹带可见字符的节点一律原样保留：那种写法本身就不规范，猜它该怎么处理不如不动。
 */
function collapseFreeText(text: string): string {
  return text.trim() === "" ? "" : text;
}

export const svgOptimize: SyncHandler = async ({ files, filenames }) => {
  const file = files[0];
  if (!file || file.length === 0) {
    throw new Error("请上传需要优化的 SVG 文件");
  }
  // 允许前面有 XML 声明/DOCTYPE，所以只看前 1KB 里有没有 <svg
  const head = file.subarray(0, 1024).toString("utf8").toLowerCase();
  if (!head.includes("<svg")) {
    throw new Error("这不是一个 SVG 文件");
  }

  const original = file.toString("utf8");
  let optimized = "";
  try {
    optimized = optimizeSvgSource(original);
  } catch {
    // 优化器本身出错时退回原文件，绝不能因为优化失败让用户拿不到东西
    optimized = "";
  }

  const originalBytes = file.length;
  const optimizedBytes = Buffer.byteLength(optimized, "utf8");
  // 优化后反而更大（例如原文件本来就只有一行）就原样返回，保证工具只做不劣化的事
  const useOriginal = optimizedBytes === 0 || optimizedBytes >= originalBytes;
  const outBuffer = useOriginal ? file : Buffer.from(optimized, "utf8");

  return {
    kind: "file",
    buffer: outBuffer,
    filename: `${stemName(filenames[0], "image")}-optimized.svg`,
    mimeType: "image/svg+xml",
  };
};

// ───────────────────────────── 8. ASCII 艺术字 ─────────────────────────────

/** 5 行高的位图字体。每行长度即字宽，字形之间另加 1 列间隔。 */
const ASCII_FONT: Record<string, string[]> = {
  A: [" ### ", "#   #", "#####", "#   #", "#   #"],
  B: ["#### ", "#   #", "#### ", "#   #", "#### "],
  C: [" ####", "#    ", "#    ", "#    ", " ####"],
  D: ["#### ", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#### ", "#    ", "#####"],
  F: ["#####", "#    ", "#### ", "#    ", "#    "],
  G: [" ####", "#    ", "#  ##", "#   #", " ####"],
  H: ["#   #", "#   #", "#####", "#   #", "#   #"],
  I: ["#####", "  #  ", "  #  ", "  #  ", "#####"],
  J: ["    #", "    #", "    #", "#   #", " ### "],
  K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#### ", "#    ", "#    "],
  Q: [" ### ", "#   #", "# # #", "#  # ", " ## #"],
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  S: [" ####", "#    ", " ### ", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", " # # ", " # # "],
  W: ["#   #", "#   #", "# # #", "## ##", "#   #"],
  X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
  Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "   # ", "  #  ", " #   ", "#####"],
  "0": [" ### ", "#  ##", "# # #", "##  #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", "#####"],
  "2": [" ### ", "#   #", "   # ", "  #  ", "#####"],
  "3": ["#### ", "    #", " ### ", "    #", "#### "],
  "4": ["#  # ", "#  # ", "#####", "   # ", "   # "],
  "5": ["#####", "#    ", "#### ", "    #", "#### "],
  "6": [" ####", "#    ", "#### ", "#   #", " ### "],
  "7": ["#####", "   # ", "  #  ", " #   ", "#    "],
  "8": [" ### ", "#   #", " ### ", "#   #", " ### "],
  "9": [" ### ", "#   #", " ####", "    #", " ### "],
  " ": ["   ", "   ", "   ", "   ", "   "],
  "!": ["  #  ", "  #  ", "  #  ", "     ", "  #  "],
  "?": [" ### ", "#   #", "   # ", "     ", "  #  "],
  ".": ["     ", "     ", "     ", "     ", "  #  "],
  ",": ["     ", "     ", "     ", "  #  ", " #   "],
  ":": ["     ", "  #  ", "     ", "  #  ", "     "],
  "-": ["     ", "     ", "#####", "     ", "     "],
};

const ASCII_MAX_CHARS = 20;

function renderAsciiArt(text: string): string {
  const rows: string[] = ["", "", "", "", ""];
  const glyphs = [...text];
  glyphs.forEach((glyph, glyphIndex) => {
    const bitmap = ASCII_FONT[glyph] ?? ASCII_FONT[" "];
    if (!bitmap) return;
    for (let row = 0; row < 5; row += 1) {
      const piece = bitmap[row] ?? "";
      // 字形之间留一列空白，否则两个字母会粘在一起分不出来
      rows[row] += glyphIndex === glyphs.length - 1 ? piece : `${piece} `;
    }
  });
  // 行尾空白看不见却占体积，去掉不影响观感
  return rows.map((row) => row.replace(/\s+$/, "")).join("\n");
}

export const asciiArt: SyncHandler = async ({ fields }) => {
  // 连续空白（含粘贴进来的换行）折叠成一个空格，再按字符数判断上限
  const text = (fields.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("请输入要转换的英文或数字");

  // 校验前先转大写：位图字体只有大写一套，小写直接转换比报错好用
  const unsupported = [...text].filter((ch) => !(ch.toUpperCase() in ASCII_FONT));
  if (unsupported.length > 0) {
    // 中文/emoji 用 5x5 位图拼不出来，直接把用户引导到能做出同样效果的工具
    const nonAscii = unsupported.some((ch) => ch.charCodeAt(0) > 126);
    if (nonAscii) {
      throw new Error("ASCII 艺术字只支持英文字母和数字，中文请用「签名设计」或「花体字」工具");
    }
    throw new Error(`暂不支持「${unsupported[0]}」这个字符，目前支持 A-Z、0-9、空格和 ! ? . , : - `);
  }

  if (text.length > ASCII_MAX_CHARS) {
    throw new Error("最多支持 20 个字符");
  }

  // 小写字母统一转大写：5x5 位图根本画不出大小写区别，报错反而更难用
  const art = renderAsciiArt(text.toUpperCase());

  return {
    kind: "text",
    text: art,
    filename: "ascii-art.txt",
    mimeType: TEXT_MIME,
  };
};
