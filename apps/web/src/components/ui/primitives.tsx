"use client";

import React, { useState, useEffect, useRef, useMemo, isValidElement } from "react";
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

export function Select({
  className,
  value,
  defaultValue,
  onChange,
  children,
  disabled,
  id,
  name,
  style,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
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
            value: String(p.value ?? ""),
            label: p.children ?? String(p.value ?? ""),
            disabled: Boolean(p.disabled),
          });
        } else if (child.type === "optgroup") {
          extract((child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>).children);
        }
      });
    };
    extract(children);
    return list;
  }, [children]);

  // 当前选中值
  const currentValue = String(value !== undefined ? value : defaultValue ?? (options[0]?.value ?? ""));
  const selectedOption = options.find((o) => o.value === currentValue) || options[0];

  // 点击外部或按 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleSelect = (optVal: string) => {
    if (disabled) return;
    setOpen(false);
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
        id={id}
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
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-xl border border-input bg-card px-3.5 py-2 text-sm text-foreground transition-all duration-200",
          "hover:border-primary/50 focus:border-primary/60 focus:outline-none focus:ring-4 focus:ring-primary/10",
          open && "border-primary/70 ring-4 ring-primary/10 shadow-sm",
          disabled && "cursor-not-allowed opacity-50 bg-muted/40",
        )}
      >
        <span className="truncate text-left">
          {selectedOption ? selectedOption.label : <span className="text-muted-foreground/60">请选择...</span>}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ml-2",
            open && "rotate-180 text-primary",
          )}
        />
      </button>

      {/* 下拉面板（纯 DOM 渲染，杜绝任何系统原生弹窗闪白） */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-60 w-full min-w-[160px] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          >
            {options.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">暂无选项</div>
            ) : (
              options.map((opt) => {
                const isSelected = opt.value === currentValue;
                return (
                  <button
                    key={opt.value}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
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
      alert("无法访问剪贴板，请手动粘贴（Ctrl+V）");
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
      title="粘贴剪贴板内容"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      </svg>
      {copied ? "已粘贴" : "粘贴"}
    </button>
  );
}
