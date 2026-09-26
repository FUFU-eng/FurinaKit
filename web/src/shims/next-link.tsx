// next/link 的替身：桌面端不做整页跳转，改成 @/router 的软跳转。
//
// 行为要和 Next 的 Link 对齐：
//  · 左键单击 → 站内软跳转（preventDefault）
//  · Ctrl/Shift/Alt/中键 点击 → 放行（让浏览器按原意处理）
//  · target="_blank" → 不拦截
//  · href 仍然渲染成真实的 <a href="...">，样式（含 hover/active）与原来完全一致

import React from "react";
import { navigate } from "@/router";

type Props = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
  legacyBehavior?: boolean;
};

export default function Link({
  href,
  replace,
  scroll,
  prefetch: _prefetch,
  legacyBehavior: _legacyBehavior,
  onClick,
  target,
  children,
  ...rest
}: Props) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (target && target !== "_self") return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

    // 外链交给系统浏览器
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return;

    e.preventDefault();
    navigate(href, { replace, scroll });
  };

  return (
    <a href={href} target={target} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
