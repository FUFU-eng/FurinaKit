"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Label, Textarea } from "@/components/ui/primitives";
import { CopyButton } from "@/components/tools/copy-button";

function decodeSegment(seg: string): unknown {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(seg.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function fmtTimestamp(value: unknown): string | null {
  if (typeof value !== "number") return null;
  const d = new Date(value * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

type JwtError = { error: string };
type JwtOk = {
  header: string;
  payload: string;
  signature: string;
  claims: { label: string; human: string }[];
};

export function JwtDecoderTool() {
  const [token, setToken] = useState("");

  const result = useMemo<JwtError | JwtOk | null>(() => {
    const t = token.trim();
    if (!t) return null;
    const parts = t.split(".");
    if (parts.length < 2) return { error: "JWT 由三个用点号分隔的部分组成：header.payload.signature。" };
    try {
      const header = decodeSegment(parts[0]);
      const payload = decodeSegment(parts[1]) as Record<string, unknown>;
      const claims: { label: string; human: string }[] = [];
      const exp = fmtTimestamp(payload.exp);
      const iat = fmtTimestamp(payload.iat);
      const nbf = fmtTimestamp(payload.nbf);
      if (iat) claims.push({ label: "签发时间", human: iat });
      if (nbf) claims.push({ label: "生效时间", human: nbf });
      if (exp) {
        const expired = typeof payload.exp === "number" && payload.exp * 1000 < Date.now();
        claims.push({ label: "过期时间", human: `${exp}${expired ? "（已过期）" : ""}` });
      }
      return {
        header: JSON.stringify(header, null, 2),
        payload: JSON.stringify(payload, null, 2),
        signature: parts[2] ?? "",
        claims,
      };
    } catch {
      return { error: "无法解析该令牌：头部 / 载荷不是有效的 Base64URL JSON。" };
    }
  }, [token]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>JWT 令牌</Label>
        <Textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.signature"
          className="min-h-[160px] font-mono-accent text-xs break-all leading-relaxed"
        />
      </div>

      {result && "error" in result && (
        <div className="flex items-center gap-2 rounded-md border-l-2 border-l-destructive bg-destructive/10 px-4 py-3 font-mono-accent text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {result.error}
        </div>
      )}

      {result && "payload" in result && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="flex items-start gap-2 rounded-md border-l-2 border-l-amber-500/70 bg-amber-500/10 px-4 py-2.5 font-mono-accent text-xs text-amber-900 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <span>签名仅作展示，<strong>不会被校验</strong>；这里只做解码，无需提供密钥。</span>
          </div>

          {result.claims.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              {result.claims.map((c) => (
                <div key={c.label} className="rounded-md border border-border bg-card px-3 py-2">
                  <p className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">{c.label}</p>
                  <p className="mt-0.5 text-xs text-foreground">{c.human}</p>
                </div>
              ))}
            </div>
          )}

          {[
            { label: "头部 Header", value: result.header },
            { label: "载荷 Payload", value: result.payload },
          ].map((block) => (
            <div key={block.label} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{block.label}</Label>
                <CopyButton value={block.value} />
              </div>
              <pre className="thin-scroll max-h-[280px] overflow-auto rounded-md border border-border bg-card p-4 font-mono-accent text-xs leading-relaxed">
                {block.value}
              </pre>
            </div>
          ))}

          {result.signature && (
            <div className="space-y-2">
              <Label>签名 Signature</Label>
              <pre className="overflow-auto rounded-md border border-border bg-card p-4 font-mono-accent text-xs break-all text-muted-foreground">
                {result.signature}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
