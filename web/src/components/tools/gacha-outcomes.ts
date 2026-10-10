import type { GameKey, PoolDef, Rec } from './gacha-analysis-tool';
import { getBannerDb } from './gacha-banners';

/**
 * Automatic UP / 歪 resolution.
 *
 *   歪 := the top-rarity result is NOT one of the featured items of the banner the pull was made on.
 *
 * Priority:
 *   1. manual            – this account's per-record / per-banner correction (never overwritten by sync)
 *   2. banner            – public banner database: exact gacha_id (Star Rail) or the banners that were live
 *                          at the pull time (Genshin: also the raw gacha_type 301 vs 400; ZZZ: the union of
 *                          every live exclusive/engine channel and rerun selection; Wuthering Waves: the union of
 *                          every featured-resonator banner that was open, they share one pity counter)
 *   3. inferred          – outside the database window: permanent roster ⇒ 歪; otherwise ⇒ UP (flagged)
 *   The "guaranteed after 歪" rule is applied by the caller (it needs the previous result).
 *
 * Whether a character is currently in some player's custom off-banner pool never matters: only the banner's
 * own featured items decide. The same Caesar is 歪 on another agent's banner and UP on his own.
 */
export type Outcome = 'up' | 'off' | 'unknown';
export type Basis = 'manual' | 'banner' | 'inferred';
export type Evidence = { outcome: Outcome; reason: string; basis: Basis; ups?: string[] };
export type AnalysisSettings = {
  schema: 1;
  overrides: Record<string, Outcome>;
  banners: Record<string, { upNames: string[] }>;
};
export type AnalysisPatch =
  | { record: { pool: string; id: string; value: Outcome | 'auto' } }
  | { banner: { pool: string; id: string; upNames: string[] } };

export const emptyAnalysis = (): AnalysisSettings => ({ schema: 1, overrides: {}, banners: {} });
export const recordKey = (pool: string, id: string) => `${pool}:${id}`;

const normalize = (name: string) => String(name ?? '').trim().replace(/[「」『』“”\s]/g, '');
const aliases: Record<string, string> = { 猫又: '猫宫又奈', 丽娜: '亚历山德丽娜·莎芭丝缇安', 雅: '星见雅', 柳: '月城柳', 悠真: '浅羽悠真', 简: '简·杜', 扳机: '扳机' };
const itemName = (name: string) => { const n = normalize(name); return aliases[n] || n; };
const same = (a: string, b: string) => itemName(a) === itemName(b);

export function bannerId(record: Rec): string {
  const id = String(record.gacha_id ?? '').trim();
  return /^\d+$/.test(id) && Number(id) > 0 ? id : '';
}

// Permanent rosters / selectable off-banner items. Used ONLY when the banner database has no window for the pull.
const STANDARD: Record<string, string[]> = {
  'genshin:301': ['迪卢克', '琴', '七七', '莫娜', '刻晴', '提纳里', '迪希雅', '梦见月瑞希'],
  'genshin:302': ['天空之刃', '风鹰剑', '阿莫斯之弓', '天空之傲', '天空之脊', '狼的末路', '和璞鸢', '四风原典', '天空之卷', '天空之翼'],
  'starrail:11': ['姬子', '瓦尔特', '布洛妮娅', '杰帕德', '克拉拉', '彦卿', '白露'],
  'starrail:21': ['姬子', '瓦尔特', '布洛妮娅', '杰帕德', '克拉拉', '彦卿', '白露'],
  'starrail:12': ['银河铁道之夜', '无可取代的东西', '以世界之名', '但战斗还未结束', '制胜的瞬间', '如泥酣眠', '时节不居'],
  'starrail:22': ['银河铁道之夜', '无可取代的东西', '以世界之名', '但战斗还未结束', '制胜的瞬间', '如泥酣眠', '时节不居'],
  'zzz:2': ['猫又', '珂蕾妲', '格莉丝', '莱卡恩', '11号', '丽娜', '柳', '凯撒', '朱鸢'], // 柳/凯撒/朱鸢: joined the selectable off-banner pool in 3.1
  'zzz:3': ['钢铁肉垫', '硫磺石', '燃狱齿轮', '拘缚者', '嵌合编译器', '悲鸣之摇篮'],
  'ww:1': ['凌阳', '安可', '卡卡罗', '鉴心', '维里奈'], // permanent 5★ resonators: what a lost 50/50 can return
};

export type BannerHit = { ups: string[]; ids: string[]; label: string };

/** The featured items of the banner(s) a record could belong to; null when the database has no matching window. */
export function bannerFor(game: GameKey, def: PoolDef, r: Rec): BannerHit | null {
  const db = getBannerDb();
  const t = String(r.time || '');
  if (game === 'genshin' && (def.id === '301' || def.id === '302')) {
    let rows = db.genshin[def.id as '301' | '302'].filter(x => x.s <= t && t < x.e);
    if (!rows.length) return null;
    if (def.id === '301') {
      const gt = String(r.gacha_type ?? '');
      const mine = rows.filter(x => x.i === (gt === '400' ? 2 : 1));
      if ((gt === '400' || gt === '301') && mine.length) rows = mine;
    }
    return { ups: [...new Set(rows.flatMap(x => x.u))], ids: [], label: rows.map(x => `${x.v}「${x.t || x.u.join('、')}」`).join(' / ') };
  }
  if (game === 'zzz' && (def.id === '2' || def.id === '3')) {
    const rows = db.zzz[def.id as '2' | '3'].filter(x => x.s <= t && t < x.e);
    if (!rows.length) return null;
    return { ups: [...new Set(rows.flatMap(x => x.u))], ids: [], label: rows.map(x => `${x.v} ${x.k}「${x.t || x.u.join('、')}」`).join(' / ') };
  }
  if (game === 'ww' && def.id === '1') {
    const rows = (db.ww?.['1'] ?? []).filter(x => x.s <= t && t < x.e);
    if (!rows.length) return null;
    return { ups: [...new Set(rows.flatMap(x => x.u))], ids: [], label: [...new Set(rows.map(x => `${x.v}${x.t ? `「${x.t}」` : ''}`))].join(' / ') };
  }
  if (game === 'starrail') {
    const gid = bannerId(r);
    const exact = gid ? db.starrail.banners[recordKey(def.id, gid)] : undefined;
    if (gid && !exact) return null; // a banner id the database does not know: never guess from dates
    const hits = exact ? [exact] : Object.entries(db.starrail.banners).filter(([k, v]) => k.startsWith(`${def.id}:`) && v.s && v.s <= t && t < (v.e || '9999')).map(([, v]) => v);
    if (!hits.length) return null;
    const ids = [...new Set(hits.map(h => h.u))];
    return { ups: ids.map(i => db.starrail.names[i] || `物品#${i}`), ids, label: exact ? `期次 ${gid}` : '同期卡池' };
  }
  return null;
}

export function resolveOutcome(game: GameKey, def: PoolDef, r: Rec, settings: AnalysisSettings = emptyAnalysis()): Evidence {
  const key = recordKey(def.id, r.id);
  const override = settings.overrides?.[key];
  if (override === 'up' || override === 'off' || override === 'unknown') {
    return { outcome: override, basis: 'manual', reason: override === 'unknown' ? '你标记为：暂不判定' : '你手动指定（仅此账号、此条记录）' };
  }
  const id = bannerId(r);
  const configured = id ? settings.banners?.[recordKey(def.id, id)] : undefined;
  if (configured && Array.isArray(configured.upNames) && configured.upNames.length) {
    const up = configured.upNames.some(n => same(n, r.name));
    return { outcome: up ? 'up' : 'off', basis: 'manual', ups: configured.upNames, reason: `你配置的期次 ${id} · UP：${configured.upNames.join('、')}` };
  }
  const hit = bannerFor(game, def, r);
  if (hit && (hit.ups.length || hit.ids.length)) {
    const up = (r.item_id && hit.ids.includes(String(r.item_id))) || hit.ups.some(n => same(n, r.name));
    if (!up && game === 'ww' && !STANDARD['ww:1'].some(n => same(n, r.name))) {
      // Losing the 50/50 on a Wuthering Waves featured banner can only return a permanent resonator. A top-rarity result
      // that is neither featured nor permanent means this window's list is stale or misaligned (other server clock,
      // a banner the source has not listed yet): treat it as the featured item, flagged as inferred.
      return {
        outcome: 'up', basis: 'inferred', ups: hit.ups,
        reason: `卡池资料 · ${hit.label} 的 UP 里没有「${r.name}」，但它不是常驻五星，按当期 UP 推断（卡池资料可能滞后）`,
      };
    }
    return {
      outcome: up ? 'up' : 'off',
      basis: 'banner',
      ups: hit.ups,
      reason: up ? `卡池资料 · ${hit.label} · 当期 UP：${hit.ups.join('、')}` : `卡池资料 · ${hit.label} · 当期 UP 为 ${hit.ups.join('、')}，本次获得「${r.name}」`,
    };
  }
  const roster = STANDARD[`${game}:${def.id}`];
  if (roster) {
    const std = roster.some(n => same(n, r.name));
    return {
      outcome: std ? 'off' : 'up',
      basis: 'inferred',
      reason: std ? `该时段没有卡池资料 · 「${r.name}」属于常驻/可歪名单，按歪推断` : `该时段没有卡池资料 · 「${r.name}」不在常驻/可歪名单，按当期 UP 推断`,
    };
  }
  return { outcome: 'unknown', basis: 'inferred', reason: '没有可用的卡池资料' };
}
