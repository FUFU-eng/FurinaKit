/**
 * 媒体地址替身 —— 让 `<img src="/api/...">` 这类预览也能显示出来。
 *
 * 针对 W15 与 W16 的架构修复：
 *  1. 支持 src 动态切换：按当前原始 API src 精准判断，同一个元素切换为新的 /api/ 地址时能正确再次转换。
 *  2. 异步时序防竞态：采用自增版本号（token），如果用户快速切图，旧的异步请求完成后自动丢弃并立即回收 blob，绝不覆盖新结果。
 *  3. 多媒体类型完整回收：适配 img（load/error）以及 video/audio（loadeddata/canplay/error），并在换图或元素解绑时安全销毁旧 ObjectURL。
 */

const MEDIA_TAGS = ["img", "video", "audio"] as const;
type MediaEl = HTMLImageElement | HTMLVideoElement | HTMLAudioElement;

function needsFix(el: Element): el is MediaEl {
  const tag = el.tagName.toLowerCase();
  if (!MEDIA_TAGS.includes(tag as (typeof MEDIA_TAGS)[number])) return false;
  const media = el as MediaEl;
  const src = media.getAttribute("src") || "";
  // 只接管站内接口；blob:/data:/http(s): 一律不动
  if (!src.startsWith("/api/")) return false;
  // 若当前元素已经被修复过且绑定的原始地址就是该 src，无需重复处理
  if (media.dataset.fkFixedSrc === src) return false;
  return true;
}

function fix(el: MediaEl) {
  const src = el.getAttribute("src") || "";
  if (!src.startsWith("/api/")) return;

  // 标记当前正在处理的目标地址，并自增请求版本号
  const token = (Number(el.dataset.fkToken) || 0) + 1;
  el.dataset.fkToken = String(token);
  el.dataset.fkFixedSrc = src;

  // 如果此前已有正在使用的旧 blob，先记录以便安全更替
  const oldBlobUrl = el.dataset.fkBlobUrl;

  fetch(src, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      // 检查请求是否已过期（用户在此期间切换到了其他媒体或其它任务）
      if (el.dataset.fkToken !== String(token)) {
        return; // 过期直接放弃，交给新的请求
      }

      const url = URL.createObjectURL(blob);
      el.dataset.fkBlobUrl = url;

      // 释放上一张图的 ObjectURL
      if (oldBlobUrl && oldBlobUrl !== url) {
        try { URL.revokeObjectURL(oldBlobUrl); } catch {}
      }

      el.setAttribute("src", url);

      // 根据元素类型监听加载完成事件
      const tag = el.tagName.toLowerCase();
      const isMedia = tag === "video" || tag === "audio";
      const finishEvents = isMedia ? ["loadeddata", "canplay", "error"] : ["load", "error"];

      let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
      const doCleanup = () => {
        if (cleanupTimer) clearTimeout(cleanupTimer);
        cleanupTimer = setTimeout(() => {
          if (el.dataset.fkBlobUrl === url) {
            delete el.dataset.fkBlobUrl;
          }
          try { URL.revokeObjectURL(url); } catch {}
        }, isMedia ? 15000 : 6000);
      };

      finishEvents.forEach((evt) => {
        el.addEventListener(evt, doCleanup, { once: true });
      });

      // 兜底保底计时器：避免某些特殊环境未触发 load 事件导致内存永久滞留
      setTimeout(doCleanup, 30000);
    })
    .catch((e) => {
      if (el.dataset.fkToken === String(token)) {
        el.setAttribute("title", `预览加载失败：${e instanceof Error ? e.message : String(e)}`);
        delete el.dataset.fkFixedSrc;
      }
    });
}

/** 在 React 渲染之前调用一次 */
export function installMediaShim() {
  if (typeof window === "undefined" || typeof MutationObserver === "undefined") return;

  const scan = (root: ParentNode) => {
    if (root instanceof HTMLElement && needsFix(root)) {
      fix(root);
      return;
    }
    root.querySelectorAll?.(MEDIA_TAGS.join(",")).forEach((el) => {
      if (needsFix(el)) fix(el);
    });
  };

  scan(document);

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      // 新增的节点
      for (const node of r.addedNodes) {
        if (node instanceof HTMLElement) scan(node);
      }
      // 组件改了 src（比如换了任务、换了结果）
      if (r.type === "attributes" && r.target instanceof HTMLElement && needsFix(r.target)) {
        fix(r.target);
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
}
