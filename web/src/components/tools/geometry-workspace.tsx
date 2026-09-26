import { useMemo, useRef, useState } from "react";
import {
  Circle,
  Triangle,
  Square,
  Box,
  Ruler,
  Copy,
  Download,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Search,
} from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { tr, uiMessage, createUiText, useLanguage } from "@/lib/language";
import { saveOutputBlob, reportOutputSaved } from "@/lib/output-directory";
import {
  SHAPES,
  CATS,
  FigureSvg,
  type Cat,
  type Solved,
} from "./geometry-tools";
const t = createUiText("components/tools/geometry-tools.tsx"),
  card = "rounded-2xl border border-border bg-card p-5";
const SIMPLE = [
  "circle",
  "rectangle",
  "triangle",
  "square",
  "cylinder",
  "sphere",
  "cuboid",
  "cone",
];
function ShapeIcon({ id }: { id: string }) {
  const Icon =
    id.includes("circle") || id.includes("sphere")
      ? Circle
      : id.includes("riangle") || id === "cone"
        ? Triangle
        : ["rectangle", "square"].includes(id)
          ? Square
          : Box;
  return <Icon size={23} strokeWidth={1.4} />;
}
export function GeometryWorkspace() {
  const locale = useLanguage();
  const [mode, setMode] = useState("simple"),
    [selection, setSelection] = useState({
      simple: "circle",
      professional: "twoLines",
    }),
    [cat, setCat] = useState<Cat>("coord"),
    [query, setQuery] = useState(""),
    [methods, setMethods] = useState<Record<string, string>>({}),
    [values, setValues] = useState<Record<string, string>>({}),
    [angle, setAngle] = useState<"deg" | "rad">("deg"),
    [digits, setDigits] = useState(6),
    [unit, setUnit] = useState("cm"),
    [message, setMessage] = useState(""),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 });
  const diagram = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
      null,
    );
  const id = mode === "simple" ? selection.simple : selection.professional,
    shape = SHAPES.find((s) => s.id === id) || SHAPES[0],
    method = shape.modes.find((m) => m.id === methods[id]) || shape.modes[0];
  const key = (field: string) => `${id}:${method.id}:${field}`;
  const val = (field: { k: string; def: string }) =>
    values[key(field.k)] ?? field.def;
  const solved = useMemo(() => {
    try {
      const raw: Record<string, string> = {},
        nums: Record<string, number> = {};
      for (const f of method.fields) {
        const v = values[`${id}:${method.id}:${f.k}`] ?? f.def;
        raw[f.k] = v;
        nums[f.k] = f.kind === "text" ? NaN : v.trim() ? Number(v) : NaN;
        if (
          f.kind !== "text" &&
          (!Number.isFinite(nums[f.k]) || Math.abs(nums[f.k]) > 1e12)
        )
          throw new Error(
            tr(
              "请填入有效数值；绝对值不超过 10¹²。",
              "Enter finite numbers with an absolute value no greater than 10¹².",
            ),
          );
        if (
          f.kind === "int" &&
          (Math.abs(nums[f.k]) > 256 || !Number.isInteger(nums[f.k]))
        )
          throw new Error(
            tr(
              "图形整数参数最多为 256，且必须是整数。",
              "Integer shape parameters must be whole numbers no greater than 256 in magnitude.",
            ),
          );
      }
      const out = shape.run(method.id, nums, raw, { unit: angle, digits });
      return "errors" in out
        ? { value: null, error: out.errors.map(uiMessage).join("\n") }
        : { value: out as Solved, error: "" };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [shape, method, id, values, angle, digits, locale]);
  const shapes = SHAPES.filter((s) =>
    mode === "simple" ? SIMPLE.includes(s.id) : s.cat === cat,
  ).filter(
    (s) =>
      !query ||
      `${s.name} ${t(s.name)} ${s.brief}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  function select(next: string) {
    setSelection((s) => ({ ...s, [mode]: next }));
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setMessage("");
  }
  function report() {
    if (!solved.value) return "";
    return (
      `${t(shape.name)} · ${t(method.label)}\n${tr("统一长度单位", "Common length unit")}: ${unit}\n${tr("角度", "Angles")}: ${angle}\n\n` +
      method.fields.map((f) => `${t(f.label)} = ${val(f)}`).join("\n") +
      "\n\n" +
      solved.value.rows
        .map((r) => `${t(r.label)}: ${uiMessage(r.value)}`)
        .join("\n") +
      "\n\n" +
      solved.value.formulas
        .map((f) => `${t(f.name)}: ${uiMessage(f.expr)}`)
        .join("\n")
    );
  }
  async function save(kind: "svg" | "txt") {
    try {
      let content = report(),
        type = "text/plain;charset=utf-8";
      if (kind === "svg") {
        const node = diagram.current?.querySelector("svg");
        if (!node) return;
        const clone = node.cloneNode(true) as SVGSVGElement;
        const originals = [node, ...Array.from(node.querySelectorAll("*"))],
          copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
        originals.forEach((element, index) => {
          const style = getComputedStyle(element);
          for (const property of [
            "fill",
            "stroke",
            "stroke-width",
            "font-family",
            "font-size",
            "font-weight",
            "opacity",
          ])
            copies[index].setAttribute(
              property,
              style.getPropertyValue(property),
            );
          copies[index].removeAttribute("class");
        });
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", "900");
        clone.setAttribute("height", "600");
        content = new XMLSerializer().serializeToString(clone);
        type = "image/svg+xml";
      }
      reportOutputSaved(
        await saveOutputBlob(
          new Blob([content], { type }),
          `geometry-${id}.${kind}`,
        ),
      );
      setMessage(tr("已保存到输出目录", "Saved to the output folder"));
    } catch (e) {
      setMessage(String(e));
    }
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-2xl border border-border bg-card p-1">
          {[
            ["simple", tr("简单 · 常用图形", "Simple · common shapes")],
            [
              "professional",
              tr("专业 · 条件求解", "Advanced · condition solver"),
            ],
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={mode === v}
              onClick={() => {
                setMode(v);
                setQuery("");
                setZoom(1);
                setPan({ x: 0, y: 0 });
                setMessage("");
              }}
              className={`rounded-xl px-4 py-2.5 text-sm ${mode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {tr(
            "选择图形 → 填入条件 → 查看示意与结果",
            "Choose a shape → enter conditions → inspect the diagram and results",
          )}
        </span>
      </div>
      <section className={card}>
        {mode === "professional" && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {CATS.map((c) => (
                <button
                  key={c.id}
                  className={`rounded-lg px-3 py-2 text-sm ${cat === c.id ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted"}`}
                  onClick={() => {
                    setCat(c.id);
                    setQuery("");
                    select(SHAPES.find((s) => s.cat === c.id)!.id);
                  }}
                >
                  {t(c.name)}
                </button>
              ))}
            </div>
            <label className="relative">
              <Search
                size={15}
                className="absolute left-3 top-3.5 text-muted-foreground"
              />
              <Input
                value={query}
                maxLength={80}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                placeholder={tr("搜索图形或定理", "Search shapes or theorems")}
              />
            </label>
          </div>
        )}
        <div
          className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${mode === "simple" ? "xl:grid-cols-8" : "xl:grid-cols-5"}`}
        >
          {shapes.map((s) => (
            <button
              key={s.id}
              aria-pressed={s.id === id}
              onClick={() => select(s.id)}
              className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center text-sm transition ${s.id === id ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}
            >
              <ShapeIcon id={s.id} />
              {t(s.name)}
            </button>
          ))}
        </div>
        {!shapes.length && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {tr("没有匹配的图形", "No matching shapes")}
          </p>
        )}
      </section>
      <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className={`${card} space-y-5`}>
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Ruler size={18} />
              {t(shape.name)}
            </h3>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {t(shape.brief)}
            </p>
          </div>
          <label className="block space-y-2 text-sm">
            <span className="font-medium">
              {tr("已知条件", "Known conditions")}
            </span>
            <Select
              value={method.id}
              onChange={(e) => {
                setMethods((s) => ({ ...s, [id]: e.target.value }));
                setMessage("");
              }}
              triggerClassName="min-h-11 rounded-xl text-sm"
            >
              {shape.modes.map((m) => (
                <option value={m.id} key={m.id}>
                  {t(m.label)}
                </option>
              ))}
            </Select>
          </label>
          {method.fields.map((f) => (
            <label key={key(f.k)} className="block space-y-2 text-sm">
              <span>{t(f.label)}</span>
              {f.kind === "text" ? (
                <Textarea
                  value={val(f)}
                  maxLength={4000}
                  onChange={(e) =>
                    setValues((s) => ({ ...s, [key(f.k)]: e.target.value }))
                  }
                  className="min-h-24 font-mono"
                />
              ) : (
                <Input
                  value={val(f)}
                  inputMode="decimal"
                  maxLength={32}
                  onChange={(e) =>
                    setValues((s) => ({ ...s, [key(f.k)]: e.target.value }))
                  }
                />
              )}{" "}
              {f.hint && (
                <span className="block text-xs leading-5 text-muted-foreground">
                  {t(f.hint)}
                </span>
              )}
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
            <label className="space-y-2 text-xs">
              {tr("长度单位", "Length unit")}
              <Select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                triggerClassName="h-10 rounded-xl text-xs px-2.5"
              >
                {["mm", "cm", "m", "km"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </label>
            <label className="space-y-2 text-xs">
              {tr("角度单位", "Angle unit")}
              <Select
                value={angle}
                onChange={(e) => setAngle(e.target.value as "deg" | "rad")}
                triggerClassName="h-10 rounded-xl text-xs px-2.5"
              >
                <option value="deg">{tr("度（°）", "Degrees (°)")}</option>
                <option value="rad">
                  {tr("弧度（rad）", "Radians (rad)")}
                </option>
              </Select>
            </label>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {tr(
              `所有长度统一按 ${unit} 输入；面积用 ${unit}²，体积用 ${unit}³。更换单位只更改标注，不换算输入。`,
              `Use ${unit} for all lengths, ${unit}² for areas and ${unit}³ for volumes. Changing units relabels values; it does not convert inputs.`,
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setValues((s) => {
                  const next = { ...s };
                  for (const f of method.fields) next[key(f.k)] = f.def;
                  return next;
                })
              }
            >
              {tr("填入示例", "Use example")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setValues((s) => {
                  const next = { ...s };
                  for (const f of method.fields) next[key(f.k)] = "";
                  return next;
                })
              }
            >
              {tr("清空条件", "Clear conditions")}
            </Button>
          </div>
        </section>
        <div className="min-w-0 space-y-5">
          <section className={card}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">
                  {tr("几何示意图", "Geometric diagram")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tr(
                    "拖动平移，按钮缩放；尺寸标注以计算值为准。",
                    "Drag to pan; use the buttons to zoom. Dimension labels show calculated values.",
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  title={tr("放大", "Zoom in")}
                  onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
                >
                  <ZoomIn size={16} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={tr("缩小", "Zoom out")}
                  onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}
                >
                  <ZoomOut size={16} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={tr("复位视图", "Reset view")}
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  <RotateCcw size={16} />
                </Button>
              </div>
            </div>
            <div
              className="relative h-[320px] touch-none overflow-hidden rounded-xl border border-border bg-secondary/20"
              onPointerDown={(e) => {
                if (!solved.value) return;
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  px: pan.x,
                  py: pan.y,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (drag.current)
                  setPan({
                    x: drag.current.px + e.clientX - drag.current.x,
                    y: drag.current.py + e.clientY - drag.current.y,
                  });
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
            >
              {solved.value ? (
                <div
                  ref={diagram}
                  className="h-full w-full cursor-grab select-none"
                  style={{
                    transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
                  }}
                >
                  <FigureSvg prims={solved.value.figure} />
                </div>
              ) : (
                <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  {tr(
                    "填写有效条件后显示图形",
                    "Enter valid conditions to display the diagram",
                  )}
                </p>
              )}
            </div>
          </section>
          {solved.error && (
            <p
              role="alert"
              className="whitespace-pre-wrap rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {solved.error}
            </p>
          )}
          {solved.value && (
            <section className={card}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t(solved.value.primary.label)}
                  </p>
                  <p className="mt-1 break-all font-mono text-3xl font-semibold text-primary">
                    {uiMessage(solved.value.primary.value)}
                  </p>
                </div>
                <label className="space-y-1 text-xs text-muted-foreground">
                  {tr("小数位数", "Decimal places")}
                  <Select
                    value={digits}
                    onChange={(e) => setDigits(Number(e.target.value))}
                    className="inline-block w-auto ml-2"
                    triggerClassName="h-8 rounded-xl px-2.5 py-1 text-xs"
                  >
                    {[2, 4, 6, 8].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </Select>
                </label>
              </div>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {solved.value.rows
                  .slice(0, mode === "simple" ? 4 : solved.value.rows.length)
                  .map((r, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap justify-between gap-2 border-b border-border/60 pb-2 text-sm"
                    >
                      <dt className="text-muted-foreground">{t(r.label)}</dt>
                      <dd className="break-all font-mono">
                        {uiMessage(r.value)}
                      </dd>
                    </div>
                  ))}
              </dl>
              {mode === "simple" && solved.value.rows.length > 4 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-primary">
                    {tr("更多推导量", "More derived values")}
                  </summary>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    {solved.value.rows.slice(4).map((r, i) => (
                      <div key={i}>
                        <dt className="text-xs text-muted-foreground">
                          {t(r.label)}
                        </dt>
                        <dd className="mt-1 font-mono">{uiMessage(r.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
              <details className="mt-5 border-t border-border pt-4 text-sm">
                <summary className="cursor-pointer">
                  {tr("公式与推导依据", "Formulas and calculation basis")}
                </summary>
                <div className="mt-3 space-y-3">
                  {solved.value.formulas.map((f, i) => (
                    <div key={i}>
                      <p className="text-xs text-muted-foreground">
                        {t(f.name)}
                      </p>
                      <p className="mt-1 break-words font-mono">
                        {uiMessage(f.expr)}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(report())
                      .then(() =>
                        setMessage(
                          tr("已复制计算报告", "Calculation report copied"),
                        ),
                      )
                      .catch(() => setMessage(tr("复制失败", "Copy failed")))
                  }
                >
                  <Copy size={15} />
                  {tr("复制报告", "Copy report")}
                </Button>
                <Button variant="secondary" onClick={() => void save("txt")}>
                  <Download size={15} />
                  {tr("保存 TXT", "Save TXT")}
                </Button>
                <Button onClick={() => void save("svg")}>
                  <Download size={15} />
                  {tr("保存图形 SVG", "Save diagram SVG")}
                </Button>
              </div>
            </section>
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
