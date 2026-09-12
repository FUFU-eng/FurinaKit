"use client";

import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Eraser,
  Library,
  Ruler,
  Search,
  Sigma,
  Wand2,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/**
 * 几何计算器（重做版）
 *
 * 与旧的「输两个数出面积周长」不同，这里是**求解器**：
 * 每个图形按「已知条件」分成若干种解法（三角形有 SSS/SAS/ASA/AAS/SSA/底高/坐标七种），
 * 解出该图形所有可推导的量（周长、面积、体积、表面积、对角线、内外接圆、各角、各高、
 * 中线、角平分线…），并把用到的公式一并列出；右侧按当前参数**实时画出带标注的示意图**。
 *
 * 数值一律用实数（不取整），显示时统一走 fmtNum：小于 1e-10 的浮点残渣直接显示 0，
 * 避免出现 sin(60°) = 0.8660254038 却把 1.2246e-16 这种噪声当真结果的情况。
 */

// <<<GEO-CORE-BEGIN>>>
// ══════════════════════════════════════════════════════════════════════
//  纯计算核心：以下内容不依赖 React / DOM，可整段抽出在 Node 里做对拍单测
// ══════════════════════════════════════════════════════════════════════

export type Unit = "deg" | "rad";

/** 数学坐标（y 轴向上）下的二维点 */
export type Vec = [number, number];

/** 示意图图元：所有图形都由这些基本图元拼出来，渲染在 <FigureSvg> 里统一处理 */
export type Prim =
  | { k: "poly"; pts: Vec[]; fill?: boolean; dash?: boolean }
  | { k: "circle"; c: Vec; r: number; fill?: boolean; dash?: boolean }
  | { k: "ellipse"; c: Vec; rx: number; ry: number; fill?: boolean; dash?: boolean }
  | { k: "arc"; c: Vec; r: number; a0: number; a1: number; dash?: boolean }
  /** 扇形（圆心 + 两条半径 + 圆弧）填充 */
  | { k: "fan"; c: Vec; r: number; a0: number; a1: number }
  /** 弓形（圆弧 + 弦）填充 */
  | { k: "cap"; c: Vec; r: number; a0: number; a1: number }
  | { k: "seg"; a: Vec; b: Vec; dash?: boolean }
  /** 尺寸线（带端部刻线） */
  | { k: "dim"; a: Vec; b: Vec; text: string; side?: number }
  /** 角弧 */
  | { k: "ang"; at: Vec; p: Vec; q: Vec; r: number }
  /** 直角小方块 */
  | { k: "right"; at: Vec; p: Vec; q: Vec; size?: number }
  /** 文字标注；dir 为数学坐标下的偏移方向，渲染时换算成固定像素间距 */
  | { k: "label"; at: Vec; text: string; dir?: Vec }
  | { k: "dot"; at: Vec };

export type Row = { label: string; value: string };
export type Formula = { name: string; expr: string };
export type Figure = Prim[];
export type Solved = { rows: Row[]; formulas: Formula[]; figure: Figure; primary: Row };
export type Failed = { errors: string[] };
export type Ctx = { unit: Unit; digits: number };

export type FieldDef = {
  k: string;
  label: string;
  def: string;
  kind?: "len" | "ang" | "num" | "int" | "text";
  hint?: string;
};
export type ModeDef = { id: string; label: string; fields: FieldDef[] };
export type Cat = "plane" | "solid" | "coord" | "theorem";
export type ShapeDef = {
  id: string;
  name: string;
  cat: Cat;
  brief: string;
  modes: ModeDef[];
  run: (
    mode: string,
    nums: Record<string, number>,
    raw: Record<string, string>,
    ctx: Ctx,
  ) => Solved | Failed;
};

export const CATS: { id: Cat; name: string; desc: string }[] = [
  { id: "plane", name: "平面图形", desc: "圆、椭圆、扇形、三角形、四边形、正多边形" },
  { id: "solid", name: "立体图形", desc: "球、柱、锥、台、正多面体、圆环体" },
  { id: "coord", name: "坐标几何", desc: "距离、直线、圆的方程、四心、多边形顶点" },
  { id: "theorem", name: "定理助手", desc: "勾股、相似、解直角三角形、角度与截线" },
];

const PI = Math.PI;
const D2R = PI / 180;
const R2D = 180 / PI;
const EPS = 1e-12;

const row = (label: string, value: string): Row => ({ label, value });

/** 数值显示：抹掉浮点残渣、去掉多余尾零，极大/极小值走科学计数 */
export function fmtNum(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return "—";
  if (Math.abs(x) < 1e-10) return "0";
  const a = Math.abs(x);
  if (a >= 1e12 || a < 1e-6) return x.toExponential(5);
  let s = x.toFixed(Math.max(0, Math.min(12, digits)));
  if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") s = "0";
  return s;
}

/** 角度显示：按当前单位输出，并带上 ° / rad 后缀 */
export function fmtAng(rad: number, ctx: Ctx, digits?: number): string {
  const d = digits === undefined ? ctx.digits : digits;
  if (ctx.unit === "rad") return `${fmtNum(rad, Math.min(d, 8))} rad`;
  return `${fmtNum(rad * R2D, Math.min(d, 6))}°`;
}

function toRad(v: number, unit: Unit): number {
  return unit === "deg" ? v * D2R : v;
}

// ── 输入校验：一律给人话提示，绝不把 NaN 当结果放出去 ──────────────────

function needPos(
  errs: string[],
  nums: Record<string, number>,
  raw: Record<string, string>,
  labels: Record<string, string>,
): void {
  for (const k in labels) {
    const s = (raw[k] === undefined ? "" : raw[k]).trim();
    const v = nums[k];
    if (s === "") errs.push(`请填写「${labels[k]}」`);
    else if (!Number.isFinite(v)) errs.push(`「${labels[k]}」不是有效的数字：${s}`);
    else if (v <= 0) errs.push(`「${labels[k]}」必须大于 0`);
  }
}

function needNum(
  errs: string[],
  nums: Record<string, number>,
  raw: Record<string, string>,
  labels: Record<string, string>,
): void {
  for (const k in labels) {
    const s = (raw[k] === undefined ? "" : raw[k]).trim();
    if (s === "") errs.push(`请填写「${labels[k]}」`);
    else if (!Number.isFinite(nums[k])) errs.push(`「${labels[k]}」不是有效的数字：${s}`);
  }
}

/** 角度输入校验：要求 0 < 角度 < max（弧度），并按当前单位给出人话提示 */
function needAngle(
  errs: string[],
  nums: Record<string, number>,
  raw: Record<string, string>,
  labels: Record<string, string>,
  ctx: Ctx,
  max: number,
): void {
  const unitName = ctx.unit === "deg" ? "度" : "弧度";
  const maxText =
    ctx.unit === "deg" ? fmtNum(max * R2D, 4) : fmtNum(max, 6);
  for (const k in labels) {
    const s = (raw[k] === undefined ? "" : raw[k]).trim();
    const v = nums[k];
    if (s === "") {
      errs.push(`请填写「${labels[k]}」`);
      continue;
    }
    if (!Number.isFinite(v)) {
      errs.push(`「${labels[k]}」不是有效的数字：${s}`);
      continue;
    }
    const rad = toRad(v, ctx.unit);
    if (!(rad > 0) || rad >= max - EPS) {
      errs.push(`「${labels[k]}」需要大于 0 且小于 ${maxText}（当前角度单位：${unitName}）`);
    }
  }
}

// ── 向量与图元小工具 ────────────────────────────────────────────────

const V = (x: number, y: number): Vec => [x, y];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s];
const vlen = (a: Vec): number => Math.hypot(a[0], a[1]);
const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const perp = (a: Vec): Vec => [-a[1], a[0]];
function unit(a: Vec): Vec {
  const L = vlen(a);
  if (!(L > EPS)) return [0, 0];
  return [a[0] / L, a[1] / L];
}
function centroidOf(pts: Vec[]): Vec {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / Math.max(1, pts.length), y / Math.max(1, pts.length)];
}

/** 造一个点：示意图里到处都在用，写成最简形式 */
const pt = (x: number, y: number): Vec => [x, y];

const poly = (pts: Vec[], opts: { fill?: boolean; dash?: boolean } = {}): Prim => ({
  k: "poly",
  pts,
  fill: opts.fill,
  dash: opts.dash,
});
const circ = (c: Vec, r: number, fill = false, dash = false): Prim => ({ k: "circle", c, r, fill, dash });
const ellipseP = (c: Vec, rx: number, ry: number, fill = false, dash = false): Prim => ({
  k: "ellipse",
  c,
  rx,
  ry,
  fill,
  dash,
});
const arcP = (c: Vec, r: number, a0: number, a1: number, dash = false): Prim => ({ k: "arc", c, r, a0, a1, dash });
const fanP = (c: Vec, r: number, a0: number, a1: number): Prim => ({ k: "fan", c, r, a0, a1 });
const capP = (c: Vec, r: number, a0: number, a1: number): Prim => ({ k: "cap", c, r, a0, a1 });
const segP = (a: Vec, b: Vec, dash = false): Prim => ({ k: "seg", a, b, dash });
const dimP = (a: Vec, b: Vec, text: string, side = 1): Prim => ({ k: "dim", a, b, text, side });
const angP = (at: Vec, p: Vec, q: Vec, r: number): Prim => ({ k: "ang", at, p, q, r });
const rightP = (at: Vec, p: Vec, q: Vec, size?: number): Prim => ({ k: "right", at, p, q, size });
const labP = (at: Vec, text: string, dir?: Vec): Prim => ({ k: "label", at, text, dir });
const dotP = (at: Vec): Prim => ({ k: "dot", at });

/** 多边形每条边的外侧标注（i 号边 = pts[i] → pts[i+1]） */
function edgeLabels(pts: Vec[], texts: (string | undefined)[]): Prim[] {
  const g = centroidOf(pts);
  const out: Prim[] = [];
  for (let i = 0; i < pts.length; i++) {
    const t = texts[i];
    if (!t) continue;
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const m = mid(a, b);
    let d = unit(sub(m, g));
    if (Math.abs(d[0]) < EPS && Math.abs(d[1]) < EPS) d = unit(perp(sub(b, a)));
    out.push(labP(m, t, d));
  }
  return out;
}

/** 多边形各顶点的内角标注：直角画小方块，其余画角弧＋度数 */
function vertexMarks(pts: Vec[], angles: number[], texts: (string | undefined)[], r: number): Prim[] {
  const out: Prim[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const t = texts[i];
    const at = pts[i];
    const p = pts[(i - 1 + n) % n];
    const q = pts[(i + 1) % n];
    const u = unit(sub(p, at));
    const w = unit(sub(q, at));
    const bis = unit(add(u, w));
    if (Math.abs(angles[i] - PI / 2) < 1e-9) {
      out.push(rightP(at, p, q, 0.45 * r));
      if (t) out.push(labP(add(at, mul(bis, r * 1.25)), t, bis));
    } else {
      out.push(angP(at, p, q, r));
      if (t) out.push(labP(add(at, mul(bis, r * 1.25)), t, bis));
    }
  }
  return out;
}

// ── 三角形：核心求解与输出 ──────────────────────────────────────────

type Tri = { a: number; b: number; c: number; A: number; B: number; C: number };

const clamp1 = (x: number): number => Math.max(-1, Math.min(1, x));

/** 由三边解三角形（余弦定理）；不满足三角不等式返回 null */
function triFromSides(a: number, b: number, c: number): Tri | null {
  if (!(a > 0 && b > 0 && c > 0)) return null;
  if (a + b <= c + 1e-12 || a + c <= b + 1e-12 || b + c <= a + 1e-12) return null;
  const A = Math.acos(clamp1((b * b + c * c - a * a) / (2 * b * c)));
  const B = Math.acos(clamp1((a * a + c * c - b * b) / (2 * a * c)));
  const C = PI - A - B;
  return { a, b, c, A, B, C };
}

/** 由两边及夹角解三角形（边 a、边 b 夹角为 C） */
function triFromSAS(a: number, b: number, C: number): Tri | null {
  const c = Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * Math.cos(C)));
  return triFromSides(a, b, c);
}

function triArea(t: Tri): number {
  const s = (t.a + t.b + t.c) / 2;
  return Math.sqrt(Math.max(0, s * (s - t.a) * (s - t.b) * (s - t.c)));
}

function triKind(t: Tri): string {
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  let bySide = "不等边三角形";
  if (eq(t.a, t.b) && eq(t.b, t.c)) bySide = "等边三角形";
  else if (eq(t.a, t.b) || eq(t.b, t.c) || eq(t.a, t.c)) bySide = "等腰三角形";
  const mx = Math.max(t.A, t.B, t.C);
  let byAng = "锐角三角形";
  if (Math.abs(mx - PI / 2) < 1e-9) byAng = "直角三角形";
  else if (mx > PI / 2) byAng = "钝角三角形";
  return `${byAng} · ${bySide}`;
}

/** 三角形的“全量”输出：三边、三角、周长、面积、内外接圆、高、中线、角平分线 */
function triRows(t: Tri, ctx: Ctx): Row[] {
  const f = (x: number) => fmtNum(x, ctx.digits);
  const g = (r: number) => fmtAng(r, ctx);
  const s = (t.a + t.b + t.c) / 2;
  const S = triArea(t);
  const R = (t.a * t.b * t.c) / (4 * S);
  const ri = S / s;
  const med = (x: number, y: number, z: number) => 0.5 * Math.sqrt(Math.max(0, 2 * y * y + 2 * z * z - x * x));
  const bis = (ang: number, y: number, z: number) => (2 * y * z * Math.cos(ang / 2)) / (y + z);
  return [
    row("边 a (BC)", f(t.a)),
    row("边 b (CA)", f(t.b)),
    row("边 c (AB)", f(t.c)),
    row("角 A (∠BAC)", g(t.A)),
    row("角 B (∠ABC)", g(t.B)),
    row("角 C (∠ACB)", g(t.C)),
    row("内角和 A+B+C", g(t.A + t.B + t.C)),
    row("面积 S", f(S)),
    row("周长 P", f(2 * s)),
    row("半周长 s", f(s)),
    row("内切圆半径 r = S/s", f(ri)),
    row("外接圆半径 R = abc/4S", f(R)),
    row("外接圆直径 2R", f(2 * R)),
    row("a 边上的高 h_a", f((2 * S) / t.a)),
    row("b 边上的高 h_b", f((2 * S) / t.b)),
    row("c 边上的高 h_c", f((2 * S) / t.c)),
    row("中线 m_a", f(med(t.a, t.b, t.c))),
    row("中线 m_b", f(med(t.b, t.a, t.c))),
    row("中线 m_c", f(med(t.c, t.a, t.b))),
    row("角平分线 t_a", f(bis(t.A, t.b, t.c))),
    row("角平分线 t_b", f(bis(t.B, t.a, t.c))),
    row("角平分线 t_c", f(bis(t.C, t.a, t.b))),
    row("内切圆面积", f(PI * ri * ri)),
    row("外接圆面积", f(PI * R * R)),
    row("三角形类型", triKind(t)),
  ];
}

const TRI_FORMULAS: Formula[] = [
  { name: "余弦定理", expr: "a² = b² + c² − 2bc·cos A（求角）；cos A = (b²+c²−a²) / (2bc)" },
  { name: "正弦定理", expr: "a / sin A = b / sin B = c / sin C = 2R" },
  { name: "海伦公式（三边求面积）", expr: "S = √(s(s−a)(s−b)(s−c))，s = (a+b+c)/2" },
  { name: "面积（两边夹一角）", expr: "S = ½·a·b·sin C" },
  { name: "内切圆半径", expr: "r = S / s" },
  { name: "外接圆半径", expr: "R = a·b·c / (4S)" },
  { name: "高", expr: "h_a = 2S / a" },
  { name: "中线长", expr: "m_a = ½·√(2b² + 2c² − a²)" },
  { name: "角平分线长", expr: "t_a = 2bc·cos(A/2) / (b+c)" },
  { name: "内角和", expr: "A + B + C = 180°" },
];

/** 三角形示意图：顶点按 A(0,0)、B(c,0)、C 落在上方摆放 */
function triFigure(t: Tri, ctx: Ctx, note?: string): Figure {
  const f = (x: number) => fmtNum(x, ctx.digits);
  const g = (r: number) => fmtAng(r, ctx, 4);
  const A = pt(0, 0);
  const B = pt(t.c, 0);
  const C = pt(t.b * Math.cos(t.A), t.b * Math.sin(t.A));
  const pts = [A, B, C];
  const r = 0.2 * Math.min(t.a, t.b, t.c);
  const prims: Prim[] = [poly(pts, { fill: true })];
  prims.push(...edgeLabels(pts, [`c = ${f(t.c)}`, `a = ${f(t.a)}`, `b = ${f(t.b)}`]));
  prims.push(...vertexMarks(pts, [t.A, t.B, t.C], [g(t.A), g(t.B), g(t.C)], r));
  prims.push(dotP(A), dotP(B), dotP(C));
  prims.push(labP(A, "A", [-1, -1]), labP(B, "B", [1, -1]), labP(C, "C", [0, 1]));
  if (note) prims.push(labP(pt(t.c / 2, -0.28 * Math.max(t.c, t.a)), note));
  return prims;
}

function triSolved(t: Tri, ctx: Ctx, extra: Row[] = [], note?: string): Solved {
  const f = (x: number) => fmtNum(x, ctx.digits);
  const rows = triRows(t, ctx);
  return {
    rows: extra.length ? [...extra, ...rows] : rows,
    formulas: TRI_FORMULAS,
    figure: triFigure(t, ctx, note),
    primary: row("面积 S", f(triArea(t))),
  };
}

/** 两圆交点（side = +1 / −1 取两个解；无交点返回 null） */
function circleIntersect(p1: Vec, r1: number, p2: Vec, r2: number, side: number): Vec | null {
  const d = vlen(sub(p2, p1));
  if (!(d > EPS) || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < 0) return null;
  const h = Math.sqrt(Math.max(0, h2));
  const u = unit(sub(p2, p1));
  const n = perp(u);
  return add(add(p1, mul(u, a)), mul(n, side * h));
}

/** 三点外接圆圆心与半径（三点共线返回 null） */
function circumcenter(A: Vec, B: Vec, C: Vec): { c: Vec; R: number } | null {
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  if (Math.abs(d) < EPS) return null;
  const s1 = A[0] * A[0] + A[1] * A[1];
  const s2 = B[0] * B[0] + B[1] * B[1];
  const s3 = C[0] * C[0] + C[1] * C[1];
  const ux = (s1 * (B[1] - C[1]) + s2 * (C[1] - A[1]) + s3 * (A[1] - B[1])) / d;
  const uy = (s1 * (C[0] - B[0]) + s2 * (A[0] - C[0]) + s3 * (B[0] - A[0])) / d;
  return { c: [ux, uy], R: Math.hypot(A[0] - ux, A[1] - uy) };
}

/** 多边形有向面积（鞋带公式，逆时针为正） */
function polyArea(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

function polyPerimeter(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += vlen(sub(pts[(i + 1) % pts.length], pts[i]));
  return s;
}

/** 是否凸多边形（允许共线） */
function isConvex(pts: Vec[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-12) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// ── 立体示意图的公共画法（椭圆表示圆的透视） ────────────────────────

/** 圆柱 / 圆台 / 圆锥（rTop = 0 时退化为圆锥） */
function tubePrims(rBot: number, rTop: number, h: number, k = 0.3): Prim[] {
  if (rTop <= 1e-9) {
    return [
      ellipseP(pt(0, 0), rBot, rBot * k, true),
      segP(pt(-rBot, 0), pt(0, h)),
      segP(pt(rBot, 0), pt(0, h)),
      dotP(pt(0, h)),
      segP(pt(0, 0), pt(0, h), true),
      rightP(pt(0, 0), pt(rBot, 0), pt(0, h), 0.12 * Math.min(rBot, h)),
    ];
  }
  return [
    ellipseP(pt(0, 0), rBot, rBot * k, true),
    segP(pt(-rBot, 0), pt(-rTop, h)),
    segP(pt(rBot, 0), pt(rTop, h)),
    ellipseP(pt(0, h), rTop, rTop * k, true),
    segP(pt(0, 0), pt(0, h), true),
  ];
}

function spherePrims(r: number, k = 0.32): Prim[] {
  return [circ(pt(0, 0), r, true), ellipseP(pt(0, 0), r, r * k, false, true), segP(pt(0, 0), pt(r, 0)), dotP(pt(0, 0))];
}

/** 正 n 边形的顶点（squash 为纵向压扁比例，用于画出立体感） */
function ngonPts(n: number, R: number, squash = 1): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const ang = -PI / 2 + (2 * PI * i) / n;
    pts.push(pt(R * Math.cos(ang), R * Math.sin(ang) * squash));
  }
  return pts;
}

function prismPrims(n: number, R: number, h: number, squash = 0.45): Prim[] {
  const base = ngonPts(n, R, squash);
  const top = base.map((p) => pt(p[0], p[1] + h));
  const prims: Prim[] = [poly(base, { fill: true })];
  for (let i = 0; i < n; i++) prims.push(segP(base[i], top[i]));
  prims.push(poly(top, { fill: true }));
  return prims;
}

function pyramidPrims(n: number, R: number, h: number, squash = 0.45): Prim[] {
  const base = ngonPts(n, R, squash);
  const apex = pt(0, h);
  const prims: Prim[] = [poly(base, { fill: true })];
  for (let i = 0; i < n; i++) prims.push(segP(base[i], apex));
  prims.push(dotP(apex), segP(pt(0, 0), apex, true));
  return prims;
}

function frustumPyramidPrims(n: number, R1: number, R2: number, h: number, squash = 0.45): Prim[] {
  const base = ngonPts(n, R2, squash);
  const top = ngonPts(n, R1, squash).map((p) => pt(p[0], p[1] + h));
  const prims: Prim[] = [poly(base, { fill: true })];
  for (let i = 0; i < n; i++) prims.push(segP(base[i], top[i]));
  prims.push(poly(top, { fill: true }));
  return prims;
}

/** 长方体 / 正方体（斜二测示意：a 长、b 高、c 深） */
function boxPrims(a: number, b: number, c: number): Prim[] {
  const ox = 0.45 * c;
  const oy = 0.34 * c;
  const F = [pt(0, 0), pt(a, 0), pt(a, b), pt(0, b)];
  const B = F.map((p) => pt(p[0] + ox, p[1] + oy));
  return [
    poly([B[0], B[1], B[2], B[3]], { fill: true }),
    segP(F[0], B[0], true),
    poly([F[3], F[2], B[2], B[3]], { fill: true }),
    poly([F[2], F[1], B[1], B[2]], { fill: true }),
    poly(F, { fill: true }),
  ];
}

/** 一般式直线 Ax + By + C = 0 的可读写法 */
function lineEqStr(A: number, B: number, C: number, digits = 4): string {
  const f = (x: number) => fmtNum(x, digits);
  const terms: string[] = [];
  const push = (coef: number, name: string) => {
    if (Math.abs(coef) < 1e-12) return;
    const sign = coef < 0 ? "-" : terms.length === 0 ? "" : "+";
    const mag = Math.abs(coef);
    const magStr = name !== "" && Math.abs(mag - 1) < 1e-12 ? "" : f(mag);
    terms.push(`${sign}${magStr}${name}`);
  };
  push(A, "x");
  push(B, "y");
  push(C, "");
  if (!terms.length) return "恒成立（A、B、C 全为 0）";
  return `${terms.join(" ")} = 0`;
}

/** 解析「x,y; x,y; …」形式的点集（分号或换行分隔每个点） */
function parsePointList(text: string): { pts: Vec[]; error?: string } {
  const parts = text
    .split(/[;\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const pts: Vec[] = [];
  for (const part of parts) {
    const nums = part.split(/[,\s]+/).filter((s) => s.length > 0);
    if (nums.length !== 2) {
      return { pts: [], error: `坐标「${part}」要写成 x,y 的形式（两个数，用逗号隔开）` };
    }
    const x = Number(nums[0]);
    const y = Number(nums[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { pts: [], error: `坐标「${part}」里含有不是数字的内容` };
    }
    pts.push([x, y]);
  }
  if (!pts.length) return { pts: [], error: "请填写顶点坐标，例如 0,0; 4,0; 4,3" };
  return { pts };
}

/** 直线 Ax+By+C=0 上的一段（过 center 的垂足或过原点垂足，向两边各延伸 len） */
function lineSpan(A: number, B: number, C: number, center: Vec | null, len: number): [Vec, Vec] {
  const nlen = Math.hypot(A, B) || 1;
  const foot: Vec = center
    ? pt(
        center[0] - (A * (A * center[0] + B * center[1] + C)) / (nlen * nlen),
        center[1] - (B * (A * center[0] + B * center[1] + C)) / (nlen * nlen),
      )
    : pt((-A * C) / (nlen * nlen), (-B * C) / (nlen * nlen));
  const dir = pt(-B / nlen, A / nlen);
  return [sub(foot, mul(dir, len)), add(foot, mul(dir, len))];
}

/** 以线段 ab 为一边、在 dir 侧画一个正方形（用于勾股定理的面积配图） */
function squareOn(a: Vec, b: Vec, dir: number): { prims: Prim[]; center: Vec } {
  const u = sub(b, a);
  const nrm = mul(perp(u), dir);
  const c = add(b, nrm);
  const d = add(a, nrm);
  return { prims: [poly([a, b, c, d], { fill: false })], center: add(mid(a, b), mul(nrm, 0.5)) };
}

export const SHAPES: ShapeDef[] = [
  // ───────────────────────── 平面图形：圆族 ─────────────────────────
  {
    id: "circle",
    name: "圆",
    cat: "plane",
    brief: "半径、直径、周长、面积四者任知其一，其余全部求出，并给出内接正多边形的边长。",
    modes: [
      { id: "r", label: "已知半径 r", fields: [{ k: "r", label: "半径 r", def: "5", kind: "len" }] },
      { id: "d", label: "已知直径 d", fields: [{ k: "d", label: "直径 d", def: "10", kind: "len" }] },
      { id: "C", label: "已知周长 C", fields: [{ k: "C", label: "周长 C", def: "31.4159", kind: "len" }] },
      { id: "S", label: "已知面积 S", fields: [{ k: "S", label: "面积 S", def: "78.5398", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      let r = NaN;
      if (mode === "r") {
        needPos(errs, n, raw, { r: "半径 r" });
        r = n.r;
      } else if (mode === "d") {
        needPos(errs, n, raw, { d: "直径 d" });
        r = n.d / 2;
      } else if (mode === "C") {
        needPos(errs, n, raw, { C: "周长 C" });
        r = n.C / (2 * PI);
      } else {
        needPos(errs, n, raw, { S: "面积 S" });
        r = Math.sqrt(n.S / PI);
      }
      if (errs.length) return { errors: errs };
      const d = 2 * r;
      const C = 2 * PI * r;
      const S = PI * r * r;
      return {
        rows: [
          row("半径 r", f(r)),
          row("直径 d", f(d)),
          row("周长 C", f(C)),
          row("面积 S", f(S)),
          row("半圆周长 πr + 2r", f(PI * r + 2 * r)),
          row("圆的方程（以原点为圆心）", `x² + y² = ${f(r * r)}`),
          row("内接正方形边长 r√2", f(r * Math.SQRT2)),
          row("内接正三角形边长 r√3", f(r * Math.sqrt(3))),
          row("内接正六边形边长 r", f(r)),
          row("外切正方形边长 2r", f(d)),
          row("圆心角 1° 对应弧长", f((PI * r) / 180)),
        ],
        formulas: [
          { name: "周长", expr: "C = 2πr = πd" },
          { name: "面积", expr: "S = πr²" },
          { name: "由面积反求半径", expr: "r = √(S / π)" },
          { name: "内接正方形", expr: "边长 = r√2（对角线恰为直径 2r）" },
          { name: "内接正六边形", expr: "边长 = r（正六边形边长等于外接圆半径）" },
        ],
        figure: [
          circ(pt(0, 0), r, true),
          segP(pt(0, 0), pt(r, 0)),
          dotP(pt(0, 0)),
          labP(pt(r / 2, 0), `r = ${f(r)}`, [0, 1]),
          labP(pt(r * 0.72, -r * 0.72), `C = ${f(C)}`, [1, -1]),
          labP(pt(-r * 0.7, r * 0.7), `S = ${f(S)}`, [-1, 1]),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "semicircle",
    name: "半圆",
    cat: "plane",
    brief: "半圆的弧长、面积、周长与形心位置。",
    modes: [
      { id: "r", label: "已知半径 r", fields: [{ k: "r", label: "半径 r", def: "6", kind: "len" }] },
      { id: "L", label: "已知弧长 L", fields: [{ k: "L", label: "弧长 L", def: "18.8496", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      let r = NaN;
      if (mode === "r") {
        needPos(errs, n, raw, { r: "半径 r" });
        r = n.r;
      } else {
        needPos(errs, n, raw, { L: "弧长 L" });
        r = n.L / PI;
      }
      if (errs.length) return { errors: errs };
      const arc = PI * r;
      return {
        rows: [
          row("半径 r", f(r)),
          row("直径 d", f(2 * r)),
          row("半圆弧长 πr", f(arc)),
          row("半圆面积 πr²/2", f((PI * r * r) / 2)),
          row("周长（弧 + 直径）", f(arc + 2 * r)),
          row("形心到直径的距离 4r/3π", f((4 * r) / (3 * PI))),
          row("圆心角", ctx.unit === "deg" ? "180°" : `${f(PI)} rad`),
        ],
        formulas: [
          { name: "弧长", expr: "L = πr" },
          { name: "面积", expr: "S = πr² / 2" },
          { name: "周长", expr: "P = πr + 2r" },
          { name: "形心", expr: "距直径 4r / (3π) ≈ 0.4244r" },
        ],
        figure: [
          capP(pt(0, 0), r, 0, PI),
          segP(pt(-r, 0), pt(r, 0)),
          segP(pt(0, 0), pt(r, 0)),
          dotP(pt(0, 0)),
          labP(pt(r / 2, 0), `r = ${f(r)}`, [0, -1]),
          labP(pt(0, r * 1.15), `L = ${f(arc)}`, [0, 1]),
        ],
        primary: row("面积 S", f((PI * r * r) / 2)),
      };
    },
  },
  {
    id: "ellipse",
    name: "椭圆",
    cat: "plane",
    brief: "由半长轴与半短轴求面积、周长（拉马努金近似）、离心率、焦点与准线。",
    modes: [
      {
        id: "ab",
        label: "半长轴 a + 半短轴 b",
        fields: [
          { k: "a", label: "半长轴 a", def: "6", kind: "len" },
          { k: "b", label: "半短轴 b", def: "4", kind: "len" },
        ],
      },
      {
        id: "ae",
        label: "半长轴 a + 离心率 e",
        fields: [
          { k: "a", label: "半长轴 a", def: "6", kind: "len" },
          { k: "e", label: "离心率 e (0≤e<1)", def: "0.6", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      let a = NaN;
      let b = NaN;
      if (mode === "ab") {
        needPos(errs, n, raw, { a: "半长轴 a", b: "半短轴 b" });
        a = n.a;
        b = n.b;
        if (b > a) {
          const t = a;
          a = b;
          b = t;
        }
      } else {
        needPos(errs, n, raw, { a: "半长轴 a" });
        needNum(errs, n, raw, { e: "离心率 e" });
        if (n.e < 0 || n.e >= 1) errs.push("「离心率 e」需要满足 0 ≤ e < 1");
        a = n.a;
        b = a * Math.sqrt(Math.max(0, 1 - n.e * n.e));
      }
      if (errs.length) return { errors: errs };
      const c = Math.sqrt(Math.max(0, a * a - b * b));
      const e = c / a;
      const S = PI * a * b;
      // 拉马努金（Ramanujan）第二近似，精度约 1e-10 量级
      const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
      const P = PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
      return {
        rows: [
          row("半长轴 a", f(a)),
          row("半短轴 b", f(b)),
          row("长轴 2a", f(2 * a)),
          row("短轴 2b", f(2 * b)),
          row("面积 S = πab", f(S)),
          row("周长（拉马努金近似）", f(P)),
          row("焦距 c = √(a²−b²)", f(c)),
          row("焦点坐标 (±c, 0)", `(±${f(c)}, 0)`),
          row("离心率 e = c/a", f(e)),
          row("半通径 b²/a", f((b * b) / a)),
          row("准线 x = ±a/e", e < 1e-12 ? "不存在（此时是圆）" : `x = ±${f(a / e)}`),
          row("圆度偏差（b/a）", f(b / a)),
        ],
        formulas: [
          { name: "面积", expr: "S = πab" },
          {
            name: "周长（拉马努金第二近似）",
            expr: "P ≈ π(a+b)[1 + 3h/(10+√(4−3h))]，h = (a−b)²/(a+b)²",
          },
          { name: "焦距", expr: "c = √(a² − b²)" },
          { name: "离心率", expr: "e = c / a（0 ≤ e < 1）" },
          { name: "椭圆方程", expr: "x²/a² + y²/b² = 1" },
        ],
        figure: [
          ellipseP(pt(0, 0), a, b, true),
          segP(pt(-a, 0), pt(a, 0), true),
          segP(pt(0, -b), pt(0, b), true),
          dotP(pt(-c, 0)),
          dotP(pt(c, 0)),
          labP(pt(-a / 2, 0), `a = ${f(a)}`, [0, 1]),
          labP(pt(0, b / 2), `b = ${f(b)}`, [-1, 0]),
          labP(pt(-c, 0), `F₁`, [-1, -1]),
          labP(pt(c, 0), `F₂`, [1, -1]),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "sector",
    name: "扇形",
    cat: "plane",
    brief: "扇形由半径与圆心角（或弧长、面积）求解弧长、面积、弦长、弓形高与周长。",
    modes: [
      {
        id: "rTheta",
        label: "半径 + 圆心角",
        fields: [
          { k: "r", label: "半径 r", def: "6", kind: "len" },
          { k: "theta", label: "圆心角 θ", def: "60", kind: "ang" },
        ],
      },
      {
        id: "rArc",
        label: "半径 + 弧长",
        fields: [
          { k: "r", label: "半径 r", def: "6", kind: "len" },
          { k: "L", label: "弧长 L", def: "6.2832", kind: "len" },
        ],
      },
      {
        id: "rArea",
        label: "半径 + 面积",
        fields: [
          { k: "r", label: "半径 r", def: "6", kind: "len" },
          { k: "S", label: "扇形面积 S", def: "18.8496", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, { r: "半径 r" });
      let th = NaN;
      if (mode === "rTheta") {
        needAngle(errs, n, raw, { theta: "圆心角 θ" }, ctx, 2 * PI);
        th = toRad(n.theta, ctx.unit);
      } else if (mode === "rArc") {
        needPos(errs, n, raw, { L: "弧长 L" });
        th = n.L / n.r;
      } else {
        needPos(errs, n, raw, { S: "扇形面积 S" });
        th = (2 * n.S) / (n.r * n.r);
      }
      if (errs.length) return { errors: errs };
      if (!(th > 0) || th >= 2 * PI) {
        return { errors: ["由当前输入推出的圆心角不在 0° ~ 360° 之间，请检查数据"] };
      }
      const r = n.r;
      const L = r * th;
      const S = (r * r * th) / 2;
      const chord = 2 * r * Math.sin(th / 2);
      const height = r * (1 - Math.cos(th / 2));
      return {
        rows: [
          row("半径 r", f(r)),
          row("圆心角 θ", g(th)),
          row("弧长 L = rθ", f(L)),
          row("面积 S = ½r²θ", f(S)),
          row("弦长 2r·sin(θ/2)", f(chord)),
          row("弓形高 r(1−cos(θ/2))", f(height)),
          row("周长（弧 + 两半径）", f(L + 2 * r)),
          row("弧长占整圆比例", f(th / (2 * PI))),
          row("面积占整圆比例", f(th / (2 * PI))),
          row("同半径整圆面积", f(PI * r * r)),
        ],
        formulas: [
          { name: "弧长", expr: "L = rθ（θ 用弧度）" },
          { name: "面积", expr: "S = ½r²θ = ½rL" },
          { name: "弦长", expr: "c = 2r·sin(θ/2)" },
          { name: "弓形高", expr: "h = r(1 − cos(θ/2))" },
          { name: "周长", expr: "P = L + 2r" },
        ],
        figure: [
          fanP(pt(0, 0), r, 0, th),
          segP(pt(0, 0), pt(r, 0)),
          segP(pt(0, 0), pt(r * Math.cos(th), r * Math.sin(th))),
          arcP(pt(0, 0), r * 0.999, 0, th),
          dotP(pt(0, 0)),
          labP(pt(r / 2, 0), `r = ${f(r)}`, [1, -1]),
          labP(pt(r * 0.35 * Math.cos(th / 2), r * 0.35 * Math.sin(th / 2)), g(th), [1, 1]),
          labP(
            pt(r * 1.12 * Math.cos(th / 2), r * 1.12 * Math.sin(th / 2)),
            `L = ${f(L)}`,
            [Math.cos(th / 2), Math.sin(th / 2)],
          ),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "segment",
    name: "弓形（圆缺）",
    cat: "plane",
    brief: "圆被一条弦截出的部分：由半径配圆心角、弓形高或弦长求面积、弧长与弦长。",
    modes: [
      {
        id: "rTheta",
        label: "半径 + 圆心角",
        fields: [
          { k: "r", label: "半径 r", def: "5", kind: "len" },
          { k: "theta", label: "圆心角 θ", def: "90", kind: "ang" },
        ],
      },
      {
        id: "rh",
        label: "半径 + 弓形高",
        fields: [
          { k: "r", label: "半径 r", def: "5", kind: "len" },
          { k: "h", label: "弓形高 h", def: "1.5", kind: "len" },
        ],
      },
      {
        id: "rc",
        label: "半径 + 弦长",
        fields: [
          { k: "r", label: "半径 r", def: "5", kind: "len" },
          { k: "c", label: "弦长 c", def: "8", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, { r: "半径 r" });
      const r = n.r;
      let th = NaN;
      if (mode === "rTheta") {
        needAngle(errs, n, raw, { theta: "圆心角 θ" }, ctx, 2 * PI);
        th = toRad(n.theta, ctx.unit);
      } else if (mode === "rh") {
        needPos(errs, n, raw, { h: "弓形高 h" });
        if (Number.isFinite(n.h) && n.h >= 2 * r) {
          errs.push(`「弓形高 h」必须小于直径 ${f(2 * r)}`);
        }
        th = 2 * Math.acos(clamp1(1 - n.h / r));
      } else {
        needPos(errs, n, raw, { c: "弦长 c" });
        if (Number.isFinite(n.c) && n.c > 2 * r) {
          errs.push(`「弦长 c」不能超过直径 ${f(2 * r)}`);
        }
        th = 2 * Math.asin(clamp1(n.c / (2 * r)));
      }
      if (errs.length) return { errors: errs };
      const chord = 2 * r * Math.sin(th / 2);
      const height = r * (1 - Math.cos(th / 2));
      const L = r * th;
      const S = (r * r * (th - Math.sin(th))) / 2;
      const sectorArea = (r * r * th) / 2;
      const triAreaInside = (r * r * Math.sin(th)) / 2;
      return {
        rows: [
          row("半径 r", f(r)),
          row("圆心角 θ", g(th)),
          row("弦长 c = 2r·sin(θ/2)", f(chord)),
          row("弓形高 h = r(1−cos(θ/2))", f(height)),
          row("弧长 L = rθ", f(L)),
          row("弓形面积 S = ½r²(θ − sinθ)", f(S)),
          row("所在扇形面积", f(sectorArea)),
          row("扇形内三角形（圆心+弦）面积", f(triAreaInside)),
          row("弓形周长（弧 + 弦）", f(L + chord)),
          row("弦心距 d = r·cos(θ/2)", f(r * Math.cos(th / 2))),
        ],
        formulas: [
          { name: "圆心角（由弓形高）", expr: "θ = 2·arccos(1 − h/r)" },
          { name: "圆心角（由弦长）", expr: "θ = 2·arcsin(c / 2r)" },
          { name: "弦长", expr: "c = 2r·sin(θ/2)" },
          { name: "弓形高", expr: "h = r(1 − cos(θ/2))" },
          { name: "弓形面积", expr: "S = ½r²(θ − sin θ)" },
          { name: "弓形周长", expr: "P = rθ + 2r·sin(θ/2)" },
        ],
        figure: (() => {
          const a0 = PI / 2 - th / 2;
          const a1 = PI / 2 + th / 2;
          const p0 = pt(r * Math.cos(a0), r * Math.sin(a0));
          const p1 = pt(r * Math.cos(a1), r * Math.sin(a1));
          const chordY = r * Math.cos(th / 2);
          return [
            capP(pt(0, 0), r, a0, a1),
            arcP(pt(0, 0), r * 0.999, a0, a1),
            segP(p0, p1),
            segP(pt(0, 0), pt(0, r), true),
            dotP(pt(0, 0)),
            rightP(pt(0, chordY), pt(1, chordY), pt(0, r), 0.18 * r),
            labP(pt(r * 0.5 * Math.cos(a1 * 0.6), r * 0.5 * Math.sin(a1 * 0.6)), `r = ${f(r)}`, [1, 0]),
            labP(pt(0, r * 1.06), g(th), [0, 1]),
            dimP(pt(0, r), pt(0, chordY), `h = ${f(height)}`, -1),
            labP(pt(0, chordY), `c = ${f(chord)}`, [1, -1]),
          ];
        })(),
        primary: row("弓形面积 S", f(S)),
      };
    },
  },
  {
    id: "annulus",
    name: "圆环（环形）",
    cat: "plane",
    brief: "两个同心圆之间的环带：面积、内外周长、环宽与占外圆比例。",
    modes: [
      {
        id: "Rr",
        label: "外半径 + 内半径",
        fields: [
          { k: "R", label: "外半径 R", def: "8", kind: "len" },
          { k: "r", label: "内半径 r", def: "5", kind: "len" },
        ],
      },
      {
        id: "Rw",
        label: "外半径 + 环宽",
        fields: [
          { k: "R", label: "外半径 R", def: "8", kind: "len" },
          { k: "w", label: "环宽 w", def: "3", kind: "len" },
        ],
      },
      {
        id: "Dd",
        label: "外直径 + 内直径",
        fields: [
          { k: "D", label: "外直径 D", def: "16", kind: "len" },
          { k: "d", label: "内直径 d", def: "10", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      let R = NaN;
      let r = NaN;
      if (mode === "Rr") {
        needPos(errs, n, raw, { R: "外半径 R", r: "内半径 r" });
        R = n.R;
        r = n.r;
      } else if (mode === "Rw") {
        needPos(errs, n, raw, { R: "外半径 R", w: "环宽 w" });
        R = n.R;
        r = n.R - n.w;
      } else {
        needPos(errs, n, raw, { D: "外直径 D", d: "内直径 d" });
        R = n.D / 2;
        r = n.d / 2;
      }
      if (errs.length) return { errors: errs };
      if (!(R > r)) return { errors: ["外半径必须大于内半径，请检查两个数据"] };
      const S = PI * (R * R - r * r);
      const Sout = PI * R * R;
      return {
        rows: [
          row("外半径 R", f(R)),
          row("内半径 r", f(r)),
          row("环宽 w = R − r", f(R - r)),
          row("外圆面积 πR²", f(Sout)),
          row("内圆面积 πr²", f(PI * r * r)),
          row("环面积 π(R²−r²)", f(S)),
          row("外周长 2πR", f(2 * PI * R)),
          row("内周长 2πr", f(2 * PI * r)),
          row("环面积占外圆比例", f(S / Sout)),
          row("平均半径 (R+r)/2", f((R + r) / 2)),
        ],
        formulas: [
          { name: "环面积", expr: "S = π(R² − r²) = π(R+r)(R−r)" },
          { name: "外周长", expr: "C外 = 2πR" },
          { name: "内周长", expr: "C内 = 2πr" },
          { name: "环宽", expr: "w = R − r" },
        ],
        figure: [
          circ(pt(0, 0), R, true),
          circ(pt(0, 0), r, false),
          segP(pt(0, 0), pt(0, R)),
          segP(pt(0, 0), pt(0, r)),
          dotP(pt(0, 0)),
          labP(pt(0, R / 2), `R = ${f(R)}`, [1, 0]),
          labP(pt(0, r / 2), `r = ${f(r)}`, [-1, 0]),
          labP(pt(R * 0.7, -R * 0.7), `S = ${f(S)}`, [1, -1]),
        ],
        primary: row("环面积 S", f(S)),
      };
    },
  },
  // ───────────────────────── 平面图形：三角形 ─────────────────────────
  {
    id: "triangle",
    name: "三角形（多条件求解）",
    cat: "plane",
    brief: "七种已知条件下求解三角形的三边三角、面积、内外接圆、高、中线与角平分线。",
    modes: [
      {
        id: "sss",
        label: "SSS 三边",
        fields: [
          { k: "a", label: "边 a (BC)", def: "3", kind: "len" },
          { k: "b", label: "边 b (CA)", def: "4", kind: "len" },
          { k: "c", label: "边 c (AB)", def: "5", kind: "len" },
        ],
      },
      {
        id: "sas",
        label: "SAS 两边及夹角",
        fields: [
          { k: "a", label: "边 a", def: "5", kind: "len" },
          { k: "b", label: "边 b", def: "7", kind: "len" },
          { k: "C", label: "夹角 C（a 与 b 之间）", def: "60", kind: "ang" },
        ],
      },
      {
        id: "asa",
        label: "ASA 两角及夹边",
        fields: [
          { k: "B", label: "角 B", def: "45", kind: "ang" },
          { k: "C", label: "角 C", def: "60", kind: "ang" },
          { k: "a", label: "边 a (BC，B 与 C 的夹边)", def: "8", kind: "len" },
        ],
      },
      {
        id: "aas",
        label: "AAS 两角及对边",
        fields: [
          { k: "A", label: "角 A", def: "40", kind: "ang" },
          { k: "B", label: "角 B", def: "60", kind: "ang" },
          { k: "a", label: "边 a（∠A 的对边 BC）", def: "6", kind: "len" },
        ],
      },
      {
        id: "ssa",
        label: "SSA 两边及其中一边的对角",
        fields: [
          { k: "a", label: "边 a（∠A 的对边 BC）", def: "6", kind: "len" },
          { k: "b", label: "边 b (CA)", def: "8", kind: "len" },
          { k: "A", label: "角 A", def: "30", kind: "ang" },
        ],
      },
      {
        id: "bh",
        label: "底 × 高",
        fields: [
          { k: "b", label: "底 b", def: "10", kind: "len" },
          { k: "h", label: "高 h", def: "4", kind: "len" },
        ],
      },
      {
        id: "coords",
        label: "三点坐标",
        fields: [
          { k: "x1", label: "A 点 x", def: "0", kind: "num" },
          { k: "y1", label: "A 点 y", def: "0", kind: "num" },
          { k: "x2", label: "B 点 x", def: "6", kind: "num" },
          { k: "y2", label: "B 点 y", def: "0", kind: "num" },
          { k: "x3", label: "C 点 x", def: "2", kind: "num" },
          { k: "y3", label: "C 点 y", def: "4", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      if (mode === "sss") {
        needPos(errs, n, raw, { a: "边 a (BC)", b: "边 b (CA)", c: "边 c (AB)" });
        if (errs.length) return { errors: errs };
        const t = triFromSides(n.a, n.b, n.c);
        if (!t) return { errors: ["三边不能构成三角形：任意两边之和必须大于第三边"] };
        return triSolved(t, ctx, [], `三边 SSS：a=${f(n.a)}，b=${f(n.b)}，c=${f(n.c)}`);
      }
      if (mode === "sas") {
        needPos(errs, n, raw, { a: "边 a", b: "边 b" });
        needAngle(errs, n, raw, { C: "夹角 C" }, ctx, PI);
        if (errs.length) return { errors: errs };
        const t = triFromSAS(n.a, n.b, toRad(n.C, ctx.unit));
        if (!t) return { errors: ["这三组数据解不出三角形，请检查"] };
        return triSolved(t, ctx, [], `两边及夹角 SAS：a=${f(n.a)}，b=${f(n.b)}，C=${fmtAng(toRad(n.C, ctx.unit), ctx)}`);
      }
      if (mode === "asa") {
        needPos(errs, n, raw, { a: "边 a (BC)" });
        needAngle(errs, n, raw, { B: "角 B", C: "角 C" }, ctx, PI);
        if (errs.length) return { errors: errs };
        const B = toRad(n.B, ctx.unit);
        const C = toRad(n.C, ctx.unit);
        const A = PI - B - C;
        if (!(A > 0)) return { errors: ["两个角的和必须小于 180°，请检查角 B 与角 C"] };
        const a = n.a;
        const b = (a * Math.sin(B)) / Math.sin(A);
        const c = (a * Math.sin(C)) / Math.sin(A);
        const t = triFromSides(a, b, c);
        if (!t) return { errors: ["这三组数据解不出三角形，请检查"] };
        return triSolved(t, ctx, [], `两角及夹边 ASA：B=${fmtAng(B, ctx)}，C=${fmtAng(C, ctx)}，a=${f(a)}`);
      }
      if (mode === "aas") {
        needPos(errs, n, raw, { a: "边 a" });
        needAngle(errs, n, raw, { A: "角 A", B: "角 B" }, ctx, PI);
        if (errs.length) return { errors: errs };
        const A = toRad(n.A, ctx.unit);
        const B = toRad(n.B, ctx.unit);
        const C = PI - A - B;
        if (!(C > 0)) return { errors: ["两个角的和必须小于 180°，请检查角 A 与角 B"] };
        const a = n.a;
        const b = (a * Math.sin(B)) / Math.sin(A);
        const c = (a * Math.sin(C)) / Math.sin(A);
        const t = triFromSides(a, b, c);
        if (!t) return { errors: ["这三组数据解不出三角形，请检查"] };
        return triSolved(t, ctx, [], `两角及对边 AAS：A=${fmtAng(A, ctx)}，B=${fmtAng(B, ctx)}，a=${f(a)}`);
      }
      if (mode === "ssa") {
        needPos(errs, n, raw, { a: "边 a", b: "边 b" });
        needAngle(errs, n, raw, { A: "角 A" }, ctx, PI);
        if (errs.length) return { errors: errs };
        const A = toRad(n.A, ctx.unit);
        const sinB = (n.b * Math.sin(A)) / n.a;
        if (sinB > 1 + 1e-12) {
          return {
            errors: [
              `无解：b·sin A = ${f(n.b * Math.sin(A))} 大于对边 a = ${f(n.a)}，这样的三角形不存在`,
            ],
          };
        }
        const B1 = Math.asin(clamp1(sinB));
        const cands: number[] = [B1];
        const B2 = PI - B1;
        if (B2 - B1 > 1e-9 && A + B2 < PI - 1e-12) cands.push(B2);
        const tris: Tri[] = [];
        for (const B of cands) {
          const C = PI - A - B;
          const c = (n.a * Math.sin(C)) / Math.sin(A);
          const t = triFromSides(n.a, n.b, c);
          if (t) tris.push(t);
        }
        if (!tris.length) return { errors: ["这三组数据解不出三角形，请检查"] };
        if (tris.length === 1) {
          return triSolved(
            tris[0],
            ctx,
            [row("说明", "SSA 条件下只有一组解（另一组不成立）")],
            "SSA（唯一解）",
          );
        }
        const pre = (t: Tri, tag: string): Row[] => triRows(t, ctx).map((r) => ({ label: `${tag} · ${r.label}`, value: r.value }));
        return {
          rows: [
            row("说明", "SSA 条件下有两组解（同 a、b、∠A 可作出两个不同的三角形）"),
            ...pre(tris[0], "解一（锐角解）"),
            ...pre(tris[1], "解二（钝角解）"),
          ],
          formulas: TRI_FORMULAS,
          figure: triFigure(tris[0], ctx, "示意图按「解一（锐角解）」绘制"),
          primary: row("解一 · 面积 S", f(triArea(tris[0]))),
        };
      }
      if (mode === "bh") {
        needPos(errs, n, raw, { b: "底 b", h: "高 h" });
        if (errs.length) return { errors: errs };
        const S = (n.b * n.h) / 2;
        return {
          rows: [
            row("底 b", f(n.b)),
            row("高 h", f(n.h)),
            row("面积 S = ½bh", f(S)),
            row("提示", "只知道底和高时只有面积是唯一确定的，边长与角度需要更多条件"),
          ],
          formulas: [{ name: "面积", expr: "S = ½ × 底 × 高" }],
          figure: [
            poly([pt(0, 0), pt(n.b, 0), pt(n.b * 0.42, n.h)], { fill: true }),
            dimP(pt(0, 0), pt(n.b, 0), `底 b = ${f(n.b)}`, -1),
            segP(pt(n.b * 0.42, n.h), pt(n.b * 0.42, 0), true),
            rightP(pt(n.b * 0.42, 0), pt(n.b, 0), pt(n.b * 0.42, n.h), 0.12 * n.h),
            labP(pt(n.b * 0.42, n.h / 2), `h = ${f(n.h)}`, [1, 0]),
          ],
          primary: row("面积 S", f(S)),
        };
      }
      // 三点坐标
      needNum(errs, n, raw, {
        x1: "A 点 x",
        y1: "A 点 y",
        x2: "B 点 x",
        y2: "B 点 y",
        x3: "C 点 x",
        y3: "C 点 y",
      });
      if (errs.length) return { errors: errs };
      const A1: Vec = [n.x1, n.y1];
      const B1: Vec = [n.x2, n.y2];
      const C1: Vec = [n.x3, n.y3];
      const a = vlen(sub(C1, B1));
      const b = vlen(sub(C1, A1));
      const c = vlen(sub(B1, A1));
      const shoelace = Math.abs(
        (A1[0] * (B1[1] - C1[1]) + B1[0] * (C1[1] - A1[1]) + C1[0] * (A1[1] - B1[1])) / 2,
      );
      const t = triFromSides(a, b, c);
      if (!t) return { errors: ["三个点重合或共线，无法构成三角形"] };
      return triSolved(
        t,
        ctx,
        [
          row("A 点坐标", `(${f(A1[0])}, ${f(A1[1])})`),
          row("B 点坐标", `(${f(B1[0])}, ${f(B1[1])})`),
          row("C 点坐标", `(${f(C1[0])}, ${f(C1[1])})`),
          row("面积（坐标鞋带公式）", f(shoelace)),
          row("重心坐标", `(${f((A1[0] + B1[0] + C1[0]) / 3)}, ${f((A1[1] + B1[1] + C1[1]) / 3)})`),
        ],
        "三点坐标（示意图按标准位置摆放）",
      );
    },
  },
  {
    id: "rightTriangle",
    name: "直角三角形",
    cat: "plane",
    brief: "四组已知条件下求解直角三角形的三边、锐角、三角函数值与投影长。",
    modes: [
      {
        id: "legs",
        label: "两直角边",
        fields: [
          { k: "p", label: "直角边 p", def: "3", kind: "len" },
          { k: "q", label: "直角边 q", def: "4", kind: "len" },
        ],
      },
      {
        id: "hypLeg",
        label: "斜边 + 一直角边",
        fields: [
          { k: "c", label: "斜边 c", def: "13", kind: "len" },
          { k: "p", label: "直角边 p", def: "5", kind: "len" },
        ],
      },
      {
        id: "legAngle",
        label: "直角边 + 锐角",
        fields: [
          { k: "p", label: "直角边 p（∠B 的邻边）", def: "5", kind: "len" },
          { k: "B", label: "锐角 B", def: "30", kind: "ang" },
        ],
      },
      {
        id: "hypAngle",
        label: "斜边 + 锐角",
        fields: [
          { k: "c", label: "斜边 c", def: "10", kind: "len" },
          { k: "B", label: "锐角 B", def: "35", kind: "ang" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      let p = NaN;
      let q = NaN;
      let c = NaN;
      let B = NaN;
      if (mode === "legs") {
        needPos(errs, n, raw, { p: "直角边 p", q: "直角边 q" });
        if (errs.length) return { errors: errs };
        p = n.p;
        q = n.q;
        c = Math.hypot(p, q);
        B = Math.atan2(q, p);
      } else if (mode === "hypLeg") {
        needPos(errs, n, raw, { c: "斜边 c", p: "直角边 p" });
        if (errs.length) return { errors: errs };
        if (n.p >= n.c) return { errors: ["直角边必须小于斜边，请检查两个数据"] };
        c = n.c;
        p = n.p;
        q = Math.sqrt(c * c - p * p);
        B = Math.atan2(q, p);
      } else if (mode === "legAngle") {
        needPos(errs, n, raw, { p: "直角边 p" });
        needAngle(errs, n, raw, { B: "锐角 B" }, ctx, PI / 2);
        if (errs.length) return { errors: errs };
        p = n.p;
        B = toRad(n.B, ctx.unit);
        q = p * Math.tan(B);
        c = p / Math.cos(B);
      } else {
        needPos(errs, n, raw, { c: "斜边 c" });
        needAngle(errs, n, raw, { B: "锐角 B" }, ctx, PI / 2);
        if (errs.length) return { errors: errs };
        c = n.c;
        B = toRad(n.B, ctx.unit);
        p = c * Math.cos(B);
        q = c * Math.sin(B);
      }
      const A = PI / 2;
      const C = PI / 2 - B;
      const S = (p * q) / 2;
      const h = (p * q) / c;
      const ri = (p + q - c) / 2;
      const prime = (p * p) / c;
      const qprime = (q * q) / c;
      const tri: Tri = { a: c, b: q, c: p, A, B, C };
      return {
        rows: [
          row("直角边 p (AB)", f(p)),
          row("直角边 q (AC)", f(q)),
          row("斜边 c (BC)", f(c)),
          row("角 A（直角）", g(A)),
          row("角 B", g(B)),
          row("角 C", g(C)),
          row("面积 S = ½pq", f(S)),
          row("周长 P", f(p + q + c)),
          row("斜边上的高 h = pq/c", f(h)),
          row("外接圆半径 R = c/2", f(c / 2)),
          row("内切圆半径 r = (p+q−c)/2", f(ri)),
          row("sin B = q/c", f(Math.sin(B))),
          row("cos B = p/c", f(Math.cos(B))),
          row("tan B = q/p", f(Math.tan(B))),
          row("p 在斜边上的投影 p²/c", f(prime)),
          row("q 在斜边上的投影 q²/c", f(qprime)),
          row("直角边比 p : q", `${f(p)} : ${f(q)}`),
          row("三角形类型", triKind(tri)),
        ],
        formulas: [
          { name: "勾股定理", expr: "c² = p² + q²" },
          { name: "面积", expr: "S = ½pq" },
          { name: "斜边上的高", expr: "h = pq / c" },
          { name: "外接圆", expr: "R = c / 2（斜边中点即外心，直角所对的弦是直径）" },
          { name: "内切圆", expr: "r = (p + q − c) / 2" },
          { name: "三角函数", expr: "sin B = q/c，cos B = p/c，tan B = q/p" },
          { name: "射影定理", expr: "p² = c · p′，q² = c · q′（p′、q′ 为两直角边在斜边上的投影）" },
        ],
        figure: [
          poly([pt(0, 0), pt(p, 0), pt(0, q)], { fill: true }),
          dimP(pt(0, 0), pt(p, 0), `p = ${f(p)}`, -1),
          dimP(pt(0, 0), pt(0, q), `q = ${f(q)}`, -1),
          dimP(pt(p, 0), pt(0, q), `c = ${f(c)}`, 1),
          rightP(pt(0, 0), pt(p, 0), pt(0, q), 0.12 * Math.min(p, q)),
          angP(pt(p, 0), pt(0, 0), pt(0, q), 0.18 * Math.min(p, q)),
          labP(
            pt(p * 0.78, q * 0.22),
            g(B),
            [1, -1],
          ),
          labP(pt(0, q), "A", [-1, 0.6]),
          labP(pt(p, 0), "B", [1, -0.6]),
          labP(pt(0, 0), "C", [-1, -1]),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "equilateral",
    name: "等边三角形",
    cat: "plane",
    brief: "正三角形由一条边求出高、面积、内外接圆与所有角。",
    modes: [
      {
        id: "a",
        label: "已知边长 a",
        fields: [{ k: "a", label: "边长 a", def: "6", kind: "len" }],
      },
      {
        id: "S",
        label: "已知面积 S",
        fields: [{ k: "S", label: "面积 S", def: "15.5885", kind: "len" }],
      },
      {
        id: "h",
        label: "已知高 h",
        fields: [{ k: "h", label: "高 h", def: "5.1962", kind: "len" }],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "a" ? { a: "边长 a" } : mode === "S" ? { S: "面积 S" } : { h: "高 h" });
      if (errs.length) return { errors: errs };
      const a = mode === "a" ? n.a : mode === "S" ? Math.sqrt((4 * n.S) / Math.sqrt(3)) : (2 * n.h) / Math.sqrt(3);
      const h = (a * Math.sqrt(3)) / 2;
      const S = (a * a * Math.sqrt(3)) / 4;
      const ri = (a * Math.sqrt(3)) / 6;
      const R = (a * Math.sqrt(3)) / 3;
      const t: Tri = { a, b: a, c: a, A: PI / 3, B: PI / 3, C: PI / 3 };
      return {
        rows: [
          row("边长 a", f(a)),
          row("高 h = (√3/2)a", f(h)),
          row("面积 S = (√3/4)a²", f(S)),
          row("周长 P = 3a", f(3 * a)),
          row("内切圆半径 r = (√3/6)a", f(ri)),
          row("外接圆半径 R = (√3/3)a", f(R)),
          row("内切圆面积", f(PI * ri * ri)),
          row("外接圆面积", f(PI * R * R)),
          row("每个内角", fmtAng(PI / 3, ctx)),
          row("角平分线 = 中线 = 高", f(h)),
          row("三角形类型", triKind(t)),
        ],
        formulas: [
          { name: "高", expr: "h = (√3/2)·a" },
          { name: "面积", expr: "S = (√3/4)·a²" },
          { name: "内切圆半径", expr: "r = (√3/6)·a = h/3" },
          { name: "外接圆半径", expr: "R = (√3/3)·a = 2h/3" },
          { name: "三线合一", expr: "高 = 中线 = 角平分线" },
        ],
        figure: [
          poly([pt(0, 0), pt(a, 0), pt(a / 2, h)], { fill: true }),
          dimP(pt(0, 0), pt(a, 0), `a = ${f(a)}`, -1),
          segP(pt(a / 2, h), pt(a / 2, 0), true),
          rightP(pt(a / 2, 0), pt(a, 0), pt(a / 2, h), 0.1 * a),
          labP(pt(a / 2, h / 2), `h = ${f(h)}`, [1, 0]),
          ...vertexMarks(
            [pt(0, 0), pt(a, 0), pt(a / 2, h)],
            [PI / 3, PI / 3, PI / 3],
            [fmtAng(PI / 3, ctx), fmtAng(PI / 3, ctx), fmtAng(PI / 3, ctx)],
            0.18 * a,
          ),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "isoscelesTriangle",
    name: "等腰三角形",
    cat: "plane",
    brief: "由腰与底（或腰与顶角）求三边三角、底边高、面积与内外接圆。",
    modes: [
      {
        id: "sides",
        label: "腰 + 底边",
        fields: [
          { k: "a", label: "腰 a", def: "5", kind: "len" },
          { k: "b", label: "底边 b", def: "6", kind: "len" },
        ],
      },
      {
        id: "apex",
        label: "腰 + 顶角",
        fields: [
          { k: "a", label: "腰 a", def: "5", kind: "len" },
          { k: "apex", label: "顶角", def: "60", kind: "ang" },
        ],
      },
      {
        id: "baseAngle",
        label: "腰 + 底角",
        fields: [
          { k: "a", label: "腰 a", def: "5", kind: "len" },
          { k: "base", label: "底角", def: "50", kind: "ang" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, { a: "腰 a" });
      let b = NaN;
      let apex = NaN;
      if (mode === "sides") {
        needPos(errs, n, raw, { b: "底边 b" });
        if (errs.length) return { errors: errs };
        if (n.b >= 2 * n.a) return { errors: ["底边必须小于两腰之和（2 × 腰），请检查数据"] };
        b = n.b;
        apex = 2 * Math.asin(b / (2 * n.a));
      } else if (mode === "apex") {
        needAngle(errs, n, raw, { apex: "顶角" }, ctx, PI);
        if (errs.length) return { errors: errs };
        apex = toRad(n.apex, ctx.unit);
        b = 2 * n.a * Math.sin(apex / 2);
      } else {
        needAngle(errs, n, raw, { base: "底角" }, ctx, PI / 2);
        if (errs.length) return { errors: errs };
        const base = toRad(n.base, ctx.unit);
        apex = PI - 2 * base;
        b = 2 * n.a * Math.sin(apex / 2);
      }
      const base = (PI - apex) / 2;
      const h = n.a * Math.cos(apex / 2);
      const t = triFromSides(b, n.a, n.a);
      if (!t) return { errors: ["这些数据解不出等腰三角形，请检查"] };
      const S = triArea(t);
      const R = (t.a * t.b * t.c) / (4 * S);
      const ri = S / ((t.a + t.b + t.c) / 2);
      return {
        rows: [
          row("腰 a", f(n.a)),
          row("底边 b", f(b)),
          row("顶角", g(apex)),
          row("两个底角", `${g(base)}（相等）`),
          row("底边上的高 h", f(h)),
          row("面积 S = ½bh", f(S)),
          row("周长 P = 2a + b", f(2 * n.a + b)),
          row("内切圆半径 r", f(ri)),
          row("外接圆半径 R", f(R)),
          row("底边一半 b/2", f(b / 2)),
          row("腰在底边上的投影 b/2", f(b / 2)),
          row("三角形类型", triKind(t)),
        ],
        formulas: [
          { name: "顶角与底边", expr: "b = 2a·sin(顶角/2)" },
          { name: "底边上的高", expr: "h = a·cos(顶角/2) = √(a² − b²/4)" },
          { name: "面积", expr: "S = ½·b·h" },
          { name: "两底角", expr: "底角 = (180° − 顶角) / 2" },
          { name: "三线合一", expr: "底边上的高、中线、角平分线重合" },
        ],
        figure: (() => {
          const A = pt(0, 0);
          const B = pt(b, 0);
          const C = pt(b / 2, h);
          return [
            poly([A, B, C], { fill: true }),
            dimP(A, B, `b = ${f(b)}`, -1),
            dimP(A, C, `a = ${f(n.a)}`, -1),
            segP(C, pt(b / 2, 0), true),
            rightP(pt(b / 2, 0), B, C, 0.1 * b),
            labP(pt(b / 2, h / 2), `h = ${f(h)}`, [1, 0]),
            ...vertexMarks([A, B, C], [base, base, apex], [g(base), g(base), g(apex)], 0.16 * b),
          ];
        })(),
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "isoscelesRight",
    name: "等腰直角三角形",
    cat: "plane",
    brief: "45°–45°–90° 三角形：由直角边或斜边求全部量与 1 : 1 : √2 比例。",
    modes: [
      {
        id: "leg",
        label: "已知直角边 a",
        fields: [{ k: "a", label: "直角边 a", def: "5", kind: "len" }],
      },
      {
        id: "hyp",
        label: "已知斜边 c",
        fields: [{ k: "c", label: "斜边 c", def: "7.0711", kind: "len" }],
      },
      {
        id: "S",
        label: "已知面积 S",
        fields: [{ k: "S", label: "面积 S", def: "12.5", kind: "len" }],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "leg" ? { a: "直角边 a" } : mode === "hyp" ? { c: "斜边 c" } : { S: "面积 S" });
      if (errs.length) return { errors: errs };
      const a = mode === "leg" ? n.a : mode === "hyp" ? n.c / Math.SQRT2 : Math.sqrt(2 * n.S);
      const c = a * Math.SQRT2;
      const S = (a * a) / 2;
      const R = c / 2;
      const ri = (a * (2 - Math.SQRT2)) / 2;
      const t: Tri = { a: c, b: a, c: a, A: PI / 2, B: PI / 4, C: PI / 4 };
      return {
        rows: [
          row("直角边 a", f(a)),
          row("斜边 c = a√2", f(c)),
          row("面积 S = a²/2", f(S)),
          row("周长 P = (2+√2)a", f(2 * a + c)),
          row("斜边上的高 = c/2", f(c / 2)),
          row("外接圆半径 R = c/2", f(R)),
          row("内切圆半径 r = a(2−√2)/2", f(ri)),
          row("两个锐角", `${fmtAng(PI / 4, ctx)}（相等）`),
          row("直角", fmtAng(PI / 2, ctx)),
          row("边比 a : a : c", `1 : 1 : ${f(Math.SQRT2)}`),
          row("三角形类型", triKind(t)),
        ],
        formulas: [
          { name: "斜边", expr: "c = a√2（45° 直角三角形的 1 : 1 : √2 比例）" },
          { name: "面积", expr: "S = a² / 2" },
          { name: "周长", expr: "P = (2 + √2)·a" },
          { name: "外接圆半径", expr: "R = c / 2 = a/√2" },
          { name: "内切圆半径", expr: "r = a(2 − √2) / 2" },
        ],
        figure: [
          poly([pt(0, 0), pt(a, 0), pt(0, a)], { fill: true }),
          dimP(pt(0, 0), pt(a, 0), `a = ${f(a)}`, -1),
          dimP(pt(0, 0), pt(0, a), `a = ${f(a)}`, -1),
          dimP(pt(a, 0), pt(0, a), `c = ${f(c)}`, 1),
          rightP(pt(0, 0), pt(a, 0), pt(0, a), 0.12 * a),
          ...vertexMarks(
            [pt(0, 0), pt(a, 0), pt(0, a)],
            [PI / 2, PI / 4, PI / 4],
            [fmtAng(PI / 2, ctx), fmtAng(PI / 4, ctx), fmtAng(PI / 4, ctx)],
            0.16 * a,
          ),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  // ─────────────────── 平面图形：四边形与正多边形 ───────────────────
  {
    id: "rectangle",
    name: "矩形",
    cat: "plane",
    brief: "由长宽、一边加对角线或一边加面积求解矩形的全部量。",
    modes: [
      {
        id: "ab",
        label: "长 + 宽",
        fields: [
          { k: "a", label: "长 a", def: "8", kind: "len" },
          { k: "b", label: "宽 b", def: "5", kind: "len" },
        ],
      },
      {
        id: "diag",
        label: "一边 + 对角线",
        fields: [
          { k: "a", label: "长 a", def: "8", kind: "len" },
          { k: "d", label: "对角线 d", def: "9.434", kind: "len" },
        ],
      },
      {
        id: "area",
        label: "一边 + 面积",
        fields: [
          { k: "a", label: "长 a", def: "8", kind: "len" },
          { k: "S", label: "面积 S", def: "40", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      let a = NaN;
      let b = NaN;
      if (mode === "ab") {
        needPos(errs, n, raw, { a: "长 a", b: "宽 b" });
        a = n.a;
        b = n.b;
      } else if (mode === "diag") {
        needPos(errs, n, raw, { a: "长 a", d: "对角线 d" });
        if (errs.length) return { errors: errs };
        if (n.d <= n.a) return { errors: ["对角线必须大于任意一条边，请检查两个数据"] };
        a = n.a;
        b = Math.sqrt(n.d * n.d - n.a * n.a);
      } else {
        needPos(errs, n, raw, { a: "长 a", S: "面积 S" });
        a = n.a;
        b = n.S / n.a;
      }
      if (errs.length) return { errors: errs };
      const S = a * b;
      const P = 2 * (a + b);
      const d = Math.hypot(a, b);
      const R = d / 2;
      return {
        rows: [
          row("长 a", f(a)),
          row("宽 b", f(b)),
          row("面积 S = ab", f(S)),
          row("周长 P = 2(a+b)", f(P)),
          row("对角线 d = √(a²+b²)", f(d)),
          row("外接圆半径 R = d/2", f(R)),
          row("外接圆面积", f(PI * R * R)),
          row("对角线与长边夹角", g(Math.atan2(b, a))),
          row("对角线与短边夹角", g(Math.atan2(a, b))),
          row("长宽比 a : b", `${f(a)} : ${f(b)}`),
          row("两条对角线的交角", `${g(2 * Math.atan2(b, a))} / ${g(PI - 2 * Math.atan2(b, a))}`),
        ],
        formulas: [
          { name: "面积", expr: "S = a·b" },
          { name: "周长", expr: "P = 2(a + b)" },
          { name: "对角线", expr: "d = √(a² + b²)" },
          { name: "外接圆", expr: "R = d / 2（矩形四顶点共圆，圆心是对角线交点）" },
        ],
        figure: [
          poly([pt(0, 0), pt(a, 0), pt(a, b), pt(0, b)], { fill: true }),
          segP(pt(0, 0), pt(a, b), true),
          segP(pt(0, b), pt(a, 0), true),
          dimP(pt(0, 0), pt(a, 0), `a = ${f(a)}`, -1),
          dimP(pt(0, 0), pt(0, b), `b = ${f(b)}`, -1),
          labP(pt(a / 2, b / 2), `d = ${f(d)}`, [0, 1]),
          ...vertexMarks(
            [pt(0, 0), pt(a, 0), pt(a, b), pt(0, b)],
            [PI / 2, PI / 2, PI / 2, PI / 2],
            [undefined, undefined, undefined, undefined],
            0.1 * Math.min(a, b),
          ),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "square",
    name: "正方形",
    cat: "plane",
    brief: "边长、对角线、面积、周长任知其一，求出内外接圆等全部量。",
    modes: [
      { id: "a", label: "已知边长 a", fields: [{ k: "a", label: "边长 a", def: "6", kind: "len" }] },
      { id: "d", label: "已知对角线 d", fields: [{ k: "d", label: "对角线 d", def: "8.4853", kind: "len" }] },
      { id: "S", label: "已知面积 S", fields: [{ k: "S", label: "面积 S", def: "36", kind: "len" }] },
      { id: "P", label: "已知周长 P", fields: [{ k: "P", label: "周长 P", def: "24", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "a" ? { a: "边长 a" } : mode === "d" ? { d: "对角线 d" } : mode === "S" ? { S: "面积 S" } : { P: "周长 P" });
      if (errs.length) return { errors: errs };
      const a =
        mode === "a" ? n.a : mode === "d" ? n.d / Math.SQRT2 : mode === "S" ? Math.sqrt(n.S) : n.P / 4;
      const d = a * Math.SQRT2;
      const S = a * a;
      return {
        rows: [
          row("边长 a", f(a)),
          row("面积 S = a²", f(S)),
          row("周长 P = 4a", f(4 * a)),
          row("对角线 d = a√2", f(d)),
          row("内切圆半径 r = a/2", f(a / 2)),
          row("外接圆半径 R = d/2 = a/√2", f(d / 2)),
          row("内切圆面积", f((PI * a * a) / 4)),
          row("外接圆面积", f((PI * a * a) / 2)),
          row("对角线与边夹角", fmtAng(PI / 4, ctx)),
          row("四个内角", `${fmtAng(PI / 2, ctx)}（均为直角）`),
          row("对角线互相垂直平分", "是"),
        ],
        formulas: [
          { name: "面积", expr: "S = a² = d² / 2" },
          { name: "周长", expr: "P = 4a" },
          { name: "对角线", expr: "d = a√2" },
          { name: "内切圆", expr: "r = a / 2" },
          { name: "外接圆", expr: "R = d / 2 = a / √2" },
        ],
        figure: [
          poly([pt(0, 0), pt(a, 0), pt(a, a), pt(0, a)], { fill: true }),
          segP(pt(0, 0), pt(a, a), true),
          segP(pt(0, a), pt(a, 0), true),
          dimP(pt(0, 0), pt(a, 0), `a = ${f(a)}`, -1),
          labP(pt(a / 2, a / 2), `d = ${f(d)}`, [0, 1]),
          ...vertexMarks(
            [pt(0, 0), pt(a, 0), pt(a, a), pt(0, a)],
            [PI / 2, PI / 2, PI / 2, PI / 2],
            [undefined, undefined, undefined, undefined],
            0.1 * a,
          ),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "parallelogram",
    name: "平行四边形",
    cat: "plane",
    brief: "由两邻边加夹角、底加高或两邻边加一条对角线求面积、两条对角线、高与各角。",
    modes: [
      {
        id: "abAngle",
        label: "两邻边 + 夹角",
        fields: [
          { k: "a", label: "邻边 a", def: "7", kind: "len" },
          { k: "b", label: "邻边 b", def: "5", kind: "len" },
          { k: "theta", label: "夹角 θ", def: "55", kind: "ang" },
        ],
      },
      {
        id: "baseHeight",
        label: "底 + 高",
        fields: [
          { k: "b", label: "底 b", def: "7", kind: "len" },
          { k: "h", label: "高 h", def: "4", kind: "len" },
        ],
      },
      {
        id: "sidesDiag",
        label: "两邻边 + 一条对角线",
        fields: [
          { k: "a", label: "邻边 a", def: "7", kind: "len" },
          { k: "b", label: "邻边 b", def: "5", kind: "len" },
          { k: "d", label: "对角线 d (BD)", def: "6", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      if (mode === "baseHeight") {
        needPos(errs, n, raw, { b: "底 b", h: "高 h" });
        if (errs.length) return { errors: errs };
        const S = n.b * n.h;
        return {
          rows: [
            row("底 b", f(n.b)),
            row("高 h", f(n.h)),
            row("面积 S = bh", f(S)),
            row("提示", "只知道底和高只能确定面积，周长与角度还需要邻边或夹角"),
          ],
          formulas: [{ name: "面积", expr: "S = 底 × 高 = b·h" }],
          figure: [
            poly([pt(0, 0), pt(n.b, 0), pt(n.b * 0.8, n.h), pt(-n.b * 0.2, n.h)], { fill: true }),
            segP(pt(n.b * 0.8, n.h), pt(n.b * 0.8, 0), true),
            rightP(pt(n.b * 0.8, 0), pt(n.b, 0), pt(n.b * 0.8, n.h), 0.12 * n.h),
            dimP(pt(0, 0), pt(n.b, 0), `b = ${f(n.b)}`, -1),
            labP(pt(n.b * 0.8, n.h / 2), `h = ${f(n.h)}`, [1, 0]),
          ],
          primary: row("面积 S", f(S)),
        };
      }
      let a = NaN;
      let b = NaN;
      let th = NaN;
      if (mode === "abAngle") {
        needPos(errs, n, raw, { a: "邻边 a", b: "邻边 b" });
        needAngle(errs, n, raw, { theta: "夹角 θ" }, ctx, PI);
        if (errs.length) return { errors: errs };
        a = n.a;
        b = n.b;
        th = toRad(n.theta, ctx.unit);
      } else {
        needPos(errs, n, raw, { a: "邻边 a", b: "邻边 b", d: "对角线 d (BD)" });
        if (errs.length) return { errors: errs };
        if (n.d <= Math.abs(n.a - n.b) || n.d >= n.a + n.b) {
          return { errors: ["这条对角线长度无法与两边构成三角形（需要满足 |a−b| < d < a+b）"] };
        }
        a = n.a;
        b = n.b;
        th = Math.acos(clamp1((a * a + b * b - n.d * n.d) / (2 * a * b)));
      }
      const S = a * b * Math.sin(th);
      const dLong = Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(th)));
      const dShort = Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * Math.cos(th)));
      const A = pt(0, 0);
      const B = pt(a, 0);
      const D = pt(b * Math.cos(th), b * Math.sin(th));
      const C = add(B, D);
      return {
        rows: [
          row("邻边 a", f(a)),
          row("邻边 b", f(b)),
          row("夹角 θ", g(th)),
          row("面积 S = ab·sinθ", f(S)),
          row("周长 P = 2(a+b)", f(2 * (a + b))),
          row("a 边上的高 h_a = b·sinθ", f(b * Math.sin(th))),
          row("b 边上的高 h_b = a·sinθ", f(a * Math.sin(th))),
          row("长对角线 AC", f(dLong)),
          row("短对角线 BD", f(dShort)),
          row("对角线平方和 = 2(a²+b²)", f(dLong * dLong + dShort * dShort)),
          row("其余两个角", `${g(PI - th)}（与 θ 互补）`),
          row("两条对角线的交角", `${g(2 * Math.atan2(a * b * Math.sin(th), a * a + b * b + 2 * a * b * Math.cos(th)))} 见附注`),
        ],
        formulas: [
          { name: "面积", expr: "S = a·b·sin θ = 底 × 高" },
          { name: "对角线（平行四边形定理）", expr: "d₁² + d₂² = 2(a² + b²)" },
          { name: "长对角线", expr: "d₁ = √(a² + b² + 2ab·cos θ)" },
          { name: "短对角线", expr: "d₂ = √(a² + b² − 2ab·cos θ)" },
          { name: "高", expr: "h_a = b·sin θ" },
          { name: "邻角关系", expr: "相邻两角互补，和为 180°" },
        ],
        figure: [
          poly([A, B, C, D], { fill: true }),
          segP(A, C, true),
          segP(B, D, true),
          dimP(A, B, `a = ${f(a)}`, -1),
          dimP(A, D, `b = ${f(b)}`, -1),
          segP(D, pt(D[0], 0), true),
          labP(pt(A[0] + 0.9, 0), g(th), [0, 1]),
          labP(mid(B, C), `h = ${f(b * Math.sin(th))}`, [1, 0]),
          ...edgeLabels([A, B, C, D], [undefined, undefined, undefined, undefined]),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "rhombus",
    name: "菱形",
    cat: "plane",
    brief: "由边长加角、两条对角线或边长加高求面积、对角线、高与内切圆。",
    modes: [
      {
        id: "sideAngle",
        label: "边长 + 锐角",
        fields: [
          { k: "a", label: "边长 a", def: "6", kind: "len" },
          { k: "theta", label: "锐角 θ", def: "60", kind: "ang" },
        ],
      },
      {
        id: "diagonals",
        label: "两条对角线",
        fields: [
          { k: "d1", label: "对角线 d₁", def: "8", kind: "len" },
          { k: "d2", label: "对角线 d₂", def: "6", kind: "len" },
        ],
      },
      {
        id: "sideHeight",
        label: "边长 + 高",
        fields: [
          { k: "a", label: "边长 a", def: "6", kind: "len" },
          { k: "h", label: "高 h", def: "5", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      let a = NaN;
      let th = NaN;
      let d1 = NaN;
      let d2 = NaN;
      if (mode === "sideAngle") {
        needPos(errs, n, raw, { a: "边长 a" });
        needAngle(errs, n, raw, { theta: "锐角 θ" }, ctx, PI / 2);
        if (errs.length) return { errors: errs };
        a = n.a;
        th = toRad(n.theta, ctx.unit);
        d1 = 2 * a * Math.cos(th / 2);
        d2 = 2 * a * Math.sin(th / 2);
      } else if (mode === "diagonals") {
        needPos(errs, n, raw, { d1: "对角线 d₁", d2: "对角线 d₂" });
        if (errs.length) return { errors: errs };
        d1 = Math.max(n.d1, n.d2);
        d2 = Math.min(n.d1, n.d2);
        a = Math.hypot(d1, d2) / 2;
        th = 2 * Math.atan2(d2, d1);
      } else {
        needPos(errs, n, raw, { a: "边长 a", h: "高 h" });
        if (errs.length) return { errors: errs };
        if (n.h > n.a) return { errors: ["高不能大于边长（高最大等于边长）"] };
        a = n.a;
        th = Math.asin(clamp1(n.h / n.a));
        d1 = 2 * a * Math.cos(th / 2);
        d2 = 2 * a * Math.sin(th / 2);
      }
      const S = (d1 * d2) / 2;
      const h = a * Math.sin(th);
      const ri = (d1 * d2) / (2 * Math.sqrt(d1 * d1 + d2 * d2));
      const A = pt(0, 0);
      const B = pt(a * Math.cos(th / 2), a * Math.sin(th / 2));
      const C = pt(a * Math.cos(th / 2) * 2, 0);
      const D = pt(a * Math.cos(th / 2), -a * Math.sin(th / 2));
      return {
        rows: [
          row("边长 a", f(a)),
          row("锐角 θ", g(th)),
          row("钝角", g(PI - th)),
          row("面积 S = ½·d₁·d₂ = a²·sinθ", f(S)),
          row("周长 P = 4a", f(4 * a)),
          row("长对角线 d₁ = 2a·cos(θ/2)", f(d1)),
          row("短对角线 d₂ = 2a·sin(θ/2)", f(d2)),
          row("高 h = a·sinθ", f(h)),
          row("内切圆半径 r = ½h", f(ri)),
          row("对角线互相垂直平分", "是（对角线夹角 90°）"),
          row("两条对角线的半长", `${f(d1 / 2)} 与 ${f(d2 / 2)}`),
        ],
        formulas: [
          { name: "面积（对角线）", expr: "S = ½ · d₁ · d₂" },
          { name: "面积（边与角）", expr: "S = a² · sin θ" },
          { name: "对角线", expr: "d₁ = 2a·sin(θ/2)，d₂ = 2a·cos(θ/2)" },
          { name: "高", expr: "h = a · sin θ" },
          { name: "内切圆半径", expr: "r = h/2 = d₁d₂ / (2√(d₁²+d₂²))" },
        ],
        figure: [
          poly([A, B, C, D], { fill: true }),
          segP(A, C, true),
          segP(B, D, true),
          dimP(A, C, `d₁ = ${f(d1)}`, -1),
          dimP(B, D, `d₂ = ${f(d2)}`, 1),
          rightP(pt(a * Math.cos(th / 2), 0), B, A, 0.1 * a),
          labP(pt(0.9, 0.35), g(th), [1, 1]),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "trapezoid",
    name: "梯形（含等腰 / 直角）",
    cat: "plane",
    brief: "一般梯形、等腰梯形、直角梯形：求面积、周长、高、中位线、对角线与各角。",
    modes: [
      {
        id: "abHeight",
        label: "两底 + 高",
        fields: [
          { k: "a", label: "上底 a", def: "6", kind: "len" },
          { k: "b", label: "下底 b", def: "10", kind: "len" },
          { k: "h", label: "高 h", def: "4", kind: "len" },
        ],
      },
      {
        id: "isosceles",
        label: "等腰梯形：两底 + 腰",
        fields: [
          { k: "a", label: "上底 a", def: "6", kind: "len" },
          { k: "b", label: "下底 b", def: "10", kind: "len" },
          { k: "c", label: "腰 c", def: "4", kind: "len" },
        ],
      },
      {
        id: "rightTrapezoid",
        label: "直角梯形：两底 + 高",
        fields: [
          { k: "a", label: "上底 a", def: "6", kind: "len" },
          { k: "b", label: "下底 b", def: "10", kind: "len" },
          { k: "h", label: "高 h（直角腰）", def: "4", kind: "len" },
        ],
      },
      {
        id: "fourSides",
        label: "一般梯形：两底 + 两腰",
        fields: [
          { k: "a", label: "上底 a", def: "6", kind: "len" },
          { k: "b", label: "下底 b", def: "10", kind: "len" },
          { k: "c", label: "左腰 c (AD)", def: "4", kind: "len" },
          { k: "d", label: "右腰 d (BC)", def: "5", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      if (mode === "abHeight") {
        needPos(errs, n, raw, { a: "上底 a", b: "下底 b", h: "高 h" });
        if (errs.length) return { errors: errs };
        const S = ((n.a + n.b) * n.h) / 2;
        return {
          rows: [
            row("上底 a", f(n.a)),
            row("下底 b", f(n.b)),
            row("高 h", f(n.h)),
            row("面积 S = ½(a+b)h", f(S)),
            row("中位线 m = (a+b)/2", f((n.a + n.b) / 2)),
            row("两底之差 b − a", f(n.b - n.a)),
            row("提示", "要知道周长与角度，还需要腰长或底角"),
          ],
          formulas: [
            { name: "面积", expr: "S = ½(a + b)·h" },
            { name: "中位线", expr: "m = (a + b) / 2（中位线平行于两底且等于两底和的一半）" },
          ],
          figure: (() => {
            const off = (n.b - n.a) / 2;
            const pts = [pt(0, 0), pt(n.b, 0), pt(n.b - off, n.h), pt(off, n.h)];
            return [
              poly(pts, { fill: true }),
              segP(pt(off, n.h), pt(off, 0), true),
              rightP(pt(off, 0), pt(n.b, 0), pt(off, n.h), 0.12 * n.h),
              dimP(pt(0, 0), pt(n.b, 0), `b = ${f(n.b)}`, -1),
              dimP(pts[3], pts[2], `a = ${f(n.a)}`, 1),
              labP(pt(off, n.h / 2), `h = ${f(n.h)}`, [-1, 0]),
              segP(mid(pts[0], pts[1]), mid(pts[2], pts[3]), true),
              labP(mid(mid(pts[0], pts[1]), mid(pts[2], pts[3])), `m = ${f((n.a + n.b) / 2)}`, [0, 1]),
            ];
          })(),
          primary: row("面积 S", f(S)),
        };
      }
      if (mode === "fourSides") {
        needPos(errs, n, raw, { a: "上底 a", b: "下底 b", c: "左腰 c (AD)", d: "右腰 d (BC)" });
        if (errs.length) return { errors: errs };
        if (n.b <= n.a) return { errors: ["本解法要求下底大于上底（把较长的底填在下底）"] };
        const diff = n.b - n.a;
        const x = (n.c * n.c - n.d * n.d + diff * diff) / (2 * diff);
        const h2 = n.c * n.c - x * x;
        if (!(h2 > 0)) return { errors: ["这两条腰与两底之差无法构成三角形，请检查数据"] };
        if (x < -1e-9 || x > diff + 1e-9) return { errors: ["这条腰只能斜到下方底边之外，数据不合理"] };
        const h = Math.sqrt(h2);
        const angA = Math.atan2(h, x);
        const angB = Math.atan2(h, diff - x);
        const S = ((n.a + n.b) * h) / 2;
        const d1 = Math.hypot(x + n.a, h);
        const d2 = Math.hypot(n.b - x, h);
        return {
          rows: [
            row("上底 a", f(n.a)),
            row("下底 b", f(n.b)),
            row("左腰 c", f(n.c)),
            row("右腰 d", f(n.d)),
            row("高 h", f(h)),
            row("面积 S", f(S)),
            row("周长 P = a+b+c+d", f(n.a + n.b + n.c + n.d)),
            row("中位线 m", f((n.a + n.b) / 2)),
            row("左下角 ∠A", g(angA)),
            row("右下角 ∠B", g(angB)),
            row("左上角 ∠D", g(PI - angA)),
            row("右上角 ∠C", g(PI - angB)),
            row("对角线 AC", f(d1)),
            row("对角线 BD", f(d2)),
            row("左腰水平投影 x", f(x)),
            row("右腰水平投影", f(diff - x)),
          ],
          formulas: [
            { name: "高（由两底与两腰）", expr: "h = √(c² − x²)，x = (c² − d² + (b−a)²) / (2(b−a))" },
            { name: "面积", expr: "S = ½(a + b)·h" },
            { name: "周长", expr: "P = a + b + c + d" },
            { name: "中位线", expr: "m = (a + b)/2" },
            { name: "同旁内角", expr: "每条腰两侧的角互补，各角和为 360°" },
          ],
          figure: (() => {
            const A = pt(0, 0);
            const B = pt(n.b, 0);
            const C = pt(x + n.a, h);
            const D = pt(x, h);
            return [
              poly([A, B, C, D], { fill: true }),
              segP(D, pt(x, 0), true),
              rightP(pt(x, 0), B, D, 0.1 * h),
              dimP(A, B, `b = ${f(n.b)}`, -1),
              dimP(D, C, `a = ${f(n.a)}`, 1),
              dimP(A, D, `c = ${f(n.c)}`, -1),
              dimP(B, C, `d = ${f(n.d)}`, 1),
              labP(pt(x, h / 2), `h = ${f(h)}`, [-1, 0]),
              ...vertexMarks([A, B, C, D], [angA, angB, PI - angB, PI - angA], [g(angA), g(angB), g(PI - angB), g(PI - angA)], 0.16 * Math.min(n.a, h)),
            ];
          })(),
          primary: row("面积 S", f(S)),
        };
      }
      // 等腰梯形 / 直角梯形
      needPos(errs, n, raw, { a: "上底 a", b: "下底 b" });
      if (mode === "isosceles") needPos(errs, n, raw, { c: "腰 c" });
      else needPos(errs, n, raw, { h: "高 h（直角腰）" });
      if (errs.length) return { errors: errs };
      if (n.b <= n.a) return { errors: ["本解法要求下底大于上底（把较长的底填在下底）"] };
      const diff = n.b - n.a;
      let h = NaN;
      let leg = NaN;
      let leg2 = NaN;
      let pts: Vec[] = [];
      let angA = 0;
      let angB = 0;
      if (mode === "isosceles") {
        const x = diff / 2;
        const h2 = n.c * n.c - x * x;
        if (!(h2 > 0)) return { errors: ["腰太短，撑不起两底之差（需要 c > (b−a)/2）"] };
        h = Math.sqrt(h2);
        leg = n.c;
        leg2 = n.c;
        angA = Math.atan2(h, x);
        angB = angA;
        pts = [pt(0, 0), pt(n.b, 0), pt(n.b - x, h), pt(x, h)];
      } else {
        h = n.h;
        leg = n.h;
        leg2 = Math.hypot(diff, h);
        angA = PI / 2;
        angB = Math.atan2(h, diff);
        pts = [pt(0, 0), pt(n.b, 0), pt(n.a, h), pt(0, h)];
      }
      const S = ((n.a + n.b) * h) / 2;
      const d1 = vlen(sub(pts[2], pts[0]));
      const d2 = vlen(sub(pts[3], pts[1]));
      const angD = mode === "isosceles" ? PI - angA : PI / 2;
      const angC = mode === "isosceles" ? PI - angA : angB;
      return {
        rows: [
          row("上底 a", f(n.a)),
          row("下底 b", f(n.b)),
          row(mode === "isosceles" ? "腰 c" : "直角腰", f(leg)),
          row(mode === "isosceles" ? "另一条腰" : "斜腰", f(leg2)),
          row("高 h", f(h)),
          row("面积 S = ½(a+b)h", f(S)),
          row("周长 P", f(n.a + n.b + leg + leg2)),
          row("中位线 m = (a+b)/2", f((n.a + n.b) / 2)),
          row("左下角 ∠A", g(angA)),
          row("右下角 ∠B", g(angB)),
          row("左上角 ∠D", g(angD)),
          row("右上角 ∠C", g(angC)),
          row("对角线 AC", f(d1)),
          row("对角线 BD", f(d2)),
          row("两腰中点连线（中位线）", f((n.a + n.b) / 2)),
        ],
        formulas: [
          { name: "面积", expr: "S = ½(a + b)·h" },
          { name: "中位线", expr: "m = (a + b)/2" },
          { name: "等腰梯形的高", expr: "h = √(c² − ((b−a)/2)²)" },
          { name: "等腰梯形", expr: "两腰相等、两个底角相等、对角线相等" },
          { name: "直角梯形的斜腰", expr: "斜腰 = √((b−a)² + h²)" },
          { name: "同旁内角", expr: "每条腰同侧的两角互补（和为 180°）" },
        ],
        figure: [
          poly(pts, { fill: true }),
          ...(mode === "isosceles"
            ? [
                segP(pts[3], pt(pts[3][0], 0), true),
                rightP(pt(pts[3][0], 0), pt(pts[3][0] + 1, 0), pts[3], 0.1 * h),
                segP(pts[2], pt(pts[2][0], 0), true),
              ]
            : [
                rightP(pt(0, 0), pt(n.b, 0), pt(0, h), 0.1 * h),
                rightP(pt(0, h), pt(n.a, h), pt(0, 0), 0.1 * h),
              ]),
          dimP(pts[0], pts[1], `b = ${f(n.b)}`, -1),
          dimP(pts[3], pts[2], `a = ${f(n.a)}`, 1),
          labP(pt(pts[3][0], h / 2), `h = ${f(h)}`, [-1, 0]),
          ...vertexMarks(pts, [angA, angB, angC, angD], [g(angA), g(angB), g(angC), g(angD)], 0.16 * Math.min(n.a, h)),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "regularPolygon",
    name: "正多边形",
    cat: "plane",
    brief: "正 n 边形：由边长、外接圆半径、边心距或面积求周长、面积、内外角与对角线数。",
    modes: [
      {
        id: "side",
        label: "边数 + 边长",
        fields: [
          { k: "n", label: "边数 n", def: "6", kind: "int" },
          { k: "a", label: "边长 a", def: "5", kind: "len" },
        ],
      },
      {
        id: "circum",
        label: "边数 + 外接圆半径",
        fields: [
          { k: "n", label: "边数 n", def: "6", kind: "int" },
          { k: "R", label: "外接圆半径 R", def: "5", kind: "len" },
        ],
      },
      {
        id: "inradius",
        label: "边数 + 边心距",
        fields: [
          { k: "n", label: "边数 n", def: "6", kind: "int" },
          { k: "r", label: "边心距 r", def: "4.3301", kind: "len" },
        ],
      },
      {
        id: "area",
        label: "边数 + 面积",
        fields: [
          { k: "n", label: "边数 n", def: "6", kind: "int" },
          { k: "S", label: "面积 S", def: "64.9519", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, { n: "边数 n" });
      if (Number.isFinite(n.n) && (n.n < 3 || Math.abs(n.n - Math.round(n.n)) > 1e-9)) {
        errs.push("「边数 n」需要是不小于 3 的整数");
      }
      if (mode === "side") needPos(errs, n, raw, { a: "边长 a" });
      else if (mode === "circum") needPos(errs, n, raw, { R: "外接圆半径 R" });
      else if (mode === "inradius") needPos(errs, n, raw, { r: "边心距 r" });
      else needPos(errs, n, raw, { S: "面积 S" });
      if (errs.length) return { errors: errs };
      const k = Math.round(n.n);
      const interior = ((k - 2) * PI) / k;
      const exterior = (2 * PI) / k;
      let a = NaN;
      if (mode === "side") a = n.a;
      else if (mode === "circum") a = 2 * n.R * Math.sin(PI / k);
      else if (mode === "inradius") a = 2 * n.r * Math.tan(PI / k);
      else a = Math.sqrt((4 * n.S * Math.tan(PI / k)) / k);
      const R = a / (2 * Math.sin(PI / k));
      const apothem = a / (2 * Math.tan(PI / k));
      const S = (k * a * apothem) / 2;
      const P = k * a;
      const verts: Vec[] = [];
      for (let i = 0; i < k; i++) {
        const ang = PI / 2 + (2 * PI * i) / k;
        verts.push(pt(R * Math.cos(ang), R * Math.sin(ang)));
      }
      return {
        rows: [
          row("边数 n", String(k)),
          row("边长 a", f(a)),
          row("周长 P = n·a", f(P)),
          row("面积 S = ½·n·a·r", f(S)),
          row("每个内角 (n−2)·180°/n", g(interior)),
          row("每个外角 360°/n", g(exterior)),
          row("内角和 (n−2)·180°", g((k - 2) * PI)),
          row("外角和", g(2 * PI)),
          row("外接圆半径 R = a/(2sin(π/n))", f(R)),
          row("边心距 r = a/(2tan(π/n))", f(apothem)),
          row("外接圆面积", f(PI * R * R)),
          row("内切圆面积", f(PI * apothem * apothem)),
          row("每条边所对圆心角 360°/n", g(exterior)),
          row("对角线总数 n(n−3)/2", String((k * (k - 3)) / 2)),
        ],
        formulas: [
          { name: "内角和", expr: "(n − 2) × 180°" },
          { name: "每个内角（正 n 边形）", expr: "(n − 2) × 180° / n" },
          { name: "外角", expr: "360° / n（外角和恒为 360°）" },
          { name: "面积", expr: "S = ½ · n · a · r（r 为边心距）" },
          { name: "面积（外接圆）", expr: "S = ½ · n · R² · sin(2π/n)" },
          { name: "外接圆半径", expr: "R = a / (2 sin(π/n))" },
          { name: "边心距", expr: "r = a / (2 tan(π/n))" },
          { name: "对角线数", expr: "n(n − 3) / 2" },
        ],
        figure: [
          poly(verts, { fill: true }),
          circ(pt(0, 0), R, false, true),
          segP(pt(0, 0), verts[0]),
          segP(pt(0, 0), mid(verts[0], verts[1])),
          dotP(pt(0, 0)),
          labP(mid(pt(0, 0), verts[0]), `R = ${f(R)}`, [1, 0.4]),
          labP(mid(pt(0, 0), mid(verts[0], verts[1])), `r = ${f(apothem)}`, [1, -0.4]),
          labP(mid(verts[0], verts[1]), `a = ${f(a)}`, [verts[0][0] + verts[1][0], verts[0][1] + verts[1][1]]),
          ...vertexMarks(
            verts,
            Array.from({ length: k }, () => interior),
            Array.from({ length: k }, () => undefined as string | undefined),
            0.14 * a,
          ),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "quadrilateral",
    name: "任意四边形（布雷特施奈德）",
    cat: "plane",
    brief: "四边加对角和用布雷特施奈德公式求面积；或四边加一条对角线拆成两个三角形求解。",
    modes: [
      {
        id: "bretschneider",
        label: "四边 + 对角和",
        fields: [
          { k: "a", label: "边 a (AB)", def: "5", kind: "len" },
          { k: "b", label: "边 b (BC)", def: "6", kind: "len" },
          { k: "c", label: "边 c (CD)", def: "7", kind: "len" },
          { k: "d", label: "边 d (DA)", def: "6", kind: "len" },
          { k: "sum", label: "对角和 α+γ", def: "180", kind: "ang" },
        ],
      },
      {
        id: "diagonal",
        label: "四边 + 一条对角线",
        fields: [
          { k: "a", label: "边 a (AB)", def: "5", kind: "len" },
          { k: "b", label: "边 b (BC)", def: "6", kind: "len" },
          { k: "c", label: "边 c (CD)", def: "7", kind: "len" },
          { k: "d", label: "边 d (DA)", def: "6", kind: "len" },
          { k: "f", label: "对角线 AC", def: "8", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, { a: "边 a (AB)", b: "边 b (BC)", c: "边 c (CD)", d: "边 d (DA)" });
      if (mode === "bretschneider") needPos(errs, n, raw, { sum: "对角和 α+γ" });
      else needPos(errs, n, raw, { f: "对角线 AC" });
      if (errs.length) return { errors: errs };
      const s = (n.a + n.b + n.c + n.d) / 2;
      let S = NaN;
      let note = "";
      if (mode === "bretschneider") {
        const sum = toRad(n.sum, ctx.unit);
        const rad =
          (s - n.a) * (s - n.b) * (s - n.c) * (s - n.d) - n.a * n.b * n.c * n.d * Math.pow(Math.cos(sum / 2), 2);
        if (rad < 0) {
          return {
            errors: ["这组数据下不存在这样的四边形（对角和与四边长度不匹配），请检查"],
          };
        }
        S = Math.sqrt(rad);
        note = Math.abs(sum - PI) < 1e-9 ? "对角和为 180°，是圆内接四边形（此时即婆罗摩笈多公式）" : "一般四边形";
      } else {
        const t1 = triFromSides(n.a, n.b, n.f);
        const t2 = triFromSides(n.c, n.d, n.f);
        if (!t1 || !t2) return { errors: ["这条对角线无法把四边形分成两个三角形，请检查数据"] };
        S = triArea(t1) + triArea(t2);
        note = `对角线 AC 把四边形分成两个三角形，面积分别为 ${f(triArea(t1))} 与 ${f(triArea(t2))}`;
      }
      const A1: Vec = pt(0, 0);
      const C1: Vec = pt(n.f, 0);
      const B1 = circleIntersect(A1, n.a, C1, n.b, 1);
      const D1 = circleIntersect(A1, n.d, C1, n.c, -1);
      const figure: Figure =
        B1 && D1
          ? [
              poly([A1, B1, C1, D1], { fill: true }),
              segP(A1, C1, true),
              dimP(B1, C1, `b = ${f(n.b)}`, 1),
              dimP(D1, C1, `c = ${f(n.c)}`, -1),
              dimP(A1, B1, `a = ${f(n.a)}`, -1),
              dimP(A1, D1, `d = ${f(n.d)}`, 1),
              labP(mid(A1, C1), `对角线 = ${f(n.f)}`, [0, 1]),
            ]
          : [
              poly([pt(0, 0), pt(n.a, 0), pt(n.a * 0.9, n.b * 0.8), pt(-n.c * 0.3, n.d * 0.8)], { fill: true }),
              ...edgeLabels(
                [pt(0, 0), pt(n.a, 0), pt(n.a * 0.9, n.b * 0.8), pt(-n.c * 0.3, n.d * 0.8)],
                [`a = ${f(n.a)}`, `b = ${f(n.b)}`, `c = ${f(n.c)}`, `d = ${f(n.d)}`],
              ),
              labP(pt(0, -0.6), "示意图（只标出已知量）", [0, 1]),
            ];
      return {
        rows: [
          row("边 a (AB)", f(n.a)),
          row("边 b (BC)", f(n.b)),
          row("边 c (CD)", f(n.c)),
          row("边 d (DA)", f(n.d)),
          mode === "bretschneider" ? row("对角和 α+γ", g(toRad(n.sum, ctx.unit))) : row("对角线 AC", f(n.f)),
          row("面积 S", f(S)),
          row("周长 P", f(n.a + n.b + n.c + n.d)),
          row("半周长 s", f(s)),
          row("说明", note),
          row("四边形的角和", "四个内角之和恒为 360°"),
        ],
        formulas: [
          { name: "布雷特施奈德公式", expr: "S = √((s−a)(s−b)(s−c)(s−d) − abcd·cos²((α+γ)/2))" },
          { name: "婆罗摩笈多公式（圆内接时）", expr: "S = √((s−a)(s−b)(s−c)(s−d))，即 α+γ = 180°" },
          { name: "对角线拆分法", expr: "S = S△ABC + S△ACD（各用海伦公式）" },
          { name: "内角和", expr: "四边形内角和 = 360°" },
        ],
        figure,
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "cyclicQuad",
    name: "圆内接四边形",
    cat: "plane",
    brief: "四边求面积（婆罗摩笈多）、两条对角线、外接圆半径与四个内角。",
    modes: [
      {
        id: "fourSides",
        label: "四条边（按顺序）",
        fields: [
          { k: "a", label: "边 a (AB)", def: "2", kind: "len" },
          { k: "b", label: "边 b (BC)", def: "3", kind: "len" },
          { k: "c", label: "边 c (CD)", def: "4", kind: "len" },
          { k: "d", label: "边 d (DA)", def: "5", kind: "len" },
        ],
      },
      {
        id: "rect",
        label: "矩形（长 + 宽）",
        fields: [
          { k: "a", label: "长 a", def: "8", kind: "len" },
          { k: "b", label: "宽 b", def: "5", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      let a = NaN;
      let b = NaN;
      let c = NaN;
      let d = NaN;
      if (mode === "fourSides") {
        needPos(errs, n, raw, { a: "边 a (AB)", b: "边 b (BC)", c: "边 c (CD)", d: "边 d (DA)" });
        if (errs.length) return { errors: errs };
        a = n.a;
        b = n.b;
        c = n.c;
        d = n.d;
      } else {
        needPos(errs, n, raw, { a: "长 a", b: "宽 b" });
        if (errs.length) return { errors: errs };
        a = n.a;
        b = n.b;
        c = n.a;
        d = n.b;
      }
      const s = (a + b + c + d) / 2;
      if (!(s - a > 0 && s - b > 0 && s - c > 0 && s - d > 0)) {
        return { errors: ["这四条边构不成四边形（最长边不能大于等于另外三边之和）"] };
      }
      const S = Math.sqrt((s - a) * (s - b) * (s - c) * (s - d));
      const p = Math.sqrt(((a * c + b * d) * (a * b + c * d)) / (a * d + b * c));
      const q = Math.sqrt(((a * c + b * d) * (a * d + b * c)) / (a * b + c * d));
      const R = 0.25 * Math.sqrt(((a * b + c * d) * (a * c + b * d) * (a * d + b * c)) / ((s - a) * (s - b) * (s - c) * (s - d)));
      const A = Math.acos(clamp1((a * a + d * d - b * b - c * c) / (2 * (a * d + b * c))));
      const B = Math.acos(clamp1((a * a + b * b - c * c - d * d) / (2 * (a * b + c * d))));
      const B1 = circleIntersect(pt(0, 0), a, pt(q, 0), b, 1);
      const D1 = circleIntersect(pt(0, 0), d, pt(q, 0), c, -1);
      const cc = B1 ? circumcenter(pt(0, 0), pt(q, 0), B1) : null;
      const figure: Figure =
        B1 && D1
          ? [
              ...(cc ? [circ(cc.c, cc.R, false, true)] : []),
              poly([pt(0, 0), B1, pt(q, 0), D1], { fill: true }),
              segP(pt(0, 0), pt(q, 0), true),
              ...(cc ? [dotP(cc.c), ...(cc.R > 0 ? [labP(cc.c, "O", [-1, -1])] : [])] : []),
              ...edgeLabels([pt(0, 0), B1, pt(q, 0), D1], [`a = ${f(a)}`, `b = ${f(b)}`, `c = ${f(c)}`, `d = ${f(d)}`]),
              labP(pt(q / 2, 0), `BD = ${f(q)}`, [0, 1]),
            ]
          : [poly([pt(0, 0), pt(a, 0), pt(a + b * 0.5, b * 0.8), pt(-c * 0.4, d * 0.8)], { fill: true })];
      return {
        rows: [
          row("边 a (AB)", f(a)),
          row("边 b (BC)", f(b)),
          row("边 c (CD)", f(c)),
          row("边 d (DA)", f(d)),
          row("面积 S（婆罗摩笈多）", f(S)),
          row("周长 P", f(a + b + c + d)),
          row("半周长 s", f(s)),
          row("对角线 AC = p", f(p)),
          row("对角线 BD = q", f(q)),
          row("托勒密定理校验 p·q = ac + bd", `${f(p * q)} = ${f(a * c + b * d)}`),
          row("外接圆半径 R", f(R)),
          row("外接圆直径 2R", f(2 * R)),
          row("外接圆面积", f(PI * R * R)),
          row("角 A", g(A)),
          row("角 B", g(B)),
          row("角 C = 180° − A", g(PI - A)),
          row("角 D = 180° − B", g(PI - B)),
        ],
        formulas: [
          { name: "婆罗摩笈多公式", expr: "S = √((s−a)(s−b)(s−c)(s−d))" },
          { name: "对角线", expr: "p = √((ac+bd)(ab+cd)/(ad+bc))，q = √((ac+bd)(ad+bc)/(ab+cd))" },
          { name: "托勒密定理", expr: "p·q = a·c + b·d" },
          {
            name: "外接圆半径",
            expr: "R = ¼·√((ab+cd)(ac+bd)(ad+bc) / ((s−a)(s−b)(s−c)(s−d)))",
          },
          { name: "对角", expr: "cos A = (a²+d²−b²−c²) / (2(ad+bc))，且 A + C = 180°、B + D = 180°" },
        ],
        figure,
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "composite",
    name: "复合图形",
    cat: "plane",
    brief: "L 形与「矩形 + 半圆」的组合图形：总面积、外轮廓周长与扣掉部分。",
    modes: [
      {
        id: "lShape",
        label: "L 形（外框 + 厚度）",
        fields: [
          { k: "W", label: "外框宽 W", def: "10", kind: "len" },
          { k: "H", label: "外框高 H", def: "8", kind: "len" },
          { k: "t", label: "厚度 t", def: "3", kind: "len" },
        ],
      },
      {
        id: "rectSemi",
        label: "矩形 + 顶部半圆",
        fields: [
          { k: "W", label: "矩形宽 W", def: "8", kind: "len" },
          { k: "H", label: "矩形高 H", def: "5", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      if (mode === "lShape") {
        needPos(errs, n, raw, { W: "外框宽 W", H: "外框高 H", t: "厚度 t" });
        if (errs.length) return { errors: errs };
        if (n.t >= Math.min(n.W, n.H)) return { errors: ["厚度 t 必须小于外框的长和宽"] };
        const S = n.t * (n.W + n.H - n.t);
        const P = 2 * (n.W + n.H);
        return {
          rows: [
            row("外框宽 W", f(n.W)),
            row("外框高 H", f(n.H)),
            row("厚度 t", f(n.t)),
            row("面积 S = t(W+H−t)", f(S)),
            row("外轮廓周长 = 2(W+H)", f(P)),
            row("外接矩形面积", f(n.W * n.H)),
            row("缺角矩形面积", f((n.W - n.t) * (n.H - n.t))),
            row("内拐角周长（折线长）", f((n.W - n.t) + (n.H - n.t))),
          ],
          formulas: [
            { name: "面积", expr: "S = W·H − (W−t)(H−t) = t(W + H − t)" },
            { name: "周长", expr: "P = 2(W + H)（L 形的外轮廓周长与整个外接矩形相同）" },
          ],
          figure: [
            poly([pt(0, 0), pt(n.W, 0), pt(n.W, n.t), pt(n.t, n.t), pt(n.t, n.H), pt(0, n.H)], { fill: true }),
            segP(pt(n.t, n.t), pt(n.W, n.t), true),
            segP(pt(n.t, n.t), pt(n.t, n.H), true),
            dimP(pt(0, 0), pt(n.W, 0), `W = ${f(n.W)}`, -1),
            dimP(pt(0, 0), pt(0, n.H), `H = ${f(n.H)}`, -1),
            dimP(pt(n.W, 0), pt(n.W, n.t), `t = ${f(n.t)}`, 1),
          ],
          primary: row("面积 S", f(S)),
        };
      }
      needPos(errs, n, raw, { W: "矩形宽 W", H: "矩形高 H" });
      if (errs.length) return { errors: errs };
      const r = n.W / 2;
      const S = n.W * n.H + (PI * n.W * n.W) / 8;
      const P = 2 * n.H + n.W + PI * r;
      return {
        rows: [
          row("矩形宽 W", f(n.W)),
          row("矩形高 H", f(n.H)),
          row("半圆半径 r = W/2", f(r)),
          row("矩形面积", f(n.W * n.H)),
          row("半圆面积 πr²/2", f((PI * r * r) / 2)),
          row("总面积 S", f(S)),
          row("外轮廓周长", f(P)),
          row("半圆弧长 πr", f(PI * r)),
          row("形心高度（约）", f((n.W * n.H * (n.H / 2) + (PI * r * r * (n.H + (4 * r) / (3 * PI))) / 2) / S)),
        ],
        formulas: [
          { name: "总面积", expr: "S = W·H + π(W/2)²/2" },
          { name: "外轮廓周长", expr: "P = 2H + W + π(W/2)" },
          { name: "半圆面积", expr: "S半 = πr²/2" },
        ],
        figure: [
          capP(pt(0, n.H), r, 0, PI),
          poly([pt(0, 0), pt(n.W, 0), pt(n.W, n.H), pt(0, n.H)], { fill: true }),
          segP(pt(0, n.H), pt(n.W, n.H)),
          dimP(pt(0, 0), pt(n.W, 0), `W = ${f(n.W)}`, -1),
          dimP(pt(0, 0), pt(0, n.H), `H = ${f(n.H)}`, -1),
          labP(pt(0, n.H + r * 0.55), `r = ${f(r)}`, [-1, 0]),
        ],
        primary: row("总面积 S", f(S)),
      };
    },
  },
  // ───────────────────────── 立体图形：球族 ─────────────────────────
  {
    id: "sphere",
    name: "球",
    cat: "solid",
    brief: "半径、直径、体积、表面积任知其一，求出其余全部量。",
    modes: [
      { id: "r", label: "已知半径 r", fields: [{ k: "r", label: "半径 r", def: "3", kind: "len" }] },
      { id: "d", label: "已知直径 d", fields: [{ k: "d", label: "直径 d", def: "6", kind: "len" }] },
      { id: "V", label: "已知体积 V", fields: [{ k: "V", label: "体积 V", def: "113.0973", kind: "len" }] },
      { id: "S", label: "已知表面积 S", fields: [{ k: "S", label: "表面积 S", def: "113.0973", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "r" ? { r: "半径 r" } : mode === "d" ? { d: "直径 d" } : mode === "V" ? { V: "体积 V" } : { S: "表面积 S" });
      if (errs.length) return { errors: errs };
      const r =
        mode === "r"
          ? n.r
          : mode === "d"
            ? n.d / 2
            : mode === "V"
              ? Math.cbrt((3 * n.V) / (4 * PI))
              : Math.sqrt(n.S / (4 * PI));
      const V = (4 / 3) * PI * r * r * r;
      const S = 4 * PI * r * r;
      return {
        rows: [
          row("半径 r", f(r)),
          row("直径 d", f(2 * r)),
          row("体积 V = 4/3·πr³", f(V)),
          row("表面积 S = 4πr²", f(S)),
          row("大圆周长 2πr", f(2 * PI * r)),
          row("大圆面积 πr²", f(PI * r * r)),
          row("半球体积 2/3·πr³", f((2 / 3) * PI * r * r * r)),
          row("半球曲面面积 2πr²", f(2 * PI * r * r)),
          row("体积 ÷ 表面积 = r/3", f(r / 3)),
          row("球面上两点最大距离", f(2 * r)),
          row("内接正方体棱长 2r/√3", f((2 * r) / Math.sqrt(3))),
        ],
        formulas: [
          { name: "体积", expr: "V = 4/3 · πr³" },
          { name: "表面积", expr: "S = 4πr²" },
          { name: "由体积反求半径", expr: "r = ∛(3V / 4π)" },
          { name: "由表面积反求半径", expr: "r = √(S / 4π)" },
          { name: "大圆", expr: "C = 2πr，S大圆 = πr²" },
        ],
        figure: [
          ...spherePrims(r),
          labP(pt(r / 2, 0), `r = ${f(r)}`, [0, 1]),
          labP(pt(-r * 0.72, r * 0.62), `V = ${f(V)}`, [-1, 1]),
          labP(pt(r * 0.72, -r * 0.62), `S = ${f(S)}`, [1, -1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "hemisphere",
    name: "半球",
    cat: "solid",
    brief: "半球的体积、曲面面积与含底面的全面积。",
    modes: [
      { id: "r", label: "已知半径 r", fields: [{ k: "r", label: "半径 r", def: "4", kind: "len" }] },
      { id: "V", label: "已知体积 V", fields: [{ k: "V", label: "体积 V", def: "134.0413", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "r" ? { r: "半径 r" } : { V: "体积 V" });
      if (errs.length) return { errors: errs };
      const r = mode === "r" ? n.r : Math.cbrt((3 * n.V) / (2 * PI));
      const V = (2 / 3) * PI * r * r * r;
      const curve = 2 * PI * r * r;
      const base = PI * r * r;
      return {
        rows: [
          row("半径 r", f(r)),
          row("直径 d", f(2 * r)),
          row("体积 V = 2/3·πr³", f(V)),
          row("曲面面积（球冠）2πr²", f(curve)),
          row("底面面积 πr²", f(base)),
          row("全面积 3πr²", f(curve + base)),
          row("底面周长 2πr", f(2 * PI * r)),
          row("大圆面积 πr²", f(base)),
          row("完整球的体积", f((4 / 3) * PI * r * r * r)),
        ],
        formulas: [
          { name: "体积", expr: "V = 2/3 · πr³（等于同半径球的一半）" },
          { name: "曲面面积", expr: "S曲 = 2πr²" },
          { name: "底面面积", expr: "S底 = πr²" },
          { name: "全面积", expr: "S全 = 3πr²" },
        ],
        figure: [
          capP(pt(0, 0), r, 0, PI),
          arcP(pt(0, 0), r, 0, PI),
          ellipseP(pt(0, 0), r, r * 0.3, true),
          segP(pt(0, 0), pt(r, 0)),
          dotP(pt(0, 0)),
          labP(pt(r / 2, 0), `r = ${f(r)}`, [0, 1]),
          labP(pt(0, r * 1.1), `V = ${f(V)}`, [0, 1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "sphericalCap",
    name: "球缺（含球冠）",
    cat: "solid",
    brief: "球被一个平面截下的部分：由球半径、球缺高或底面半径求体积与球冠面积。",
    modes: [
      {
        id: "rH",
        label: "球半径 + 球缺高",
        fields: [
          { k: "R", label: "球半径 R", def: "5", kind: "len" },
          { k: "h", label: "球缺高 h", def: "2", kind: "len" },
        ],
      },
      {
        id: "aH",
        label: "底面半径 + 球缺高",
        fields: [
          { k: "a", label: "底面半径 a", def: "4", kind: "len" },
          { k: "h", label: "球缺高 h", def: "2", kind: "len" },
        ],
      },
      {
        id: "Ra",
        label: "球半径 + 底面半径",
        fields: [
          { k: "R", label: "球半径 R", def: "5", kind: "len" },
          { k: "a", label: "底面半径 a", def: "4", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      let R = NaN;
      let h = NaN;
      let a = NaN;
      if (mode === "rH") {
        needPos(errs, n, raw, { R: "球半径 R", h: "球缺高 h" });
        if (errs.length) return { errors: errs };
        if (n.h > 2 * n.R) return { errors: ["球缺高不能大于直径 2R"] };
        R = n.R;
        h = n.h;
        a = Math.sqrt(Math.max(0, h * (2 * R - h)));
      } else if (mode === "aH") {
        needPos(errs, n, raw, { a: "底面半径 a", h: "球缺高 h" });
        if (errs.length) return { errors: errs };
        R = (n.a * n.a + n.h * n.h) / (2 * n.h);
        h = n.h;
        a = n.a;
      } else {
        needPos(errs, n, raw, { R: "球半径 R", a: "底面半径 a" });
        if (errs.length) return { errors: errs };
        if (n.a > n.R) return { errors: ["底面半径不能大于球半径 R"] };
        R = n.R;
        a = n.a;
        h = R - Math.sqrt(Math.max(0, R * R - a * a));
      }
      const V = (PI * h * h * (3 * R - h)) / 3;
      const cap = 2 * PI * R * h;
      const base = PI * a * a;
      const ball = (4 / 3) * PI * R * R * R;
      return {
        rows: [
          row("球半径 R", f(R)),
          row("球缺高 h", f(h)),
          row("底面半径 a", f(a)),
          row("底面直径 2a", f(2 * a)),
          row("球缺体积 V = πh²(3R−h)/3", f(V)),
          row("球冠面积（曲面）2πRh", f(cap)),
          row("底面面积 πa²", f(base)),
          row("球缺全面积", f(cap + base)),
          row("整球体积", f(ball)),
          row("剩余部分体积", f(ball - V)),
          row("球缺体积占整球比例", f(V / ball)),
        ],
        formulas: [
          { name: "球缺体积", expr: "V = πh²(3R − h) / 3" },
          { name: "球冠面积", expr: "S冠 = 2πRh" },
          { name: "底面半径", expr: "a² = h(2R − h)" },
          { name: "由底面半径与高求球半径", expr: "R = (a² + h²) / (2h)" },
          { name: "球缺全面积", expr: "S全 = 2πRh + πa²" },
        ],
        figure: (() => {
          const chordY = R - h;
          const ang = Math.asin(clamp1(a / R));
          const a0 = PI / 2 - ang;
          const a1 = PI / 2 + ang;
          return [
            circ(pt(0, 0), R, false, true),
            capP(pt(0, 0), R, a0, a1),
            arcP(pt(0, 0), R, a0, a1),
            segP(pt(-a, chordY), pt(a, chordY)),
            segP(pt(0, 0), pt(a, chordY)),
            dotP(pt(0, 0)),
            labP(pt(a / 2, chordY), `a = ${f(a)}`, [-1, -1]),
            dimP(pt(0, R), pt(0, chordY), `h = ${f(h)}`, 1),
            labP(pt(0, 0), "O", [-1, -1]),
          ];
        })(),
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "sphericalSector",
    name: "球扇形",
    cat: "solid",
    brief: "球面上一块球冠与球心围成的几何体：由球半径与球缺高求体积与表面积。",
    modes: [
      {
        id: "rH",
        label: "球半径 + 球缺高",
        fields: [
          { k: "R", label: "球半径 R", def: "5", kind: "len" },
          { k: "h", label: "球缺高 h", def: "2", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, { R: "球半径 R", h: "球缺高 h" });
      if (errs.length) return { errors: errs };
      if (n.h > 2 * n.R) return { errors: ["球缺高不能大于直径 2R"] };
      const R = n.R;
      const h = n.h;
      const a = Math.sqrt(Math.max(0, h * (2 * R - h)));
      const V = (2 / 3) * PI * R * R * h;
      const curve = 2 * PI * R * h;
      const base = PI * a * a;
      return {
        rows: [
          row("球半径 R", f(R)),
          row("球缺高 h", f(h)),
          row("底面半径 a", f(a)),
          row("体积 V = 2/3·πR²h", f(V)),
          row("球冠曲面面积 2πRh", f(curve)),
          row("底面面积 πa²", f(base)),
          row("表面积（曲面 + 底面）", f(curve + base)),
          row("整球体积", f((4 / 3) * PI * R * R * R)),
          row("体积占整球比例", f(((2 / 3) * PI * R * R * h) / ((4 / 3) * PI * R * R * R))),
        ],
        formulas: [
          { name: "球扇形体积", expr: "V = 2/3 · πR²h（h 为对应球缺的高）" },
          { name: "球冠面积", expr: "S冠 = 2πRh" },
          { name: "底面半径", expr: "a² = h(2R − h)" },
          { name: "表面积", expr: "S = 2πRh + πa²" },
        ],
        figure: (() => {
          const chordY = R - h;
          const ang = Math.asin(clamp1(a / R));
          const a0 = PI / 2 - ang;
          const a1 = PI / 2 + ang;
          return [
            capP(pt(0, 0), R, a0, a1),
            arcP(pt(0, 0), R, a0, a1),
            segP(pt(0, 0), pt(a, chordY)),
            segP(pt(0, 0), pt(-a, chordY)),
            segP(pt(-a, chordY), pt(a, chordY), true),
            dotP(pt(0, 0)),
            labP(pt(a / 2, chordY / 2), `R = ${f(R)}`, [1, -1]),
            labP(pt(0, R * 1.06), `h = ${f(h)}`, [0, 1]),
          ];
        })(),
        primary: row("体积 V", f(V)),
      };
    },
  },
  // ─────────────────── 立体图形：柱、锥、台、体 ───────────────────
  {
    id: "cylinder",
    name: "圆柱",
    cat: "solid",
    brief: "由半径加高（或半径加体积）求体积、侧面积、全面积与轴截面数据。",
    modes: [
      {
        id: "rH",
        label: "半径 + 高",
        fields: [
          { k: "r", label: "底面半径 r", def: "3", kind: "len" },
          { k: "h", label: "高 h", def: "5", kind: "len" },
        ],
      },
      {
        id: "rV",
        label: "半径 + 体积",
        fields: [
          { k: "r", label: "底面半径 r", def: "3", kind: "len" },
          { k: "V", label: "体积 V", def: "141.3717", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, { r: "底面半径 r" });
      needPos(errs, n, raw, mode === "rH" ? { h: "高 h" } : { V: "体积 V" });
      if (errs.length) return { errors: errs };
      const r = n.r;
      const h = mode === "rH" ? n.h : n.V / (PI * r * r);
      const base = PI * r * r;
      const lateral = 2 * PI * r * h;
      const V = base * h;
      return {
        rows: [
          row("底面半径 r", f(r)),
          row("底面直径 d", f(2 * r)),
          row("高 h", f(h)),
          row("底面积 πr²", f(base)),
          row("底面周长 2πr", f(2 * PI * r)),
          row("侧面积 2πrh", f(lateral)),
          row("全面积 2πr(r+h)", f(lateral + 2 * base)),
          row("体积 V = πr²h", f(V)),
          row("轴截面面积 2rh", f(2 * r * h)),
          row("轴截面对角线 √((2r)²+h²)", f(Math.hypot(2 * r, h))),
          row("体积 ÷ 侧面积", f(V / lateral)),
        ],
        formulas: [
          { name: "体积", expr: "V = πr²h" },
          { name: "侧面积", expr: "S侧 = 2πrh（侧面展开是矩形）" },
          { name: "全面积", expr: "S全 = 2πr² + 2πrh = 2πr(r + h)" },
          { name: "轴截面", expr: "轴截面是 2r × h 的矩形，对角线 = √((2r)² + h²)" },
        ],
        figure: [
          ...tubePrims(r, r, h),
          dimP(pt(r, 0), pt(r, h), `h = ${f(h)}`, 1),
          labP(pt(r / 2, 0), `r = ${f(r)}`, [0, -1]),
          labP(pt(0, h), `S全 = ${f(lateral + 2 * base)}`, [0, 1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "hollowCylinder",
    name: "空心圆柱（管）",
    cat: "solid",
    brief: "管状几何体：由外半径、内半径与高求体积、内外表面积与端面面积。",
    modes: [
      {
        id: "Rrh",
        label: "外半径 + 内半径 + 高",
        fields: [
          { k: "R", label: "外半径 R", def: "5", kind: "len" },
          { k: "r", label: "内半径 r", def: "3", kind: "len" },
          { k: "h", label: "高 h", def: "10", kind: "len" },
        ],
      },
      {
        id: "Ddh",
        label: "外直径 + 内直径 + 高",
        fields: [
          { k: "D", label: "外直径 D", def: "10", kind: "len" },
          { k: "d", label: "内直径 d", def: "6", kind: "len" },
          { k: "h", label: "高 h", def: "10", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      let R = NaN;
      let r = NaN;
      if (mode === "Rrh") {
        needPos(errs, n, raw, { R: "外半径 R", r: "内半径 r", h: "高 h" });
        R = n.R;
        r = n.r;
      } else {
        needPos(errs, n, raw, { D: "外直径 D", d: "内直径 d", h: "高 h" });
        R = n.D / 2;
        r = n.d / 2;
      }
      if (errs.length) return { errors: errs };
      if (!(R > r)) return { errors: ["外半径必须大于内半径，请检查两个数据"] };
      const h = n.h;
      const wall = R - r;
      const V = PI * (R * R - r * r) * h;
      const outS = 2 * PI * R * h;
      const inS = 2 * PI * r * h;
      const ends = PI * (R * R - r * r);
      return {
        rows: [
          row("外半径 R", f(R)),
          row("内半径 r", f(r)),
          row("壁厚 R − r", f(wall)),
          row("高 h", f(h)),
          row("体积 V = π(R²−r²)h", f(V)),
          row("外侧面积 2πRh", f(outS)),
          row("内侧面积 2πrh", f(inS)),
          row("单个端面面积 π(R²−r²)", f(ends)),
          row("两个端面面积和", f(2 * ends)),
          row("全面积", f(outS + inS + 2 * ends)),
          row("外底面积 πR²", f(PI * R * R)),
          row("内底面积 πr²", f(PI * r * r)),
          row("材料体积（同体积）", f(V)),
        ],
        formulas: [
          { name: "体积（材料体积）", expr: "V = π(R² − r²)·h" },
          { name: "外侧面积", expr: "S外 = 2πRh" },
          { name: "内侧面积", expr: "S内 = 2πrh" },
          { name: "端面（圆环）面积", expr: "S端 = π(R² − r²)，共两个" },
          { name: "全面积", expr: "S全 = 2πRh + 2πrh + 2π(R² − r²)" },
        ],
        figure: [
          ...tubePrims(R, R, h),
          ellipseP(pt(0, h), r, r * 0.3, false, true),
          ellipseP(pt(0, 0), r, r * 0.3, false, true),
          dimP(pt(R, 0), pt(R, h), `h = ${f(h)}`, 1),
          labP(pt(R / 2, R * 0.3), `R = ${f(R)}`, [0, -1]),
          labP(pt(0, -r * 0.3), `r = ${f(r)}`, [0, -1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "cone",
    name: "圆锥",
    cat: "solid",
    brief: "由半径加高（或半径加母线）求体积、侧面积、全面积与侧面展开扇形的圆心角。",
    modes: [
      {
        id: "rH",
        label: "半径 + 高",
        fields: [
          { k: "r", label: "底面半径 r", def: "3", kind: "len" },
          { k: "h", label: "高 h", def: "4", kind: "len" },
        ],
      },
      {
        id: "rl",
        label: "半径 + 母线",
        fields: [
          { k: "r", label: "底面半径 r", def: "3", kind: "len" },
          { k: "l", label: "母线 l", def: "5", kind: "len" },
        ],
      },
      {
        id: "rTheta",
        label: "半径 + 半顶角",
        fields: [
          { k: "r", label: "底面半径 r", def: "3", kind: "len" },
          { k: "t", label: "半顶角 α", def: "36.8699", kind: "ang" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, { r: "底面半径 r" });
      let h = NaN;
      let l = NaN;
      if (mode === "rH") {
        needPos(errs, n, raw, { h: "高 h" });
        if (errs.length) return { errors: errs };
        h = n.h;
        l = Math.hypot(n.r, h);
      } else if (mode === "rl") {
        needPos(errs, n, raw, { l: "母线 l" });
        if (errs.length) return { errors: errs };
        if (n.l <= n.r) return { errors: ["母线必须大于底面半径"] };
        l = n.l;
        h = Math.sqrt(l * l - n.r * n.r);
      } else {
        needAngle(errs, n, raw, { t: "半顶角 α" }, ctx, PI / 2);
        if (errs.length) return { errors: errs };
        const alpha = toRad(n.t, ctx.unit);
        h = n.r / Math.tan(alpha);
        l = n.r / Math.sin(alpha);
      }
      const r = n.r;
      const base = PI * r * r;
      const lateral = PI * r * l;
      const V = (base * h) / 3;
      const sweepDeg = (360 * r) / l;
      return {
        rows: [
          row("底面半径 r", f(r)),
          row("底面直径 d", f(2 * r)),
          row("高 h", f(h)),
          row("母线 l = √(r²+h²)", f(l)),
          row("底面积 πr²", f(base)),
          row("底面周长 2πr", f(2 * PI * r)),
          row("侧面积 πrl", f(lateral)),
          row("全面积 πr(r+l)", f(lateral + base)),
          row("体积 V = πr²h/3", f(V)),
          row("侧面展开扇形圆心角", `${f(sweepDeg)}°（= 360°·r/l）`),
          row("半顶角 α = atan(r/h)", g(Math.atan2(r, h))),
          row("顶角 2α", g(2 * Math.atan2(r, h))),
          row("轴截面面积 rh", f(r * h)),
        ],
        formulas: [
          { name: "母线", expr: "l = √(r² + h²)" },
          { name: "体积", expr: "V = ⅓·πr²h" },
          { name: "侧面积", expr: "S侧 = πrl" },
          { name: "全面积", expr: "S全 = πr² + πrl = πr(r + l)" },
          { name: "侧面展开", expr: "展开成半径 l、圆心角 θ = 360°·r/l 的扇形" },
        ],
        figure: [
          ...tubePrims(r, 0, h),
          dimP(pt(0, 0), pt(0, h), `h = ${f(h)}`, 1),
          labP(pt(r / 2, 0), `r = ${f(r)}`, [0, -1]),
          labP(mid(pt(r, 0), pt(0, h)), `l = ${f(l)}`, [1, 1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "frustum",
    name: "圆台",
    cat: "solid",
    brief: "由上下底半径与高求体积、母线、侧面积与全面积。",
    modes: [
      {
        id: "Rrh",
        label: "上下底半径 + 高",
        fields: [
          { k: "R", label: "下底半径 R", def: "5", kind: "len" },
          { k: "r", label: "上底半径 r", def: "2", kind: "len" },
          { k: "h", label: "高 h", def: "4", kind: "len" },
        ],
      },
      {
        id: "Rrl",
        label: "上下底半径 + 母线",
        fields: [
          { k: "R", label: "下底半径 R", def: "5", kind: "len" },
          { k: "r", label: "上底半径 r", def: "2", kind: "len" },
          { k: "l", label: "母线 l", def: "5", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, { R: "下底半径 R", r: "上底半径 r" });
      if (mode === "Rrh") needPos(errs, n, raw, { h: "高 h" });
      else needPos(errs, n, raw, { l: "母线 l" });
      if (errs.length) return { errors: errs };
      if (n.R <= n.r) return { errors: ["下底半径需要大于上底半径（把大的填在下底）"] };
      const R = n.R;
      const r = n.r;
      let h = NaN;
      let l = NaN;
      if (mode === "Rrh") {
        h = n.h;
        l = Math.hypot(R - r, h);
      } else {
        l = n.l;
        if (l <= R - r) return { errors: ["母线太短，无法构成圆台（需要 l > R − r）"] };
        h = Math.sqrt(l * l - (R - r) * (R - r));
      }
      const S1 = PI * R * R;
      const S2 = PI * r * r;
      const lateral = PI * (R + r) * l;
      const V = (PI * h * (R * R + R * r + r * r)) / 3;
      return {
        rows: [
          row("下底半径 R", f(R)),
          row("上底半径 r", f(r)),
          row("高 h", f(h)),
          row("母线 l = √((R−r)²+h²)", f(l)),
          row("下底面积 πR²", f(S1)),
          row("上底面积 πr²", f(S2)),
          row("侧面积 π(R+r)l", f(lateral)),
          row("全面积", f(lateral + S1 + S2)),
          row("体积 V = πh(R²+Rr+r²)/3", f(V)),
          row("半顶角 atan(h/(R−r))", g(Math.atan2(h, R - r))),
          row("上下底半径差", f(R - r)),
          row("补成圆锥后的母线长", f((l * R) / (R - r))),
        ],
        formulas: [
          { name: "母线", expr: "l = √((R − r)² + h²)" },
          { name: "体积", expr: "V = ⅓·πh(R² + Rr + r²)" },
          { name: "侧面积", expr: "S侧 = π(R + r)·l" },
          { name: "全面积", expr: "S全 = πR² + πr² + π(R+r)l" },
        ],
        figure: [
          ...tubePrims(R, r, h),
          dimP(pt(R, 0), pt(R, h), `h = ${f(h)}`, 1),
          labP(pt(R / 2, 0), `R = ${f(R)}`, [0, -1]),
          labP(pt(r / 2, h), `r = ${f(r)}`, [0, 1]),
          labP(mid(pt(R, 0), pt(r, h)), `l = ${f(l)}`, [1, 1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "cube",
    name: "正方体",
    cat: "solid",
    brief: "由棱长、体积或体对角线求表面积、内外接球与各种对角线。",
    modes: [
      { id: "a", label: "已知棱长 a", fields: [{ k: "a", label: "棱长 a", def: "4", kind: "len" }] },
      { id: "V", label: "已知体积 V", fields: [{ k: "V", label: "体积 V", def: "64", kind: "len" }] },
      { id: "d", label: "已知体对角线 d", fields: [{ k: "d", label: "体对角线 d", def: "6.9282", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "a" ? { a: "棱长 a" } : mode === "V" ? { V: "体积 V" } : { d: "体对角线 d" });
      if (errs.length) return { errors: errs };
      const a = mode === "a" ? n.a : mode === "V" ? Math.cbrt(n.V) : n.d / Math.sqrt(3);
      const V = a * a * a;
      const S = 6 * a * a;
      const face = a * Math.SQRT2;
      const space = a * Math.sqrt(3);
      const rIn = a / 2;
      const rOut = space / 2;
      return {
        rows: [
          row("棱长 a", f(a)),
          row("体积 V = a³", f(V)),
          row("表面积 S = 6a²", f(S)),
          row("棱长和 12a", f(12 * a)),
          row("面对角线 a√2", f(face)),
          row("体对角线 a√3", f(space)),
          row("内切球半径 r = a/2", f(rIn)),
          row("内切球体积 4/3·πr³", f((4 / 3) * PI * rIn * rIn * rIn)),
          row("外接球半径 R = √3a/2", f(rOut)),
          row("外接球体积", f((4 / 3) * PI * rOut * rOut * rOut)),
          row("外接球表面积", f(4 * PI * rOut * rOut)),
          row("底面积 a²", f(a * a)),
          row("体积 ÷ 表面积", f(V / S)),
          row("面对角线与棱的夹角", `${f(45)}°`),
        ],
        formulas: [
          { name: "体积", expr: "V = a³" },
          { name: "表面积", expr: "S = 6a²" },
          { name: "面对角线", expr: "√2·a" },
          { name: "体对角线", expr: "√3·a" },
          { name: "内切球", expr: "r = a/2（球心即体心，与六个面相切）" },
          { name: "外接球", expr: "R = √3·a/2（球心即体心，过八个顶点）" },
        ],
        figure: [
          ...boxPrims(a, a, a),
          labP(pt(a / 2, 0), `a = ${f(a)}`, [0, -1]),
          labP(pt(0, a / 2), `a = ${f(a)}`, [-1, 0]),
          labP(pt(a * 0.5, a * 0.5), `V = ${f(V)}`, [1, 1]),
          segP(pt(a, a), pt(a + 0.45 * a, a + 0.34 * a)),
          labP(pt(a + 0.45 * a, a + 0.34 * a), `体对角线 = ${f(space)}`, [1, 0]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "cuboid",
    name: "长方体",
    cat: "solid",
    brief: "由长宽高求体积、表面积、体对角线、外接球与各面对角线。",
    modes: [
      {
        id: "abc",
        label: "长 + 宽 + 高",
        fields: [
          { k: "a", label: "长 a", def: "5", kind: "len" },
          { k: "b", label: "宽 b", def: "4", kind: "len" },
          { k: "c", label: "高 c", def: "3", kind: "len" },
        ],
      },
      {
        id: "abV",
        label: "长 + 宽 + 体积",
        fields: [
          { k: "a", label: "长 a", def: "5", kind: "len" },
          { k: "b", label: "宽 b", def: "4", kind: "len" },
          { k: "V", label: "体积 V", def: "60", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needPos(errs, n, raw, { a: "长 a", b: "宽 b" });
      if (mode === "abc") needPos(errs, n, raw, { c: "高 c" });
      else needPos(errs, n, raw, { V: "体积 V" });
      if (errs.length) return { errors: errs };
      const a = n.a;
      const b = n.b;
      const c = mode === "abc" ? n.c : n.V / (a * b);
      const V = a * b * c;
      const S = 2 * (a * b + b * c + a * c);
      const diag = Math.sqrt(a * a + b * b + c * c);
      return {
        rows: [
          row("长 a", f(a)),
          row("宽 b", f(b)),
          row("高 c", f(c)),
          row("体积 V = abc", f(V)),
          row("表面积 S = 2(ab+bc+ca)", f(S)),
          row("棱长和 4(a+b+c)", f(4 * (a + b + c))),
          row("体对角线 √(a²+b²+c²)", f(diag)),
          row("外接球半径 R = 对角线/2", f(diag / 2)),
          row("外接球体积", f((4 / 3) * PI * Math.pow(diag / 2, 3))),
          row("底面（长×宽）面积", f(a * b)),
          row("底面对角线", f(Math.hypot(a, b))),
          row("前面对角线（长×高）", f(Math.hypot(a, c))),
          row("侧面对角线（宽×高）", f(Math.hypot(b, c))),
          row("三个面的面积", `${f(a * b)} / ${f(b * c)} / ${f(a * c)}`),
        ],
        formulas: [
          { name: "体积", expr: "V = a·b·c" },
          { name: "表面积", expr: "S = 2(ab + bc + ca)" },
          { name: "体对角线（三维勾股定理）", expr: "d = √(a² + b² + c²)" },
          { name: "外接球", expr: "R = d / 2，S球 = 4πR²" },
        ],
        figure: [
          ...boxPrims(a, c, b),
          labP(pt(a / 2, 0), `a = ${f(a)}`, [0, -1]),
          labP(pt(a + 0.45 * b, a * 0.5), `宽 = ${f(b)}`, [1, -1]),
          labP(pt(-0.02 * a, c / 2), `c = ${f(c)}`, [-1, 0]),
          labP(pt(a * 0.42, c * 0.5), `V = ${f(V)}`, [1, 1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "prism",
    name: "棱柱",
    cat: "solid",
    brief: "正 n 棱柱或一般棱柱：由底面积与高求体积、侧面积与全面积。",
    modes: [
      {
        id: "regular",
        label: "正 n 棱柱：边数 + 底边 + 高",
        fields: [
          { k: "n", label: "底面边数 n", def: "6", kind: "int" },
          { k: "a", label: "底面边长 a", def: "3", kind: "len" },
          { k: "h", label: "高 h（侧棱长）", def: "8", kind: "len" },
        ],
      },
      {
        id: "area",
        label: "一般棱柱：底面积 + 底面周长 + 高",
        fields: [
          { k: "S", label: "底面积 S", def: "30", kind: "len" },
          { k: "P", label: "底面周长 P", def: "20", kind: "len" },
          { k: "h", label: "高 h", def: "8", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      if (mode === "regular") {
        needPos(errs, n, raw, { n: "底面边数 n", a: "底面边长 a", h: "高 h（侧棱长）" });
        if (Number.isFinite(n.n) && (n.n < 3 || Math.abs(n.n - Math.round(n.n)) > 1e-9)) {
          errs.push("「底面边数 n」需要是不小于 3 的整数");
        }
        if (errs.length) return { errors: errs };
        const k = Math.round(n.n);
        const base = (k * n.a * n.a) / (4 * Math.tan(PI / k));
        const P = k * n.a;
        const lateral = P * n.h;
        const V = base * n.h;
        const R = n.a / (2 * Math.sin(PI / k));
        const apothem = n.a / (2 * Math.tan(PI / k));
        return {
          rows: [
            row("底面边数 n", String(k)),
            row("底面边长 a", f(n.a)),
            row("高 h（侧棱）", f(n.h)),
            row("底面积", f(base)),
            row("底面周长", f(P)),
            row("侧面积 = 底面周长 × 高", f(lateral)),
            row("全面积 = 2×底面积 + 侧面积", f(2 * base + lateral)),
            row("体积 V = 底面积 × 高", f(V)),
            row("底面外接圆半径", f(R)),
            row("底面边心距", f(apothem)),
            row("每条侧棱长", f(n.h)),
            row("底面每个内角", g(((k - 2) * PI) / k)),
          ],
          formulas: [
            { name: "体积", expr: "V = S底 · h" },
            { name: "侧面积", expr: "S侧 = 底面周长 × h（侧面展开是矩形）" },
            { name: "全面积", expr: "S全 = 2·S底 + S侧" },
            { name: "正 n 边形底面积", expr: "S底 = n·a² / (4·tan(π/n))" },
          ],
          figure: [
            ...prismPrims(k, R, n.h),
            dimP(pt(0, 0), pt(0, n.h), `h = ${f(n.h)}`, 1),
            labP(pt(R * 0.7, 0), `a = ${f(n.a)}`, [1, -1]),
            labP(pt(0, n.h * 0.55), `V = ${f(V)}`, [0, 1]),
          ],
          primary: row("体积 V", f(V)),
        };
      }
      needPos(errs, n, raw, { S: "底面积 S", P: "底面周长 P", h: "高 h" });
      if (errs.length) return { errors: errs };
      const lateral = n.P * n.h;
      const V = n.S * n.h;
      return {
        rows: [
          row("底面积 S", f(n.S)),
          row("底面周长 P", f(n.P)),
          row("高 h", f(n.h)),
          row("体积 V = S·h", f(V)),
          row("侧面积 = P·h", f(lateral)),
          row("全面积 = 2S + Ph", f(2 * n.S + lateral)),
          row("底面平均边长（近似）", f(n.P / 4)),
        ],
        formulas: [
          { name: "体积", expr: "V = S底 × 高" },
          { name: "侧面积", expr: "S侧 = 底面周长 × 高" },
          { name: "全面积", expr: "S全 = 2S底 + S侧" },
        ],
        figure: [
          ...boxPrims(6, 4, 3),
          labP(pt(3, 0), `底面积 = ${f(n.S)}`, [0, -1]),
          labP(pt(0, 2), `h = ${f(n.h)}`, [-1, 0]),
          labP(pt(3, 2), `V = ${f(V)}`, [1, 1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "pyramid",
    name: "棱锥",
    cat: "solid",
    brief: "正 n 棱锥或一般棱锥：由底面积与高求体积、侧面积（含斜高）与全面积。",
    modes: [
      {
        id: "regular",
        label: "正 n 棱锥：边数 + 底边 + 高",
        fields: [
          { k: "n", label: "底面边数 n", def: "4", kind: "int" },
          { k: "a", label: "底面边长 a", def: "4", kind: "len" },
          { k: "h", label: "高 h", def: "6", kind: "len" },
        ],
      },
      {
        id: "area",
        label: "一般棱锥：底面积 + 底面周长 + 高",
        fields: [
          { k: "S", label: "底面积 S", def: "16", kind: "len" },
          { k: "P", label: "底面周长 P", def: "16", kind: "len" },
          { k: "h", label: "高 h", def: "6", kind: "len" },
        ],
      },
      {
        id: "slant",
        label: "正 n 棱锥：底边 + 斜高",
        fields: [
          { k: "n", label: "底面边数 n", def: "4", kind: "int" },
          { k: "a", label: "底面边长 a", def: "4", kind: "len" },
          { k: "l", label: "斜高 l", def: "6.3246", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      if (mode === "area") {
        needPos(errs, n, raw, { S: "底面积 S", P: "底面周长 P", h: "高 h" });
        if (errs.length) return { errors: errs };
        const V = (n.S * n.h) / 3;
        return {
          rows: [
            row("底面积 S", f(n.S)),
            row("底面周长 P", f(n.P)),
            row("高 h", f(n.h)),
            row("体积 V = S·h/3", f(V)),
            row("提示", "侧面积还需要斜高（或每条侧棱与高的关系）"),
          ],
          formulas: [{ name: "体积", expr: "V = ⅓ · S底 · h" }],
          figure: [
            ...pyramidPrims(4, 4, n.h),
            labP(pt(0, 2.4), `底面积 = ${f(n.S)}`, [0, -1]),
            labP(pt(0, n.h * 0.6), `h = ${f(n.h)}`, [1, 0]),
            labP(pt(0, n.h), `V = ${f(V)}`, [0, 1]),
          ],
          primary: row("体积 V", f(V)),
        };
      }
      needPos(errs, n, raw, { n: "底面边数 n", a: "底面边长 a" });
      if (Number.isFinite(n.n) && (n.n < 3 || Math.abs(n.n - Math.round(n.n)) > 1e-9)) {
        errs.push("「底面边数 n」需要是不小于 3 的整数");
      }
      if (mode === "regular") needPos(errs, n, raw, { h: "高 h" });
      else needPos(errs, n, raw, { l: "斜高 l" });
      if (errs.length) return { errors: errs };
      const k = Math.round(n.n);
      const base = (k * n.a * n.a) / (4 * Math.tan(PI / k));
      const P = k * n.a;
      const apothem = n.a / (2 * Math.tan(PI / k));
      const R = n.a / (2 * Math.sin(PI / k));
      let h = NaN;
      let slant = NaN;
      if (mode === "regular") {
        h = n.h;
        slant = Math.hypot(h, apothem);
      } else {
        slant = n.l;
        if (slant <= apothem) return { errors: ["斜高必须大于底面的边心距"] };
        h = Math.sqrt(slant * slant - apothem * apothem);
      }
      const lateral = (P * slant) / 2;
      const V = (base * h) / 3;
      const edge = Math.hypot(h, R);
      return {
        rows: [
          row("底面边数 n", String(k)),
          row("底面边长 a", f(n.a)),
          row("高 h", f(h)),
          row("斜高 l = √(h²+r²)", f(slant)),
          row("侧棱长 = √(h²+R²)", f(edge)),
          row("底面积", f(base)),
          row("底面周长", f(P)),
          row("底面外接圆半径 R", f(R)),
          row("底面边心距 r", f(apothem)),
          row("侧面积 = ½·P·l", f(lateral)),
          row("全面积", f(base + lateral)),
          row("体积 V = 底面积×h/3", f(V)),
          row("侧面等腰三角形的高 = 斜高", f(slant)),
          row("侧面顶角（近似）", g(2 * Math.atan2(n.a / 2, slant))),
        ],
        formulas: [
          { name: "体积", expr: "V = ⅓ · S底 · h" },
          { name: "斜高", expr: "l = √(h² + r²)，r 为底面边心距" },
          { name: "侧棱长", expr: "侧棱 = √(h² + R²)，R 为底面外接圆半径" },
          { name: "侧面积", expr: "S侧 = ½ · 底面周长 · 斜高" },
          { name: "全面积", expr: "S全 = S底 + S侧" },
        ],
        figure: [
          ...pyramidPrims(k, R, h),
          dimP(pt(0, 0), pt(0, h), `h = ${f(h)}`, 1),
          labP(pt(R * 0.75, 0), `a = ${f(n.a)}`, [1, -1]),
          labP(mid(pt(R, 0), pt(0, h)), `l = ${f(slant)}`, [1, 1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "frustumPyramid",
    name: "棱台",
    cat: "solid",
    brief: "棱台由上下底面积与高求体积；正 n 棱台额外给出斜高与侧面积。",
    modes: [
      {
        id: "area",
        label: "上底面积 + 下底面积 + 高",
        fields: [
          { k: "S1", label: "上底面积 S₁", def: "9", kind: "len" },
          { k: "S2", label: "下底面积 S₂", def: "36", kind: "len" },
          { k: "h", label: "高 h", def: "4", kind: "len" },
        ],
      },
      {
        id: "regular",
        label: "正 n 棱台：边数 + 上下底边 + 高",
        fields: [
          { k: "n", label: "底面边数 n", def: "4", kind: "int" },
          { k: "a1", label: "上底边长 a₁", def: "3", kind: "len" },
          { k: "a2", label: "下底边长 a₂", def: "6", kind: "len" },
          { k: "h", label: "高 h", def: "4", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      if (mode === "area") {
        needPos(errs, n, raw, { S1: "上底面积 S₁", S2: "下底面积 S₂", h: "高 h" });
        if (errs.length) return { errors: errs };
        const V = (n.h * (n.S1 + n.S2 + Math.sqrt(n.S1 * n.S2))) / 3;
        return {
          rows: [
            row("上底面积 S₁", f(n.S1)),
            row("下底面积 S₂", f(n.S2)),
            row("高 h", f(n.h)),
            row("体积 V = h(S₁+S₂+√(S₁S₂))/3", f(V)),
            row("上下底面积比", f(n.S1 / n.S2)),
            row("√(S₁·S₂)", f(Math.sqrt(n.S1 * n.S2))),
            row("提示", "侧面积还需要斜高（侧面梯形的高）"),
          ],
          formulas: [
            { name: "体积", expr: "V = h(S₁ + S₂ + √(S₁·S₂)) / 3" },
            { name: "侧面梯形", expr: "侧面是梯形，上底 a₁、下底 a₂、高为斜高 l" },
          ],
          figure: [
            ...frustumPyramidPrims(4, 2.4, 4.8, n.h),
            labP(pt(0, n.h * 0.5), `h = ${f(n.h)}`, [1, 0]),
            labP(pt(0, 0), `S₂ = ${f(n.S2)}`, [0, -1]),
            labP(pt(0, n.h), `S₁ = ${f(n.S1)}`, [0, 1]),
          ],
          primary: row("体积 V", f(V)),
        };
      }
      needPos(errs, n, raw, { n: "底面边数 n", a1: "上底边长 a₁", a2: "下底边长 a₂", h: "高 h" });
      if (Number.isFinite(n.n) && (n.n < 3 || Math.abs(n.n - Math.round(n.n)) > 1e-9)) {
        errs.push("「底面边数 n」需要是不小于 3 的整数");
      }
      if (errs.length) return { errors: errs };
      if (n.a2 <= n.a1) return { errors: ["下底边长需要大于上底边长"] };
      const k = Math.round(n.n);
      const S1 = (k * n.a1 * n.a1) / (4 * Math.tan(PI / k));
      const S2 = (k * n.a2 * n.a2) / (4 * Math.tan(PI / k));
      const r1 = n.a1 / (2 * Math.tan(PI / k));
      const r2 = n.a2 / (2 * Math.tan(PI / k));
      const slant = Math.hypot(n.h, r2 - r1);
      const lateral = ((k * (n.a1 + n.a2)) / 2) * slant;
      const V = (n.h * (S1 + S2 + Math.sqrt(S1 * S2))) / 3;
      return {
        rows: [
          row("底面边数 n", String(k)),
          row("上底边长 a₁", f(n.a1)),
          row("下底边长 a₂", f(n.a2)),
          row("高 h", f(n.h)),
          row("上底面积 S₁", f(S1)),
          row("下底面积 S₂", f(S2)),
          row("上下底边心距之差", f(r2 - r1)),
          row("斜高 l = √(h²+(r₂−r₁)²)", f(slant)),
          row("侧面积 = ½·n(a₁+a₂)·l", f(lateral)),
          row("全面积", f(S1 + S2 + lateral)),
          row("体积 V", f(V)),
          row("上底周长", f(k * n.a1)),
          row("下底周长", f(k * n.a2)),
        ],
        formulas: [
          { name: "体积", expr: "V = h(S₁ + S₂ + √(S₁S₂)) / 3" },
          { name: "斜高", expr: "l = √(h² + (r₂ − r₁)²)，r 为底面边心距" },
          { name: "侧面积", expr: "S侧 = ½ · n(a₁ + a₂) · l（每侧面是梯形）" },
          { name: "正 n 边形面积", expr: "S = n·a² / (4·tan(π/n))" },
        ],
        figure: [
          ...frustumPyramidPrims(k, r1 * 2, r2 * 2, n.h),
          dimP(pt(0, 0), pt(0, n.h), `h = ${f(n.h)}`, 1),
          labP(pt(0, 0), `a₂ = ${f(n.a2)}`, [0, -1]),
          labP(pt(0, n.h), `a₁ = ${f(n.a1)}`, [0, 1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "tetra",
    name: "正四面体",
    cat: "solid",
    brief: "正四面体：由棱长求体积、表面积、高、内外接球与二面角。",
    modes: [
      { id: "a", label: "已知棱长 a", fields: [{ k: "a", label: "棱长 a", def: "6", kind: "len" }] },
      { id: "V", label: "已知体积 V", fields: [{ k: "V", label: "体积 V", def: "25.4558", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "a" ? { a: "棱长 a" } : { V: "体积 V" });
      if (errs.length) return { errors: errs };
      const a = mode === "a" ? n.a : Math.cbrt(n.V * 6 * Math.SQRT2);
      const V = (a * a * a) / (6 * Math.SQRT2);
      const S = Math.sqrt(3) * a * a;
      const h = (a * Math.sqrt(6)) / 3;
      const rIn = (a * Math.sqrt(6)) / 12;
      const rOut = (a * Math.sqrt(6)) / 4;
      return {
        rows: [
          row("棱长 a", f(a)),
          row("体积 V = a³/(6√2)", f(V)),
          row("表面积 S = √3·a²", f(S)),
          row("高 h = (√6/3)a", f(h)),
          row("棱长和 6a", f(6 * a)),
          row("内切球半径 r = (√6/12)a", f(rIn)),
          row("外接球半径 R = (√6/4)a", f(rOut)),
          row("内切球体积", f((4 / 3) * PI * Math.pow(rIn, 3))),
          row("外接球体积", f((4 / 3) * PI * Math.pow(rOut, 3))),
          row("每个面的面积", f((Math.sqrt(3) / 4) * a * a)),
          row("每个面的高", f((Math.sqrt(3) / 2) * a)),
          row("二面角 arccos(1/3)", g(Math.acos(1 / 3))),
          row("体积 ÷ 表面积", f(V / S)),
        ],
        formulas: [
          { name: "体积", expr: "V = a³ / (6√2)" },
          { name: "表面积", expr: "S = √3 · a²（4 个等边三角形）" },
          { name: "高", expr: "h = (√6/3)·a" },
          { name: "内切球", expr: "r = (√6/12)·a = h/4" },
          { name: "外接球", expr: "R = (√6/4)·a = 3h/4" },
          { name: "二面角", expr: "arccos(1/3) ≈ 70.5288°" },
        ],
        figure: (() => {
          const base = [pt(0, 0), pt(a, 0), pt(a / 2, (Math.sqrt(3) / 2) * a * 0.45)];
          const apex = pt(a / 2, h * 0.62);
          return [
            poly(base, { fill: true }),
            segP(base[0], apex),
            segP(base[1], apex),
            segP(base[2], apex),
            segP(pt(a / 2, 0), apex, true),
            dotP(apex),
            labP(pt(a / 2, 0), "底面等边三角形", [0, -1]),
            labP(pt(a / 2, apex[1]), `h = ${f(h)}`, [1, 0]),
          ];
        })(),
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "octa",
    name: "正八面体",
    cat: "solid",
    brief: "正八面体：由棱长求体积、表面积、内外接球与二面角。",
    modes: [
      { id: "a", label: "已知棱长 a", fields: [{ k: "a", label: "棱长 a", def: "6", kind: "len" }] },
      { id: "V", label: "已知体积 V", fields: [{ k: "V", label: "体积 V", def: "101.8234", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "a" ? { a: "棱长 a" } : { V: "体积 V" });
      if (errs.length) return { errors: errs };
      const a = mode === "a" ? n.a : Math.cbrt((3 * n.V) / Math.SQRT2);
      const V = (Math.SQRT2 / 3) * a * a * a;
      const S = 2 * Math.sqrt(3) * a * a;
      const rIn = (a * Math.sqrt(6)) / 6;
      const rOut = (a * Math.SQRT2) / 2;
      return {
        rows: [
          row("棱长 a", f(a)),
          row("体积 V = (√2/3)a³", f(V)),
          row("表面积 S = 2√3·a²", f(S)),
          row("棱长和 12a", f(12 * a)),
          row("内切球半径 r = (√6/6)a", f(rIn)),
          row("外接球半径 R = (√2/2)a", f(rOut)),
          row("相对顶点距离 2R", f(2 * rOut)),
          row("内切球体积", f((4 / 3) * PI * Math.pow(rIn, 3))),
          row("外接球体积", f((4 / 3) * PI * Math.pow(rOut, 3))),
          row("每个面的面积", f((Math.sqrt(3) / 4) * a * a)),
          row("二面角 arccos(−1/3)", g(Math.acos(-1 / 3))),
          row("体积 ÷ 表面积", f(V / S)),
        ],
        formulas: [
          { name: "体积", expr: "V = (√2 / 3) · a³" },
          { name: "表面积", expr: "S = 2√3 · a²（8 个等边三角形）" },
          { name: "内切球", expr: "r = (√6/6)·a" },
          { name: "外接球", expr: "R = (√2/2)·a" },
          { name: "二面角", expr: "arccos(−1/3) ≈ 109.4712°" },
        ],
        figure: (() => {
          const w = a / Math.SQRT2;
          const pts = [pt(-w, 0), pt(0, w * 0.5), pt(w, 0), pt(0, -w * 0.5)];
          const apex = pt(0, w * 0.5 + w * 0.72);
          const bottom = pt(0, -w * 0.5 - w * 0.72);
          return [
            poly(pts, { fill: true }),
            segP(pts[0], apex),
            segP(pts[1], apex),
            segP(pts[2], apex),
            segP(pts[3], apex),
            segP(pts[0], bottom, true),
            segP(pts[2], bottom, true),
            segP(pts[3], bottom),
            segP(pts[1], bottom),
            dotP(apex),
            dotP(bottom),
            labP(apex, `R = ${f(rOut)}`, [1, 1]),
            labP(pt(0, -0.1), "正方形截面", [1, -1]),
          ];
        })(),
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "dodeca",
    name: "正十二面体",
    cat: "solid",
    brief: "正十二面体（12 个正五边形面）由棱长求体积、表面积、内外接球与二面角。",
    modes: [
      { id: "a", label: "已知棱长 a", fields: [{ k: "a", label: "棱长 a", def: "3", kind: "len" }] },
      { id: "V", label: "已知体积 V", fields: [{ k: "V", label: "体积 V", def: "206.9046", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "a" ? { a: "棱长 a" } : { V: "体积 V" });
      if (errs.length) return { errors: errs };
      const k = (15 + 7 * Math.sqrt(5)) / 4;
      const a = mode === "a" ? n.a : Math.cbrt(n.V / k);
      const V = k * a * a * a;
      const S = 3 * Math.sqrt(25 + 10 * Math.sqrt(5)) * a * a;
      const rIn = (a / 4) * Math.sqrt(10 + 22 / Math.sqrt(5));
      const rOut = (a * Math.sqrt(3) * (1 + Math.sqrt(5))) / 4;
      const faceArea = (a * a * Math.sqrt(25 + 10 * Math.sqrt(5))) / 4;
      return {
        rows: [
          row("棱长 a", f(a)),
          row("体积 V = (15+7√5)/4 · a³", f(V)),
          row("表面积 S = 3√(25+10√5)·a²", f(S)),
          row("顶点数 / 棱数 / 面数", "20 / 30 / 12（欧拉公式 V−E+F = 2）"),
          row("棱长和 30a", f(30 * a)),
          row("单个正五边形面积", f(faceArea)),
          row("内切球半径 r", f(rIn)),
          row("外接球半径 R", f(rOut)),
          row("内切球体积", f((4 / 3) * PI * Math.pow(rIn, 3))),
          row("外接球体积", f((4 / 3) * PI * Math.pow(rOut, 3))),
          row("二面角 arccos(−1/√5)", g(Math.acos(-1 / Math.sqrt(5)))),
          row("体积 ÷ 表面积", f(V / S)),
        ],
        formulas: [
          { name: "体积", expr: "V = (15 + 7√5)/4 · a³ ≈ 7.6631·a³" },
          { name: "表面积", expr: "S = 3√(25 + 10√5) · a² ≈ 20.6457·a²" },
          { name: "内切球半径", expr: "r = (a/4)·√(10 + 22/√5) ≈ 1.1135·a" },
          { name: "外接球半径", expr: "R = (√3/4)(1 + √5)·a ≈ 1.4013·a" },
          { name: "二面角", expr: "arccos(−1/√5) ≈ 116.5651°" },
        ],
        figure: (() => {
          const outer = ngonPts(5, a * 1.5);
          const inner = ngonPts(5, a * 0.75).map((p) => pt(p[0], p[1] + a * 0.1));
          return [
            poly(outer, { fill: true }),
            ...outer.map((p, i) => segP(p, inner[i])),
            poly(inner, { fill: true }),
            labP(pt(0, a * 1.85), "外形示意（12 个正五边形面）", [0, 1]),
          ];
        })(),
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "icosa",
    name: "正二十面体",
    cat: "solid",
    brief: "正二十面体（20 个正三角形面）由棱长求体积、表面积、内外接球与二面角。",
    modes: [
      { id: "a", label: "已知棱长 a", fields: [{ k: "a", label: "棱长 a", def: "3", kind: "len" }] },
      { id: "V", label: "已知体积 V", fields: [{ k: "V", label: "体积 V", def: "58.9055", kind: "len" }] },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, mode === "a" ? { a: "棱长 a" } : { V: "体积 V" });
      if (errs.length) return { errors: errs };
      const k = (5 / 12) * (3 + Math.sqrt(5));
      const a = mode === "a" ? n.a : Math.cbrt(n.V / k);
      const V = k * a * a * a;
      const S = 5 * Math.sqrt(3) * a * a;
      const rIn = (a * Math.sqrt(3) * (3 + Math.sqrt(5))) / 12;
      const rOut = (a / 4) * Math.sqrt(10 + 2 * Math.sqrt(5));
      return {
        rows: [
          row("棱长 a", f(a)),
          row("体积 V = (5/12)(3+√5)·a³", f(V)),
          row("表面积 S = 5√3·a²", f(S)),
          row("顶点数 / 棱数 / 面数", "12 / 30 / 20（欧拉公式 V−E+F = 2）"),
          row("棱长和 30a", f(30 * a)),
          row("单个正三角形面面积", f((Math.sqrt(3) / 4) * a * a)),
          row("内切球半径 r", f(rIn)),
          row("外接球半径 R", f(rOut)),
          row("内切球体积", f((4 / 3) * PI * Math.pow(rIn, 3))),
          row("外接球体积", f((4 / 3) * PI * Math.pow(rOut, 3))),
          row("二面角 arccos(−√5/3)", g(Math.acos(-Math.sqrt(5) / 3))),
          row("体积 ÷ 表面积", f(V / S)),
        ],
        formulas: [
          { name: "体积", expr: "V = (5/12)(3 + √5)·a³ ≈ 2.1817·a³" },
          { name: "表面积", expr: "S = 5√3 · a² ≈ 8.6603·a²" },
          { name: "内切球半径", expr: "r = (√3/12)(3 + √5)·a ≈ 0.7558·a" },
          { name: "外接球半径", expr: "R = (a/4)·√(10 + 2√5) ≈ 0.9511·a" },
          { name: "二面角", expr: "arccos(−√5/3) ≈ 138.1897°" },
        ],
        figure: (() => {
          const outer = ngonPts(6, a * 1.6);
          const inner = ngonPts(3, a * 0.95).map((p) => pt(p[0], p[1] + a * 0.12));
          return [
            poly(outer, { fill: true }),
            poly(inner, { fill: false }),
            ...inner.map((p) => segP(pt(0, a * 0.12), p)),
            labP(pt(0, a * 1.95), "外形示意（20 个正三角形面）", [0, 1]),
          ];
        })(),
        primary: row("体积 V", f(V)),
      };
    },
  },
  {
    id: "torus",
    name: "圆环体（环面）",
    cat: "solid",
    brief: "甜甜圈形状：由主半径与管半径求体积、表面积与内外直径。",
    modes: [
      {
        id: "Rr",
        label: "主半径 + 管半径",
        fields: [
          { k: "R", label: "主半径 R（中心到管心）", def: "6", kind: "len" },
          { k: "r", label: "管半径 r", def: "2", kind: "len" },
        ],
      },
      {
        id: "Dd",
        label: "外直径 + 内直径",
        fields: [
          { k: "D", label: "外直径 D", def: "16", kind: "len" },
          { k: "d", label: "内直径 d（孔洞）", def: "8", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      let R = NaN;
      let r = NaN;
      if (mode === "Rr") {
        needPos(errs, n, raw, { R: "主半径 R", r: "管半径 r" });
        R = n.R;
        r = n.r;
      } else {
        needPos(errs, n, raw, { D: "外直径 D", d: "内直径 d（孔洞）" });
        R = (n.D + n.d) / 4;
        r = (n.D - n.d) / 4;
      }
      if (errs.length) return { errors: errs };
      if (!(r > 0) || !(R > 0)) return { errors: ["内直径必须小于外直径，请检查数据"] };
      const V = 2 * PI * PI * R * r * r;
      const S = 4 * PI * PI * R * r;
      return {
        rows: [
          row("主半径 R", f(R)),
          row("管半径 r", f(r)),
          row("外直径 2(R+r)", f(2 * (R + r))),
          row("内直径 2(R−r)", f(2 * (R - r))),
          row("中心线（主圆）周长 2πR", f(2 * PI * R)),
          row("管截面周长 2πr", f(2 * PI * r)),
          row("体积 V = 2π²Rr²", f(V)),
          row("表面积 S = 4π²Rr", f(S)),
          row("R / r 比例", f(R / r)),
          row("体积 ÷ 表面积", f(V / S)),
          row("管截面面积 πr²", f(PI * r * r)),
        ],
        formulas: [
          { name: "体积（帕普斯定理）", expr: "V = 2π²Rr² = (πr²)·(2πR)" },
          { name: "表面积", expr: "S = 4π²Rr = (2πr)·(2πR)" },
          { name: "外直径 / 内直径", expr: "2(R+r) / 2(R−r)" },
          { name: "帕普斯–古尔丁定理", expr: "旋转体体积 = 截面面积 × 形心走过的路程" },
        ],
        figure: [
          ellipseP(pt(0, 0), R + r, (R + r) * 0.42, true),
          ellipseP(pt(0, 0), R - r, (R - r) * 0.42, false),
          circ(pt(R, 0), r * 0.6, false),
          dotP(pt(0, 0)),
          segP(pt(0, 0), pt(R, 0), true),
          labP(pt(R / 2, 0), `R = ${f(R)}`, [0, 1]),
          labP(pt(R, r * 0.6), `r = ${f(r)}`, [1, 0]),
          labP(pt(0, 0), "O", [-1, -1]),
        ],
        primary: row("体积 V", f(V)),
      };
    },
  },
  // ───────────────────────── 坐标几何 ─────────────────────────
  {
    id: "distanceMidpoint",
    name: "两点距离与中点",
    cat: "coord",
    brief: "两点的距离、中点、斜率、倾斜角与所在直线的方程、垂直平分线。",
    modes: [
      {
        id: "two",
        label: "两个点的坐标",
        fields: [
          { k: "x1", label: "A 点 x₁", def: "1", kind: "num" },
          { k: "y1", label: "A 点 y₁", def: "2", kind: "num" },
          { k: "x2", label: "B 点 x₂", def: "5", kind: "num" },
          { k: "y2", label: "B 点 y₂", def: "6", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needNum(errs, n, raw, { x1: "A 点 x₁", y1: "A 点 y₁", x2: "B 点 x₂", y2: "B 点 y₂" });
      if (errs.length) return { errors: errs };
      const A = pt(n.x1, n.y1);
      const B = pt(n.x2, n.y2);
      const dx = n.x2 - n.x1;
      const dy = n.y2 - n.y1;
      const d = Math.hypot(dx, dy);
      if (!(d > EPS)) return { errors: ["两个点重合了，请填写不同的坐标"] };
      const M = mid(A, B);
      const vertical = Math.abs(dx) < EPS;
      const k = vertical ? NaN : dy / dx;
      const incAngle = Math.atan2(dy, dx);
      const inc = incAngle < 0 ? incAngle + PI : incAngle;
      const b = vertical ? NaN : n.y1 - k * n.x1;
      const pbSlope = vertical ? 0 : -1 / k;
      const pbB = M[1] - pbSlope * M[0];
      const rows = [
        row("A 点坐标", `(${f(A[0])}, ${f(A[1])})`),
        row("B 点坐标", `(${f(B[0])}, ${f(B[1])})`),
        row("水平差 Δx", f(dx)),
        row("竖直升 Δy", f(dy)),
        row("两点距离 d = √(Δx²+Δy²)", f(d)),
        row("中点 M", `(${f(M[0])}, ${f(M[1])})`),
        row("斜率 k = Δy/Δx", vertical ? "不存在（竖直直线）" : f(k)),
        row("倾斜角 α", g(inc)),
        row("直线方程（斜截式）", vertical ? `x = ${f(n.x1)}` : `y = ${f(k)}x ${b < 0 ? "-" : "+"} ${f(Math.abs(b))}`),
        row(
          "直线方程（一般式）",
          lineEqStr(-dy, dx, dy * n.x1 - dx * n.y1, ctx.digits),
        ),
        row(
          "垂直平分线方程",
          vertical ? `y = ${f(M[1])}` : `y = ${f(pbSlope)}x ${pbB < 0 ? "-" : "+"} ${f(Math.abs(pbB))}`,
        ),
        row("方向向量 (Δx, Δy)", `(${f(dx)}, ${f(dy)})`),
        row("单位方向向量", `(${f(dx / d)}, ${f(dy / d)})`),
      ];
      return {
        rows,
        formulas: [
          { name: "两点距离", expr: "d = √((x₂−x₁)² + (y₂−y₁)²)" },
          { name: "中点", expr: "M = ((x₁+x₂)/2, (y₁+y₂)/2)" },
          { name: "斜率", expr: "k = (y₂−y₁) / (x₂−x₁)（x₁ = x₂ 时斜率不存在）" },
          { name: "倾斜角", expr: "α = arctan k，范围 [0°, 180°)" },
          { name: "垂直平分线", expr: "过中点且斜率 k′ = −1/k" },
        ],
        figure: [
          segP(A, B),
          segP(A, pt(B[0], A[1]), true),
          segP(pt(B[0], A[1]), B, true),
          dotP(A),
          dotP(B),
          dotP(M),
          rightP(pt(B[0], A[1]), A, B, 0.12 * Math.max(Math.abs(dx), Math.abs(dy))),
          labP(A, `A(${f(A[0])}, ${f(A[1])})`, [-1, -1]),
          labP(B, `B(${f(B[0])}, ${f(B[1])})`, [1, 1]),
          labP(M, `中点 M`, [1, -1]),
          labP(mid(A, pt(B[0], A[1])), `Δx = ${f(dx)}`, [0, -1]),
          labP(mid(pt(B[0], A[1]), B), `Δy = ${f(dy)}`, [1, 0]),
          labP(mid(A, B), `d = ${f(d)}`, [0, 1]),
        ],
        primary: row("距离 d", f(d)),
      };
    },
  },
  {
    id: "lineEquation",
    name: "直线方程",
    cat: "coord",
    brief: "两点式、点斜式与一般式互求，并给出斜率、截距、倾斜角；可求平行线与垂线。",
    modes: [
      {
        id: "twoPoints",
        label: "过两点",
        fields: [
          { k: "x1", label: "点 x₁", def: "0", kind: "num" },
          { k: "y1", label: "点 y₁", def: "1", kind: "num" },
          { k: "x2", label: "点 x₂", def: "3", kind: "num" },
          { k: "y2", label: "点 y₂", def: "7", kind: "num" },
        ],
      },
      {
        id: "pointSlope",
        label: "点 + 斜率",
        fields: [
          { k: "x0", label: "点 x₀", def: "2", kind: "num" },
          { k: "y0", label: "点 y₀", def: "3", kind: "num" },
          { k: "k", label: "斜率 k", def: "-1.5", kind: "num" },
        ],
      },
      {
        id: "general",
        label: "一般式 Ax+By+C=0",
        fields: [
          { k: "A", label: "系数 A", def: "3", kind: "num" },
          { k: "B", label: "系数 B", def: "-4", kind: "num" },
          { k: "C", label: "常数 C", def: "10", kind: "num" },
        ],
      },
      {
        id: "parallel",
        label: "过点且平行于已知直线",
        fields: [
          { k: "A", label: "已知直线 A", def: "2", kind: "num" },
          { k: "B", label: "已知直线 B", def: "3", kind: "num" },
          { k: "C", label: "已知直线 C", def: "-6", kind: "num" },
          { k: "x0", label: "过点 x₀", def: "1", kind: "num" },
          { k: "y0", label: "过点 y₀", def: "4", kind: "num" },
        ],
      },
      {
        id: "perpendicular",
        label: "过点且垂直于已知直线",
        fields: [
          { k: "A", label: "已知直线 A", def: "2", kind: "num" },
          { k: "B", label: "已知直线 B", def: "3", kind: "num" },
          { k: "C", label: "已知直线 C", def: "-6", kind: "num" },
          { k: "x0", label: "过点 x₀", def: "1", kind: "num" },
          { k: "y0", label: "过点 y₀", def: "4", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      let A = NaN;
      let B = NaN;
      let C = NaN;
      let extra: Row[] = [];
      if (mode === "twoPoints") {
        needNum(errs, n, raw, { x1: "点 x₁", y1: "点 y₁", x2: "点 x₂", y2: "点 y₂" });
        if (errs.length) return { errors: errs };
        if (Math.abs(n.x2 - n.x1) < EPS && Math.abs(n.y2 - n.y1) < EPS) {
          return { errors: ["两个点重合了，无法确定一条直线"] };
        }
        A = n.y2 - n.y1;
        B = -(n.x2 - n.x1);
        C = (n.x2 - n.x1) * n.y1 - (n.y2 - n.y1) * n.x1;
      } else if (mode === "pointSlope") {
        needNum(errs, n, raw, { x0: "点 x₀", y0: "点 y₀", k: "斜率 k" });
        if (errs.length) return { errors: errs };
        A = n.k;
        B = -1;
        C = n.y0 - n.k * n.x0;
        extra = [
          row("点斜式", `y − ${f(n.y0)} = ${f(n.k)}(x − ${f(n.x0)})`),
          row("斜截式", `y = ${f(n.k)}x ${n.y0 - n.k * n.x0 < 0 ? "-" : "+"} ${f(Math.abs(n.y0 - n.k * n.x0))}`),
        ];
      } else {
        needNum(errs, n, raw, { A: "系数 A", B: "系数 B", C: "常数 C" });
        if (errs.length) return { errors: errs };
        A = n.A;
        B = n.B;
        C = n.C;
        if (Math.abs(A) < EPS && Math.abs(B) < EPS) {
          return { errors: ["A 与 B 不能同时为 0，否则这不是一条直线"] };
        }
        if (mode !== "general") {
          needNum(errs, n, raw, { x0: "过点 x₀", y0: "过点 y₀" });
          if (errs.length) return { errors: errs };
          const d0 = A * n.x0 + B * n.y0;
          if (mode === "parallel") {
            C = (A * n.x0 + B * n.y0) * -1;
            extra = [row("做法", "平行直线与原直线 A、B 相同，只换常数项（保证过已知点）")];
          } else {
            const A2 = -B;
            const B2 = A;
            const C2 = -(A2 * n.x0 + B2 * n.y0);
            extra = [
              row("原直线在点处的值", f(d0)),
              row("垂线方向", "把法向量 (A, B) 当作方向向量，即交换系数并改一个符号"),
            ];
            A = A2;
            B = B2;
            C = C2;
          }
        }
      }
      const vertical = Math.abs(B) < EPS;
      const k = vertical ? NaN : -A / B;
      const yIntercept = vertical ? NaN : -C / B;
      const xIntercept = Math.abs(A) < EPS ? NaN : -C / A;
      const nlen = Math.hypot(A, B);
      const inc0 = vertical ? PI / 2 : Math.atan(k);
      const inc = ((inc0 % PI) + PI) % PI;
      const marked =
        mode === "pointSlope" || mode === "parallel" || mode === "perpendicular" ? pt(n.x0, n.y0) : null;
      const eq = lineEqStr(A, B, C, ctx.digits);
      return {
        rows: [
          row("直线方程（一般式）", eq),
          row("直线方程（斜截式）", vertical ? `x = ${f(xIntercept)}` : `y = ${f(k)}x ${yIntercept < 0 ? "-" : "+"} ${f(Math.abs(yIntercept))}`),
          row("斜率 k", vertical ? "不存在（竖直直线）" : f(k)),
          row("倾斜角 α", g(inc)),
          row("y 轴截距", vertical ? "无（与 y 轴平行）" : f(yIntercept)),
          row("x 轴截距", Math.abs(A) < EPS ? "无（与 x 轴平行）" : f(xIntercept)),
          row("法向量 (A, B)", `(${f(A)}, ${f(B)})`),
          row("方向向量 (−B, A)", `(${f(-B)}, ${f(A)})`),
          row("与 x 轴交点", Math.abs(A) < EPS ? "无" : `(${f(xIntercept)}, 0)`),
          row("与 y 轴交点", vertical ? "无" : `(0, ${f(yIntercept)})`),
          row("原点到直线的距离", f(Math.abs(C) / nlen)),
          row("方程两边同除 √(A²+B²) 后", `常数项 = ${f(C / nlen)}（即到原点的有向距离）`),
          ...extra,
        ],
        formulas: [
          { name: "两点式", expr: "(y − y₁)/(y₂ − y₁) = (x − x₁)/(x₂ − x₁)" },
          { name: "点斜式", expr: "y − y₀ = k(x − x₀)" },
          { name: "一般式", expr: "Ax + By + C = 0，斜率 k = −A/B，倾斜角 α = arctan k" },
          { name: "截距", expr: "x 轴截距 = −C/A，y 轴截距 = −C/B" },
          { name: "点到直线距离", expr: "d = |Ax₀ + By₀ + C| / √(A² + B²)" },
          { name: "平行 / 垂直", expr: "平行：A₁B₂ = A₂B₁；垂直：A₁A₂ + B₁B₂ = 0" },
        ],
        figure: (() => {
          const span = lineSpan(A, B, C, marked, 3);
          return [
            segP(span[0], span[1]),
            ...(marked ? [dotP(marked), labP(marked, `(${f(marked[0])}, ${f(marked[1])})`, [1, 1])] : []),
            labP(span[1], eq, [1, 1]),
          ];
        })(),
        primary: row("直线方程", eq),
      };
    },
  },
  {
    id: "pointLineDistance",
    name: "点到直线的距离",
    cat: "coord",
    brief: "点到直线的距离、垂足与关于直线的对称点。",
    modes: [
      {
        id: "pointABC",
        label: "点 + 一般式 Ax+By+C=0",
        fields: [
          { k: "x0", label: "点 P 的 x₀", def: "1", kind: "num" },
          { k: "y0", label: "点 P 的 y₀", def: "2", kind: "num" },
          { k: "A", label: "直线 A", def: "3", kind: "num" },
          { k: "B", label: "直线 B", def: "4", kind: "num" },
          { k: "C", label: "直线 C", def: "-5", kind: "num" },
        ],
      },
      {
        id: "parallel",
        label: "两条平行线的距离",
        fields: [
          { k: "A", label: "直线 A（两条相同）", def: "2", kind: "num" },
          { k: "B", label: "直线 B（两条相同）", def: "3", kind: "num" },
          { k: "C1", label: "C₁", def: "-6", kind: "num" },
          { k: "C2", label: "C₂", def: "9", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      if (mode === "parallel") {
        needNum(errs, n, raw, { A: "直线 A", B: "直线 B", C1: "C₁", C2: "C₂" });
        if (errs.length) return { errors: errs };
        const A = n.A;
        const B = n.B;
        const nlen = Math.hypot(A, B);
        if (nlen < EPS) return { errors: ["A 与 B 不能同时为 0"] };
        const d = Math.abs(n.C2 - n.C1) / nlen;
        return {
          rows: [
            row("直线 1", lineEqStr(A, B, n.C1, ctx.digits)),
            row("直线 2", lineEqStr(A, B, n.C2, ctx.digits)),
            row("两条直线是否平行", "是（A、B 系数相同）"),
            row("两平行线距离", f(d)),
            row("法向量长度 √(A²+B²)", f(nlen)),
          ],
          formulas: [
            { name: "两平行线距离", expr: "d = |C₂ − C₁| / √(A² + B²)" },
            { name: "点到直线距离", expr: "d = |Ax₀ + By₀ + C| / √(A² + B²)" },
          ],
          figure: (() => {
            const s1 = lineSpan(A, B, n.C1, null, 3);
            const s2 = lineSpan(A, B, n.C2, null, 3);
            return [
              segP(s1[0], s1[1]),
              segP(s2[0], s2[1]),
              dimP(mid(s1[0], s1[1]), mid(s2[0], s2[1]), `d = ${f(d)}`, 1),
              labP(s1[1], lineEqStr(A, B, n.C1, 2), [1, -1]),
              labP(s2[1], lineEqStr(A, B, n.C2, 2), [1, 1]),
            ];
          })(),
          primary: row("两平行线距离 d", f(d)),
        };
      }
      needNum(errs, n, raw, { x0: "点 P 的 x₀", y0: "点 P 的 y₀", A: "直线 A", B: "直线 B", C: "直线 C" });
      if (errs.length) return { errors: errs };
      const A = n.A;
      const B = n.B;
      const C = n.C;
      const nlen = Math.hypot(A, B);
      if (nlen < EPS) return { errors: ["A 与 B 不能同时为 0，否则这不是一条直线"] };
      const P = pt(n.x0, n.y0);
      const val = A * P[0] + B * P[1] + C;
      const d = Math.abs(val) / nlen;
      const foot = pt(P[0] - (A * val) / (nlen * nlen), P[1] - (B * val) / (nlen * nlen));
      const mirror = pt(2 * foot[0] - P[0], 2 * foot[1] - P[1]);
      const k = Math.abs(B) < EPS ? NaN : -A / B;
      const span = lineSpan(A, B, C, P, 3);
      const uDir = pt(-B / nlen, A / nlen);
      return {
        rows: [
          row("点 P 坐标", `(${f(P[0])}, ${f(P[1])})`),
          row("直线方程", lineEqStr(A, B, C, ctx.digits)),
          row("Ax₀ + By₀ + C", f(val)),
          row("√(A²+B²)", f(nlen)),
          row("点到直线距离 d", f(d)),
          row("垂足（投影点）", `(${f(foot[0])}, ${f(foot[1])})`),
          row("P 关于直线的对称点", `(${f(mirror[0])}, ${f(mirror[1])})`),
          row("点是否在直线上", Math.abs(val) < 1e-9 ? "是" : "否"),
          row("直线斜率", Math.abs(B) < EPS ? "不存在" : f(k)),
          row("法向量（单位）", `(${f(A / nlen)}, ${f(B / nlen)})`),
        ],
        formulas: [
          { name: "点到直线距离", expr: "d = |Ax₀ + By₀ + C| / √(A² + B²)" },
          { name: "垂足", expr: "P′ = P − ((Ax₀+By₀+C)/(A²+B²))·(A, B)" },
          { name: "对称点", expr: "P″ = 2P′ − P" },
          { name: "两平行线距离", expr: "d = |C₂ − C₁| / √(A² + B²)" },
        ],
        figure: [
          segP(span[0], span[1]),
          segP(P, foot),
          dotP(P),
          dotP(foot),
          dotP(mirror),
          rightP(foot, P, add(foot, uDir), 0.7),
          labP(P, `P(${f(P[0])}, ${f(P[1])})`, [1, 1]),
          labP(foot, "垂足", [1, -1]),
          labP(mirror, "对称点", [-1, -1]),
          labP(mid(P, foot), `d = ${f(d)}`, [1, 0]),
        ],
        primary: row("距离 d", f(d)),
      };
    },
  },
  {
    id: "twoLines",
    name: "两直线的位置关系",
    cat: "coord",
    brief: "判断两条直线相交、平行还是垂直，并给出交点、夹角与平行时的距离。",
    modes: [
      {
        id: "general",
        label: "两条一般式直线",
        fields: [
          { k: "A1", label: "直线 1：A₁", def: "1", kind: "num" },
          { k: "B1", label: "直线 1：B₁", def: "2", kind: "num" },
          { k: "C1", label: "直线 1：C₁", def: "-3", kind: "num" },
          { k: "A2", label: "直线 2：A₂", def: "2", kind: "num" },
          { k: "B2", label: "直线 2：B₂", def: "-1", kind: "num" },
          { k: "C2", label: "直线 2：C₂", def: "-1", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needNum(errs, n, raw, {
        A1: "直线 1：A₁",
        B1: "直线 1：B₁",
        C1: "直线 1：C₁",
        A2: "直线 2：A₂",
        B2: "直线 2：B₂",
        C2: "直线 2：C₂",
      });
      if (errs.length) return { errors: errs };
      const { A1, B1, C1, A2, B2, C2 } = n;
      if (Math.hypot(A1, B1) < EPS || Math.hypot(A2, B2) < EPS) {
        return { errors: ["每条直线的 A、B 不能同时为 0"] };
      }
      const det = A1 * B2 - A2 * B1;
      const parallel = Math.abs(det) < 1e-12;
      const perp = Math.abs(A1 * A2 + B1 * B2) < 1e-12;
      const k1 = Math.abs(B1) < EPS ? NaN : -A1 / B1;
      const k2 = Math.abs(B2) < EPS ? NaN : -A2 / B2;
      const cosT = Math.abs(A1 * A2 + B1 * B2) / (Math.hypot(A1, B1) * Math.hypot(A2, B2));
      const theta = Math.acos(clamp1(cosT));
      const rows: Row[] = [
        row("直线 1", lineEqStr(A1, B1, C1, ctx.digits)),
        row("直线 2", lineEqStr(A2, B2, C2, ctx.digits)),
        row("直线 1 斜率", Number.isNaN(k1) ? "不存在" : f(k1)),
        row("直线 2 斜率", Number.isNaN(k2) ? "不存在" : f(k2)),
      ];
      let figure: Figure = [];
      let primary: Row;
      if (parallel) {
        const same = Math.abs(A1 * C2 - A2 * C1) < 1e-9 && Math.abs(B1 * C2 - B2 * C1) < 1e-9;
        // 先把直线 2 的系数按比例缩放到与直线 1 同一个法向量方向，再算两平行线距离，
        // 这样 (A,B) 反向（即 (A₂,B₂) = −λ(A₁,B₁)）时也不会算出错误结果
        const lam = Math.abs(A1) > EPS ? A2 / A1 : B2 / B1;
        const d = Math.abs(C1 - C2 / lam) / Math.hypot(A1, B1);
        rows.push(row("位置关系", same ? "两条直线重合（同一条直线）" : "平行（无交点）"));
        rows.push(row("两线距离", same ? "0" : f(d)));
        primary = row("位置关系", same ? "重合" : "平行");
        figure = (() => {
          const s1 = lineSpan(A1, B1, C1, null, 3);
          const s2 = lineSpan(A2, B2, C2, null, 3);
          return [
            segP(s1[0], s1[1]),
            segP(s2[0], s2[1]),
            dimP(mid(s1[0], s1[1]), mid(s2[0], s2[1]), "两线距离", 1),
            labP(s1[1], "直线 1", [1, -1]),
            labP(s2[1], "直线 2", [1, 1]),
          ];
        })();
      } else {
        const x = (B1 * C2 - B2 * C1) / det;
        const y = (C1 * A2 - C2 * A1) / det;
        rows.push(row("位置关系", perp ? "相交且互相垂直" : "相交"));
        rows.push(row("交点", `(${f(x)}, ${f(y)})`));
        rows.push(row("两直线夹角（锐角）", g(theta)));
        rows.push(row("是否垂直（A₁A₂+B₁B₂ = 0）", perp ? `是（${f(A1 * A2 + B1 * B2)}）` : `否（${f(A1 * A2 + B1 * B2)}）`));
        rows.push(row("夹角余弦 |cos θ|", f(cosT)));
        primary = row("两直线夹角", g(theta));
        figure = (() => {
          const X = pt(x, y);
          const u1 = pt(-B1 / Math.hypot(A1, B1), A1 / Math.hypot(A1, B1));
          const u2 = pt(-B2 / Math.hypot(A2, B2), A2 / Math.hypot(A2, B2));
          const s1 = lineSpan(A1, B1, C1, X, 3);
          const s2 = lineSpan(A2, B2, C2, X, 3);
          const bis = unit(add(u1, u2));
          return [
            segP(s1[0], s1[1]),
            segP(s2[0], s2[1]),
            dotP(X),
            angP(X, add(X, u1), add(X, u2), 1.1),
            labP(X, `交点 (${f(x)}, ${f(y)})`, [1, -1]),
            labP(add(X, mul(bis, 1.6)), `θ = ${g(theta)}`, [bis[0], bis[1]]),
          ];
        })();
      }
      return {
        rows,
        formulas: [
          { name: "平行判定", expr: "A₁B₂ − A₂B₁ = 0" },
          { name: "垂直判定", expr: "A₁A₂ + B₁B₂ = 0" },
          { name: "交点", expr: "x = (B₁C₂ − B₂C₁) / (A₁B₂ − A₂B₁)，y = (C₁A₂ − C₂A₁) / (A₁B₂ − A₂B₁)" },
          { name: "夹角", expr: "cos θ = |A₁A₂ + B₁B₂| / (√(A₁²+B₁²)·√(A₂²+B₂²))" },
          { name: "两平行线距离", expr: "d = |C₂ − C₁| / √(A² + B²)" },
        ],
        figure,
        primary,
      };
    },
  },
  {
    id: "triangleCenters",
    name: "三角形的四心",
    cat: "coord",
    brief: "由三个顶点坐标求重心、垂心、外心、内心，以及外接圆、内切圆与各边长。",
    modes: [
      {
        id: "three",
        label: "三个顶点的坐标",
        fields: [
          { k: "x1", label: "A 点 x", def: "0", kind: "num" },
          { k: "y1", label: "A 点 y", def: "0", kind: "num" },
          { k: "x2", label: "B 点 x", def: "4", kind: "num" },
          { k: "y2", label: "B 点 y", def: "0", kind: "num" },
          { k: "x3", label: "C 点 x", def: "0", kind: "num" },
          { k: "y3", label: "C 点 y", def: "3", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needNum(errs, n, raw, {
        x1: "A 点 x",
        y1: "A 点 y",
        x2: "B 点 x",
        y2: "B 点 y",
        x3: "C 点 x",
        y3: "C 点 y",
      });
      if (errs.length) return { errors: errs };
      const A = pt(n.x1, n.y1);
      const B = pt(n.x2, n.y2);
      const C = pt(n.x3, n.y3);
      const a = vlen(sub(C, B));
      const b = vlen(sub(C, A));
      const c = vlen(sub(B, A));
      const S = Math.abs(polyArea([A, B, C]));
      if (!(S > 1e-12)) return { errors: ["三个点共线，构不成三角形"] };
      const G = pt((A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3);
      const cc = circumcenter(A, B, C);
      if (!cc) return { errors: ["三个点共线，构不成三角形"] };
      const O = cc.c;
      const R = cc.R;
      const H = pt(A[0] + B[0] + C[0] - 2 * O[0], A[1] + B[1] + C[1] - 2 * O[1]);
      const I = pt(
        (a * A[0] + b * B[0] + c * C[0]) / (a + b + c),
        (a * A[1] + b * B[1] + c * C[1]) / (a + b + c),
      );
      const ri = S / ((a + b + c) / 2);
      const angA = Math.acos(clamp1((b * b + c * c - a * a) / (2 * b * c)));
      const angB = Math.acos(clamp1((a * a + c * c - b * b) / (2 * a * c)));
      const angC = PI - angA - angB;
      const euler = vlen(sub(H, G));
      const nineCenter = mid(H, O);
      return {
        rows: [
          row("A 点", `(${f(A[0])}, ${f(A[1])})`),
          row("B 点", `(${f(B[0])}, ${f(B[1])})`),
          row("C 点", `(${f(C[0])}, ${f(C[1])})`),
          row("边 a = BC", f(a)),
          row("边 b = CA", f(b)),
          row("边 c = AB", f(c)),
          row("面积（坐标鞋带公式）", f(S)),
          row("周长", f(a + b + c)),
          row("重心 G（中线交点）", `(${f(G[0])}, ${f(G[1])})`),
          row("外心 O（中垂线交点）", `(${f(O[0])}, ${f(O[1])})`),
          row("垂心 H（高线交点）", `(${f(H[0])}, ${f(H[1])})`),
          row("内心 I（角平分线交点）", `(${f(I[0])}, ${f(I[1])})`),
          row("外接圆半径 R", f(R)),
          row("外接圆方程", `(x ${O[0] < 0 ? "+" : "-"} ${f(Math.abs(O[0]))})² + (y ${O[1] < 0 ? "+" : "-"} ${f(Math.abs(O[1]))})² = ${f(R * R)}`),
          row("内切圆半径 r = S/s", f(ri)),
          row("内切圆方程", `(x ${I[0] < 0 ? "+" : "-"} ${f(Math.abs(I[0]))})² + (y ${I[1] < 0 ? "+" : "-"} ${f(Math.abs(I[1]))})² = ${f(ri * ri)}`),
          row("欧拉线 |HG|（H-G-O 三点共线）", f(euler)),
          row("重心到外心距离 |GO|", f(vlen(sub(G, O)))),
          row("九点圆圆心", `(${f(nineCenter[0])}, ${f(nineCenter[1])})`),
          row("九点圆半径 R/2", f(R / 2)),
          row("角 A", g(angA)),
          row("角 B", g(angB)),
          row("角 C", g(angC)),
        ],
        formulas: [
          { name: "重心", expr: "G = ((x₁+x₂+x₃)/3, (y₁+y₂+y₃)/3)" },
          { name: "外心（外接圆圆心）", expr: "到三顶点等距，即三点外接圆的圆心" },
          { name: "垂心", expr: "H = A + B + C − 2O（O 为外心）" },
          { name: "内心", expr: "I = (a·A + b·B + c·C) / (a + b + c)，a、b、c 为对边长度" },
          { name: "面积（鞋带公式）", expr: "S = ½|x₁(y₂−y₃) + x₂(y₃−y₁) + x₃(y₁−y₂)|" },
          { name: "外接圆半径", expr: "R = abc / (4S)" },
          { name: "内切圆半径", expr: "r = S / s，s 为半周长" },
          { name: "欧拉线", expr: "H、G、O 共线，且 |HG| = 2|GO|（G 在 H 与 O 之间）" },
        ],
        figure: [
          poly([A, B, C], { fill: true }),
          segP(A, mid(B, C), true),
          segP(B, mid(A, C), true),
          segP(C, mid(A, B), true),
          dotP(G),
          dotP(O),
          dotP(H),
          dotP(I),
          labP(G, `重心 G`, [0, -1]),
          labP(O, `外心 O`, [1, -1]),
          labP(H, `垂心 H`, [0, 1]),
          labP(I, `内心 I`, [-1, 1]),
          labP(A, "A", [-1, -1]),
          labP(B, "B", [1, -1]),
          labP(C, "C", [0, 1]),
        ],
        primary: row("外接圆半径 R", f(R)),
      };
    },
  },
  {
    id: "circleEquation",
    name: "圆的方程",
    cat: "coord",
    brief: "由圆心半径、三点、一般式或圆心与圆上一点求圆的标准方程与一般方程。",
    modes: [
      {
        id: "centerRadius",
        label: "圆心 + 半径",
        fields: [
          { k: "a", label: "圆心 x₀", def: "2", kind: "num" },
          { k: "b", label: "圆心 y₀", def: "-3", kind: "num" },
          { k: "r", label: "半径 r", def: "5", kind: "len" },
        ],
      },
      {
        id: "threePoints",
        label: "圆上三点",
        fields: [
          { k: "x1", label: "点 1 x", def: "0", kind: "num" },
          { k: "y1", label: "点 1 y", def: "0", kind: "num" },
          { k: "x2", label: "点 2 x", def: "6", kind: "num" },
          { k: "y2", label: "点 2 y", def: "0", kind: "num" },
          { k: "x3", label: "点 3 x", def: "0", kind: "num" },
          { k: "y3", label: "点 3 y", def: "8", kind: "num" },
        ],
      },
      {
        id: "general",
        label: "一般式 x²+y²+Dx+Ey+F=0",
        fields: [
          { k: "D", label: "系数 D", def: "-6", kind: "num" },
          { k: "E", label: "系数 E", def: "4", kind: "num" },
          { k: "F", label: "常数 F", def: "-12", kind: "num" },
        ],
      },
      {
        id: "centerPoint",
        label: "圆心 + 圆上一点",
        fields: [
          { k: "a", label: "圆心 x₀", def: "1", kind: "num" },
          { k: "b", label: "圆心 y₀", def: "2", kind: "num" },
          { k: "x1", label: "圆上点 x", def: "4", kind: "num" },
          { k: "y1", label: "圆上点 y", def: "6", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      let a = NaN;
      let b = NaN;
      let r = NaN;
      let pts: Vec[] = [];
      if (mode === "centerRadius") {
        needNum(errs, n, raw, { a: "圆心 x₀", b: "圆心 y₀" });
        needPos(errs, n, raw, { r: "半径 r" });
        if (errs.length) return { errors: errs };
        a = n.a;
        b = n.b;
        r = n.r;
      } else if (mode === "centerPoint") {
        needNum(errs, n, raw, { a: "圆心 x₀", b: "圆心 y₀", x1: "圆上点 x", y1: "圆上点 y" });
        if (errs.length) return { errors: errs };
        a = n.a;
        b = n.b;
        r = Math.hypot(n.x1 - a, n.y1 - b);
        if (!(r > EPS)) return { errors: ["圆上的点不能与圆心重合"] };
        pts = [pt(n.x1, n.y1)];
      } else if (mode === "threePoints") {
        needNum(errs, n, raw, {
          x1: "点 1 x",
          y1: "点 1 y",
          x2: "点 2 x",
          y2: "点 2 y",
          x3: "点 3 x",
          y3: "点 3 y",
        });
        if (errs.length) return { errors: errs };
        pts = [pt(n.x1, n.y1), pt(n.x2, n.y2), pt(n.x3, n.y3)];
        const cc = circumcenter(pts[0], pts[1], pts[2]);
        if (!cc) return { errors: ["三个点共线，不能确定一个圆"] };
        a = cc.c[0];
        b = cc.c[1];
        r = cc.R;
      } else {
        needNum(errs, n, raw, { D: "系数 D", E: "系数 E", F: "常数 F" });
        if (errs.length) return { errors: errs };
        const disc = n.D * n.D + n.E * n.E - 4 * n.F;
        if (!(disc > 0)) {
          return { errors: ["D² + E² − 4F 必须大于 0，这个方程不表示一个真正的圆"] };
        }
        a = -n.D / 2;
        b = -n.E / 2;
        r = Math.sqrt(disc) / 2;
      }
      const D = -2 * a;
      const E = -2 * b;
      const F = a * a + b * b - r * r;
      const dx2 = r * r - b * b;
      const dy2 = r * r - a * a;
      const xHits =
        dx2 < -1e-12 ? "与 x 轴没有交点" : Math.abs(dx2) < 1e-12 ? `与 x 轴相切于 (${f(a)}, 0)` : `(${f(a - Math.sqrt(dx2))}, 0) 与 (${f(a + Math.sqrt(dx2))}, 0)`;
      const yHits =
        dy2 < -1e-12 ? "与 y 轴没有交点" : Math.abs(dy2) < 1e-12 ? `与 y 轴相切于 (0, ${f(b)})` : `(0, ${f(b - Math.sqrt(dy2))}) 与 (0, ${f(b + Math.sqrt(dy2))})`;
      const sign = (v: number) => (v < 0 ? "+" : "-");
      return {
        rows: [
          row("圆心", `(${f(a)}, ${f(b)})`),
          row("半径 r", f(r)),
          row("标准方程", `(x ${sign(a)} ${f(Math.abs(a))})² + (y ${sign(b)} ${f(Math.abs(b))})² = ${f(r * r)}`),
          row("一般方程", `x² + y² ${D < 0 ? "-" : "+"} ${f(Math.abs(D))}x ${E < 0 ? "-" : "+"} ${f(Math.abs(E))}y ${F < 0 ? "-" : "+"} ${f(Math.abs(F))} = 0`),
          row("D、E、F", `${f(D)}、${f(E)}、${f(F)}`),
          row("直径 2r", f(2 * r)),
          row("周长 2πr", f(2 * PI * r)),
          row("面积 πr²", f(PI * r * r)),
          row("与 x 轴", xHits),
          row("与 y 轴", yHits),
          row("是否过原点", Math.abs(F) < 1e-9 ? "是（F = 0）" : "否"),
          row("圆心到原点距离", f(Math.hypot(a, b))),
          ...(pts.length
            ? [row("给定点在圆上", pts.map((p) => `(${f(p[0])}, ${f(p[1])})`).join("、"))]
            : []),
        ],
        formulas: [
          { name: "标准方程", expr: "(x − a)² + (y − b)² = r²，圆心 (a, b)，半径 r" },
          { name: "一般方程", expr: "x² + y² + Dx + Ey + F = 0" },
          { name: "圆心与半径（一般式）", expr: "圆心 (−D/2, −E/2)，r = ½√(D² + E² − 4F)" },
          { name: "三点定圆", expr: "圆心是三点构成三角形的外心（两条中垂线交点）" },
          { name: "与坐标轴交点", expr: "令 y = 0 解 x（判 r² − b²），令 x = 0 解 y（判 r² − a²）" },
        ],
        figure: (() => {
          const prims: Prim[] = [circ(pt(a, b), r, false), dotP(pt(a, b)), segP(pt(a, b), pt(a + r, b))];
          prims.push(labP(pt(a, b), `O(${f(a)}, ${f(b)})`, [-1, -1]));
          prims.push(labP(pt(a + r / 2, b), `r = ${f(r)}`, [0, -1]));
          prims.push(segP(pt(a - r, b), pt(a + r, b), true));
          prims.push(segP(pt(a, b - r), pt(a, b + r), true));
          for (const p of pts) {
            prims.push(dotP(p));
            prims.push(labP(p, `(${f(p[0])}, ${f(p[1])})`, [1, 1]));
          }
          return prims;
        })(),
        primary: row("半径 r", f(r)),
      };
    },
  },
  {
    id: "polygonPoints",
    name: "多边形（顶点坐标）",
    cat: "coord",
    brief: "由顶点坐标求任意多边形的面积（鞋带公式）、周长、形心、边长与凸凹性。",
    modes: [
      {
        id: "pts",
        label: "顶点坐标列表",
        fields: [
          {
            k: "pts",
            label: "顶点坐标（每行或分号隔开一个点，格式 x,y）",
            def: "0,0; 8,0; 8,5; 3,5; 3,8; 0,8",
            kind: "text",
          },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const parsed = parsePointList(raw.pts === undefined ? "" : raw.pts);
      if (parsed.error) return { errors: [parsed.error] };
      const pts = parsed.pts;
      if (pts.length < 3) return { errors: ["至少要 3 个顶点才能构成多边形"] };
      const signed = polyArea(pts);
      const S = Math.abs(signed);
      if (!(S > 1e-12)) return { errors: ["这些点（近似）共线，围不出面积"] };
      const P = polyPerimeter(pts);
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        const cross = p[0] * q[1] - q[0] * p[1];
        cx += (p[0] + q[0]) * cross;
        cy += (p[1] + q[1]) * cross;
      }
      cx /= 6 * signed;
      cy /= 6 * signed;
      const sideRows = pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return row(`边 ${i + 1}（P${i + 1}→P${i + 1 === pts.length ? 1 : i + 2}）`, f(vlen(sub(q, p))));
      });
      return {
        rows: [
          row("顶点数", String(pts.length)),
          row("面积（鞋带公式）", f(S)),
          row("有向面积", f(signed)),
          row("顶点顺序", signed > 0 ? "逆时针" : "顺时针"),
          row("周长", f(P)),
          row("面积形心", `(${f(cx)}, ${f(cy)})`),
          row("顶点平均点", `(${f(centroidOf(pts)[0])}, ${f(centroidOf(pts)[1])})`),
          row("是否凸多边形", isConvex(pts) ? "是" : "否（存在凹角）"),
          row("外接矩形宽 × 高", `${f(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])))} × ${f(Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])))}`),
          ...sideRows,
          row("最长边", f(Math.max(...pts.map((p, i) => vlen(sub(pts[(i + 1) % pts.length], p)))))),
          row("最短边", f(Math.min(...pts.map((p, i) => vlen(sub(pts[(i + 1) % pts.length], p)))))),
        ],
        formulas: [
          { name: "鞋带公式（面积）", expr: "S = ½|Σ(xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)|" },
          { name: "周长", expr: "P = Σ √((xᵢ₊₁−xᵢ)² + (yᵢ₊₁−yᵢ)²)" },
          { name: "形心", expr: "C = (1/6A)·Σ(xᵢ+xᵢ₊₁)(xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)（A 为有向面积）" },
          { name: "凸性判定", expr: "所有相邻边叉积同号则为凸多边形" },
        ],
        figure: [
          poly(pts, { fill: true }),
          ...pts.map((p, i) => dotP(p)),
          ...pts.map((p, i) => labP(p, `P${i + 1}`, [1, 1])),
          dotP(pt(cx, cy)),
          labP(pt(cx, cy), "形心", [1, -1]),
        ],
        primary: row("面积 S", f(S)),
      };
    },
  },
  {
    id: "sectionFormula",
    name: "定比分点（线段分割）",
    cat: "coord",
    brief: "按 m : n 内分或外分线段求分点坐标，以及中点与线段长度。",
    modes: [
      {
        id: "mn",
        label: "两点 + 比 m : n",
        fields: [
          { k: "x1", label: "A 点 x₁", def: "-2", kind: "num" },
          { k: "y1", label: "A 点 y₁", def: "1", kind: "num" },
          { k: "x2", label: "B 点 x₂", def: "6", kind: "num" },
          { k: "y2", label: "B 点 y₂", def: "5", kind: "num" },
          { k: "m", label: "比 m", def: "1", kind: "num" },
          { k: "n", label: "比 n", def: "3", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needNum(errs, n, raw, { x1: "A 点 x₁", y1: "A 点 y₁", x2: "B 点 x₂", y2: "B 点 y₂" });
      needPos(errs, n, raw, { m: "比 m", n: "比 n" });
      if (errs.length) return { errors: errs };
      const A = pt(n.x1, n.y1);
      const B = pt(n.x2, n.y2);
      const m = n.m;
      const nn = n.n;
      const inner = pt((m * B[0] + nn * A[0]) / (m + nn), (m * B[1] + nn * A[1]) / (m + nn));
      const outer = Math.abs(m - nn) < 1e-12 ? null : pt((m * B[0] - nn * A[0]) / (m - nn), (m * B[1] - nn * A[1]) / (m - nn));
      const M = mid(A, B);
      const d = vlen(sub(B, A));
      return {
        rows: [
          row("A 点", `(${f(A[0])}, ${f(A[1])})`),
          row("B 点", `(${f(B[0])}, ${f(B[1])})`),
          row("比 m : n", `${f(m)} : ${f(nn)}`),
          row(`内分点（AP : PB = m : n）`, `(${f(inner[0])}, ${f(inner[1])})`),
          row("内分点到 A 的距离", f((m / (m + nn)) * d)),
          row("内分点到 B 的距离", f((nn / (m + nn)) * d)),
          row("外分点（AP : PB = m : n，P 在延长线上）", outer ? `(${f(outer[0])}, ${f(outer[1])})` : "不存在（m = n 时外分点在无穷远，即两条边平行）"),
          row("中点", `(${f(M[0])}, ${f(M[1])})`),
          row("线段长度", f(d)),
          row("A、B 的中点到内分点距离", f(vlen(sub(inner, M)))),
        ],
        formulas: [
          { name: "定比分点（内分）", expr: "P = ((m·x₂ + n·x₁)/(m+n), (m·y₂ + n·y₁)/(m+n))" },
          { name: "定比分点（外分）", expr: "P = ((m·x₂ − n·x₁)/(m−n), (m·y₂ − n·y₁)/(m−n))" },
          { name: "中点（m = n = 1）", expr: "M = ((x₁+x₂)/2, (y₁+y₂)/2)" },
        ],
        figure: [
          segP(A, B),
          dotP(A),
          dotP(B),
          dotP(inner),
          dotP(M),
          ...(outer ? [dotP(outer), labP(outer, "外分点", [-1, -1])] : []),
          labP(A, "A", [-1, -1]),
          labP(B, "B", [1, -1]),
          labP(inner, `内分点 ${f(m)}:${f(nn)}`, [0, 1]),
          labP(M, "中点", [0, -1]),
        ],
        primary: row("内分点", `(${f(inner[0])}, ${f(inner[1])})`),
      };
    },
  },
  {
    id: "circleLine",
    name: "直线与圆的位置关系",
    cat: "coord",
    brief: "判断直线与圆相交、相切还是相离，并给出弦长、弦中点与交点坐标。",
    modes: [
      {
        id: "centerLine",
        label: "圆心 + 半径 + 直线 Ax+By+C=0",
        fields: [
          { k: "a", label: "圆心 x₀", def: "0", kind: "num" },
          { k: "b", label: "圆心 y₀", def: "0", kind: "num" },
          { k: "r", label: "半径 r", def: "5", kind: "len" },
          { k: "A", label: "直线 A", def: "3", kind: "num" },
          { k: "B", label: "直线 B", def: "4", kind: "num" },
          { k: "C", label: "直线 C", def: "-5", kind: "num" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      needNum(errs, n, raw, { a: "圆心 x₀", b: "圆心 y₀", A: "直线 A", B: "直线 B", C: "直线 C" });
      needPos(errs, n, raw, { r: "半径 r" });
      if (errs.length) return { errors: errs };
      const O = pt(n.a, n.b);
      const r = n.r;
      const A = n.A;
      const B = n.B;
      const C = n.C;
      const nlen = Math.hypot(A, B);
      if (nlen < EPS) return { errors: ["A 与 B 不能同时为 0，否则这不是一条直线"] };
      const val = A * O[0] + B * O[1] + C;
      const d = Math.abs(val) / nlen;
      const foot = pt(O[0] - (A * val) / (nlen * nlen), O[1] - (B * val) / (nlen * nlen));
      const span = lineSpan(A, B, C, O, r + 2);
      const rel = d > r + 1e-9 ? "相离（无交点）" : Math.abs(d - r) <= 1e-9 ? "相切（1 个交点）" : "相交（2 个交点）";
      const rows: Row[] = [
        row("圆心", `(${f(O[0])}, ${f(O[1])})`),
        row("半径 r", f(r)),
        row("直线方程", lineEqStr(A, B, C, ctx.digits)),
        row("圆心到直线的距离 d", f(d)),
        row("位置关系", rel),
        row("比较 d 与 r", `d ${d > r ? ">" : d < r ? "<" : "="} r（${f(d)} ${d > r ? ">" : d < r ? "<" : "="} ${f(r)}）`),
      ];
      let figure: Figure = [circ(O, r, false), segP(span[0], span[1]), dotP(O)];
      if (d < r - 1e-9) {
        const half = Math.sqrt(Math.max(0, r * r - d * d));
        const u = pt(-B / nlen, A / nlen);
        const P1 = add(foot, mul(u, half));
        const P2 = sub(foot, mul(u, half));
        rows.push(row("弦长 = 2√(r²−d²)", f(2 * half)));
        rows.push(row("弦中点（垂足）", `(${f(foot[0])}, ${f(foot[1])})`));
        rows.push(row("交点 1", `(${f(P1[0])}, ${f(P1[1])})`));
        rows.push(row("交点 2", `(${f(P2[0])}, ${f(P2[1])})`));
        rows.push(row("弦心距", f(d)));
        figure = [
          circ(O, r, false),
          segP(span[0], span[1]),
          segP(P1, P2),
          segP(O, foot, true),
          dotP(O),
          dotP(foot),
          dotP(P1),
          dotP(P2),
          rightP(foot, O, P1, 0.6),
          labP(O, "O", [-1, 0]),
          labP(foot, `d = ${f(d)}`, [0, -1]),
          labP(P1, "交点 1", [1, 1]),
          labP(P2, "交点 2", [-1, -1]),
        ];
      } else if (Math.abs(d - r) <= 1e-9) {
        rows.push(row("切点", `(${f(foot[0])}, ${f(foot[1])})`));
        rows.push(row("切线判定", `圆心到直线距离等于半径 ${f(r)}`));
        figure = [
          circ(O, r, false),
          segP(span[0], span[1]),
          segP(O, foot),
          dotP(O),
          dotP(foot),
          rightP(foot, O, span[1], 0.6),
          labP(foot, "切点", [1, -1]),
        ];
      } else {
        rows.push(row("最近点（圆心到直线的垂足）", `(${f(foot[0])}, ${f(foot[1])})`));
        rows.push(row("圆心到直线距离与半径之差", f(d - r)));
        figure = [
          circ(O, r, false),
          segP(span[0], span[1]),
          segP(O, foot, true),
          dotP(O),
          dotP(foot),
          labP(foot, `d = ${f(d)}`, [1, -1]),
        ];
      }
      return {
        rows,
        formulas: [
          { name: "圆心到直线距离", expr: "d = |A·x₀ + B·y₀ + C| / √(A² + B²)" },
          { name: "位置关系判定", expr: "d < r 相交；d = r 相切；d > r 相离" },
          { name: "弦长", expr: "弦长 = 2√(r² − d²)" },
          { name: "切线条件", expr: "圆心到直线的距离等于半径" },
        ],
        figure,
        primary: row("位置关系", rel),
      };
    },
  },
  {
    id: "transform",
    name: "坐标变换",
    cat: "coord",
    brief: "对点集（或图形顶点）做平移、旋转、对称、位似缩放，给出变换后的坐标与面积倍数。",
    modes: [
      {
        id: "translate",
        label: "平移（向量 dx, dy）",
        fields: [
          { k: "pts", label: "顶点坐标（x,y 用分号或换行隔开）", def: "0,0; 4,0; 4,3; 0,3", kind: "text" },
          { k: "dx", label: "平移量 dx", def: "3", kind: "num" },
          { k: "dy", label: "平移量 dy", def: "-2", kind: "num" },
        ],
      },
      {
        id: "rotate",
        label: "绕原点旋转",
        fields: [
          { k: "pts", label: "顶点坐标（x,y 用分号或换行隔开）", def: "0,0; 4,0; 4,3", kind: "text" },
          { k: "deg", label: "旋转角（逆时针）", def: "90", kind: "ang" },
        ],
      },
      {
        id: "scale",
        label: "以原点为中心位似缩放",
        fields: [
          { k: "pts", label: "顶点坐标（x,y 用分号或换行隔开）", def: "0,0; 4,0; 4,3; 0,3", kind: "text" },
          { k: "k", label: "缩放比 k", def: "2", kind: "num" },
        ],
      },
      {
        id: "reflectX",
        label: "关于 x 轴对称",
        fields: [{ k: "pts", label: "顶点坐标（x,y 用分号或换行隔开）", def: "0,1; 4,1; 4,4; 0,4", kind: "text" }],
      },
      {
        id: "reflectY",
        label: "关于 y 轴对称",
        fields: [{ k: "pts", label: "顶点坐标（x,y 用分号或换行隔开）", def: "1,0; 4,0; 4,3; 1,3", kind: "text" }],
      },
      {
        id: "reflectOrigin",
        label: "关于原点对称",
        fields: [{ k: "pts", label: "顶点坐标（x,y 用分号或换行隔开）", def: "1,1; 4,1; 4,3; 1,3", kind: "text" }],
      },
      {
        id: "reflectYX",
        label: "关于直线 y = x 对称",
        fields: [{ k: "pts", label: "顶点坐标（x,y 用分号或换行隔开）", def: "1,0; 4,0; 4,3; 1,3", kind: "text" }],
      },
      {
        id: "reflectNegYX",
        label: "关于直线 y = −x 对称",
        fields: [{ k: "pts", label: "顶点坐标（x,y 用分号或换行隔开）", def: "1,0; 4,0; 4,3; 1,3", kind: "text" }],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const parsed = parsePointList(raw.pts === undefined ? "" : raw.pts);
      if (parsed.error) return { errors: [parsed.error] };
      const pts = parsed.pts;
      if (!pts.length) return { errors: ["请填写至少一个点的坐标"] };
      const errs: string[] = [];
      let mat: (p: Vec) => Vec = (p) => p;
      let describe = "";
      if (mode === "translate") {
        needNum(errs, n, raw, { dx: "平移量 dx", dy: "平移量 dy" });
        if (errs.length) return { errors: errs };
        mat = (p) => pt(p[0] + n.dx, p[1] + n.dy);
        describe = `平移向量 (${f(n.dx)}, ${f(n.dy)})`;
      } else if (mode === "rotate") {
        needNum(errs, n, raw, { deg: "旋转角" });
        if (errs.length) return { errors: errs };
        const t = toRad(n.deg, ctx.unit);
        mat = (p) => pt(p[0] * Math.cos(t) - p[1] * Math.sin(t), p[0] * Math.sin(t) + p[1] * Math.cos(t));
        describe = `绕原点逆时针旋转 ${g(t)}`;
      } else if (mode === "scale") {
        needNum(errs, n, raw, { k: "缩放比 k" });
        if (errs.length) return { errors: errs };
        mat = (p) => pt(p[0] * n.k, p[1] * n.k);
        describe = `以原点为中心位似放大 ${f(n.k)} 倍`;
      } else if (mode === "reflectX") {
        mat = (p) => pt(p[0], -p[1]);
        describe = "关于 x 轴对称";
      } else if (mode === "reflectY") {
        mat = (p) => pt(-p[0], p[1]);
        describe = "关于 y 轴对称";
      } else if (mode === "reflectOrigin") {
        mat = (p) => pt(-p[0], -p[1]);
        describe = "关于原点对称（中心对称）";
      } else if (mode === "reflectYX") {
        mat = (p) => pt(p[1], p[0]);
        describe = "关于直线 y = x 对称";
      } else {
        mat = (p) => pt(-p[1], -p[0]);
        describe = "关于直线 y = −x 对称";
      }
      const out = pts.map(mat);
      const S1 = pts.length >= 3 ? Math.abs(polyArea(pts)) : 0;
      const S2 = out.length >= 3 ? Math.abs(polyArea(out)) : 0;
      const iso = mode === "translate" || mode === "rotate" || mode.startsWith("reflect");
      const rows: Row[] = [
        row("变换", describe),
        ...pts.map((p, i) => row(`P${i + 1}`, `(${f(p[0])}, ${f(p[1])}) → (${f(out[i][0])}, ${f(out[i][1])})`)),
      ];
      if (S1 > 0) {
        rows.push(row("原图形面积", f(S1)));
        rows.push(row("变换后面积", f(S2)));
        rows.push(row("面积倍数", f(S2 / S1)));
      }
      rows.push(row("是否等距变换（保长度与角度）", iso ? "是（平移、旋转、轴对称都是等距变换）" : "否（长度按比例变化，角度不变）"));
      return {
        rows,
        formulas: [
          { name: "平移", expr: "(x, y) → (x + dx, y + dy)" },
          { name: "绕原点逆时针旋转 θ", expr: "(x, y) → (x·cos θ − y·sin θ, x·sin θ + y·cos θ)" },
          { name: "关于 x 轴 / y 轴对称", expr: "(x, y) → (x, −y) / (−x, y)" },
          { name: "关于原点对称", expr: "(x, y) → (−x, −y)" },
          { name: "关于 y = x / y = −x 对称", expr: "(x, y) → (y, x) / (−y, −x)" },
          { name: "位似缩放", expr: "(x, y) → (kx, ky)，面积变为 k² 倍" },
        ],
        figure: [
          ...(pts.length >= 2 ? [poly(pts, { fill: false, dash: true })] : pts.map((p) => dotP(p))),
          ...(out.length >= 2 ? [poly(out, { fill: true })] : out.map((p) => dotP(p))),
          ...pts.map((p, i) => dotP(p)),
          ...pts.map((p, i) => labP(p, `P${i + 1}`, [-1, -1])),
          ...out.map((p, i) => dotP(p)),
          ...out.map((p, i) => labP(p, `P${i + 1}′`, [1, 1])),
        ],
        primary: row("变换", describe),
      };
    },
  },
  // ───────────────────────── 定理助手 ─────────────────────────
  {
    id: "pythagorean",
    name: "勾股定理",
    cat: "theorem",
    brief: "由两直角边求斜边、由斜边与一直角边求另一边，以及三维空间的对角线。",
    modes: [
      {
        id: "legs",
        label: "已知两条直角边 → 斜边",
        fields: [
          { k: "p", label: "直角边 p", def: "3", kind: "len" },
          { k: "q", label: "直角边 q", def: "4", kind: "len" },
        ],
      },
      {
        id: "hyp",
        label: "已知斜边 + 一条直角边",
        fields: [
          { k: "c", label: "斜边 c", def: "13", kind: "len" },
          { k: "p", label: "直角边 p", def: "5", kind: "len" },
        ],
      },
      {
        id: "space",
        label: "三维空间（长方体的体对角线）",
        fields: [
          { k: "a", label: "长 a", def: "3", kind: "len" },
          { k: "b", label: "宽 b", def: "4", kind: "len" },
          { k: "c", label: "高 c", def: "12", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      if (mode === "space") {
        needPos(errs, n, raw, { a: "长 a", b: "宽 b", c: "高 c" });
        if (errs.length) return { errors: errs };
        const d = Math.sqrt(n.a * n.a + n.b * n.b + n.c * n.c);
        const face = Math.hypot(n.a, n.b);
        return {
          rows: [
            row("长 a", f(n.a)),
            row("宽 b", f(n.b)),
            row("高 c", f(n.c)),
            row("底面对角线 √(a²+b²)", f(face)),
            row("体对角线 √(a²+b²+c²)", f(d)),
            row("体对角线与底面的夹角", g(Math.atan2(n.c, face))),
            row("体对角线与 a 棱的夹角", g(Math.acos(clamp1(n.a / d)))),
            row("是否整数解（勾股数）", Number.isInteger(d) ? `是，(${n.a}, ${n.b}, ${n.c}) 的体对角线为整数 ${d}` : "否"),
          ],
          formulas: [
            { name: "勾股定理", expr: "c² = a² + b²" },
            { name: "三维勾股定理", expr: "d² = a² + b² + c²（长方体体对角线）" },
            { name: "先算面对角线", expr: "底面对角线 = √(a² + b²)，再与高作直角三角形" },
          ],
          figure: (() => {
            const pts = boxPrims(n.a, n.c, n.b);
            const F0 = pt(0, 0);
            const F2 = pt(n.a, n.c);
            const B2 = pt(n.a + 0.45 * n.b, n.c + 0.34 * n.b);
            return [
              ...pts,
              segP(F0, B2, true),
              dotP(F0),
              dotP(B2),
              labP(mid(F0, B2), `体对角线 = ${f(d)}`, [0, -1]),
            ];
          })(),
          primary: row("体对角线 d", f(d)),
        };
      }
      needPos(errs, n, raw, mode === "legs" ? { p: "直角边 p", q: "直角边 q" } : { c: "斜边 c", p: "直角边 p" });
      if (errs.length) return { errors: errs };
      let p = NaN;
      let q = NaN;
      let c = NaN;
      if (mode === "legs") {
        p = n.p;
        q = n.q;
        c = Math.hypot(p, q);
      } else {
        if (n.p >= n.c) return { errors: ["直角边必须小于斜边，请检查两个数据"] };
        p = n.p;
        c = n.c;
        q = Math.sqrt(c * c - p * p);
      }
      const isInt = [p, q, c].every((x) => Math.abs(x - Math.round(x)) < 1e-9);
      const scale = Math.min(p, q, c) || 1;
      const isPrimitive = isInt && [p / scale, q / scale, c / scale].every((x) => Math.abs(x - Math.round(x)) < 1e-9);
      return {
        rows: [
          row("直角边 p", f(p)),
          row("直角边 q", f(q)),
          row("斜边 c = √(p²+q²)", f(c)),
          row("面积 S = ½pq", f((p * q) / 2)),
          row("周长 P", f(p + q + c)),
          row("斜边上的高 h = pq/c", f((p * q) / c)),
          row("锐角（对 p 的角）", g(Math.atan2(p, q))),
          row("锐角（对 q 的角）", g(Math.atan2(q, p))),
          row("内切圆半径 (p+q−c)/2", f((p + q - c) / 2)),
          row("外接圆半径 c/2", f(c / 2)),
          row("直角边比 p : q", `1 : ${f(q / p)}`),
          row("是否勾股数（三边都是整数）", isInt ? (isPrimitive ? "是（且互质，本原勾股数）" : "是") : "否（存在无理边长）"),
        ],
        formulas: [
          { name: "勾股定理", expr: "c² = p² + q²" },
          { name: "求直角边", expr: "p = √(c² − q²)" },
          { name: "面积", expr: "S = ½·p·q" },
          { name: "斜边上的高", expr: "h = p·q / c" },
          { name: "射影定理", expr: "p² = c·p′，q² = c·q′" },
          { name: "常见勾股数", expr: "3-4-5、5-12-13、8-15-17、7-24-25…" },
        ],
        figure: (() => {
          const B = pt(q, 0);
          const C = pt(0, p);
          const sqQ = squareOn(pt(0, 0), B, -1);
          const sqP = squareOn(pt(0, 0), C, 1);
          const sqC = squareOn(B, C, 1);
          return [
            ...sqQ.prims,
            ...sqP.prims,
            ...sqC.prims,
            poly([pt(0, 0), B, C], { fill: true }),
            rightP(pt(0, 0), B, C, 0.14 * Math.min(p, q)),
            dimP(pt(0, 0), B, `q = ${f(q)}`, -1),
            dimP(pt(0, 0), C, `p = ${f(p)}`, -1),
            dimP(B, C, `c = ${f(c)}`, 1),
            labP(sqQ.center, `q² = ${f(q * q)}`, [0, -1]),
            labP(sqP.center, `p² = ${f(p * p)}`, [-1, 0]),
            labP(sqC.center, `c² = ${f(c * c)}`, [1, 1]),
            labP(add(C, pt(0.5, 0.5)), `p² + q² = c²`, [1, 1]),
          ];
        })(),
        primary: row("斜边 c", f(c)),
      };
    },
  },
  {
    id: "similarTriangles",
    name: "相似三角形",
    cat: "theorem",
    brief: "由对应边求相似比、周长比与面积比，并求出未知的对应边长。",
    modes: [
      {
        id: "ratio",
        label: "相似比 + 对应边",
        fields: [
          { k: "a1", label: "第一三角形边 a₁", def: "3", kind: "len" },
          { k: "a2", label: "第二三角形对应边 a₂", def: "6", kind: "len" },
          { k: "b1", label: "第一三角形边 b₁", def: "4", kind: "len" },
        ],
      },
      {
        id: "areas",
        label: "面积比 → 相似比与边长",
        fields: [
          { k: "r", label: "面积比（大 ÷ 小）", def: "9", kind: "len" },
          { k: "a1", label: "小三角形的某条边", def: "5", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const errs: string[] = [];
      if (mode === "ratio") {
        needPos(errs, n, raw, { a1: "第一三角形边 a₁", a2: "第二三角形对应边 a₂", b1: "第一三角形边 b₁" });
        if (errs.length) return { errors: errs };
        const k = n.a2 / n.a1;
        const b2 = n.b1 * k;
        return {
          rows: [
            row("对应边 a₁ → a₂", `${f(n.a1)} → ${f(n.a2)}`),
            row("相似比 k（第二 ÷ 第一）", f(k)),
            row("反比（第一 ÷ 第二）", f(1 / k)),
            row("周长比", `${f(1)} : ${f(k)}（等于相似比）`),
            row("面积比", `${f(1)} : ${f(k * k)}（等于相似比的平方）`),
            row("体积比（若为立体）", `${f(1)} : ${f(k * k * k)}（等于相似比的立方）`),
            row("已知 b₁", f(n.b1)),
            row("对应边 b₂ = b₁·k", f(b2)),
            row("若周长为 C₁", `C₂ = ${f(k)} × C₁`),
            row("若面积为 S₁", `S₂ = ${f(k * k)} × S₁`),
          ],
          formulas: [
            { name: "相似比", expr: "k = a₂ / a₁（对应边之比）" },
            { name: "周长比", expr: "C₂ / C₁ = k" },
            { name: "面积比", expr: "S₂ / S₁ = k²" },
            { name: "体积比", expr: "V₂ / V₁ = k³（相似立体）" },
            { name: "相似判定", expr: "AA（两角相等）、SSS（三边成比例）、SAS（两边成比例且夹角相等）" },
          ],
          figure: (() => {
            const A = pt(0, 0);
            const B = pt(3, 0);
            const C = pt(0.6, 2.4);
            const k = n.a2 / n.a1;
            const A2 = pt(4.2, 0);
            const B2 = pt(4.2 + 3 * k, 0);
            const C2 = pt(4.2 + 0.6 * k, 2.4 * k);
            return [
              poly([A, B, C], { fill: true }),
              poly([A2, B2, C2], { fill: true }),
              ...edgeLabels([A, B, C], [`a₁ = ${f(n.a1)}`, `b₁ = ${f(n.b1)}`, undefined]),
              ...edgeLabels([A2, B2, C2], [`a₂ = ${f(n.a2)}`, `b₂ = ${f(n.b1 * k)}`, undefined]),
              labP(pt(0, -0.6), "原三角形", [0, -1]),
              labP(pt(4.2, -0.6), `相似比 k = ${f(k)}`, [0, -1]),
            ];
          })(),
          primary: row("相似比 k", f(k)),
        };
      }
      needPos(errs, n, raw, { r: "面积比（大 ÷ 小）", a1: "小三角形的某条边" });
      if (errs.length) return { errors: errs };
      const k = Math.sqrt(n.r);
      return {
        rows: [
          row("面积比", f(n.r)),
          row("相似比 k = √(面积比)", f(k)),
          row("小三角形边 a₁", f(n.a1)),
          row("大三角形对应边 a₂ = k·a₁", f(k * n.a1)),
          row("周长比", `${f(1)} : ${f(k)}`),
          row("面积比校验", `${f(1)} : ${f(k * k)}`),
          row("若小三角形周长为 P₁", `大三角形周长 = ${f(k)} × P₁`),
        ],
        formulas: [
          { name: "由面积比求相似比", expr: "k = √(S₂ / S₁)" },
          { name: "对应边", expr: "a₂ = k · a₁" },
          { name: "周长比", expr: "C₂ / C₁ = k" },
          { name: "面积比", expr: "S₂ / S₁ = k²" },
        ],
        figure: (() => {
          const A = pt(0, 0);
          const B = pt(3, 0);
          const C = pt(0.6, 2.4);
          const A2 = pt(4.2, 0);
          const B2 = pt(4.2 + 3 * k, 0);
          const C2 = pt(4.2 + 0.6 * k, 2.4 * k);
          return [
            poly([A, B, C], { fill: true }),
            poly([A2, B2, C2], { fill: true }),
            ...edgeLabels([A, B, C], [`a₁ = ${f(n.a1)}`, undefined, undefined]),
            ...edgeLabels([A2, B2, C2], [`a₂ = ${f(k * n.a1)}`, undefined, undefined]),
            labP(pt(4.2, -0.6), `k = ${f(k)}`, [0, -1]),
          ];
        })(),
        primary: row("相似比 k", f(k)),
      };
    },
  },
  {
    id: "rightTrig",
    name: "解直角三角形（三角函数）",
    cat: "theorem",
    brief: "用三角函数求解直角三角形：由斜边、直角边与锐角的任意组合求出全部元素与三角函数值。",
    modes: [
      {
        id: "hypAngle",
        label: "斜边 + 锐角",
        fields: [
          { k: "c", label: "斜边 c", def: "10", kind: "len" },
          { k: "A", label: "锐角 A", def: "30", kind: "ang" },
        ],
      },
      {
        id: "legAngle",
        label: "直角边 + 锐角",
        fields: [
          { k: "p", label: "直角边 p（∠A 的邻边）", def: "6", kind: "len" },
          { k: "A", label: "锐角 A", def: "40", kind: "ang" },
        ],
      },
      {
        id: "twoLegs",
        label: "两条直角边",
        fields: [
          { k: "p", label: "直角边 p", def: "3", kind: "len" },
          { k: "q", label: "直角边 q", def: "4", kind: "len" },
        ],
      },
      {
        id: "hypLeg",
        label: "斜边 + 直角边",
        fields: [
          { k: "c", label: "斜边 c", def: "13", kind: "len" },
          { k: "p", label: "直角边 p", def: "5", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      let p = NaN;
      let q = NaN;
      let c = NaN;
      let A = NaN;
      if (mode === "hypAngle") {
        needPos(errs, n, raw, { c: "斜边 c" });
        needAngle(errs, n, raw, { A: "锐角 A" }, ctx, PI / 2);
        if (errs.length) return { errors: errs };
        c = n.c;
        A = toRad(n.A, ctx.unit);
        p = c * Math.cos(A);
        q = c * Math.sin(A);
      } else if (mode === "legAngle") {
        needPos(errs, n, raw, { p: "直角边 p" });
        needAngle(errs, n, raw, { A: "锐角 A" }, ctx, PI / 2);
        if (errs.length) return { errors: errs };
        p = n.p;
        A = toRad(n.A, ctx.unit);
        q = p * Math.tan(A);
        c = p / Math.cos(A);
      } else if (mode === "twoLegs") {
        needPos(errs, n, raw, { p: "直角边 p", q: "直角边 q" });
        if (errs.length) return { errors: errs };
        p = n.p;
        q = n.q;
        c = Math.hypot(p, q);
        A = Math.atan2(q, p);
      } else {
        needPos(errs, n, raw, { c: "斜边 c", p: "直角边 p" });
        if (errs.length) return { errors: errs };
        if (n.p >= n.c) return { errors: ["直角边必须小于斜边"] };
        p = n.p;
        c = n.c;
        q = Math.sqrt(c * c - p * p);
        A = Math.acos(p / c);
      }
      const B = PI / 2 - A;
      const S = (p * q) / 2;
      return {
        rows: [
          row("锐角 A", g(A)),
          row("锐角 B = 90° − A", g(B)),
          row("直角 C", g(PI / 2)),
          row("邻边（∠A 的邻边 p）", f(p)),
          row("对边（∠A 的对边 q）", f(q)),
          row("斜边 c", f(c)),
          row("sin A = 对边/斜边", f(Math.sin(A))),
          row("cos A = 邻边/斜边", f(Math.cos(A))),
          row("tan A = 对边/邻边", f(Math.tan(A))),
          row("sin B", f(Math.sin(B))),
          row("cos B", f(Math.cos(B))),
          row("tan B", f(Math.tan(B))),
          row("面积 S = ½pq", f(S)),
          row("周长 P", f(p + q + c)),
          row("斜边上的高 h = pq/c", f((p * q) / c)),
          row("sin²A + cos²A", f(Math.sin(A) * Math.sin(A) + Math.cos(A) * Math.cos(A))),
          row("内切圆半径", f((p + q - c) / 2)),
          row("外接圆半径", f(c / 2)),
        ],
        formulas: [
          { name: "正弦", expr: "sin A = 对边 / 斜边" },
          { name: "余弦", expr: "cos A = 邻边 / 斜边" },
          { name: "正切", expr: "tan A = 对边 / 邻边" },
          { name: "互余关系", expr: "A + B = 90°，sin A = cos B" },
          { name: "平方关系", expr: "sin²A + cos²A = 1" },
          { name: "面积", expr: "S = ½ · 邻边 · 对边" },
        ],
        figure: (() => {
          const P = pt(0, 0);
          const Q = pt(p, 0);
          const R = pt(0, q);
          return [
            poly([P, Q, R], { fill: true }),
            rightP(P, Q, R, 0.12 * Math.min(p, q)),
            angP(Q, P, R, 0.2 * Math.min(p, q)),
            labP(add(Q, mul(unit(add(unit(sub(P, Q)), unit(sub(R, Q)))), 0.5)), `A = ${g(A)}`, unit(add(unit(sub(P, Q)), unit(sub(R, Q))))),
            dimP(P, Q, `p = ${f(p)}`, -1),
            dimP(P, R, `q = ${f(q)}`, -1),
            dimP(Q, R, `c = ${f(c)}`, 1),
            labP(pt(p * 0.5, q * 0.5), `sin A = ${f(Math.sin(A))}`, [1, 1]),
          ];
        })(),
        primary: row("斜边 c", f(c)),
      };
    },
  },
  {
    id: "angleTool",
    name: "角度工具（分类与补余）",
    cat: "theorem",
    brief: "判断角度类型，并给出余角、补角、优角与两个相邻角的和差。",
    modes: [
      {
        id: "classify",
        label: "角度分类与补余角",
        fields: [{ k: "deg", label: "角度", def: "35", kind: "ang" }],
      },
      {
        id: "addition",
        label: "两个相邻角",
        fields: [
          { k: "a", label: "角 α", def: "40", kind: "ang" },
          { k: "b", label: "角 β", def: "65", kind: "ang" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      if (mode === "addition") {
        needAngle(errs, n, raw, { a: "角 α", b: "角 β" }, ctx, 2 * PI);
        if (errs.length) return { errors: errs };
        const a = toRad(n.a, ctx.unit);
        const b = toRad(n.b, ctx.unit);
        const sum = a + b;
        return {
          rows: [
            row("角 α", g(a)),
            row("角 β", g(b)),
            row("和 α + β（角度加法公理）", g(sum)),
            row("差 |α − β|", g(Math.abs(a - b))),
            row("和是否等于直角", Math.abs(sum - PI / 2) < 1e-9 ? "是（互余）" : "否"),
            row("和是否等于平角", Math.abs(sum - PI) < 1e-9 ? "是（互补）" : "否"),
            row("剩余到平角的部分", sum < PI ? g(PI - sum) : "已超过平角"),
            row("剩余到周角的部分", sum < 2 * PI ? g(2 * PI - sum) : "已超过周角"),
            row("是否三线共点可构成三角形", sum < PI ? "可以（第三角为 " + g(PI - sum) + "）" : "不可以（两角之和已不小于 180°）"),
          ],
          formulas: [
            { name: "角度加法公理", expr: "若射线 OB 在 ∠AOC 内部，则 ∠AOC = ∠AOB + ∠BOC" },
            { name: "互余", expr: "两角之和为 90°" },
            { name: "互补", expr: "两角之和为 180°" },
          ],
          figure: [
            segP(pt(0, 0), pt(3, 0)),
            segP(pt(0, 0), pt(3 * Math.cos(a), 3 * Math.sin(a))),
            segP(pt(0, 0), pt(3 * Math.cos(sum), 3 * Math.sin(sum))),
            angP(pt(0, 0), pt(3, 0), pt(3 * Math.cos(a), 3 * Math.sin(a)), 1.1),
            angP(pt(0, 0), pt(3 * Math.cos(a), 3 * Math.sin(a)), pt(3 * Math.cos(sum), 3 * Math.sin(sum)), 1.6),
            dotP(pt(0, 0)),
            labP(pt(1.3, 0.35), `α = ${g(a)}`, [0, -1]),
            labP(pt(3 * Math.cos((a + sum) / 2) * 0.6, 3 * Math.sin((a + sum) / 2) * 0.6), `β = ${g(b)}`, [1, 1]),
            labP(pt(3 * Math.cos(sum), 3 * Math.sin(sum)), `α+β = ${g(sum)}`, [1, 1]),
          ],
          primary: row("α + β", g(sum)),
        };
      }
      needNum(errs, n, raw, { deg: "角度" });
      if (errs.length) return { errors: errs };
      const th = toRad(n.deg, ctx.unit);
      if (th < 0 || th >= 2 * PI) {
        return { errors: [`角度需要在 0 到 ${ctx.unit === "deg" ? "360°" : "2π rad"} 之间`] };
      }
      const deg = th * R2D;
      const kind =
        deg === 0
          ? "零角"
          : deg < 90
            ? "锐角"
            : deg === 90
              ? "直角"
              : deg < 180
                ? "钝角"
                : deg === 180
                  ? "平角"
                  : deg < 360
                    ? "优角（大于平角）"
                    : "周角";
      return {
        rows: [
          row("角度", g(th)),
          row("角度类型", kind),
          row("余角 90° − θ", deg <= 90 ? g(PI / 2 - th) : "不存在（已超过 90°）"),
          row("补角 180° − θ", deg <= 180 ? g(PI - th) : "不存在（已超过 180°）"),
          row("优角 360° − θ", g(2 * PI - th)),
          row("是否锐角 / 直角 / 钝角", deg < 90 ? "锐角" : deg === 90 ? "直角" : deg < 180 ? "钝角" : "其他"),
          row("对应的弧度值", `${fmtNum(th, 8)} rad`),
          row("对应的度分形式（近似）", `${Math.floor(deg)}° ${fmtNum((deg - Math.floor(deg)) * 60, 2)}′`),
          row("在单位圆上的坐标 (cos, sin)", `(${f(Math.cos(th))}, ${f(Math.sin(th))})`),
        ],
        formulas: [
          { name: "锐角 / 直角 / 钝角", expr: "小于 90° / 等于 90° / 大于 90° 且小于 180°" },
          { name: "余角", expr: "90° − θ" },
          { name: "补角", expr: "180° − θ" },
          { name: "优角", expr: "360° − θ" },
        ],
        figure: [
          segP(pt(0, 0), pt(3, 0)),
          segP(pt(0, 0), pt(3 * Math.cos(th), 3 * Math.sin(th))),
          arcP(pt(0, 0), 1.6, 0, th),
          dotP(pt(0, 0)),
          labP(pt(0, 0), "O", [-1, -1]),
          labP(pt(1.9 * Math.cos(th / 2), 1.9 * Math.sin(th / 2)), g(th), [Math.cos(th / 2), Math.sin(th / 2)]),
          labP(pt(3, 0), "射线 1", [0, -1]),
          labP(pt(3 * Math.cos(th), 3 * Math.sin(th)), "射线 2", [1, 1]),
        ],
        primary: row("角度类型", kind),
      };
    },
  },
  {
    id: "parallelLines",
    name: "平行线与截线（8 个角）",
    cat: "theorem",
    brief: "两条平行线被一条截线所截：由其中一个角求出全部 8 个角并标出相互关系。",
    modes: [
      {
        id: "one",
        label: "已知其中一个角",
        fields: [
          { k: "deg", label: "已知角度", def: "65", kind: "ang" },
          { k: "pos", label: "它在图中是第几个角（1–8）", def: "1", kind: "int" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needAngle(errs, n, raw, { deg: "已知角度" }, ctx, PI);
      needNum(errs, n, raw, { pos: "它在图中是第几个角（1–8）" });
      if (errs.length) return { errors: errs };
      const pos = Math.round(n.pos);
      if (!(pos >= 1 && pos <= 8)) return { errors: ["位置编号需要在 1 到 8 之间"] };
      const base = toRad(n.deg, ctx.unit);
      // 角编号：上排 1-4（左上→右上顺时针 1,2,3,4），下排 5-8 与上排同位角
      const angles: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
      const group = pos % 2 === 1 ? 1 : 2; // 奇数为锐角组
      const pattern = [1, 2, 1, 2, 1, 2, 1, 2];
      for (let i = 0; i < 8; i++) angles[i] = pattern[i] === group ? base : PI - base;
      const names = ["同位角", "内错角", "同旁内角", "对顶角", "邻补角"];
      return {
        rows: [
          row("已知角度", g(base)),
          row("它在图中的编号", `第 ${pos} 个角`),
          ...angles.map((a, i) => row(`第 ${i + 1} 个角${i + 1 === pos ? "（已知）" : ""}`, g(a))),
          row("相等的角（同位角 / 内错角 / 对顶角）", angles
            .map((a, i) => (Math.abs(a - angles[pos - 1]) < 1e-9 ? i + 1 : 0))
            .filter((x) => x > 0)
            .join("、")),
          row("互补的角（同旁内角 / 邻补角）", angles
            .map((a, i) => (Math.abs(a + angles[pos - 1] - PI) < 1e-9 ? i + 1 : 0))
            .filter((x) => x > 0)
            .join("、")),
          row("关系名词", names.join("、")),
          row("同位角", "相等（两直线平行）"),
          row("内错角", "相等（两直线平行）"),
          row("同旁内角", "互补，和为 180°（两直线平行）"),
          row("对顶角", "相等"),
          row("邻补角", "互补，和为 180°"),
        ],
        formulas: [
          { name: "同位角", expr: "两条平行线被截线所截，同位角相等" },
          { name: "内错角", expr: "内错角相等" },
          { name: "同旁内角", expr: "同旁内角互补（和为 180°）" },
          { name: "对顶角", expr: "对顶角相等" },
          { name: "邻补角", expr: "邻补角互补" },
        ],
        figure: (() => {
          const y1 = 0;
          const y2 = 2.4;
          const slope = Math.tan(base);
          const xAt = (y: number) => (y - y1) / slope;
          const prims: Prim[] = [
            segP(pt(-4, y1), pt(4, y1)),
            segP(pt(-4, y2), pt(4, y2)),
            segP(pt(xAt(-1.2), -1.2), pt(xAt(y2 + 1.2), y2 + 1.2)),
          ];
          const corner = (i: number): Vec => {
            const y = i < 4 ? y1 : y2;
            const x = xAt(y);
            const side = i % 2 === 0 ? -1 : 1;
            const yOffset = 0.35;
            return pt(x + side * 0.55, y + (i % 4 < 2 ? yOffset : -yOffset));
          };
          for (let i = 0; i < 8; i++) {
            const p = corner(i);
            prims.push(labP(p, `${i + 1}`, [1, 1]));
          }
          prims.push(labP(pt(xAt(y1), y1), `已知 ∠${pos} = ${g(base)}`, [1, -1]));
          return prims;
        })(),
        primary: row("全部 8 个角", `${g(base)} 与 ${g(PI - base)} 两类`),
      };
    },
  },
  {
    id: "elevation",
    name: "仰角测高",
    cat: "theorem",
    brief: "用水平距离与仰角（或两次观测的仰角差）求物体的高度。",
    modes: [
      {
        id: "single",
        label: "水平距离 + 仰角",
        fields: [
          { k: "d", label: "水平距离 d", def: "30", kind: "len" },
          { k: "e", label: "仰角", def: "35", kind: "ang" },
          { k: "eye", label: "观测者眼高 h₀", def: "1.6", kind: "len" },
        ],
      },
      {
        id: "twice",
        label: "前后两次观测 + 前进距离",
        fields: [
          { k: "d", label: "两次观测点距离 d", def: "20", kind: "len" },
          { k: "e1", label: "第一次仰角 α", def: "42", kind: "ang" },
          { k: "e2", label: "第二次仰角 β", def: "58", kind: "ang" },
          { k: "eye", label: "观测者眼高 h₀", def: "1.6", kind: "len" },
        ],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      needPos(errs, n, raw, { d: "水平距离 d" });
      if (mode === "single") {
        needAngle(errs, n, raw, { e: "仰角" }, ctx, PI / 2);
        if (errs.length) return { errors: errs };
        const e = toRad(n.e, ctx.unit);
        const h = n.d * Math.tan(e);
        const total = h + n.eye;
        return {
          rows: [
            row("水平距离 d", f(n.d)),
            row("仰角", g(e)),
            row("物体高出观测视线的部分 h = d·tanα", f(h)),
            row("观测者眼高 h₀", f(n.eye)),
            row("物体总高度 h + h₀", f(total)),
            row("观测点到物体顶端的直线距离", f(Math.hypot(n.d, h))),
            row("俯角（看底部）", g(Math.atan2(n.eye, n.d))),
            row("tan α", f(Math.tan(e))),
          ],
          formulas: [
            { name: "测高", expr: "h = d · tan α" },
            { name: "含眼高", expr: "H = d·tan α + h₀" },
            { name: "斜距", expr: "观测点到顶端 = √(d² + h²)" },
          ],
          figure: (() => {
            const H = h + n.eye;
            return [
              segP(pt(0, 0), pt(n.d, 0)),
              poly([pt(n.d, 0), pt(n.d, H), pt(n.d - 0.6, H), pt(n.d - 0.6, 0)], { fill: true }),
              segP(pt(0, n.eye), pt(n.d, n.eye), true),
              segP(pt(0, n.eye), pt(n.d, H)),
              rightP(pt(n.d, n.eye), pt(n.d - 1, n.eye), pt(n.d, H), 0.5),
              dimP(pt(0, n.eye), pt(n.d, n.eye), `d = ${f(n.d)}`, -1),
              labP(pt(n.d, H), `H = ${f(H)}`, [1, 1]),
              labP(pt(n.d * 0.55, n.eye + h * 0.16), `α = ${g(e)}`, [0, 1]),
              dotP(pt(0, n.eye)),
            ];
          })(),
          primary: row("物体高度 H", f(total)),
        };
      }
      needAngle(errs, n, raw, { e1: "第一次仰角 α", e2: "第二次仰角 β" }, ctx, PI / 2);
      if (errs.length) return { errors: errs };
      const a1 = toRad(n.e1, ctx.unit);
      const a2 = toRad(n.e2, ctx.unit);
      if (Math.abs(a2 - a1) < 1e-9) return { errors: ["两次观测的仰角不能相同，否则无法解出高度"] };
      const h = (n.d * Math.tan(a1) * Math.tan(a2)) / (Math.tan(a2) - Math.tan(a1));
      if (!(h > 0)) {
        return { errors: ["这组角度解不出正的高度：第二次仰角需要大于第一次（越走越近）"] };
      }
      return {
        rows: [
          row("两次观测点距离 d", f(n.d)),
          row("第一次仰角 α", g(a1)),
          row("第二次仰角 β", g(a2)),
          row("物体高出视线的高度 h", f(h)),
          row("观测者眼高 h₀", f(n.eye)),
          row("物体总高度 h + h₀", f(h + n.eye)),
          row("第二次观测点到物体的水平距离", f(h / Math.tan(a2))),
          row("第一次观测点到物体的水平距离", f(h / Math.tan(a1))),
          row("两距离之差（应等于 d）", f(h / Math.tan(a1) - h / Math.tan(a2))),
        ],
        formulas: [
          { name: "两次观测测高", expr: "h = d·tan α·tan β / (tan β − tan α)" },
          { name: "等价形式", expr: "h = d / (cot α − cot β)" },
          { name: "含眼高", expr: "H = h + h₀" },
        ],
        figure: (() => {
          const d2 = h / Math.tan(a2);
          const x1 = d2 + n.d;
          const H = h + n.eye;
          return [
            segP(pt(0, 0), pt(x1, 0)),
            poly([pt(x1, 0), pt(x1, H), pt(x1 - 0.6, H), pt(x1 - 0.6, 0)], { fill: true }),
            segP(pt(0, n.eye), pt(x1, n.eye), true),
            segP(pt(0, n.eye), pt(x1, H)),
            segP(pt(d2, n.eye), pt(x1, H)),
            dotP(pt(0, n.eye)),
            dotP(pt(d2, n.eye)),
            angP(pt(0, n.eye), pt(d2, n.eye), pt(x1, H), 2.2),
            angP(pt(d2, n.eye), pt(0, n.eye), pt(x1, H), 1.4),
            labP(pt(x1, H), `H = ${f(H)}`, [1, 1]),
            labP(pt(d2 * 0.5, n.eye + 0.5), `β = ${g(a2)}`, [0, -1]),
            labP(pt(d2 + n.d * 0.5, n.eye + 0.35), `α = ${g(a1)}`, [0, 1]),
          ];
        })(),
        primary: row("物体高度 H", f(h + n.eye)),
      };
    },
  },
  {
    id: "polygonAngle",
    name: "多边形内角和与边数",
    cat: "theorem",
    brief: "已知边数、内角和或每个内角，求多边形的角度数据与边数。",
    modes: [
      {
        id: "n",
        label: "已知边数 n",
        fields: [{ k: "n", label: "边数 n", def: "8", kind: "int" }],
      },
      {
        id: "each",
        label: "已知正多边形每个内角",
        fields: [{ k: "deg", label: "每个内角", def: "135", kind: "ang" }],
      },
      {
        id: "sum",
        label: "已知内角和",
        fields: [{ k: "deg", label: "内角和", def: "1080", kind: "ang" }],
      },
    ],
    run: (mode, n, raw, ctx) => {
      const f = (x: number) => fmtNum(x, ctx.digits);
      const g = (x: number) => fmtAng(x, ctx);
      const errs: string[] = [];
      let k = NaN;
      if (mode === "n") {
        needPos(errs, n, raw, { n: "边数 n" });
        if (Number.isFinite(n.n) && (n.n < 3 || Math.abs(n.n - Math.round(n.n)) > 1e-9)) {
          errs.push("「边数 n」需要是不小于 3 的整数");
        }
        if (errs.length) return { errors: errs };
        k = Math.round(n.n);
      } else if (mode === "each") {
        needAngle(errs, n, raw, { deg: "每个内角" }, ctx, 2 * PI);
        if (errs.length) return { errors: errs };
        const each = toRad(n.deg, ctx.unit);
        if (!(each < PI)) return { errors: ["正多边形的每个内角必须小于 180°"] };
        k = (2 * PI) / (PI - each);
        if (Math.abs(k - Math.round(k)) > 1e-6) {
          return { errors: [`这个内角对应 n = ${fmtNum(k, 4)}，不是整数，因此不存在这样的正多边形`] };
        }
        k = Math.round(k);
      } else {
        needNum(errs, n, raw, { deg: "内角和" });
        if (errs.length) return { errors: errs };
        const sum = toRad(n.deg, ctx.unit);
        if (!(sum > 0) || sum >= 2 * PI * 1000) return { errors: ["内角和需要是一个正数（单位与当前角度单位一致）"] };
        k = sum / PI + 2;
        if (Math.abs(k - Math.round(k)) > 1e-6) {
          return { errors: [`内角和 ${g(sum)} 不对应整数边数（算得 n = ${fmtNum(k, 4)}）`] };
        }
        k = Math.round(k);
        if (k < 3) return { errors: ["内角和太小，至少要是三角形的 180°"] };
      }
      const sumIn = (k - 2) * PI;
      const eachIn = sumIn / k;
      const eachOut = (2 * PI) / k;
      return {
        rows: [
          row("边数 n", String(k)),
          row("内角和 (n−2)×180°", g(sumIn)),
          row("每个内角（正 n 边形）", g(eachIn)),
          row("每个外角 360°/n", g(eachOut)),
          row("外角和（恒为 360°）", g(2 * PI)),
          row("对角线总数 n(n−3)/2", String((k * (k - 3)) / 2)),
          row("从一个顶点出发的对角线数 n−3", String(k - 3)),
          row("三角形个数（从一个顶点连对角线）", String(k - 2)),
          row("是否正多边形可构造", k >= 3 ? "是" : "否"),
          row("每个内角与相邻外角之和", g(eachIn + eachOut)),
        ],
        formulas: [
          { name: "内角和", expr: "(n − 2) × 180°" },
          { name: "每个内角（正 n 边形）", expr: "(n − 2) × 180° / n" },
          { name: "外角和", expr: "恒为 360°（与边数无关）" },
          { name: "由每个内角求边数", expr: "n = 360° / (180° − 每个内角)" },
          { name: "由内角和求边数", expr: "n = 内角和 / 180° + 2" },
          { name: "对角线数", expr: "n(n − 3) / 2" },
        ],
        figure: (() => {
          const R = 1.6;
          const verts = ngonPts(k, R);
          return [
            poly(verts, { fill: true }),
            dotP(pt(0, 0)),
            ...verts.map((p) => segP(pt(0, 0), p, true)),
            labP(pt(0, 0), `n = ${k}`, [1, -1]),
            ...vertexMarks(
              verts,
              Array.from({ length: k }, () => eachIn),
              Array.from({ length: k }, () => undefined as string | undefined),
              0.22,
            ),
            labP(pt(0, R * 1.35), `内角和 = ${g(sumIn)}`, [0, 1]),
          ];
        })(),
        primary: row("内角和", g(sumIn)),
      };
    },
  },
];

// <<<GEO-CORE-END>>>

// ══════════════════════════════════════════════════════════════════════
//  示意图渲染：把图元数组画成 SVG（自动缩放居中，标注用固定像素间距）
// ══════════════════════════════════════════════════════════════════════

const VB_W = 660;
const VB_H = 450;
const VB_PAD = 36;
const LABEL_GAP = 15;

function primAnchors(p: Prim): Vec[] {
  if (p.k === "poly") return p.pts;
  if (p.k === "circle" || p.k === "arc" || p.k === "fan" || p.k === "cap") {
    return [pt(p.c[0] - p.r, p.c[1] - p.r), pt(p.c[0] + p.r, p.c[1] + p.r)];
  }
  if (p.k === "ellipse") return [pt(p.c[0] - p.rx, p.c[1] - p.ry), pt(p.c[0] + p.rx, p.c[1] + p.ry)];
  if (p.k === "seg" || p.k === "dim") return [p.a, p.b];
  return [p.at];
}

type Mapper = (p: Vec) => Vec;

function arcPath(a: Vec, b: Vec, r: number, sweepFlag: 0 | 1, largeArc: 0 | 1): string {
  return `M ${a[0].toFixed(2)} ${a[1].toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${largeArc} ${sweepFlag} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
}

function renderPrim(p: Prim, i: number, tx: Mapper, scale: number): React.ReactNode {
  const S = "stroke-primary";
  const F = "fill-primary/10";
  if (p.k === "poly") {
    const pts = p.pts.map(tx).map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join(" ");
    return (
      <polygon
        key={i}
        points={pts}
        className={cn(p.fill ? F : "fill-none", p.dash ? "stroke-muted-foreground/70" : S)}
        strokeWidth={p.dash ? 1.4 : 1.9}
        strokeDasharray={p.dash ? "6 5" : undefined}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (p.k === "circle") {
    const c = tx(p.c);
    return (
      <circle
        key={i}
        cx={c[0]}
        cy={c[1]}
        r={Math.max(0.5, p.r * scale)}
        className={cn(p.fill ? F : "fill-none", p.dash ? "stroke-muted-foreground/70" : S)}
        strokeWidth={p.dash ? 1.4 : 1.9}
        strokeDasharray={p.dash ? "6 5" : undefined}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (p.k === "ellipse") {
    const c = tx(p.c);
    return (
      <ellipse
        key={i}
        cx={c[0]}
        cy={c[1]}
        rx={Math.max(0.5, p.rx * scale)}
        ry={Math.max(0.5, p.ry * scale)}
        className={cn(p.fill ? F : "fill-none", p.dash ? "stroke-muted-foreground/70" : S)}
        strokeWidth={p.dash ? 1.4 : 1.9}
        strokeDasharray={p.dash ? "6 5" : undefined}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (p.k === "arc" || p.k === "fan" || p.k === "cap") {
    const c = tx(p.c);
    const r = Math.max(0.5, p.r * scale);
    const p0 = tx(pt(p.c[0] + p.r * Math.cos(p.a0), p.c[1] + p.r * Math.sin(p.a0)));
    const p1 = tx(pt(p.c[0] + p.r * Math.cos(p.a1), p.c[1] + p.r * Math.sin(p.a1)));
    const sweep = p.a1 > p.a0 ? 0 : 1;
    const large = Math.abs(p.a1 - p.a0) > PI ? 1 : 0;
    const d =
      p.k === "fan"
        ? `M ${c[0].toFixed(2)} ${c[1].toFixed(2)} L ${p0[0].toFixed(2)} ${p0[1].toFixed(2)} ${arcPath(p0, p1, r, sweep as 0 | 1, large as 0 | 1).slice(2)} Z`
        : p.k === "cap"
          ? `${arcPath(p0, p1, r, sweep as 0 | 1, large as 0 | 1)} Z`
          : arcPath(p0, p1, r, sweep as 0 | 1, large as 0 | 1);
    return (
      <path
        key={i}
        d={d}
        className={cn(p.k === "arc" ? "fill-none" : F, p.k === "arc" && p.dash ? "stroke-muted-foreground/70" : S)}
        strokeWidth={1.9}
        strokeDasharray={p.k === "arc" && p.dash ? "6 5" : undefined}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (p.k === "seg") {
    const a = tx(p.a);
    const b = tx(p.b);
    return (
      <line
        key={i}
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        className={p.dash ? "stroke-muted-foreground/60" : S}
        strokeWidth={p.dash ? 1.3 : 1.9}
        strokeDasharray={p.dash ? "6 5" : undefined}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (p.k === "dim") {
    const a = tx(p.a);
    const b = tx(p.b);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const L = Math.hypot(ux, uy) || 1;
    const nx = -uy / L;
    const ny = ux / L;
    const off = (p.side !== undefined && p.side < 0 ? -1 : 1) * 26;
    const A2: Vec = [a[0] + nx * off, a[1] + ny * off];
    const B2: Vec = [b[0] + nx * off, b[1] + ny * off];
    const tick = 7;
    const mid2: Vec = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2];
    const textAt: Vec = [mid2[0] + nx * (off > 0 ? 12 : -12), mid2[1] + ny * (off > 0 ? 12 : -12)];
    return (
      <g key={i}>
        <line x1={a[0]} y1={a[1]} x2={A2[0] + nx * 6} y2={A2[1] + ny * 6} className="stroke-muted-foreground/40" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <line x1={b[0]} y1={b[1]} x2={B2[0] + nx * 6} y2={B2[1] + ny * 6} className="stroke-muted-foreground/40" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <line x1={A2[0]} y1={A2[1]} x2={B2[0]} y2={B2[1]} className="stroke-muted-foreground" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        <line x1={A2[0] - nx * tick} y1={A2[1] - ny * tick} x2={A2[0] + nx * tick} y2={A2[1] + ny * tick} className="stroke-muted-foreground" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        <line x1={B2[0] - nx * tick} y1={B2[1] - ny * tick} x2={B2[0] + nx * tick} y2={B2[1] + ny * tick} className="stroke-muted-foreground" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
        <text x={textAt[0]} y={textAt[1]} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[11px]">
          {p.text}
        </text>
      </g>
    );
  }
  if (p.k === "ang") {
    const at = tx(p.at);
    const sp = tx(p.p);
    const sq = tx(p.q);
    const a0 = Math.atan2(sp[1] - at[1], sp[0] - at[0]);
    const a1 = Math.atan2(sq[1] - at[1], sq[0] - at[0]);
    let da = a1 - a0;
    while (da > PI) da -= 2 * PI;
    while (da < -PI) da += 2 * PI;
    const r = Math.max(10, p.r * scale);
    const start: Vec = [at[0] + r * Math.cos(a0), at[1] + r * Math.sin(a0)];
    const end: Vec = [at[0] + r * Math.cos(a0 + da), at[1] + r * Math.sin(a0 + da)];
    return (
      <path
        key={i}
        d={arcPath(start, end, r, da > 0 ? 1 : 0, Math.abs(da) > PI ? 1 : 0)}
        className="fill-none stroke-primary/60"
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (p.k === "right") {
    const at = tx(p.at);
    const sp = tx(p.p);
    const sq = tx(p.q);
    const u = unit(sub(sp, at));
    const w = unit(sub(sq, at));
    const k = p.size === undefined ? 15 : Math.max(9, p.size * scale);
    const p1: Vec = [at[0] + u[0] * k, at[1] + u[1] * k];
    const p2: Vec = [at[0] + u[0] * k + w[0] * k, at[1] + u[1] * k + w[1] * k];
    const p3: Vec = [at[0] + w[0] * k, at[1] + w[1] * k];
    return (
      <polyline
        key={i}
        points={`${p1[0].toFixed(2)},${p1[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)} ${p3[0].toFixed(2)},${p3[1].toFixed(2)}`}
        className="fill-none stroke-muted-foreground"
        strokeWidth={1.3}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (p.k === "label") {
    const at = tx(p.at);
    const dx = p.dir ? p.dir[0] * LABEL_GAP : 0;
    const dy = p.dir ? -p.dir[1] * LABEL_GAP : 0;
    return (
      <text
        key={i}
        x={at[0] + dx}
        y={at[1] + dy}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-foreground text-[12px]"
      >
        {p.text}
      </text>
    );
  }
  const at = tx(p.at);
  return <circle key={i} cx={at[0]} cy={at[1]} r={2.6} className="fill-primary" />;
}

function FigureSvg({ prims }: { prims: Prim[] }) {
  const { tx, scale } = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of prims) {
      for (const q of primAnchors(p)) {
        if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
        minX = Math.min(minX, q[0]);
        maxX = Math.max(maxX, q[0]);
        minY = Math.min(minY, q[1]);
        maxY = Math.max(maxY, q[1]);
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      minX = -1;
      maxX = 1;
      minY = -1;
      maxY = 1;
    }
    const w = Math.max(1e-6, maxX - minX);
    const h = Math.max(1e-6, maxY - minY);
    const s = Math.min((VB_W - 2 * VB_PAD) / w, (VB_H - 2 * VB_PAD) / h);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const f: Mapper = (p) => [VB_W / 2 + (p[0] - cx) * s, VB_H / 2 - (p[1] - cy) * s];
    return { tx: f, scale: s };
  }, [prims]);

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full" role="img" aria-label="几何示意图">
      {prims.map((p, i) => renderPrim(p, i, tx, scale))}
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  工具主体
// ══════════════════════════════════════════════════════════════════════

const TOOL_ID = "geometry-calculator";

const DIGIT_OPTIONS = [2, 4, 6, 8];

export function GeometryCalculatorTool() {
  const { toast } = useToast();
  const [cat, setCat] = useToolDraft<Cat>(TOOL_ID, "geo_cat", "plane");
  const [shapeId, setShapeId] = useToolDraft<string>(TOOL_ID, "geo_shape_id", "triangle");
  const [modeMap, setModeMap] = useToolDraft<Record<string, string>>(TOOL_ID, "geo_modes", {});
  const [valMap, setValMap] = useToolDraft<Record<string, string>>(TOOL_ID, "geo_values", {});
  const [unit, setUnit] = useToolDraft<Unit>(TOOL_ID, "geo_unit", "deg");
  const [digits, setDigits] = useToolDraft<number>(TOOL_ID, "geo_digits", 6);
  const [query, setQuery] = useToolDraft<string>(TOOL_ID, "geo_query", "");
  const [copied, setCopied] = useState(false);

  const shape = useMemo(() => SHAPES.find((s) => s.id === shapeId) || SHAPES[0], [shapeId]);
  const modeId = useMemo(() => {
    const wanted = modeMap[shape.id];
    return shape.modes.some((m) => m.id === wanted) ? (wanted as string) : shape.modes[0].id;
  }, [modeMap, shape]);
  const mode = useMemo(
    () => shape.modes.find((m) => m.id === modeId) || shape.modes[0],
    [shape, modeId],
  );

  const fieldKey = (shapeKey: string, modeKey: string, fieldKey2: string) => `${shapeKey}:${modeKey}:${fieldKey2}`;
  const keyOf = (f: FieldDef) => fieldKey(shape.id, mode.id, f.k);
  const valueOf = (f: FieldDef) => {
    const stored = valMap[keyOf(f)];
    return stored === undefined ? f.def : stored;
  };

  const nums: Record<string, number> = {};
  const raw: Record<string, string> = {};
  for (const f of mode.fields) {
    const s = valueOf(f);
    raw[f.k] = s;
    if (f.kind === "text") nums[f.k] = NaN;
    else {
      const t = s.trim();
      nums[f.k] = t === "" ? NaN : Number(t);
    }
  }

  const ctx: Ctx = { unit, digits };
  const outcome = shape.run(mode.id, nums, raw, ctx);
  const failed = "errors" in outcome;
  const solved = failed ? null : outcome;
  const errorList = failed ? outcome.errors : [];
  const allEmpty = mode.fields.every((f) => valueOf(f).trim() === "");

  const setField = (f: FieldDef, v: string) => {
    setValMap((prev) => ({ ...prev, [keyOf(f)]: v }));
  };

  const fillExample = () => {
    const next = { ...valMap };
    for (const f of mode.fields) next[keyOf(f)] = f.def;
    setValMap(next);
    toast({ title: `已填入「${shape.name} · ${mode.label}」的示例数据` });
  };

  const clearAll = () => {
    const next = { ...valMap };
    for (const f of mode.fields) next[keyOf(f)] = "";
    setValMap(next);
  };

  const reportText = () => {
    const lines: string[] = [];
    lines.push(`几何计算器 · ${shape.name} · ${mode.label}`);
    lines.push(`角度单位：${unit === "deg" ? "度" : "弧度"}　小数位：${digits}`);
    lines.push("");
    lines.push("【已知条件】");
    for (const f of mode.fields) lines.push(`  ${f.label} = ${raw[f.k] === "" ? "（空）" : raw[f.k]}`);
    lines.push("");
    if (solved) {
      lines.push("【计算结果】");
      for (const r of solved.rows) lines.push(`  ${r.label}：${r.value}`);
      lines.push("");
      lines.push("【用到的公式】");
      for (const fm of solved.formulas) lines.push(`  ${fm.name}：${fm.expr}`);
    } else {
      lines.push("【无法计算】");
      for (const e of errorList) lines.push(`  ${e}`);
    }
    return lines.join("\n");
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText());
      setCopied(true);
      toast({ title: "已复制当前结果与公式", variant: "success" });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "复制失败，请手动选中文本", variant: "error" });
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SHAPES.filter((s) => s.cat === cat).filter((s) => {
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.brief.toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
    });
  }, [cat, query]);

  const catCount = (c: Cat) => SHAPES.filter((s) => s.cat === c).length;

  return (
    <div className="space-y-5">
      {/* 顶部操作条：只放控件，不放工具名与描述（外壳已经画过） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-primary" />
          <span className="text-xs text-muted-foreground">角度单位</span>
          <div className="flex rounded-lg border border-border/50 bg-card/70 p-0.5">
            {(["deg", "rad"] as Unit[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  unit === u ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {u === "deg" ? "度 °" : "弧度 rad"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">小数位</span>
          <div className="flex rounded-lg border border-border/50 bg-card/70 p-0.5">
            {DIGIT_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDigits(d)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  digits === d ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={fillExample}>
            <Wand2 className="h-3.5 w-3.5" />
            填入示例
          </Button>
          <Button size="sm" variant="outline" onClick={clearAll}>
            <Eraser className="h-3.5 w-3.5" />
            清空
          </Button>
          <Button size="sm" onClick={copyReport}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "已复制" : "复制结果"}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        {/* 左：图形库 */}
        <div className="xl:col-span-3">
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-xs">
            <div className="flex items-center gap-2">
              <Library className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">图形库</span>
              <Badge variant="outline" className="ml-auto">
                {SHAPES.length} 个图形
              </Badge>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索：三角形 / 圆台 / 外心"
                className="h-9 pl-8 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {CATS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCat(c.id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
                    cat === c.id
                      ? "bg-primary/15 text-primary"
                      : "bg-muted/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c.name} {catCount(c.id)}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {CATS.find((c) => c.id === cat)?.desc}
            </p>
            <div className="thin-scroll max-h-[520px] space-y-1 overflow-y-auto pr-1">
              {list.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                  没有匹配的图形，换个关键词试试
                </div>
              ) : (
                list.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setShapeId(s.id)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                      shape.id === s.id
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/40 bg-card/60 hover:bg-muted/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("text-xs font-medium", shape.id === s.id ? "text-primary" : "text-foreground")}>
                        {s.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{s.modes.length} 种条件</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 中：已知条件 */}
        <div className="xl:col-span-4">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">{shape.name}</h2>
                <Badge variant="secondary">{CATS.find((c) => c.id === shape.cat)?.name}</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{shape.brief}</p>
            </div>

            <div className="space-y-2">
              <Label>已知条件（切换后输入项随之改变）</Label>
              <div className="flex flex-wrap gap-1.5">
                {shape.modes.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModeMap((prev) => ({ ...prev, [shape.id]: m.id }))}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      mode.id === m.id
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-border/50 bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {mode.fields.map((f) => (
                <div key={f.k} className={cn("space-y-1.5", f.kind === "text" && "sm:col-span-2")}>
                  <Label htmlFor={`geo-${f.k}`} className="flex items-center gap-1">
                    {f.label}
                    {f.kind === "ang" ? <span className="text-primary">∠</span> : null}
                  </Label>
                  <Input
                    id={`geo-${f.k}`}
                    value={valueOf(f)}
                    onChange={(e) => setField(f, e.target.value)}
                    placeholder={f.kind === "text" ? "例如 0,0; 4,0; 4,3" : "请输入数字"}
                    className={cn("h-10 font-mono-accent text-xs", f.kind === "text" && "font-mono")}
                    inputMode={f.kind === "text" ? "text" : "decimal"}
                  />
                </div>
              ))}
            </div>

            {mode.fields.some((f) => f.kind === "ang") ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                角度按当前单位输入（{unit === "deg" ? "度" : "弧度"}），结果中的角度也按该单位显示。
              </p>
            ) : null}
          </div>
        </div>

        {/* 右：示意图 */}
        <div className="xl:col-span-5">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">示意图（随参数实时重绘）</span>
              <Badge variant="outline">{mode.label}</Badge>
            </div>
            <div className="aspect-[22/15] w-full overflow-hidden rounded-xl border border-border/40 bg-background/40">
              {solved ? (
                <FigureSvg prims={solved.figure} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {allEmpty
                      ? "还没有参数，先填几个数，或者点右上角「填入示例」看看这个图形怎么用。"
                      : "参数还不完整或超出取值范围，补全后示意图会自动画出来。"}
                  </p>
                  {allEmpty ? (
                    <Button size="sm" variant="outline" onClick={fillExample}>
                      <Wand2 className="h-3.5 w-3.5" />
                      填入示例
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
            {solved ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/10 px-4 py-3">
                <div>
                  <div className="text-[11px] text-muted-foreground">{solved.primary.label}</div>
                  <div className="font-mono-accent text-2xl font-semibold tracking-tight text-primary">
                    {solved.primary.value}
                  </div>
                </div>
                <div className="text-right text-[11px] leading-relaxed text-muted-foreground">
                  共 {solved.rows.length} 项结果
                  <br />
                  {solved.formulas.length} 条公式
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* 结果表 + 公式说明 */}
      {failed ? (
        <div className="space-y-2">
          {errorList.map((e, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {e}
            </div>
          ))}
        </div>
      ) : solved ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <Sigma className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">计算结果</span>
              <span className="text-[11px] text-muted-foreground">（{solved.rows.length} 项）</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={copyReport}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制"}
              </Button>
            </div>
            <div className="thin-scroll max-h-[520px] overflow-y-auto rounded-xl border border-border/40">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {solved.rows.map((r, i) => (
                    <tr
                      key={`${r.label}-${i}`}
                      className={cn("border-b border-border/40 last:border-0", i % 2 === 1 ? "bg-muted/30" : "")}
                    >
                      <td className="px-3 py-2 align-top text-xs text-muted-foreground">{r.label}</td>
                      <td className="px-3 py-2 text-right align-top font-mono-accent text-xs text-foreground">
                        {r.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">用到的公式</span>
              <span className="text-[11px] text-muted-foreground">（{solved.formulas.length} 条）</span>
            </div>
            <div className="thin-scroll max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {solved.formulas.map((fm, i) => (
                <div key={`${fm.name}-${i}`} className="rounded-xl border border-border/40 bg-muted/20 px-3 py-2">
                  <div className="text-[11px] font-medium text-foreground">{fm.name}</div>
                  <div className="mt-0.5 font-mono-accent text-[11px] leading-relaxed text-muted-foreground">
                    {fm.expr}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

