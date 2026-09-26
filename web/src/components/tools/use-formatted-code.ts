import { useEffect, useState } from "react";
import { formatCode } from "./dev-format-core";

export function useFormattedCode(input: string, language: "js" | "html") {
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setOutput("");
    setError("");
    if (!input.trim()) return;
    const timer = setTimeout(() => {
      formatCode(input, language).then(result => {
        if (!cancelled) setOutput(result);
      }).catch((e: unknown) => {
        if (cancelled) return;
        setOutput(input);
        setError("格式化失败，已保留原文：" + (e instanceof Error ? e.message : String(e)));
      });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [input, language]);
  return { output, error };
}
