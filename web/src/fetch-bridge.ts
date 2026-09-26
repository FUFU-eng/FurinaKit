// fetch 拦截层：把「Next 的服务端接口」重定向到「Rust 命令」。
//
// 背景：Next 版的工具组件里大量写 fetch("/api/xxx")，那些接口原来由 Next 的 API 路由
// 加 Python 内核实现。Tauri 里没有 HTTP 服务，这些请求会全部失败。
//
// 做法：拦下 /api/* 的请求，改写成 invoke("api_call")，由 Rust 直接实现同样的功能。
//
// 这样 163 个组件**一行都不用改**。反过来，没有对应 Rust 命令的接口会返回一个明确的
// 错误信息（不是静默失败），界面上会看到"这个功能还没搬到 Tauri 版"。
//
// 两条约定（少了任何一条，工具在界面里就是"转圈/空白"，而不是报错）：
//   1. 上传：组件用 FormData 传文件，但 invoke 只能传 JSON，
//      所以这里把每个文件读成 base64，装进 args.__files = [{field,name,data}]，
//      由 Rust 侧统一落盘（Rust 读的就是这个字段名）。
//   2. 下载：产物要的是二进制（组件普遍是 fetch(...).then(r => r.blob())），
//      所以 Rust 回 { "__binary": { data, name, mime } }，这里解回真正的 Response。

import { invoke } from "@tauri-apps/api/core";
import { stageFormData, discardStagedUploads } from "./lib/native-upload";
import { ensureOutputDirectory, installLocalOutputShim, saveOutputBlob, reportOutputSaved, internalDownloadHref } from "./lib/output-directory";

const API_PREFIX = "/api/";

function makeResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data ?? null), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 分块转 base64：不能一次性 String.fromCharCode(...全部字节)，大文件会爆栈 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}


/** 所有内部接口都走同一个 Rust 入口 api_call，Rust 那边按路径分发。
 *  这样以后加接口只改 Rust 一个文件，不用重新注册命令。 */
function commandNameFor(_path: string, _method: string): string {
  return "api_call";
}

/**
 * 让 `<a href="/api/...">` 这种"下载链接"也能用。
 *
 * 为什么需要：fetch 补丁只能拦 `fetch()`，拦不住**浏览器自己发起的导航**。
 * 项目里不少地方是把产物地址直接写在 `<a href>` 上的（互传的文件下载、PDF 各工具、
 * 图片转 PDF、AI PPT……），点了会真的去导航，而桌面版没有 HTTP 服务 → 什么都没发生。
 * 这里在 document 上兜一层：点到 /api/ 开头的链接就自己走桥接取回文件再"另存"。
 */
function installDownloadLinkShim() {
  document.addEventListener(
    "click",
    async (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = internalDownloadHref(anchor.getAttribute("href") || "");
      if (!href) return;

      e.preventDefault();
      try {
        await ensureOutputDirectory();
        const jobDownload = href.match(/^\/api\/jobs\/([^/?]+)\/download(?:\?|$)/);
        if (jobDownload) {
          const path=await invoke<string>("save_job_result", { jobId: decodeURIComponent(jobDownload[1]), filename: anchor.getAttribute("download") || "" });
          if(!path)throw new Error("保存没有返回有效路径");
          reportOutputSaved(path);
          return;
        }
        if (/^\/api\/transfer\/download(?:\?|$)/.test(href)) {
          const transfer = new URL(href, location.origin);
          const fileId = transfer.searchParams.get("id") || "";
          const kind = transfer.searchParams.get("type") || "shared";
          if (!fileId || !["shared", "received"].includes(kind)) throw new Error("互传文件参数无效");
          await invoke("save_transfer_result", { fileId, kind });
          reportOutputSaved();
          return;
        }
        const res = await fetch(href, { cache: "no-store" });
        if (!res.ok) {
          const detail = await res.json().catch(() => null);
          throw new Error(typeof detail?.error === "string" ? detail.error : `下载失败 (${res.status})`);
        }
        const type = res.headers.get("Content-Type") || "";
        if (type.includes("application/json") && res.headers.get("x-result-kind") !== "file") {
          throw new Error("下载接口没有返回文件，请重试");
        }
        const blob = await res.blob();
        let name = "";
        const header = res.headers.get("x-result-filename");
        if (header) {
          try {
            name = decodeURIComponent(header);
          } catch {
            name = header;
          }
        }
        if (!name) name = (anchor.getAttribute("download") || "").trim();
        if (!name) name = decodeURIComponent(href.split("/").pop()?.split("?")[0] || "download");
        reportOutputSaved(await saveOutputBlob(blob, name));
      } catch (error) {
        window.dispatchEvent(new CustomEvent("fk-download-error", {
          detail: typeof error === "string" ? error : error instanceof Error ? error.message : "下载失败，请重试",
        }));
      }
    },
    true,
  );
}

export function installFetchBridge() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __fkFetchPatched?: boolean; fetch: typeof fetch };
  if (w.__fkFetchPatched) return;
  w.__fkFetchPatched = true;
  installLocalOutputShim();
  installDownloadLinkShim();

  const orig = w.fetch.bind(window);

  w.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? (typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined);
    let url = "";
    let method = (init?.method || "GET").toUpperCase();
    let body: BodyInit | null | undefined = init?.body;

    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (input && typeof (input as Request).url === "string") {
      url = (input as Request).url;
      method = (init?.method || (input as Request).method || "GET").toUpperCase();
      if (body === undefined) body = (input as Request).body;
    } else {
      url = String((input as { url?: unknown })?.url || input || "");
    }

    // 只接管应用内部的接口；外部的（比如网络查询要访问公共服务）照原样放行
    const isInternal = typeof url === "string" && (url.startsWith(API_PREFIX) || url.startsWith(location.origin + API_PREFIX));
    if (!isInternal) {
      return orig(input as RequestInfo, init);
    }

    const path = url.startsWith(API_PREFIX) ? url.slice(API_PREFIX.length) : url.split(API_PREFIX)[1];
    if (signal?.aborted) throw signal.reason ?? new DOMException("请求已取消", "AbortError");

    // 解析参数：**查询串先解析，body 再覆盖**。
    // 顺序很重要：原版有 `/api/transfer?action=share` 这种"查询串带参数 + body 带数据"
    // 的写法（POST FormData / POST JSON 都这么用），只解析 body 的话 action 就丢了。
    let args: Record<string, unknown> = {};
    try {
      if (path.includes("?")) {
        const q = path.split("?")[1];
        new URLSearchParams(q).forEach((v, k) => {
          args[k] = v;
        });
      }
      if (typeof body === "string") {
        args = { ...args, ...JSON.parse(body) };
      } else if (body instanceof FormData) {
        args = { ...args, ...(await stageFormData(body, signal)) };
      }
    } catch (e) {
      if (signal?.aborted) throw signal.reason ?? e;
      return makeResponse({ error: `请求参数解析失败：${String(e)}` }, 400);
    }

    const cmd = commandNameFor(path, method);
    try {
      const data = await invoke(cmd, { path: "/api/" + path.split("?")[0], method, args });
      if (signal?.aborted) throw signal.reason ?? new DOMException("请求已取消", "AbortError");

      // 二进制产物：Rust 用 { __binary: {...} } 回，这里还原成 Blob。
      // kind 可选（"text" / "file"）：DNS、SSL 这类同步文本工具靠它让前端把响应当文本读。
      const bin = (
        data as { __binary?: { data: string; name?: string; mime?: string; kind?: string } } | null
      )?.__binary;
      if (bin && typeof bin.data === "string") {
        const bytes = base64ToBytes(bin.data);
        const name = bin.name || "result.bin";
        return new Response(bytes, {
          status: 200,
          headers: {
            "Content-Type": bin.mime || "application/octet-stream",
            // 有些组件就是从这个头取文件名（decodeURIComponent 之后当 download 属性用）
            "x-result-filename": encodeURIComponent(name),
            "x-result-kind": bin.kind || "file",
            "Content-Length": String(bytes.length),
          },
        });
      }

      return makeResponse(data, 200);
    } catch (e) {
      if (signal?.aborted) throw signal.reason ?? e;
      const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
      // 没实现 vs 执行出错，分开说清楚
      const notImplemented = /unknown command|command [`'"]?api_call[`'"]? not found/i.test(msg);
      return makeResponse(
        {
          error: notImplemented
            ? `这个功能还没搬到 Tauri 版（缺少 Rust 命令 ${cmd}）`
            : msg,
          __missingCommand: notImplemented ? cmd : undefined,
        },
        notImplemented ? 501 : 500,
      );
    } finally {
      await discardStagedUploads(args);
    }
  };
}
