// Banner database: which 5★/S items were UP in which period.
// Embedded snapshot (gacha-banner-db.json) + optional live refresh:
//   · Genshin / ZZZ  – the public BWiki MediaWiki API (CORS-enabled; only public wiki page names are requested).
//   · Star Rail      – Star Rail Station `warp_config` + StarRailRes names, fetched by the Rust side because those
//                      hosts send no CORS headers (the front-end can only name one of five fixed public URLs).
// No account, UID or record data is ever sent.
import embedded from './gacha-banner-db.json';

export type GiRow = { n: string; i: 1 | 2; t: string; v: string; s: string; e: string; u: string[] };
export type ZzzRow = { n: string; k: string; t: string; v: string; s: string; e: string; u: string[] };
export type WwRow = { n: string; t: string; v: string; s: string; e: string; u: string[] };
export type HsrEntry = { u: string; s: string; e: string };
export type BannerDb = {
  schema: 2;
  built: string;
  genshin: { '301': GiRow[]; '302': GiRow[] };
  zzz: { '2': ZzzRow[]; '3': ZzzRow[] };
  starrail: { banners: Record<string, HsrEntry>; names: Record<string, string> };
  /** Wuthering Waves featured-resonator banners (pool 1) + the official 5★ roster used to validate names. */
  ww: { '1': WwRow[]; five: string[] };
  live?: string;
};

const LIVE_KEY = 'fk-gacha-banners-live-v2';
const THROTTLE_MS = 6 * 3600 * 1000;
const listeners = new Set<() => void>();
let cache: BannerDb | null = null;

// ───────────── wikitext parsing (BWiki templates) ─────────────
const stripComments = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const splitNames = (s?: string) => (s || '').split(/[、,，/]/).map(x => x.trim()).filter(Boolean);

function templates(wikitext: string, names: string[]): [string, Record<string, string>][] {
  const re = new RegExp(`\\{\\{\\s*(${names.map(escapeRe).join('|')})\\s*\\n([\\s\\S]*?)\\n\\s*\\}\\}`, 'g');
  const out: [string, Record<string, string>][] = [];
  for (const m of stripComments(wikitext).matchAll(re)) {
    const params: Record<string, string> = {};
    for (const line of m[2].split(/\n\|/)) {
      const l = line.trim().replace(/^\|/, '');
      const k = l.indexOf('=');
      if (k > 0) params[l.slice(0, k).trim()] = l.slice(k + 1).trim();
    }
    out.push([m[1], params]);
  }
  return out;
}

/** "2026/09/30 12:00[:00]" → UTC-epoch seconds of the naive wall-clock (no timezone conversion on purpose). */
function wall(s?: string): number | null {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((s || '').trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000;
}
const p2 = (n: number) => String(n).padStart(2, '0');
function show(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}
const DAY = 86400;

export function parseZzzWiki(...texts: string[]): ZzzRow[] {
  const rows = new Map<string, ZzzRow>();
  for (const text of texts) {
    for (const [name, p] of templates(text, ['调频/独家频段', '调频/音擎频段', '调频/独家重映', '调频/音擎回响'])) {
      const kind = name.split('/')[1];
      let s = wall(p['开始时间']);
      let e = wall(p['结束时间']);
      const u = splitNames(p['S级代理人'] || p['S级音擎']);
      if (s === null || e === null || !u.length) continue;
      if (s >= e || e - s > 70 * DAY) {                      // known typo class: wrong year in the start date
        const d = new Date(s * 1000); d.setUTCFullYear(new Date(e * 1000).getUTCFullYear()); s = d.getTime() / 1000;
        if (s >= e || e - s > 70 * DAY) continue;
      }
      if (p['开始时间描述']) { const d = new Date(s * 1000); d.setUTCHours(6, 0, 0, 0); s = d.getTime() / 1000; } // "…版本更新后": real go-live is earlier than the nominal time
      e += e % 60 === 59 ? 1 : 0;                              // inclusive "hh:mm:59" → exclusive bound
      rows.set(`${kind}|${p['期数']}`, { n: p['期数'] || '', k: kind, t: p['名称'] || '', v: p['版本'] || '', s: show(s), e: show(e), u });
    }
  }
  return [...rows.values()];
}

export function parseGiWiki(text: string): { '301': GiRow[]; '302': GiRow[] } {
  const chars = new Map<string, GiRow>();
  const weapons = new Map<string, GiRow>();
  for (const [name, p] of templates(text, ['祈愿/角色活动祈愿', '祈愿/武器活动祈愿'])) {
    const char = name.includes('角色');
    const s = wall(p['开始时间']);
    let e = wall(p['结束时间']);
    const u = splitNames(char ? p['5星角色'] : p['5星武器']);
    if (s === null || e === null || !u.length || s >= e) continue;
    if ((e / 60) % 60 === 59) e += 60;                         // "17:59" → exclusive 18:00
    const n = p['期数'] || '';
    (char ? chars : weapons).set(n, { n, i: n.endsWith('-2') ? 2 : 1, t: p['名称'] || '', v: p['版本'] || '', s: show(s), e: show(e), u });
  }
  return { '301': [...chars.values()], '302': [...weapons.values()] };
}

// ───────────── Star Rail (Star Rail Station warp_config) ─────────────
type WarpBanner = { rateup?: number | string; start_time?: number; end_time?: number };
type Named = Record<string, { name?: string }>;

/** Star Rail pool id by gacha_id range: 2xxx character event, 3xxx light-cone event, 5xxx / 6xxx collab. */
export function hsrPool(id: string | number): string | null {
  const n = +id;
  return n >= 2000 && n < 3000 ? '11' : n >= 3000 && n < 4000 ? '12' : n >= 5000 && n < 6000 ? '21' : n >= 6000 && n < 7000 ? '22' : null;
}

/** warp_config.config.banners → `pool:gacha_id` → featured item id + window (UTC epoch + 8 h = naive CST wall clock). */
export function parseHsrConfig(cfg: Record<string, WarpBanner> | null | undefined): Record<string, HsrEntry> {
  const out: Record<string, HsrEntry> = {};
  for (const [id, b] of Object.entries(cfg || {})) {
    const pool = hsrPool(id);
    if (pool && b && b.rateup) {
      out[`${pool}:${id}`] = { u: String(b.rateup), s: b.start_time ? show(b.start_time + 8 * 3600) : '', e: b.end_time ? show(b.end_time + 8 * 3600) : '' };
    }
  }
  return out;
}

/** item id → Chinese name, first source that knows the id wins (characters.json, light_cones.json). */
export function hsrNameMap(ids: Iterable<string>, ...sources: (Named | null | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    for (const src of sources) {
      const name = src && typeof src === 'object' ? src[id]?.name : undefined;
      if (name) { out[id] = name; break; }
    }
  }
  return out;
}

// ───────────── merge / load ─────────────
function mergeRows<T extends { n: string; s: string }>(base: T[], live: T[], key: (r: T) => string): T[] {
  const m = new Map(base.map(r => [key(r), r] as const));
  for (const r of live) m.set(key(r), r);
  return [...m.values()].sort((a, b) => a.s.localeCompare(b.s) || a.n.localeCompare(b.n));
}

/** What the last live refresh stored. `at` = last BWiki success (older builds only wrote this), `hsrAt` = last Star Rail success. */
type Live = {
  at?: string;
  hsrAt?: string;
  tried?: { bw?: string; hsr?: string };
  genshin?: { '301': GiRow[]; '302': GiRow[] };
  zzz?: { '2': ZzzRow[]; '3': ZzzRow[] };
  starrail?: { banners: Record<string, HsrEntry>; names: Record<string, string> };
};
function readLive(): Live | null {
  try { const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LIVE_KEY) : null; return raw ? (JSON.parse(raw) as Live) : null; } catch { return null; }
}

const arr = <T,>(x: unknown): T[] | null => (Array.isArray(x) ? (x as T[]) : null);
const dict = <T,>(x: unknown): Record<string, T> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, T>) : null);

function merged(base: BannerDb, live: Live | null): BannerDb {
  if (!live) return base;
  const gk = (r: GiRow) => `${r.n}`;
  const zk = (r: ZzzRow) => `${r.k}|${r.n}`;
  // Every stored section is shape-checked: a damaged value falls back to the embedded data for that section only.
  const g1 = arr<GiRow>(live.genshin?.['301']), g2 = arr<GiRow>(live.genshin?.['302']);
  const z2 = arr<ZzzRow>(live.zzz?.['2']), z3 = arr<ZzzRow>(live.zzz?.['3']);
  const hb = dict<HsrEntry>(live.starrail?.banners), hn = dict<string>(live.starrail?.names);
  return {
    ...base,
    genshin: {
      '301': g1 && g2 ? mergeRows(base.genshin['301'], g1, gk) : base.genshin['301'],
      '302': g1 && g2 ? mergeRows(base.genshin['302'], g2, gk) : base.genshin['302'],
    },
    zzz: {
      '2': z2 && z3 ? mergeRows(base.zzz['2'], z2, zk) : base.zzz['2'],
      '3': z2 && z3 ? mergeRows(base.zzz['3'], z3, zk) : base.zzz['3'],
    },
    // Live entries add to / replace the embedded ones, they never delete them.
    starrail: hb ? { banners: { ...base.starrail.banners, ...hb }, names: { ...base.starrail.names, ...(hn || {}) } } : base.starrail,
    live: [live.at, live.hsrAt].filter((x): x is string => typeof x === 'string' && !!x).sort().pop(),
  };
}

function build(): BannerDb {
  const base = embedded as unknown as BannerDb;
  try { return merged(base, readLive()); } catch { return base; }   // a damaged stored value must never break the analysis
}

export function getBannerDb(): BannerDb { return (cache ||= build()); }
export function onBannerDbChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function bannerDbInfo() {
  const db = getBannerDb();
  const last = (rows: { e: string }[]) => rows.reduce((m, r) => (r.e > m ? r.e : m), '');
  return {
    built: db.built,
    live: db.live || '',
    covers: {
      genshin: last(db.genshin['301']).slice(0, 10),
      zzz: last(db.zzz['2']).slice(0, 10),
      starrail: Object.values(db.starrail.banners).reduce((m, r) => (r.e > m ? r.e : m), '').slice(0, 10),
      ww: last(db.ww?.['1'] ?? []).slice(0, 10),
    },
  };
}

// ───────────── live refresh ─────────────
const WIKI = (wiki: string, page: string) =>
  `https://wiki.biligame.com/${wiki}/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&origin=*`;
const sleepMs = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Exactly the URLs the Rust side allows for /api/gacha/banners/fetch (src-tauri/src/gacha.rs BANNER_SOURCES).
export const HSR_WARP = 'https://starrailstation.com/api/v1/warp_config';
export const HSR_NAME_SOURCES = {
  characters: [
    'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_new/cn/characters.json',
    'https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_new/cn/characters.json',
  ],
  light_cones: [
    'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_new/cn/light_cones.json',
    'https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_new/cn/light_cones.json',
  ],
} as const;

async function wikitext(url: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { parse?: { wikitext?: { '*'?: string } } };
    const text = j.parse?.wikitext?.['*'];
    if (!text) throw new Error('页面内容为空');
    return text;
  } finally { clearTimeout(timer); }
}

/** One of the fixed public Star Rail URLs, fetched natively (no CORS) and returned as parsed JSON. */
async function nativeFetch(url: string): Promise<unknown> {
  const res = await fetch('/api/gacha/banners/fetch', { method: 'POST', body: JSON.stringify({ url }) });
  const data = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
  if (!res.ok) throw new Error((data && typeof data.error === 'string' && data.error) || `请求失败（${res.status}）`);
  if (data === null) throw new Error('没有收到数据');
  return data;
}

export type RefreshIo = {
  wiki?: (url: string) => Promise<string>;
  native?: (url: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};
export type RefreshResult = { ok: boolean; changed: number; message: string };

const countRows = (d: BannerDb) =>
  d.zzz['2'].length + d.zzz['3'].length + d.genshin['301'].length + d.genshin['302'].length + Object.keys(d.starrail.banners).length;
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function fetchHsr(native: (url: string) => Promise<unknown>, known: Record<string, string>): Promise<NonNullable<Live['starrail']>> {
  const warp = (await native(HSR_WARP)) as { config?: { banners?: Record<string, WarpBanner> } } | null;
  const banners = parseHsrConfig(warp?.config?.banners);
  const base = Object.keys((embedded as unknown as BannerDb).starrail.banners);
  // Sanity: a changed response layout must never replace good data with a partial parse.
  if (Object.keys(banners).length < 200 || base.filter(k => banners[k]).length < base.length * 0.9) throw new Error('在线数据格式已变化');
  // Names are only needed for items the database has never seen; a failure here only costs the display name
  // (the judgement itself compares item ids).
  const missing = [...new Set(Object.values(banners).map(b => b.u))].filter(id => !known[id]);
  let names: Record<string, string> = {};
  if (missing.length) {
    const load = async (urls: readonly string[]): Promise<Named | null> => {
      for (const u of urls) { try { const d = await native(u); if (d && typeof d === 'object') return d as Named; } catch { /* next mirror */ } }
      return null;
    };
    names = hsrNameMap(missing, await load(HSR_NAME_SOURCES.characters), await load(HSR_NAME_SOURCES.light_cones));
  }
  return { banners, names };
}

const RETRY_MS = 30 * 60 * 1000;

let inflight: Promise<RefreshResult> | null = null;
/** Single flight: the automatic refresh on open and a manual click while it is still running share one run and one result. */
export function refreshBannerDb(force = false, io: RefreshIo = {}): Promise<RefreshResult> {
  if (!inflight) {
    inflight = runRefresh(force, io)
      .catch((e): RefreshResult => ({ ok: false, changed: 0, message: `无法更新卡池数据（${reason(e)}），继续使用现有数据` }))
      .finally(() => { inflight = null; });
  }
  return inflight;
}

async function runRefresh(force: boolean, io: RefreshIo): Promise<RefreshResult> {
  const now = io.now?.() ?? Date.now();
  const getWiki = io.wiki ?? wikitext, native = io.native ?? nativeFetch, sleep = io.sleep ?? sleepMs;
  const prev = readLive() || {};
  const age = (at?: unknown) => { const t = typeof at === 'string' ? Date.parse(at) : NaN; return Number.isFinite(t) ? now - t : Infinity; };
  // Each source has its own 6 h freshness window, and a failed attempt is not retried for 30 min (unless forced).
  const wantBw = force || (age(prev.at) >= THROTTLE_MS && age(prev.tried?.bw) >= RETRY_MS);
  const wantHsr = force || (age(prev.hsrAt) >= THROTTLE_MS && age(prev.tried?.hsr) >= RETRY_MS);
  if (!wantBw && !wantHsr) return { ok: true, changed: 0, message: '卡池数据近期已更新' };

  const stamp = new Date(now).toISOString();
  const live: Live = { ...prev, tried: { ...prev.tried } };
  const before = countRows(getBannerDb());
  const done: string[] = [];
  const failed: string[] = [];

  if (wantBw) {
    live.tried!.bw = stamp;
    try {
      const zzzPast = await getWiki(WIKI('zzz', '往期调频'));
      await sleep(1500);
      const zzzNow = await getWiki(WIKI('zzz', '调频'));
      await sleep(1500);
      const giText = await getWiki(WIKI('ys', '往期祈愿'));
      const z = parseZzzWiki(zzzPast, zzzNow);
      const g = parseGiWiki(giText);
      // Sanity: a changed page layout must never replace good data with a partial parse.
      if (z.length < 100 || g['301'].length < 150 || g['302'].length < 80) throw new Error('在线页面格式已变化');
      live.zzz = { '2': z.filter(r => r.k.startsWith('独家')), '3': z.filter(r => r.k.startsWith('音擎')) };
      live.genshin = g;
      live.at = stamp;
      done.push('原神、绝区零');
    } catch (e) { failed.push(`原神 / 绝区零：${reason(e)}`); }
  }
  if (wantHsr) {
    live.tried!.hsr = stamp;
    try {
      // The banner list is replaced as a whole (warp_config always carries the full history); names are only fetched for
      // items neither the embedded data nor an earlier refresh knows, so what was learned before must be carried over.
      const prevNames = dict<string>(prev.starrail?.names) || {};
      const fresh = await fetchHsr(native, { ...(embedded as unknown as BannerDb).starrail.names, ...prevNames });
      live.starrail = { banners: fresh.banners, names: { ...prevNames, ...fresh.names } };
      live.hsrAt = stamp;
      done.push('星穹铁道');
    } catch (e) { failed.push(`星穹铁道：${reason(e)}`); }
  }

  try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch { /* storage unavailable: keep the embedded data */ }
  if (!done.length) return { ok: false, changed: 0, message: `无法联网更新（${failed.join('；')}），继续使用现有数据` };
  cache = null;
  listeners.forEach(cb => cb());
  const changed = Math.max(0, countRows(getBannerDb()) - before);
  const head = changed > 0 ? `已更新${done.join('、')}，新增 ${changed} 期卡池资料` : `${done.join('、')}的卡池数据已是最新`;
  return { ok: true, changed, message: failed.length ? `${head}；${failed.join('；')}` : head };
}
