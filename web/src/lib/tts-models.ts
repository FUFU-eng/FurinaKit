"use client";
import { useQuery } from "@tanstack/react-query";
export type TtsPackage = { id: string; name: string; kind: "model" | "runtime"; family: "kokoro" | "vits" | "runtime"; size: number; sha256: string; url: string; licenseUrl: string; licenseNoteZh: string; licenseNoteEn: string; speakers: number; languages: string[]; defaultSpeaker?: number; downloaded: boolean; installedBytes: number; error?: string; active?: boolean; progress?: { id?: string; status?: string; received?: number; total?: number } };
export type TtsCatalog = { ok: boolean; components: TtsPackage[]; activeId: string | null; activeIds?: string[]; progress: { id?: string; status?: string; received?: number; total?: number }; progressMap?: Record<string, { id?: string; status?: string; received?: number; total?: number }>; operations: Record<string, { status: string; error?: string }> };
export const TTS_QUERY_KEY = ["tts-components-v66"] as const;
export async function ttsRequest<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || "语音操作失败 / Speech operation failed");
  return data as T;
}
export function useTtsComponents(enabled = true) {
  return useQuery<TtsCatalog>({ queryKey: TTS_QUERY_KEY, queryFn: () => ttsRequest<TtsCatalog>("/api/tts/components"), enabled, staleTime: 1500, retry: 1, refetchOnWindowFocus: true, refetchInterval: query => (query.state.data?.activeIds?.length || query.state.data?.activeId) ? 800 : 3000 });
}
