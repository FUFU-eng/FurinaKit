import React from "react";

/**
 * Minimal, XSS-safe Markdown → React renderer.
 * No `dangerouslySetInnerHTML` — every node is a real React element, so user
 * input can never inject markup. Supports headings, bold/italic/inline-code,
 * links (safe-href only), ordered/unordered lists, blockquotes, fenced code,
 * and horizontal rules. Good enough for a live preview tool.
 */

let keySeq = 0;
const k = () => `md-${keySeq++}`;

function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  return /^(https?:|mailto:|#|\/)/i.test(trimmed) ? trimmed : undefined;
}

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/;
  let rest = text;

  while (rest.length) {
    const m = regex.exec(rest);
    if (!m) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const token = m[0];

    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={k()}
          className="rounded bg-secondary px-1.5 py-0.5 font-mono-accent text-[0.85em] text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(
        <strong key={k()} className="font-semibold text-foreground">
          {parseInline(token.slice(2, -2))}
        </strong>,
      );
    } else if (token.startsWith("*") || token.startsWith("_")) {
      nodes.push(<em key={k()}>{parseInline(token.slice(1, -1))}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link ? safeHref(link[2]) : undefined;
      if (link && href) {
        nodes.push(
          <a
            key={k()}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:brightness-110"
          >
            {parseInline(link[1])}
          </a>,
        );
      } else {
        nodes.push(link ? link[1] : token);
      }
    }
    rest = rest.slice(m.index + token.length);
  }
  return nodes;
}

const HEADING_CLASS = [
  "text-2xl font-bold tracking-tight",
  "text-xl font-bold tracking-tight",
  "text-lg font-semibold",
  "text-base font-semibold",
  "text-sm font-semibold",
  "text-sm font-semibold text-muted-foreground",
];

function renderMarkdownInner(src: string): React.ReactNode {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line.trim())) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre
          key={k()}
          className="thin-scroll overflow-auto rounded-md border border-border bg-background p-3 font-mono-accent text-xs leading-relaxed"
        >
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push(<hr key={k()} className="my-4 border-border" />);
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const Tag = `h${level}` as "h1";
      blocks.push(
        <Tag key={k()} className={HEADING_CLASS[level - 1]}>
          {parseInline(h[2])}
        </Tag>,
      );
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={k()}
          className="space-y-2 border-l-2 border-primary/60 pl-4 italic text-muted-foreground"
        >
          {renderMarkdownInner(quote.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={k()} className="list-disc space-y-1 pl-6">
          {items.map((it) => (
            <li key={k()}>{parseInline(it)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={k()} className="list-decimal space-y-1 pl-6">
          {items.map((it) => (
            <li key={k()}>{parseInline(it)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Paragraph: gather consecutive "plain" lines.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^```/.test(lines[i].trim())
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={k()} className="leading-relaxed">
        {parseInline(para.join(" "))}
      </p>,
    );
  }

  return <div className="space-y-3 text-sm">{blocks}</div>;
}

/** Renders Markdown source to React nodes. Keys are reset per top-level call so
 * React can diff elements correctly across re-renders. */
export function renderMarkdown(src: string): React.ReactNode {
  keySeq = 0;
  return renderMarkdownInner(src);
}
