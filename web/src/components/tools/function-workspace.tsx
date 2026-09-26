import { useMemo, useState } from "react";
import {
  Copy,
  Download,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  ArrowRight,
  Table2,
} from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { tr, uiMessage, useLanguage } from "@/lib/language";
import { saveOutputBlob, reportOutputSaved } from "@/lib/output-directory";
import {
  compileExpression,
  evalProgram,
  sampleCurve,
  niceTicks,
} from "./math-graph-tools";
const box = "rounded-2xl border border-border bg-card p-5";
const n = (x: number) =>
  Number.isFinite(x) ? String(Number(x.toPrecision(12))) : "—";
function fieldNumber(value: string) {
  if (!value.trim() || !Number.isFinite(Number(value)))
    throw new Error(tr("请填写有限数值", "Enter a finite number"));
  return Number(value);
}
function safeValue(fn: (x: number) => number, x: number) {
  const y = fn(x);
  if (!Number.isFinite(y))
    throw new Error(
      tr(
        "区间中存在无定义或非有限值，请调整范围。",
        "The interval contains an undefined or non-finite value. Adjust the bounds.",
      ),
    );
  return y;
}
function numericalAnalysis(
  fn: (x: number) => number,
  op: string,
  x: number,
  a: number,
  b: number,
) {
  if (op === "derivative") {
    const h = Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(x)),
      y = safeValue(fn, x),
      l = safeValue(fn, x - h),
      r = safeValue(fn, x + h);
    const left = (y - l) / h,
      right = (r - y) / h,
      d = (r - l) / (2 * h),
      d2 = (safeValue(fn, x + h / 2) - safeValue(fn, x - h / 2)) / h;
    if (
      Math.abs(left - right) > 0.02 * Math.max(1, Math.abs(d)) ||
      Math.abs(d - d2) > 1e-4 * Math.max(1, Math.abs(d2))
    )
      throw new Error(
        tr(
          "左右变化率不一致或结果不稳定，此处可能不可导。",
          "One-sided rates disagree or estimates are unstable. The derivative may not exist here.",
        ),
      );
    return {
      value: d2,
      detail: tr(
        "中心差分；自动步长并比较两次估计。非符号求导。",
        "Central differences with automatic step size and a consistency check; not symbolic differentiation.",
      ),
    };
  }
  if (op === "integral") {
    const simpson = (panels: number) => {
      const h = (b - a) / panels;
      let sum = safeValue(fn, a) + safeValue(fn, b);
      for (let i = 1; i < panels; i++)
        sum += (i % 2 ? 4 : 2) * safeValue(fn, a + i * h);
      return (sum * h) / 3;
    };
    let prev = simpson(128),
      curr = prev;
    for (const count of [256, 512, 1024, 2048, 4096]) {
      curr = simpson(count);
      if (
        Number.isFinite(curr) &&
        Math.abs(curr - prev) <= 1e-8 * Math.max(1, Math.abs(curr))
      )
        return {
          value: curr,
          detail: tr(
            `复合 Simpson 法，${count} 等分；仅适用于常规定积分。`,
            `Composite Simpson's rule, ${count} panels; intended for proper definite integrals only.`,
          ),
        };
      prev = curr;
    }
    throw new Error(
      tr(
        "加密采样后结果仍未收敛。请检查奇点、振荡或区间，不输出猜测值。",
        "Refined samples did not converge. Check singularities, oscillations and bounds. No guess is returned.",
      ),
    );
  }
  if (!(a < b))
    throw new Error(
      tr(
        "二分求根需要左端点小于右端点",
        "For bisection, the left bound must be smaller than the right bound",
      ),
    );
  let lo = a,
    hi = b,
    fl = safeValue(fn, lo),
    fr = safeValue(fn, hi);
  if (fl === 0) return { value: lo, detail: "f(x) = 0" };
  if (fr === 0) return { value: hi, detail: "f(x) = 0" };
  if (Math.sign(fl) === Math.sign(fr))
    throw new Error(
      tr(
        "两端函数值必须异号。偶重根不一定能用二分法找到。",
        "Endpoint values must have opposite signs. Bisection may miss roots of even multiplicity.",
      ),
    );
  const scale = Math.max(Math.abs(fl), Math.abs(fr), 1e-12);
  let mid = (lo + hi) / 2,
    fm = NaN;
  for (let i = 0; i < 100; i++) {
    mid = lo + (hi - lo) / 2;
    fm = safeValue(fn, mid);
    if (
      fm === 0 ||
      (Math.abs(fm) <= 1e-10 * scale &&
        hi - lo <= 1e-9 * Math.max(1, Math.abs(mid)))
    )
      return {
        value: mid,
        detail: tr(
          `二分法；残差 f(x) ≈ ${n(fm)}。不是区间内全部根。`,
          `Bisection; residual f(x) ≈ ${n(fm)}. This does not find every root in the interval.`,
        ),
      };
    if (Math.sign(fm) === Math.sign(fl)) {
      lo = mid;
      fl = fm;
    } else {
      hi = mid;
      fr = fm;
    }
  }
  throw new Error(
    tr(
      "未找到可信零点，区间可能跨越了不连续点。",
      "No reliable root was found. The interval may cross a discontinuity.",
    ),
  );
}
function FunctionPlot({
  fn,
  center,
  span,
  point,
  onPoint,
}: {
  fn: (x: number) => number;
  center: number;
  span: number;
  point: number;
  onPoint: (x: number) => void;
}) {
  const locale = useLanguage();
  const data = useMemo(() => {
    const lo = center - span / 2,
      hi = center + span / 2;
    const values = Array.from({ length: 401 }, (_, i) => ({
      x: lo + ((hi - lo) * i) / 400,
      y: fn(lo + ((hi - lo) * i) / 400),
    }));
    const finite = values
      .map((p) => p.y)
      .filter((v) => Number.isFinite(v) && Math.abs(v) < 1e12)
      .sort((a, b) => a - b);
    let min = Math.min(0, finite[Math.floor(finite.length * 0.03)] ?? -1),
      max = Math.max(0, finite[Math.floor(finite.length * 0.97)] ?? 1);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
    const curve = sampleCurve(fn, lo, hi, {
      count: 740,
      yScale: 305 / (max - min),
      jumpPx: 550,
    });
    return { lo, hi, min, max, paths: curve.paths };
  }, [fn, center, span, locale]);
  const w = 780,
    h = 360,
    L = 55,
    R = 20,
    T = 20,
    B = 35;
  const sx = (x: number) =>
      L + ((x - data.lo) / (data.hi - data.lo)) * (w - L - R),
    sy = (y: number) =>
      h - B - ((y - data.min) / (data.max - data.min)) * (h - T - B);
  const px = point,
    py = fn(point),
    xt = niceTicks(data.lo, data.hi, 8).ticks,
    yt = niceTicks(data.min, data.max, 6).ticks;
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const x = (((e.clientX - b.left) / b.width) * w - L) / (w - L - R);
    if (x >= 0 && x <= 1) onPoint(data.lo + x * (data.hi - data.lo));
  };
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full touch-none rounded-xl bg-secondary/20"
      role="img"
      aria-label={tr(
        "函数图像：点击或拖动读取坐标",
        "Function plot: click or drag to read coordinates",
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pick(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) pick(e);
      }}
    >
      <defs>
        <clipPath id="function-workspace-plot">
          <rect x={L} y={T} width={w - L - R} height={h - T - B} />
        </clipPath>
      </defs>
      {xt.map((v) => (
        <g key={`x${v}`}>
          <path
            d={`M ${sx(v)} ${T} V ${h - B}`}
            stroke="currentColor"
            opacity={v === 0 ? 0.3 : 0.08}
          />
          <text
            x={sx(v)}
            y={h - 12}
            fill="currentColor"
            opacity=".55"
            fontSize="11"
            textAnchor="middle"
          >
            {n(v)}
          </text>
        </g>
      ))}
      {yt.map((v) => (
        <g key={`y${v}`}>
          <path
            d={`M ${L} ${sy(v)} H ${w - R}`}
            stroke="currentColor"
            opacity={v === 0 ? 0.3 : 0.08}
          />
          <text
            x={L - 9}
            y={sy(v) + 4}
            fill="currentColor"
            opacity=".55"
            fontSize="11"
            textAnchor="end"
          >
            {n(v)}
          </text>
        </g>
      ))}
      <g clipPath="url(#function-workspace-plot)">
        {data.paths.map((path, i) => (
          <path
            key={i}
            d={path.points
              .map(
                (p, j) =>
                  `${j ? "L" : "M"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`,
              )
              .join(" ")}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2.5"
          />
        ))}
        {Number.isFinite(px) && Number.isFinite(py) && (
          <>
            <path
              d={`M ${sx(px)} ${T} V ${h - B}`}
              stroke="hsl(var(--primary))"
              strokeDasharray="4 5"
              opacity=".35"
            />
            <circle
              cx={sx(px)}
              cy={sy(py)}
              r="5"
              fill="hsl(var(--primary))"
              stroke="hsl(var(--card))"
              strokeWidth="2"
            />
          </>
        )}
      </g>
    </svg>
  );
}
export function FunctionWorkspace() {
  const locale = useLanguage();
  const [mode, setMode] = useState("simple"),
    [view, setView] = useState("value"),
    [op, setOp] = useState("derivative"),
    [expr, setExpr] = useState("x^2 - 4"),
    [x, setX] = useState("3"),
    [a, setA] = useState("1"),
    [b, setB] = useState("0"),
    [lo, setLo] = useState("0"),
    [hi, setHi] = useState("5"),
    [step, setStep] = useState("1"),
    [span, setSpan] = useState(12),
    [center, setCenter] = useState(0),
    [message, setMessage] = useState("");
  const compiled = useMemo(
    () => compileExpression(expr.slice(0, 500), ["x", "a", "b"]),
    [expr],
  );
  const fn = useMemo(() => {
    const av = a.trim() ? Number(a) : NaN,
      bv = b.trim() ? Number(b) : NaN;
    return (xx: number) =>
      compiled.ok ? evalProgram(compiled, { x: xx, a: av, b: bv }) : NaN;
  }, [compiled, a, b]);
  const point = x.trim() ? Number(x) : NaN,
    value = Number.isFinite(point) ? fn(point) : NaN;
  const output = useMemo(() => {
    try {
      if (!compiled.ok) throw new Error(uiMessage(compiled.issue.pretty));
      if (mode === "professional")
        return {
          analysis: numericalAnalysis(
            fn,
            op,
            op === "derivative" ? fieldNumber(x) : 0,
            op === "derivative" ? 0 : fieldNumber(lo),
            op === "derivative" ? 0 : fieldNumber(hi),
          ),
          rows: [] as { x: number; y: number }[],
          error: "",
        };
      if (view !== "table")
        return {
          analysis: null,
          rows: [] as { x: number; y: number }[],
          error: "",
        };
      const start = fieldNumber(lo),
        end = fieldNumber(hi),
        inc = fieldNumber(step);
      if (inc === 0 || (end - start) * inc < 0)
        throw new Error(
          tr(
            "步长不能为零，方向需与区间一致",
            "Step must be nonzero and point toward the end of the interval",
          ),
        );
      const count = Math.floor((end - start) / inc + 1e-10) + 1;
      if (count > 1000 || count < 1)
        throw new Error(
          tr(
            "数值表需为 1–1,000 行，请增大步长",
            "Tables must contain 1–1,000 rows. Increase the step size.",
          ),
        );
      return {
        analysis: null,
        rows: Array.from({ length: count }, (_, i) => {
          const xx = start + i * inc;
          return { x: xx, y: fn(xx) };
        }),
        error: "",
      };
    } catch (e) {
      return {
        analysis: null,
        rows: [] as { x: number; y: number }[],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [compiled, fn, mode, op, x, lo, hi, step, view, locale]);
  async function saveTable() {
    try {
      const csv =
        "x,f(x)\n" +
        output.rows
          .map(
            (row) =>
              `${n(row.x)},${Number.isFinite(row.y) ? n(row.y) : "undefined"}`,
          )
          .join("\n");
      reportOutputSaved(
        await saveOutputBlob(
          new Blob([csv], { type: "text/csv;charset=utf-8" }),
          "function-table.csv",
        ),
      );
      setMessage(tr("已保存数值表", "Value table saved"));
    } catch (e) {
      setMessage(String(e));
    }
  }
  const choice = (
    id: string,
    label: string,
    active: string,
    set: (s: string) => void,
  ) => (
    <button
      type="button"
      key={id}
      aria-pressed={active === id}
      onClick={() => {
        set(id);
        setMessage("");
      }}
      className={`rounded-xl px-4 py-2.5 text-sm ${active === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-2xl border border-border bg-card p-1">
          {choice(
            "simple",
            tr("简单工作台", "Simple workspace"),
            mode,
            setMode,
          )}
          {choice(
            "professional",
            tr("专业 · 数值分析", "Advanced · numerical analysis"),
            mode,
            setMode,
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {tr(
            "实数计算 · 三角函数使用弧度",
            "Real-valued calculations · trigonometric functions use radians",
          )}
        </span>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className={`${box} space-y-5`}>
          <label className="block space-y-2">
            <span className="text-sm font-semibold">f(x) =</span>
            <Input
              value={expr}
              maxLength={500}
              onChange={(e) => setExpr(e.target.value)}
              className="font-mono text-base"
              aria-label={tr("函数表达式", "Function expression")}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {["x^2 - 4", "sin(x)", "exp(-x^2)", "a*x + b"].map((s) => (
              <button
                key={s}
                className="rounded-lg bg-secondary px-2.5 py-1.5 font-mono text-xs hover:bg-primary/10"
                onClick={() => setExpr(s)}
              >
                {s}
              </button>
            ))}
          </div>
          {/\b[ab]\b/.test(expr) && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2 text-xs">
                a
                <Input
                  value={a}
                  onChange={(e) => setA(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="space-y-2 text-xs">
                b
                <Input
                  value={b}
                  onChange={(e) => setB(e.target.value)}
                  inputMode="decimal"
                />
              </label>
            </div>
          )}
          {mode === "simple" ? (
            <div className="flex flex-wrap rounded-xl bg-secondary/40 p-1">
              {choice("value", tr("代入求值", "Evaluate"), view, setView)}
              {choice("table", tr("数值表", "Value table"), view, setView)}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {choice("derivative", tr("导数", "Derivative"), op, setOp)}
              {choice("integral", tr("定积分", "Integral"), op, setOp)}
              {choice("root", tr("区间求根", "Find a root"), op, setOp)}
            </div>
          )}
          {(mode === "simple" && view === "value") ||
          (mode === "professional" && op === "derivative") ? (
            <label className="block space-y-2 text-sm">
              <span>{tr("代入 x", "Value of x")}</span>
              <Input
                value={x}
                onChange={(e) => setX(e.target.value)}
                inputMode="decimal"
              />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2 text-sm">
                {tr("起点", "Start")}
                <Input
                  value={lo}
                  onChange={(e) => setLo(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              <label className="space-y-2 text-sm">
                {tr("终点", "End")}
                <Input
                  value={hi}
                  onChange={(e) => setHi(e.target.value)}
                  inputMode="decimal"
                />
              </label>
              {mode === "simple" && (
                <label className="col-span-2 space-y-2 text-sm">
                  {tr("步长", "Step")}
                  <Input
                    value={step}
                    onChange={(e) => setStep(e.target.value)}
                    inputMode="decimal"
                  />
                </label>
              )}
            </div>
          )}
          <details className="text-xs leading-6 text-muted-foreground">
            <summary className="cursor-pointer">
              {tr("输入语法与边界", "Syntax & limitations")}
            </summary>
            <p>
              {tr(
                "支持 + − * / ^、隐式乘法 2x、pi、e、sin、cos、ln、log、sqrt、abs，以及分段表达式。log(x) 为以 10 为底，ln(x) 为自然对数。输入最多 500 字符。",
                "Supports + − * / ^, implicit multiplication (2x), pi, e, sin, cos, ln, log, sqrt, abs and piecewise expressions. log(x) is base 10; ln(x) is the natural logarithm. Limit: 500 characters.",
              )}
            </p>
            <p>
              {tr(
                "图像是有限采样示意，不是连续性或全部解的证明；数值分析不替代符号证明。",
                "Plots use finite samples and do not prove continuity or completeness of roots. Numerical analysis is not a symbolic proof.",
              )}
            </p>
          </details>
        </section>
        <div className="min-w-0 space-y-5">
          <section className={box}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {mode === "professional"
                    ? tr("数值结果（近似）", "Numerical result (approximate)")
                    : tr("当前取点", "Current point")}
                </p>
                <p className="mt-1 break-all font-mono text-2xl font-semibold">
                  {mode === "professional"
                    ? output.analysis
                      ? `${op === "derivative" ? "f′(x)" : op === "integral" ? "∫ f(x) dx" : "x"} ≈ ${n(output.analysis.value)}`
                      : "—"
                    : `f(${Number.isFinite(point) ? n(point) : "x"}) = ${n(value)}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={
                  mode === "professional"
                    ? !output.analysis
                    : !Number.isFinite(value)
                }
                onClick={() => {
                  const content =
                    mode === "professional"
                      ? n(output.analysis!.value)
                      : n(value);
                  void navigator.clipboard
                    .writeText(content)
                    .then(() => setMessage(tr("已复制数值", "Value copied")))
                    .catch(() => setMessage(tr("复制失败", "Copy failed")));
                }}
              >
                <Copy size={14} />
                {tr("复制结果", "Copy result")}
              </Button>
            </div>
            <FunctionPlot
              fn={fn}
              center={center}
              span={span}
              point={point}
              onPoint={(v) => setX(n(v))}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {tr(
                  "点击或拖动图像取点；Y 轴自动适配主要曲线范围。",
                  "Click or drag to sample a point. The Y axis fits the main curve range.",
                )}
              </p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  title={tr("放大", "Zoom in")}
                  onClick={() => setSpan((s) => Math.max(0.0001, s / 1.5))}
                >
                  <ZoomIn size={16} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={tr("缩小", "Zoom out")}
                  onClick={() => setSpan((s) => Math.min(1e6, s * 1.5))}
                >
                  <ZoomOut size={16} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSpan(12);
                    setCenter(0);
                  }}
                >
                  <RotateCcw size={14} />
                  {tr("复位", "Reset")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!Number.isFinite(point) || Math.abs(point) > 1e9}
                  onClick={() => setCenter(point)}
                >
                  {tr("以取点居中", "Center on point")}
                </Button>
              </div>
            </div>
            {!Number.isFinite(value) &&
              mode === "simple" &&
              view === "value" &&
              compiled.ok && (
                <p role="alert" className="mt-3 text-sm text-amber-600">
                  {tr(
                    "该点无有限实数值，或参数尚未填写。",
                    "No finite real value exists at this point, or a parameter is missing.",
                  )}
                </p>
              )}
            {output.analysis && (
              <p className="mt-4 rounded-xl bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
                {output.analysis.detail}
              </p>
            )}
          </section>
          {mode === "simple" && view === "table" && !!output.rows.length && (
            <section className={box}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Table2 size={17} />
                  {tr("数值表", "Value table")}
                </h3>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void saveTable()}
                >
                  <Download size={14} />
                  {tr("保存 CSV", "Save CSV")}
                </Button>
              </div>
              <div className="max-h-80 overflow-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary">
                    <tr>
                      <th className="px-4 py-2 text-left">x</th>
                      <th className="px-4 py-2 text-left">f(x)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {output.rows.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-4 py-2 font-mono">{n(row.x)}</td>
                        <td className="px-4 py-2 font-mono">
                          {Number.isFinite(row.y)
                            ? n(row.y)
                            : tr("无定义", "Undefined")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {output.error && (
            <p
              role="alert"
              className="whitespace-pre-wrap rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {output.error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm text-primary">
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
