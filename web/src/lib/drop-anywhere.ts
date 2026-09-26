import { createUiText as __createUiText, uiMessage as __msg } from "@/lib/language";
const __ui = __createUiText("lib/drop-anywhere.ts");
import {hasMultipleUploadFields} from "./drop-targets";
import {installFolderInputActions} from "./folder-input-actions";
import {dropEntries,directFiles} from "./folder-import";
import { acceptsFile } from "./pending-file-model";
import { recommendFiles, currentToolAccepts } from "./file-recommendations";

/**
 * 「整页可拖入文件」垫片。
 *
 * 背景：项目里部分工具的上传区是各自手写的，只支持点击选择、不支持拖拽。
 * 在这里统一兜底：
 *   · 鼠标把文件拖到窗口任意位置 → 显示"松开即可载入"的浮层
 *   · 松手时判断落点在哪张卡片里，填入对应的文件框
 *   · 具有独立原生拖拽/Dropzone 的组件不受干扰
 *   · 包含多重自愈与看门狗机制，确保浮层在拖拽中断、取消、Esc、鼠标释放时绝不常驻假死
 */

let installed = false;

function hasFiles(e: DragEvent): boolean {
  const dt = e.dataTransfer;
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes("Files")) return true;
  return (dt.files?.length ?? 0) > 0;
}

/**
 * 找到落点对应的文件框。
 */
function findTargetInput(x: number, y: number, target?: EventTarget | null): HTMLInputElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(el => el.getClientRects().length > 0);
  const scope = (target instanceof Element ? target.closest('[role="dialog"][aria-modal="true"]') : null) || dialogs[dialogs.length - 1] || document;
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((el) => !el.disabled);
  if (inputs.length === 0) return null;

  const markers = "[data-furinakit-dropzone],[data-furinakit-file-field],[data-pending-tool]";

  // ① 优先检查事件目标与其祖先链、以及光标命中点
  const chains: (Element | null)[] = [];
  if (target instanceof Element) chains.push(target);
  const hit = document.elementFromPoint(x, y);
  if (hit && !hit.hasAttribute("data-furinakit-drop-overlay")) chains.push(hit);

  for (const start of chains) {
    let node: Element | null = start;
    while (node && node !== document.body) {
      if (node.matches?.(markers) || node.matches?.('label')) {
        const own = node.querySelector<HTMLInputElement>('input[type="file"]:not([disabled])');
        if (own) return own;
      }
      node = node.parentElement;
    }
  }

  const cardOf = (input: HTMLInputElement): Element | null => {
    let node: Element | null = input.parentElement;
    let best: Element | null = null;
    while (node && node !== document.body) {
      const r = node.getBoundingClientRect();
      if (r.width > 80 && r.height > 50) best = node;
      node = node.parentElement;
    }
    return best;
  };

  // 检查已标记的上传区或者 label 范围
  for (const input of inputs) {
    const container = input.closest(markers) || input.closest('label') || input.parentElement;
    if (!container) continue;
    const r = container.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return input;
    }
  }

  // 多个输入框时的卡片范围判定
  if (hasMultipleUploadFields()) {
    for (const input of inputs) {
      const card = cardOf(input);
      if (card) {
        const r = card.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return input;
        }
      }
    }
    return null;
  }

  // 单一或统领工具：按卡片范围命中
  for (const input of inputs) {
    const card = cardOf(input);
    if (!card) continue;
    const r = card.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return input;
    }
  }

  // 兜底：距离最近的文件框
  let nearest: HTMLInputElement | null = null;
  let bestDist = Infinity;
  for (const input of inputs) {
    const card = cardOf(input) ?? input;
    const r = card.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      nearest = input;
    }
  }
  return nearest ?? inputs[0];
}

/** 把拖进来的文件写入 input，并触发原有 change 处理 */
function applyFiles(input: HTMLInputElement, incoming: File[]) {
  const accept = input.accept;
  const files = incoming.filter(f => acceptsFile(f, accept));
  const rejected = incoming.filter(f => !acceptsFile(f, accept));
  if (rejected.length) recommendFiles(rejected, true);
  if (!files.length) return;

  const dt = new DataTransfer();
  if (input.multiple) {
    files.forEach((f) => dt.items.add(f));
  } else {
    dt.items.add(files[0]);
  }
  try {
    input.files = dt.files;
  } catch {
    return;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function installDropAnywhere() {
  if (installed || typeof window === "undefined") return;
  if (window.location.search.includes("window=float-ball") || window.location.hash.includes("float-ball")) {
    return;
  }
  installed = true;
  installFolderInputActions();

  let overlay: HTMLDivElement | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const feedWatchdog = () => {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      hideOverlay();
    }, 380);
  };

  const hideOverlay = () => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    if (overlay) {
      try {
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      } catch {}
      overlay = null;
    }
  };

  const showOverlay = (label: string) => {
    feedWatchdog();
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.setAttribute("data-furinakit-drop-overlay", "true");
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483000",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "cursor:pointer",
        "background:hsl(var(--background) / 0.72)",
        "backdrop-filter:blur(2px)",
        "transition:opacity .12s ease-out",
      ].join(";");

      // 点击或轻触任意处即可立即关闭，防止任何异常滞留
      overlay.addEventListener("click", () => hideOverlay());
      overlay.addEventListener("mousedown", () => hideOverlay());
      overlay.addEventListener("pointerdown", () => hideOverlay());

      overlay.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        feedWatchdog();
      });

      const box = document.createElement("div");
      box.style.cssText = [
        "padding:20px 28px",
        "border-radius:16px",
        "border:2px dashed hsl(var(--primary) / 0.55)",
        "background:hsl(var(--card) / 0.95)",
        "color:hsl(var(--foreground))",
        "font-size:14px",
        "font-weight:600",
        "box-shadow:0 20px 50px -20px hsl(var(--primary) / 0.5)",
        "pointer-events:none",
      ].join(";");
      box.textContent = __ui(label);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }
    if (overlay.firstElementChild) overlay.firstElementChild.textContent = __ui(label);
  };

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    if (e.defaultPrevented) return;
    feedWatchdog();
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (hasMultipleUploadFields()) {
      hideOverlay();
      return;
    }
    const input = findTargetInput(e.clientX, e.clientY, e.target);
    const notes = new URLSearchParams(location.search).get("window") === "notes" || location.pathname === "/tools/notes";
    showOverlay(notes ? "松开即可添加为便签附件" : input ? "松开即可载入文件，不支持的类型将推荐其他工具" : "松开文件，为您推荐支持该类型的工具");
  };

  const onDragLeave = (e: DragEvent) => {
    if (
      !e.relatedTarget ||
      e.clientX <= 0 ||
      e.clientY <= 0 ||
      e.clientX >= window.innerWidth ||
      e.clientY >= window.innerHeight
    ) {
      hideOverlay();
    }
  };

  const onDrop = (e: DragEvent) => {
    hideOverlay();
    if ((window as any).__FURINAKIT_PENDING_ACTIVE__ && !(e as any).furinakitDelivery && !hasMultipleUploadFields()) return;
    if (!hasFiles(e)) return;
    if (e.defaultPrevented) return;
    const incoming = Array.from(e.dataTransfer?.files ?? []);
    if (incoming.length === 0) return;
    const input = findTargetInput(e.clientX, e.clientY, e.target);
    if (!input) {
      e.preventDefault();
      if (!hasMultipleUploadFields()) recommendFiles(incoming);
      return;
    }
    e.preventDefault();
    applyFiles(input, incoming);
  };

  // 捕获阶段：目录导入拦截与不匹配工具推荐，但放过工具组件自身的直接 Dropzone
  window.addEventListener("drop", (e: DragEvent) => {
    hideOverlay();
    if (!hasFiles(e)) return;
    if (e.target instanceof Element && e.target.closest("[data-dedup-drop]")) return;

    // 自带专属拖拽区域的组件优先自行处理
    if (e.target instanceof Element && e.target.closest("[data-furinakit-dropzone],[data-furinakit-file-field],[data-pending-tool]")) {
      return;
    }

    const entries = dropEntries(e.dataTransfer);
    if (entries.some(entry => entry.isDirectory)) {
      const input = findTargetInput(e.clientX, e.clientY, e.target);
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!input?.multiple) {
        window.alert(__ui("请在支持批量导入的工具中导入文件夹。"));
        return;
      }
      void directFiles(entries).then(files => {
        if (!input.isConnected) return;
        const accepted = files.filter(file => acceptsFile(file, input.accept));
        if (!accepted.length) {
          window.alert(__ui("文件夹第一层没有此工具支持的文件，未读取子文件夹。"));
          return;
        }
        applyFiles(input, accepted);
      }).catch(error => window.alert(__msg("文件夹导入失败：{0}", String(error))));
      return;
    }

    if (new URLSearchParams(location.search).has("window")) return;
    if ((e as any).furinakitDelivery || !hasFiles(e)) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;

    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    const input = findTargetInput(e.clientX, e.clientY, e.target);
    const inTool = location.pathname.startsWith("/tools/");
    if (hasMultipleUploadFields() && !input) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    const accepted = input ? files.every(f => acceptsFile(f, input.accept)) : inTool && currentToolAccepts(files);
    if (!accepted) {
      e.preventDefault();
      e.stopImmediatePropagation();
      recommendFiles(files, inTool);
    }
  }, true);

  // 拖拽全局事件监听
  window.addEventListener("dragover", onDragOver, false);
  window.addEventListener("dragleave", onDragLeave, true);
  window.addEventListener("drop", onDrop, false);
  window.addEventListener("dragend", hideOverlay, true);

  // 防滞留自愈保底：鼠标按键抬起、窗口失焦、按下 Esc 或无拖拽鼠标移动时立即收起浮层
  window.addEventListener("mouseup", hideOverlay, true);
  window.addEventListener("pointerup", hideOverlay, true);
  window.addEventListener("blur", hideOverlay, true);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideOverlay();
  }, true);
  window.addEventListener("mousemove", (e) => {
    if (e.buttons === 0 && overlay) {
      hideOverlay();
    }
  }, true);
}
