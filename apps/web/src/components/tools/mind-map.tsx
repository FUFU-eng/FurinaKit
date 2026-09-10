"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { useTheme } from "@/components/theme-provider";
import {
  Plus,
  CornerDownRight,
  Trash2,
  ChevronDown,
  ChevronRight,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  Upload,
  Sparkles,
  Eraser,
} from "lucide-react";

/* ───────────────────────── 数据模型与常量 ───────────────────────── */

type MNode = {
  id: string;
  text: string;
  folded?: boolean;
  children: MNode[];
};

const NW = 168; // 节点宽
const NH = 42; // 节点高
const HGAP = 52; // 层级水平间距
const VGAP = 14; // 兄弟垂直间距
const PAD = 40; // 导出/适配留白
const STORE_KEY = "furinakit-mindmap";

const uid = () => "n" + Math.random().toString(36).slice(2, 9);

const makeNode = (text: string, children: MNode[] = []): MNode => ({ id: uid(), text, children });

function sampleTree(): MNode {
  return {
    id: uid(),
    text: "中心主题",
    children: [
      {
        id: uid(),
        text: "主要分支一",
        children: [makeNode("子节点 1"), makeNode("子节点 2"), makeNode("子节点 3")],
      },
      {
        id: uid(),
        text: "主要分支二",
        children: [makeNode("想法 A"), makeNode("想法 B")],
      },
      { id: uid(), text: "主要分支三", children: [makeNode("双击可编辑")] },
      { id: uid(), text: "主要分支四", children: [] },
    ],
  };
}

// 深色 / 浅色两套分支配色（在两种背景下都清晰）
const BRANCH_DARK = ["#6ad4ff", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#fb7185", "#38bdf8", "#c084fc"];
const BRANCH_LIGHT = ["#0284c7", "#7c3aed", "#db2777", "#059669", "#d97706", "#e11d48", "#0369a1", "#9333ea"];

/* ───────────────────────── 不可变树操作 ───────────────────────── */

// 返回 id 对应的索引路径
function findPath(root: MNode, id: string): number[] | null {
  if (root.id === id) return [];
  for (let i = 0; i < root.children.length; i++) {
    const p = findPath(root.children[i], id);
    if (p) return [i, ...p];
  }
  return null;
}

function getNode(root: MNode, path: number[]): MNode {
  let n = root;
  for (const i of path) n = n.children[i];
  return n;
}

// 沿路径不可变更新，mutator 返回新节点
function alter(root: MNode, path: number[], mutator: (n: MNode) => MNode): MNode {
  if (path.length === 0) return mutator(root);
  const idx = path[0];
  const child = alter(root.children[idx], path.slice(1), mutator);
  const children = root.children.slice();
  children[idx] = child;
  return { ...root, children };
}

function cloneTree(n: MNode): MNode {
  return { ...n, folded: n.folded, children: n.children.map(cloneTree) };
}

/* ───────────────────────── 自动布局 ───────────────────────── */

type LayoutNode = { id: string; x: number; y: number; depth: number; color: string; hasKids: boolean; folded: boolean; kidCount: number };
type Link = { id: string; x1: number; y1: number; x2: number; y2: number; color: string; depth: number };

function subtreeHeight(n: MNode): number {
  if (!n.children.length || n.folded) return NH;
  const kids = n.children.reduce((s, c) => s + subtreeHeight(c), 0) + VGAP * (n.children.length - 1);
  return Math.max(NH, kids);
}

function computeLayout(root: MNode, palette: string[]) {
  const nodes: LayoutNode[] = [];
  const links: Link[] = [];

  const walk = (n: MNode, x: number, yCenter: number, depth: number, color: string) => {
    nodes.push({
      id: n.id,
      x,
      y: yCenter - NH / 2,
      depth,
      color,
      hasKids: n.children.length > 0,
      folded: !!n.folded,
      kidCount: n.children.length,
    });

    if (n.folded || !n.children.length) return;
    const kidsH =
      n.children.reduce((s, c) => s + subtreeHeight(c), 0) + VGAP * (n.children.length - 1);
    let cursor = yCenter - kidsH / 2;
    n.children.forEach((c, i) => {
      const h = subtreeHeight(c);
      const childCenter = cursor + h / 2;
      const cColor = depth === 0 ? palette[i % palette.length] : color;
      links.push({
        id: n.id + "->" + c.id,
        x1: x + NW,
        y1: yCenter,
        x2: x + NW + HGAP,
        y2: childCenter,
        color: cColor,
        depth: depth + 1,
      });
      walk(c, x + NW + HGAP, childCenter, depth + 1, cColor);
      cursor += h + VGAP;
    });
  };

  const totalH = subtreeHeight(root);
  walk(root, 0, totalH / 2, 0, palette[0]);

  // 内容尺寸
  let maxX = 0;
  const maxY = totalH;
  nodes.forEach((n) => (maxX = Math.max(maxX, n.x + NW)));
  return { nodes, links, width: maxX, height: Math.max(maxY, NH) };
}

/* ───────────────────────── 组件 ───────────────────────── */

export function MindMapTool() {
  const { colors, theme } = useTheme();
  const palette = theme === "light" ? BRANCH_LIGHT : BRANCH_DARK;

  const [root, setRoot] = useState<MNode>(() => sampleTree());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 60, y: 40 });
  const [history, setHistory] = useState<{ past: MNode[]; future: MNode[] }>({ past: [], future: [] });
  const [mounted, setMounted] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const layout = useMemo(() => computeLayout(root, palette), [root, palette]);
  const nodeMap = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    layout.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [layout]);

  /* 本地自动保存 + 恢复 */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as MNode;
        if (parsed && parsed.id) {
          setRoot(parsed);
          setSelectedId(parsed.id);
        }
      } else {
        setSelectedId((s) => s ?? root.id);
      }
    } catch {
      /* ignore */
    }
    setMounted(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(root));
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [root, mounted]);

  /* 提交一次可撤销变更 */
  const commit = useCallback(
    (next: MNode) => {
      setHistory((h) => ({ past: [...h.past.slice(-49), cloneTree(root)], future: [] }));
      setRoot(next);
    },
    [root],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      setRoot(prev);
      return { past: h.past.slice(0, -1), future: [cloneTree(root), ...h.future].slice(0, 50) };
    });
  }, [root]);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (!h.future.length) return h;
      const [nxt, ...rest] = h.future;
      setRoot(nxt);
      return { past: [...h.past, cloneTree(root)], future: rest };
    });
  }, [root]);

  /* ── 节点操作 ── */
  const addChild = useCallback(
    (id: string | null) => {
      if (!id) return;
      const path = findPath(root, id);
      if (!path) return;
      const fresh = makeNode("新节点");
      const next = alter(root, path, (n) => ({ ...n, folded: false, children: [...n.children, fresh] }));
      commit(next);
      setSelectedId(fresh.id);
      setEditingId(fresh.id);
    },
    [root, commit],
  );

  const addSibling = useCallback(
    (id: string | null) => {
      if (!id) return;
      const path = findPath(root, id);
      if (!path || path.length === 0) return; // 根节点没有同级
      const fresh = makeNode("新节点");
      const parentPath = path.slice(0, -1);
      const idx = path[path.length - 1];
      const next = alter(root, parentPath, (n) => {
        const children = n.children.slice();
        children.splice(idx + 1, 0, fresh);
        return { ...n, children };
      });
      commit(next);
      setSelectedId(fresh.id);
      setEditingId(fresh.id);
    },
    [root, commit],
  );

  const removeNode = useCallback(
    (id: string | null) => {
      if (!id) return;
      const path = findPath(root, id);
      if (!path || path.length === 0) return; // 根不可删
      const parentPath = path.slice(0, -1);
      const idx = path[path.length - 1];
      const parent = getNode(root, parentPath);
      const nextSibling = parent.children[idx + 1] || parent.children[idx - 1] || null;
      const next = alter(root, parentPath, (n) => ({
        ...n,
        children: n.children.filter((_, i) => i !== idx),
      }));
      commit(next);
      setSelectedId(nextSibling ? nextSibling.id : getNode(next, parentPath).id);
    },
    [root, commit],
  );

  const toggleFold = useCallback(
    (id: string | null) => {
      if (!id) return;
      const path = findPath(root, id);
      if (!path) return;
      const n = getNode(root, path);
      if (!n.children.length) return;
      commit(alter(root, path, (x) => ({ ...x, folded: !x.folded })));
    },
    [root, commit],
  );

  const rename = useCallback(
    (id: string, text: string) => {
      const path = findPath(root, id);
      if (!path) return;
      setRoot(alter(root, path, (n) => ({ ...n, text })));
    },
    [root],
  );

  /* 方向键导航：扁平节点按视觉 y、x 排序 */
  const visualOrder = useMemo(
    () => layout.nodes.slice().sort((a, b) => a.y - b.y || a.x - b.x),
    [layout],
  );

  const moveSelection = useCallback(
    (dir: "up" | "down" | "left" | "right") => {
      if (!selectedId) {
        setSelectedId(root.id);
        return;
      }
      const path = findPath(root, selectedId);
      if (!path) return;
      if (dir === "left" && path.length) {
        setSelectedId(getNode(root, path.slice(0, -1)).id);
        return;
      }
      if (dir === "right") {
        const n = getNode(root, path);
        if (n.children.length && !n.folded) setSelectedId(n.children[0].id);
        return;
      }
      const idx = visualOrder.findIndex((n) => n.id === selectedId);
      if (idx === -1) return;
      const target = dir === "up" ? visualOrder[idx - 1] : visualOrder[idx + 1];
      if (target) setSelectedId(target.id);
    },
    [selectedId, root, visualOrder],
  );

  /* ── 键盘快捷键（window 级，点击节点后无需画布聚焦即可用） ── */
  const processKey = (e: KeyboardEvent) => {
    if (editingId) return; // 编辑节点中不触发全局快捷键
    // 焦点在表单控件上时不拦截（输入框/下拉等）；按钮上的空格、回车也交给按钮本身
    const el = e.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
    if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    switch (e.key) {
      case "Tab":
        e.preventDefault();
        addChild(selectedId);
        break;
      case "Enter":
        e.preventDefault();
        addSibling(selectedId);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        removeNode(selectedId);
        break;
      case "F2":
        e.preventDefault();
        setEditingId(selectedId);
        break;
      case " ":
        e.preventDefault();
        toggleFold(selectedId);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveSelection("up");
        break;
      case "ArrowDown":
        e.preventDefault();
        moveSelection("down");
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveSelection("left");
        break;
      case "ArrowRight":
        e.preventDefault();
        moveSelection("right");
        break;
    }
  };

  // 用 ref 持有最新处理函数，window 监听只注册一次
  const processKeyRef = useRef(processKey);
  processKeyRef.current = processKey;
  useEffect(() => {
    const fn = (e: KeyboardEvent) => processKeyRef.current(e);
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  /* ── 画布平移 / 缩放 ── */
  const onBgPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onBgPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };
  const onBgPointerUp = () => {
    dragRef.current = null;
  };

  const zoomAt = useCallback(
    (nextZoom: number, cx?: number, cy?: number) => {
      const z = Math.min(2.2, Math.max(0.25, nextZoom));
      const rect = wrapRef.current?.getBoundingClientRect();
      // 以容器中心（或给定点）为锚缩放
      const ax = cx !== undefined && rect ? cx - rect.left : rect ? rect.width / 2 : 0;
      const ay = cy !== undefined && rect ? cy - rect.top : rect ? rect.height / 2 : 0;
      setPan((p) => {
        const wx = (ax - p.x) / zoom;
        const wy = (ay - p.y) / zoom;
        return { x: ax - wx * z, y: ay - wy * z };
      });
      setZoom(z);
    },
    [zoom],
  );

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomAt(zoom * factor, e.clientX, e.clientY);
  };

  const fitView = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const z = Math.min(
      1.4,
      Math.max(0.25, Math.min((rect.width - 40) / (layout.width + PAD * 2), (rect.height - 30) / (layout.height + PAD * 2))),
    );
    setZoom(z);
    setPan({
      x: (rect.width - layout.width * z) / 2,
      y: (rect.height - layout.height * z) / 2,
    });
  }, [layout.width, layout.height]);

  /* 初次挂载后自适应 */
  useEffect(() => {
    if (mounted) {
      const t = setTimeout(fitView, 60);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  /* ── 导入 / 导出 ── */
  const downloadFile = (content: string | Blob, name: string, mime: string) => {
    const blob = typeof content === "string" ? new Blob([content], { type: mime }) : content;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const buildOutline = (n: MNode, depth: number, lines: string[]) => {
    lines.push("  ".repeat(depth) + "- " + n.text);
    n.children.forEach((c) => buildOutline(c, depth + 1, lines));
  };

  const exportJSON = () => downloadFile(JSON.stringify(root, null, 2), "思维导图.json", "application/json");
  const exportOutline = () => {
    const lines: string[] = [];
    buildOutline(root, 0, lines);
    downloadFile(lines.join("\n"), "思维导图大纲.txt", "text/plain;charset=utf-8");
  };

  const serializeSvg = (): { xml: string; w: number; h: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const w = layout.width + PAD * 2;
    const h = layout.height + PAD * 2;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const view = clone.querySelector("[data-view]");
    view?.setAttribute("transform", `translate(${PAD},${PAD})`);
    // 背景
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(w));
    bg.setAttribute("height", String(h));
    bg.setAttribute("fill", colors.panel);
    clone.insertBefore(bg, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    return { xml, w, h };
  };

  const exportSVG = () => {
    const data = serializeSvg();
    if (!data) return;
    downloadFile(data.xml, "思维导图.svg", "image/svg+xml;charset=utf-8");
  };

  const exportPNG = () => {
    const data = serializeSvg();
    if (!data) return;
    const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(data.xml);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(data.w * scale);
      canvas.height = Math.ceil(data.h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = colors.panel;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) downloadFile(blob, "思维导图.png", "image/png");
      }, "image/png");
    };
    img.src = svgUrl;
  };

  const exportPDF = async () => {
    const data = serializeSvg();
    if (!data) return;
    try {
      const { PDFDocument } = await import("pdf-lib");
      const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(data.xml);
      const img = new Image();
      img.onload = async () => {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(data.w * scale);
        canvas.height = Math.ceil(data.h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = colors.panel;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) return;
        const pngBytes = await blob.arrayBuffer();
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([data.w, data.h]);
        const pngImage = await pdfDoc.embedPng(pngBytes);
        page.drawImage(pngImage, { x: 0, y: 0, width: data.w, height: data.h });
        const pdfBytes = await pdfDoc.save();
        downloadFile(new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" }), "思维导图.pdf", "application/pdf");
      };
      img.src = svgUrl;
    } catch (err) {
      console.error("PDF 导出失败", err);
    }
  };

  // 解析缩进文本大纲或 JSON
  const importText = (raw: string) => {
    const trimmed = raw.trim();
    let tree: MNode | null = null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const obj = JSON.parse(trimmed) as unknown;
        type JsonNode = { id?: unknown; text?: unknown; title?: unknown; folded?: unknown; children?: JsonNode[] };
        const revive = (x: JsonNode): MNode => ({
          id: typeof x.id === "string" ? x.id : uid(),
          text: String(x.text ?? x.title ?? "节点"),
          folded: !!x.folded,
          children: Array.isArray(x.children) ? x.children.map(revive) : [],
        });
        tree = revive(Array.isArray(obj) ? { text: "思维导图", children: obj as JsonNode[] } : (obj as JsonNode));
      } catch {
        /* 落到文本解析 */
      }
    }
    if (!tree) {
      const lines = trimmed.split(/\r?\n/).map((l) => l.replace(/\t/g, "  ")).filter((l) => l.trim());
      if (!lines.length) return;
      const indentOf = (l: string) => (l.match(/^ */)?.[0].length ?? 0) / 2;
      const rootLine = lines[0].replace(/^\s*-\s*/, "");
      tree = { id: uid(), text: rootLine, children: [] };
      const stack: { level: number; node: MNode }[] = [{ level: -1, node: tree }];
      for (let i = 1; i < lines.length; i++) {
        const level = Math.round(indentOf(lines[i]));
        const text = lines[i].trim().replace(/^-\s*/, "");
        const node = makeNode(text);
        while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
        stack[stack.length - 1].node.children.push(node);
        stack.push({ level, node });
      }
    }
    commit(tree);
    setSelectedId(tree.id);
    setTimeout(fitView, 80);
  };

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => importText(String(reader.result || ""));
    reader.readAsText(f);
    e.target.value = "";
  };

  const resetAll = () => {
    const t = sampleTree();
    commit(t);
    setSelectedId(t.id);
    setTimeout(fitView, 80);
  };
  const clearAll = () => {
    const t = makeNode("中心主题");
    commit(t);
    setSelectedId(t.id);
  };

  /* ── 渲染节点 ── */
  const renderNode = (ln: LayoutNode) => {
    const node = (() => {
      const p = findPath(root, ln.id);
      return p ? getNode(root, p) : null;
    })();
    if (!node) return null;
    const selected = selectedId === ln.id;
    const editing = editingId === ln.id;
    const isRoot = ln.depth === 0;
    // 选中状态使用高对比色环，避免与普通边框混淆
    const ringColor = theme === "light" ? "#0284c7" : "#6ad4ff";
    const border = selected ? ringColor : ln.depth === 0 ? ln.color : colors.borderSolid;
    return (
      <foreignObject key={ln.id} x={ln.x} y={ln.y} width={NW} height={NH} style={{ overflow: "visible" }}>
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            if (editingId !== ln.id) setSelectedId(ln.id);
          }}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedId(ln.id);
            wrapRef.current?.focus();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setSelectedId(ln.id);
            setEditingId(ln.id);
          }}
          title={node.text}
          style={{
            position: "relative",
            width: NW,
            height: NH,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            borderRadius: 10,
            background: isRoot ? ln.color : colors.card,
            color: isRoot ? (theme === "light" ? "#ffffff" : "#081226") : colors.textSecondary,
            border: `${selected ? 2.5 : 1.5}px solid ${border}`,
            boxShadow: selected ? `0 0 0 4px ${border}33, 0 6px 18px -8px ${border}aa` : "0 4px 14px -10px rgba(0,0,0,0.5)",
            fontWeight: isRoot ? 700 : selected ? 600 : 500,
            fontSize: isRoot ? 15 : 13.5,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          {/* 左侧分支色条 */}
          {!isRoot && (
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 6,
                bottom: 6,
                width: 3.5,
                borderRadius: 3,
                background: ln.color,
              }}
            />
          )}
          {editing ? (
            <input
              autoFocus
              defaultValue={node.text}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = e.target.value.trim() || node.text;
                rename(ln.id, v);
                setEditingId(null);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" || e.key === "Escape") {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim() || node.text;
                    rename(ln.id, v);
                  }
                  setEditingId(null);
                }
              }}
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                background: colors.cardHover,
                color: colors.text,
                borderRadius: 6,
                padding: "4px 6px",
                fontSize: 13.5,
                marginLeft: !isRoot ? 4 : 0,
              }}
            />
          ) : (
            <span
              style={{
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                width: "100%",
                paddingLeft: !isRoot ? 6 : 0,
              }}
            >
              {node.text}
            </span>
          )}

          {/* 折叠按钮 */}
          {ln.hasKids && !editing && (
            <span
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(ln.id);
                toggleFold(ln.id);
              }}
              style={{
                position: "absolute",
                right: -11,
                top: "50%",
                transform: "translateY(-50%)",
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: ln.color,
                color: theme === "light" ? "#fff" : "#081226",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                fontSize: 11,
              }}
            >
              {ln.folded ? (
                <>
                  <ChevronRight size={12} strokeWidth={3} />
                </>
              ) : (
                <ChevronDown size={12} strokeWidth={3} />
              )}
            </span>
          )}
          {/* 折叠时显示子节点数量 */}
          {ln.folded && ln.kidCount > 0 && (
            <span
              style={{
                position: "absolute",
                right: -34,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 10,
                color: ln.color,
                fontWeight: 700,
              }}
            >
              {ln.kidCount}
            </span>
          )}
        </div>
      </foreignObject>
    );
  };

  const toolBtn = (title: string, onClick: () => void, icon: React.ReactNode, disabled?: boolean) => (
    <Button type="button" size="sm" variant="outline" onClick={onClick} disabled={disabled} title={title}>
      {icon}
      <span className="hidden md:inline">{title}</span>
    </Button>
  );

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        {toolBtn("添加子节点 (Tab)", () => addChild(selectedId), <Plus size={14} />, !selectedId)}
        {toolBtn("添加同级 (Enter)", () => addSibling(selectedId), <CornerDownRight size={14} />, !selectedId)}
        {toolBtn("删除 (Del)", () => removeNode(selectedId), <Trash2 size={14} />, !selectedId)}
        {toolBtn("折叠/展开 (空格)", () => toggleFold(selectedId), <ChevronDown size={14} />, !selectedId)}
        <span className="mx-1 h-5 w-px bg-border" />
        {toolBtn("撤销 (Ctrl+Z)", undo, <Undo2 size={14} />, !history.past.length)}
        {toolBtn("重做 (Ctrl+Y)", redo, <Redo2 size={14} />, !history.future.length)}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button type="button" size="sm" variant="ghost" onClick={() => zoomAt(zoom / 1.2)} title="缩小">
          <ZoomOut size={14} />
        </Button>
        <span className="font-mono-accent w-12 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => zoomAt(zoom * 1.2)} title="放大">
          <ZoomIn size={14} />
        </Button>
        {toolBtn("适应屏幕", fitView, <Maximize size={14} />)}
        <span className="mx-1 h-5 w-px bg-border" />
        <input ref={fileInputRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={onImportFile} />
        {toolBtn("导入", () => fileInputRef.current?.click(), <Upload size={14} />)}
        <div className="relative group">
          <Button type="button" size="sm" variant="outline">
            <Download size={14} />
            <span className="hidden md:inline">导出</span>
          </Button>
          <div
            className="invisible absolute right-0 top-full z-40 mt-1 w-36 rounded-lg border border-border py-1 opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100"
            style={{ background: colors.dropdownBg }}
          >
            {([
              { label: "PNG 图片", fn: exportPNG },
              { label: "PDF 文件", fn: exportPDF },
              { label: "SVG 矢量", fn: exportSVG },
              { label: "JSON 文件", fn: exportJSON },
              { label: "文本大纲", fn: exportOutline },
            ] as { label: string; fn: () => void }[]).map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.fn}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-white/5"
                style={{ color: colors.navText }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {toolBtn("示例", resetAll, <Sparkles size={14} />)}
        {toolBtn("清空", clearAll, <Eraser size={14} />)}
      </div>

      {/* 画布 */}
      <div
        ref={wrapRef}
        tabIndex={0}
        onWheel={onWheel}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerLeave={onBgPointerUp}
        className="thin-scroll relative outline-none"
        style={{
          height: "68vh",
          borderRadius: 12,
          border: `1px solid ${colors.borderSolid}`,
          background:
            theme === "light"
              ? "radial-gradient(circle, #e2e8f0 1px, transparent 1px)"
              : "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          backgroundColor: colors.panel,
          overflow: "hidden",
          cursor: dragRef.current ? "grabbing" : "grab",
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ display: "block", touchAction: "none" }}
        >
          <g data-view transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
            {/* 连线 */}
            {layout.links.map((l) => {
              const mx = (l.x1 + l.x2) / 2;
              return (
                <path
                  key={l.id}
                  d={`M ${l.x1} ${l.y1} C ${mx} ${l.y1}, ${mx} ${l.y2}, ${l.x2} ${l.y2}`}
                  fill="none"
                  stroke={l.color}
                  strokeWidth={l.depth === 1 ? 2.4 : 1.8}
                  strokeOpacity={0.85}
                />
              );
            })}
            {/* 节点 */}
            {layout.nodes.map(renderNode)}
          </g>
        </svg>

        {/* 快捷键提示 */}
        <div
          className="pointer-events-none absolute bottom-2 left-3 rounded-md px-2 py-1 text-[10px]"
          style={{ color: colors.mutedDark, background: colors.btn }}
        >
          Tab 子节点 · Enter 同级 · Del 删除 · 双击编辑 · 空格折叠 · 方向键移动 · 滚轮缩放 · 拖空白平移
        </div>
      </div>
    </div>
  );
}
