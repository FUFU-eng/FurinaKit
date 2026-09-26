"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/ui/primitives.tsx");


import React, { useState, useEffect, useRef, useMemo, isValidElement } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg";
}) {
  const __locale = __useLanguage();
  return (
    <button
      className={cn(
        "group/btn inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]",
        variant === "default" &&
          "sheen relative bg-primary text-primary-foreground shadow-[0_1px_0_0_hsl(0_0%_100%/0.18)_inset,0_8px_24px_-12px_hsl(var(--primary)/0.7)] hover:shadow-[0_1px_0_0_hsl(0_0%_100%/0.22)_inset,0_10px_30px_-10px_hsl(var(--primary)/0.85)] hover:brightness-110",
        variant === "secondary" &&
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border",
        variant === "outline" &&
          "border border-border bg-card text-foreground hover:bg-secondary",
        variant === "ghost" && "text-muted-foreground hover:bg-secondary hover:text-foreground",
        variant === "destructive" &&
          "bg-destructive text-white hover:brightness-110 shadow-[0_8px_24px_-12px_hsl(var(--destructive)/0.7)]",
        size === "default" && "h-10 px-5 text-sm",
        size === "sm" && "h-8 px-3 text-xs",
        size === "lg" && "h-12 px-7 text-sm",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 单行输入框。
 *
 * ⚠️ className 必须**解构**出来（像 Button/Label 那样），不能让它留在 props 里：
 * 下面 `{...props}` 是写在 className 之后的，props 里的 className 会把
 * 上面合并好的完整样式**整个覆盖掉** —— 一旦调用方传了 className，
 * 边框、主题背景色、内边距、聚焦光圈就全没了，输入框会露出浏览器默认的白底
 * （在「护眼」主题下就是一块刺眼的白，和米色背景完全不搭）。
 */
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const __locale = __useLanguage();
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-lg border border-input bg-card px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 transition-all duration-200 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** 多行输入框。className 同样必须解构，原因见上面 Input 的说明。 */
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const __locale = __useLanguage();
  return (
    <textarea
      className={cn(
        "thin-scroll flex min-h-[160px] w-full rounded-xl border border-input bg-card px-4 py-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/70 transition-all duration-200 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  const __locale = __useLanguage();
  return (
    <label
      className={cn(
        "text-[12px] font-medium tracking-wide text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  triggerClassName?: string;
}

export function Select({
  className,
  triggerClassName,
  value,
  defaultValue,
  onChange,
  children,
  disabled,
  id,
  name,
  style,
  ...props
}: SelectProps) {
  const __locale = __useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 解析 options
  const options = useMemo(() => {
    const list: Array<{ value: string; label: React.ReactNode; disabled?: boolean }> = [];
    const extract = (nodes: React.ReactNode) => {
      React.Children.forEach(nodes, (child) => {
        if (!isValidElement(child)) return;
        if (child.type === "option") {
          const p = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
          list.push({
            value: String(p.value ?? React.Children.toArray(p.children).filter(x=>typeof x==="string"||typeof x==="number").join("")),
            label: p.children ?? String(p.value ?? React.Children.toArray(p.children).filter(x=>typeof x==="string"||typeof x==="number").join("")),
            disabled: Boolean(p.disabled),
          });
        } else if (child.type === React.Fragment) {
          extract((child.props as {children:React.ReactNode}).children);
        } else if (child.type === "optgroup") {
          extract((child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>).children);
        }
      });
    };
    extract(children);
    return list;
  }, [children, __locale]);

  // 当前选中值
  const [uncontrolled,setUncontrolled]=useState<string | undefined>(defaultValue===undefined?undefined:String(defaultValue));
  const currentValue = String(value !== undefined ? value : uncontrolled ?? (options[0]?.value ?? ""));
  const selectedOption = options.find((o) => o.value === currentValue) || options[0];

  /**
   * 下拉面板的位置（fixed 定位，相对视口）。
   *
   * ★ 为什么不用 absolute + 跟随父容器：工具页的每一栏都是可滚动容器（overflow-y: auto），
   *   absolute 面板会被**裁剪**掉 —— 记账本里分类下拉被下面那张"汇总"卡挡住的正是这个。
   *   面板改渲染到 body 上（portal）+ fixed 定位，任何滚动容器都裁不到它。
   *   空间不够时自动向上弹。
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);

  const openPanel = () => {
    if (disabled) return;
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const panelMax = 240; // 与 max-h-60 对应
    const estimated = Math.min(panelMax, options.length * 36 + 16);
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < estimated && r.top > spaceBelow;
    const panelWidth = Math.min(Math.max(180, r.width), window.innerWidth - 16);
    setPanelPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - panelWidth - 8)),
      width: panelWidth,
      ...(flipUp ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
    setOpen(true);
  };

  // 点击外部或按 Esc 关闭（面板在 body 上，所以要一并判断它内部）
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {e.preventDefault();e.stopPropagation();setOpen(false);containerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();}
    };
    // 面板是 fixed 的：**底下的列表**一滚它就会跟触发按钮错位，所以那时收起。
    // ★ 但必须放过"面板自己内部的滚动" —— scroll 不冒泡，却会在**捕获阶段**经过祖先，
    //   直接判定的话用户一滚选项列表面板就关了（踩过，被作者抓出来）。
    const closeOnScroll = (e: Event) => {
      const target = e.target;
      if (panelRef.current && target instanceof Node && panelRef.current.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnScroll);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnScroll);
    };
  }, [open]);

  useEffect(()=>{if(!open)return;const raf=requestAnimationFrame(()=>(panelRef.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]:not(:disabled)') || panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus());return()=>cancelAnimationFrame(raf);},[open]);

  const handleSelect = (optVal: string) => {
    if (disabled) return;
    setOpen(false);
    setUncontrolled(optVal);
    containerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    if (onChange) {
      const syntheticEvent = {
        target: { value: optVal, name: name || id || "" },
        currentTarget: { value: optVal, name: name || id || "" },
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.ChangeEvent<HTMLSelectElement>;
      onChange(syntheticEvent);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", className)} style={style}>
      {/* 隐藏原生 select，以保留表单原生属性与兼容性 */}
      <select
        id={id ? `${id}-native` : undefined}
        aria-hidden="true"
        name={name}
        value={currentValue}
        onChange={onChange}
        disabled={disabled}
        tabIndex={-1}
        className="sr-only pointer-events-none absolute h-0 w-0 opacity-0"
        {...props}
      >
        {children}
      </select>

      {/* 自定义触发器按钮 */}
      <button
        type="button"
        disabled={disabled}
        id={id}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={props.title}
        onKeyDown={e=>{if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();e.stopPropagation();if(!open)openPanel();}}}
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-xl border border-input bg-card px-3.5 py-2 text-sm text-foreground transition-all duration-200",
          "hover:border-primary/50 focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10",
          open && "border-primary/70 ring-4 ring-primary/10 shadow-sm",
          disabled && "cursor-not-allowed opacity-50 bg-muted/40",
          triggerClassName,
        )}
      >
        <span className="fk-select-value truncate text-left">
          {selectedOption ? selectedOption.label : <span className="text-muted-foreground/60">{__ui("请选择...")}</span>}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ml-2",
            open && "rotate-180 text-primary",
          )}
        />
      </button>

      {/* 下拉面板：渲染到 body 上（portal）+ fixed 定位，
          避免被工具页的滚动容器裁剪（纯 DOM 渲染，杜绝系统原生弹窗闪白）。
          ★ 这里**不能**用 AnimatePresence 包着：面板挂在 body 上，退出动画还没播完
            React 就把 portal 节点摘了，framer-motion 再去操作它会抛 NotFoundError
            （实测每次关闭都报，连错误边界都会被触发）。入场动画改用纯 CSS 类。 */}
      {typeof document !== "undefined" && open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              role="listbox"
              aria-label={props["aria-label"]}
              onKeyDown={e=>{if(["ArrowDown","ArrowUp","Home","End"].includes(e.key)){e.preventDefault();e.stopPropagation();const opts=Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")||[]);const i=opts.indexOf(document.activeElement as HTMLButtonElement);const n=e.key==="Home"?0:e.key==="End"?opts.length-1:Math.max(0,Math.min(opts.length-1,i+(e.key==="ArrowDown"?1:-1)));opts[n]?.focus();}else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setOpen(false);containerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();}else if(e.key==="Tab"){setOpen(false);containerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();}}}
              style={{
                position: "fixed",
                left: panelPos.left,
                top: panelPos.top,
                bottom: panelPos.bottom,
                width: panelPos.width,
                minWidth: 0,
                maxWidth: "calc(100vw - 16px)",
              }}
              className="fk-drop-panel z-[1000] max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            >
              {options.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">{__ui("暂无选项")}</div>
              ) : (
                options.map((opt) => {
                  const isSelected = opt.value === currentValue;
                  return (
                    <button
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => !opt.disabled && handleSelect(opt.value)}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors",
                        isSelected
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-foreground hover:bg-accent hover:text-accent-foreground",
                        opt.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                      )}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isSelected && <Check className="h-4 w-4 shrink-0 text-primary ml-2" />}
                    </button>
                  );
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const __locale = __useLanguage();
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "secondary" | "outline" | "success" }) {
  const __locale = __useLanguage();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        variant === "default" && "bg-primary/15 text-primary border-primary/30",
        variant === "secondary" && "bg-secondary text-secondary-foreground border-border",
        variant === "outline" && "border-border text-muted-foreground",
        variant === "success" && "bg-success/15 text-success border-success/30",
        className,
      )}
      {...props}
    />
  );
}

export function ProgressBar({ value }: { value: number }) {
  const __locale = __useLanguage();
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary border border-border/60">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--brand-1))] via-[hsl(var(--brand-2))] to-[hsl(var(--brand-3))] transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

export function Alert({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" }) {
  const __locale = __useLanguage();
  return (
    <div
      className={cn(
        "rounded-lg border border-l-2 px-4 py-3 text-[12.5px] leading-relaxed",
        variant === "default" && "border-border border-l-primary/70 bg-primary/[0.06] text-muted-foreground",
        variant === "destructive" &&
          "border-destructive/30 border-l-destructive bg-destructive/10 text-destructive",
        className,
      )}
      {...props}
    />
  );
}


export function PasteButton({ onPaste, className }: { onPaste: (text: string) => void; className?: string }) {
  const __locale = __useLanguage();
  const [copied, setCopied] = useState(false);
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onPaste(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      alert(__ui("无法访问剪贴板，请手动粘贴（Ctrl+V）"));
    }
  };
  return (
    <button
      type="button"
      onClick={handlePaste}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95",
        copied && "border-green-500/50 bg-green-500/10 text-green-600",
        className,
      )}
      title={__ui("粘贴剪贴板内容")}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      </svg>
      {copied ? __ui("已粘贴") : __ui("粘贴")}
    </button>
  );
}
