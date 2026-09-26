/** Offline parsing is not resolved torrent metadata or a functioning download engine. */
export interface MagnetTorrentInfo {
  type: "magnet" | "torrent";
  name: string;
  infoHash: string;
  sizeText: string;
  fileCount: number | null;
  magnetUri?: string;
  torrentPath?: string;
  trackers: string[];
  files?: Array<{ path: string; sizeText: string; size?: number }>;
  metadataResolved: boolean;
  downloadSupported: boolean;
  downloadUnavailableReason?: string;
  note?: string;
}

export function isMagnetTorrentInfo(value: unknown): value is MagnetTorrentInfo {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (v.type === "magnet" || v.type === "torrent") &&
    typeof v.name === "string" && typeof v.sizeText === "string" &&
    typeof v.infoHash === "string" && /^[0-9a-f]{40}$/i.test(v.infoHash) &&
    (v.fileCount === null || (Number.isSafeInteger(v.fileCount) && (v.fileCount as number) >= 0)) &&
    typeof v.metadataResolved === "boolean" && typeof v.downloadSupported === "boolean" &&
    (v.magnetUri === undefined || typeof v.magnetUri === "string") &&
    (v.torrentPath === undefined || typeof v.torrentPath === "string") &&
    (v.downloadUnavailableReason === undefined || typeof v.downloadUnavailableReason === "string") &&
    (v.note === undefined || typeof v.note === "string") &&
    Array.isArray(v.trackers) && v.trackers.every(t => typeof t === "string") &&
    (v.files === undefined || (Array.isArray(v.files) && v.files.every(f =>
      f && typeof f === "object" && typeof f.path === "string" && typeof f.sizeText === "string")));
}
