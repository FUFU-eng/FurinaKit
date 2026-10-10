import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/gacha-analysis-tool.tsx");

/** Local archive analysis. Existing sync/import APIs retained; no third-party private service integration. */

import { emptyAnalysis, resolveOutcome, type AnalysisSettings, type AnalysisPatch, type Basis } from "./gacha-outcomes";
import { bannerDbInfo, onBannerDbChange, refreshBannerDb } from "./gacha-banners";
import { GachaDashboard } from "./gacha-dashboard";
import gameIcons from "./gacha-game-icons.json";
import { renderHeyboxLongImage } from "./gacha-report-image";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  Flame,
  FolderOpen,
  Gamepad2,
  HelpCircle,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers,
  Link2,
  Settings,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { revealOutputFile, reportOutputError, reportOutputSaved, saveOutputBlob } from "@/lib/output-directory";

// ── 游戏与卡池定义 ─────────────────────────────────────────────────────────

export type GameKey = "genshin" | "starrail" | "zzz" | "ww";
type UpKind = "char" | "weapon";

export type PoolDef = {
  id: string;
  name: string;
  hard: number;
  soft: number;
  up?: UpKind;
  cost: boolean;
  novice?: boolean;
  baseRate: number;
  upRate?: number;
  guaranteedUp?: boolean;
  isBangboo?: boolean;
  optional?: boolean; // 限时 / 特殊卡池：没抽过就不显示
  note?: string;
};

export type GameDef = {
  key: GameKey;
  name: string;
  currency: string;
  ticketName: string;
  top: string; // 5 或 4
  mid: string; // 4 或 3
  topLabel: string;
  midLabel: string;
  pull: string; // 祈愿 / 跃迁 / 调频 / 唤取
  playerTitle: string; // 旅行者 / 开拓者 / 绳匠 / 漂泊者
  mihoyo: boolean;
  pools: PoolDef[];
};

export const GAMES: Record<GameKey, GameDef> = {
  genshin: {
    key: "genshin",
    get name() { return __ui("原神"); },
    get currency() { return __ui("原石"); },
    get ticketName() { return __ui("纠缠/相遇之缘"); },
    top: "5",
    mid: "4",
    get topLabel() { return __ui("五星"); },
    get midLabel() { return __ui("四星"); },
    get pull() { return __ui("祈愿"); },
    get playerTitle() { return __ui("旅行者"); },
    mihoyo: true,
    pools: [
      { id: "301", get name() { return __ui("角色活动祈愿"); }, hard: 90, soft: 74, up: "char", cost: true, baseRate: 0.6, upRate: 0.5, get note() { return __ui("90抽保底，50%小保底，歪后大保底，含捕获明光机制"); } },
      { id: "302", get name() { return __ui("武器活动祈愿"); }, hard: 80, soft: 63, up: "weapon", cost: true, baseRate: 0.7, upRate: 0.75, get note() { return __ui("80抽保底，75%当期UP武器，定轨命定值上限1点"); } },
      { id: "500", get name() { return __ui("集录祈愿"); }, hard: 90, soft: 74, cost: true, baseRate: 0.6, upRate: 0.5, get note() { return __ui("90抽保底，定轨命定值上限1点，跨期抽数保留"); } },
      { id: "200", get name() { return __ui("常驻祈愿"); }, hard: 90, soft: 74, cost: true, baseRate: 0.6, get note() { return __ui("90抽保底，角色与武器混合"); } },
      { id: "100", get name() { return __ui("新手祈愿"); }, hard: 20, soft: 20, cost: true, novice: true, baseRate: 0.6, get note() { return __ui("20抽8折必出诺艾尔，抽满关闭"); } },
    ],
  },
  starrail: {
    key: "starrail",
    get name() { return __ui("崩坏：星穹铁道"); },
    get currency() { return __ui("星琼"); },
    get ticketName() { return __ui("星轨专票/通票"); },
    top: "5",
    mid: "4",
    get topLabel() { return __ui("五星"); },
    get midLabel() { return __ui("四星"); },
    get pull() { return __ui("跃迁"); },
    get playerTitle() { return __ui("开拓者"); },
    mihoyo: true,
    pools: [
      { id: "11", get name() { return __ui("角色活动跃迁"); }, hard: 90, soft: 74, up: "char", cost: true, baseRate: 0.6, upRate: 0.5, get note() { return __ui("90抽保底，支持星缘相邀；概率以当期规则为准"); } },
      { id: "12", get name() { return __ui("光锥活动跃迁"); }, hard: 80, soft: 65, up: "weapon", cost: true, baseRate: 0.8, upRate: 0.75, get note() { return __ui("80抽保底，75%超高不歪率，单UP无需定轨"); } },
      { id: "21", get name() { return __ui("角色联动跃迁"); }, hard: 90, soft: 74, up: "char", cost: true, baseRate: 0.6, upRate: 0.5, get note() { return __ui("联动角色独立池"); } },
      { id: "22", get name() { return __ui("光锥联动跃迁"); }, hard: 80, soft: 65, up: "weapon", cost: true, baseRate: 0.8, upRate: 0.75, get note() { return __ui("联动光锥独立池"); } },
      { id: "1", get name() { return __ui("常驻跃迁"); }, hard: 90, soft: 74, cost: true, baseRate: 0.6, get note() { return __ui("90抽保底，累计300抽可自选1次常驻五星角色"); } },
      { id: "2", get name() { return __ui("新手跃迁"); }, hard: 50, soft: 50, cost: true, novice: true, baseRate: 0.6, get note() { return __ui("50抽8折必出五星角色"); } },
    ],
  },
  zzz: {
    key: "zzz",
    get name() { return __ui("绝区零"); },
    get currency() { return __ui("菲林"); },
    get ticketName() { return __ui("加密/原装母带"); },
    top: "4",
    mid: "3",
    get topLabel() { return __ui("S 级"); },
    get midLabel() { return __ui("A 级"); },
    get pull() { return __ui("调频"); },
    get playerTitle() { return __ui("绳匠"); },
    mihoyo: true,
    pools: [
      { id: "2", get name() { return __ui("独家频段"); }, hard: 90, soft: 74, up: "char", cost: true, baseRate: 0.6, upRate: 0.5, get note() { return __ui("90抽保底，支持自选非UP；概率以当期规则为准"); } },
      { id: "3", get name() { return __ui("音擎频段"); }, hard: 80, soft: 65, up: "weapon", cost: true, baseRate: 0.8, upRate: 0.75, get note() { return __ui("80抽保底，75%当期UP音擎，含回响频段共享"); } },
      { id: "1", get name() { return __ui("常驻频段"); }, hard: 90, soft: 74, cost: true, baseRate: 0.6, get note() { return __ui("前50抽8折必出S级代理人，300抽自选1次"); } },
      { id: "5", get name() { return __ui("邦布频段"); }, hard: 80, soft: 65, cost: false, baseRate: 1.0, upRate: 1.0, isBangboo: true, get note() { return __ui("80抽保底，100%自选定向必中（绝不歪），免费嗯呢券"); } },
    ],
  },
  ww: {
    key: "ww",
    get name() { return __ui("鸣潮"); },
    get currency() { return __ui("星声"); },
    get ticketName() { return __ui("浮金/铸潮/唤声波"); },
    top: "5",
    mid: "4",
    get topLabel() { return __ui("五星"); },
    get midLabel() { return __ui("四星"); },
    get pull() { return __ui("唤取"); },
    get playerTitle() { return __ui("漂泊者"); },
    mihoyo: false,
    pools: [
      { id: "1", get name() { return __ui("角色活动唤取"); }, hard: 80, soft: 65, up: "char", cost: true, baseRate: 0.8, upRate: 0.5, get note() { return __ui("80抽保底（不是90），50%小保底，歪后大保底"); } },
      { id: "2", get name() { return __ui("武器活动唤取"); }, hard: 80, soft: 65, cost: true, baseRate: 0.8, upRate: 1.0, guaranteedUp: true, get note() { return __ui("80抽保底，100%必出当期限定UP武器（绝不歪）"); } },
      { id: "3", get name() { return __ui("角色常驻唤取"); }, hard: 80, soft: 65, cost: true, baseRate: 0.8, get note() { return __ui("80抽保底，纯常驻角色池"); } },
      { id: "4", get name() { return __ui("武器常驻唤取"); }, hard: 80, soft: 65, cost: true, baseRate: 0.8, upRate: 1.0, guaranteedUp: true, get note() { return __ui("80抽保底，100%自选定向武器，不歪"); } },
      { id: "5", get name() { return __ui("新手唤取"); }, hard: 50, soft: 50, cost: true, novice: true, baseRate: 0.8, get note() { return __ui("50抽8折必出五星角色"); } },
      { id: "6", get name() { return __ui("新手自选唤取"); }, hard: 80, soft: 65, cost: false, novice: true, baseRate: 0.8, get note() { return __ui("80抽自选定向常驻五星角色"); } },
      { id: "7", get name() { return __ui("感恩定向唤取"); }, hard: 80, soft: 65, cost: false, novice: true, baseRate: 0.8, get note() { return __ui("80抽自选定向"); } },
      { id: "8", get name() { return __ui("角色新旅唤取"); }, hard: 80, soft: 65, cost: true, optional: true, baseRate: 0.8, get note() { return __ui("限时活动池：从指定的往期五星角色里选一位定向唤取，最多160抽，抽到选定角色后关闭"); } },
      { id: "9", get name() { return __ui("武器新旅唤取"); }, hard: 80, soft: 65, cost: true, optional: true, baseRate: 0.8, get note() { return __ui("限时活动池：从指定的往期五星武器里选一把定向唤取，抽到选定武器后关闭"); } },
      { id: "12", get name() { return __ui("角色忆旅唤取"); }, hard: 80, soft: 65, cost: true, optional: true, baseRate: 0.8, upRate: 0.5, get note() { return __ui("可自选一位往期五星角色作为UP，50%小保底，歪后大保底；概率以游戏内说明为准"); } },
      { id: "13", get name() { return __ui("武器忆旅唤取"); }, hard: 80, soft: 65, cost: true, optional: true, baseRate: 0.8, get note() { return __ui("可自选往期五星武器定向唤取；概率以游戏内说明为准"); } },
    ],
  },
};

const GAME_ORDER: GameKey[] = ["genshin", "starrail", "zzz", "ww"];

// ── 抽卡统计与保底计算引擎 ────────────────────────────────────────────────────────

export type Rec = { id: string; name: string; rank_type: string; item_type?: string; time: string; _pool: string; item_id?: string; gacha_id?: string; gacha_type?: string };

export type Five = {
  id: string;
  name: string;
  pulls: number;
  partial?: boolean; // First interval may start before the archived history.
  time: string;
  tag: "up" | "off" | "guarantee" | "direct" | "unknown" | null;
  evidence?: string;
  basis?: Basis; // manual | banner (database) | inferred
  ups?: string[]; // featured items of the banner the pull belonged to
  smallTrial?: boolean;
  pool: string;
};

export type PoolStat = {
  def: PoolDef;
  total: number;
  pity: number; // 当前已垫
  pity4: number; // 距上次4星
  toSoft: number; // 距软保底剩余
  toHard: number; // 距硬保底剩余
  inSoftRange: boolean; // 是否处于软保底黄金期
  fives: Five[];
  count4: number;
  count3: number;
  avg5: number | null;
  avgUp: number | null;
  upCount: number;
  small: number;
  win: number;
  guaranteed: boolean | null; // null: last outcome / prior state not established
  unknownCount: number;
  inferred: number; // 5★ results decided by roster/guarantee rules instead of banner data
  manual: number;
  luck: number | null; // share of theoretical players who needed MORE pulls (model estimate)
  conflicts: number;
  upSamples: number;
  pityStatusText: string;
  pityStatusBadge: "gold" | "good" | "plain";
  fours: { name: string; type: string; count: number }[];
  first?: string;
  last?: string;
};

/** P(N > k): chance that a random player needs MORE than k pulls for the first top-rarity item. */
function pityTail(def: PoolDef): number[] {
  const step = def.hard <= 80 ? 0.07 : 0.06;
  const tail = [1];
  let alive = 1;
  for (let n = 1; n <= def.hard; n++) {
    const p = n >= def.hard ? 1 : n >= def.soft ? Math.min(1, def.baseRate / 100 + (n - def.soft + 1) * step) : def.baseRate / 100;
    alive *= 1 - p;
    tail.push(alive);
  }
  return tail;
}
function luckOf(def: PoolDef, fives: Five[]): number | null {
  const done = fives.filter(f => !f.partial);
  if (!done.length || def.novice) return null;
  const tail = pityTail(def);
  return done.reduce((n, f) => n + tail[Math.min(f.pulls, def.hard)], 0) / done.length;
}

export function analyzePool(game: GameKey, def: PoolDef, recs: Rec[], settings: AnalysisSettings = emptyAnalysis()): PoolStat {
  const g = GAMES[game];
  let pity = 0;
  let pity4 = 0;
  let count4 = 0;
  let count3 = 0;
  let guaranteed: boolean | null = null;
  let conflicts = 0;
  let inferredN = 0;
  let manualN = 0;
  let index = 0;
  let small = 0;
  let win = 0;
  let lastUpIndex: number | null = null;
  const completeUpCosts: number[] = [];
  const fives: Five[] = [];
  const fourMap = new Map<string, { name: string; type: string; count: number }>();

  for (const r of recs) {
    index++;
    pity++;
    pity4++;
    if (r.rank_type === g.top) {
      let tag: Five["tag"] = null;
      let evidence = '';
      let basis: Basis | undefined;
      let ups: string[] | undefined;
      let smallTrial = false;
      if (def.guaranteedUp || def.isBangboo) {
        tag = "direct";
        evidence = __ui("此卡池规则为定向必中");
      } else if (def.up) {
        const result = resolveOutcome(game, def, r, settings);
        let outcome = result.outcome;
        basis = result.basis;
        ups = result.ups;
        evidence = __msg(result.reason);
        if (outcome === 'unknown' && guaranteed === true && basis !== 'manual') {
          // The previous top-rarity result was 歪, so this one MUST be the featured item (shared guarantee).
          outcome = 'up';
          basis = 'inferred';
          evidence = __ui("上一个五星是歪，本次为大保底，必出当期 UP（按保底规则推断）");
        }
        if (basis === 'inferred') inferredN++;
        if (basis === 'manual') manualN++;
        if (outcome === 'unknown') {
          tag = 'unknown';
          guaranteed = null;
          lastUpIndex = null; // Never bridge an unclassified top-rarity result.
        } else {
          const prior = guaranteed;
          const off = outcome === 'off';
          tag = off ? 'off' : prior === true ? 'guarantee' : 'up';
          if (off && prior === true) {
            // Contradictory sequence: missing history or a wrong correction. Do not count it as a small pity.
            conflicts++;
            evidence += __ui(" · 与前次歪后保底冲突，请核对记录完整性与配置");
            lastUpIndex = null;
          } else if (prior === false) {
            smallTrial = true;
            small++;
            if (!off) win++;
          }
          guaranteed = off;
          if (!off) {
            if (lastUpIndex !== null) completeUpCosts.push(index - lastUpIndex);
            lastUpIndex = index;
          }
        }
      }
      fives.push({ id: r.id, name: r.name, pulls: pity, time: r.time, tag, evidence, basis, ups, smallTrial, pool: def.id, partial: fives.length === 0 });
      pity = 0;
      pity4 = 0;
    } else if (r.rank_type === g.mid) {
      count4++;
      pity4 = 0;
      const k = r.name;
      const cur = fourMap.get(k);
      if (cur) cur.count++;
      else fourMap.set(k, { name: r.name, type: r.item_type || "", count: 1 });
    } else {
      count3++;
    }
  }

  const total = recs.length;
  const done = total - pity;
  const upCount = def.up ? fives.filter((f) => f.tag === "up" || f.tag === "guarantee").length : fives.length;
  const toSoft = Math.max(0, def.soft - pity);
  const toHard = Math.max(0, def.hard - pity);
  const inSoftRange = pity >= def.soft;

  // 保底状态文本
  let pityStatusText = "";
  let pityStatusBadge: "gold" | "good" | "plain" = "plain";
  if (def.guaranteedUp || def.isBangboo) {
    pityStatusText = __ui("100% 定向必中（绝不歪）");
    pityStatusBadge = "gold";
  } else if (def.up) {
    if (guaranteed === null) {
      pityStatusText = __ui("UP 保底状态待确认（历史结果不足）");
    } else if (guaranteed) {
      pityStatusText = __ui("大保底已就绪 · 下次必出当期限定！");
      pityStatusBadge = "gold";
    } else {
      pityStatusText = __ui("当前为小保底 · 具体概率以当期游戏规则为准");
      pityStatusBadge = "good";
    }
  } else {
    pityStatusText = def.novice ? __ui("新手特惠保底") : __ui("常驻卡池保底（常规出金）");
  }

  return {
    def,
    total,
    pity,
    pity4,
    toSoft,
    toHard,
    inSoftRange,
    fives,
    count4,
    count3,
    small,
    win,
    guaranteed,
    unknownCount: fives.filter(f => f.tag === "unknown").length,
    inferred: inferredN,
    manual: manualN,
    luck: luckOf(def, fives),
    conflicts,
    upSamples: completeUpCosts.length,
    pityStatusText,
    pityStatusBadge,
    upCount,
    avg5: fives.length > 1 ? fives.slice(1).reduce((n, f) => n + f.pulls, 0) / (fives.length - 1) : null,
    avgUp: completeUpCosts.length ? completeUpCosts.reduce((a, b) => a + b, 0) / completeUpCosts.length : null,
    fours: [...fourMap.values()].sort((a, b) => b.count - a.count),
    first: recs[0]?.time,
    last: recs[recs.length - 1]?.time,
  };
}

export type Summary = {
  pools: PoolStat[];
  total: number;
  cost: number;
  fives: Five[];
  count4: number;
  count3: number;
  avg5: number | null;
  avgUp: number | null;
  small: number;
  win: number;
  luck: number | null;
  title: { name: string; desc: string; tone: "gold" | "good" | "plain" | "bad"; rankPercent: number };
  badges: string[];
  luckiest?: Five;
  unluckiest?: Five;
};

function titleFor(avg: number | null, winRate: number | null, n: number): Summary["title"] {
  if (avg === null || n === 0) {
    return { name: n ? __ui("样本不足") : __ui("尚未出金"), desc: n ? __ui("尚无完整出金间隔，暂不评价") : __ui("还没有出过最高稀有度，好运正在蓄力中"), tone: "plain", rankPercent: 50 };
  }
  const wr = winRate ?? 0.5;
  if (avg <= 48 && wr >= 0.7) {
    return { name: __ui("天选欧皇"), desc: __ui("极少吃保底且几乎不歪，本地样本内出金较早。"), tone: "gold", rankPercent: 99 };
  }
  if (wr >= 0.8 && n >= 3) {
    return { name: __ui("小保底战神"), desc: __ui("小保底百战百胜，歪常驻与你彻底绝缘！"), tone: "gold", rankPercent: 96 };
  }
  if (avg <= 55) {
    return { name: __ui("欧气满满"), desc: __ui("本地记录中的平均出金抽数较低。"), tone: "gold", rankPercent: 90 };
  }
  if (avg <= 62) {
    return { name: __ui("福星高照"), desc: __ui("综合运气上佳，抽卡体验平稳舒适。"), tone: "good", rankPercent: 78 };
  }
  if (avg <= 69) {
    return { name: __ui("欧非守恒"), desc: __ui("标准的大数定律执行者，起伏有致，平稳健康。"), tone: "plain", rankPercent: 52 };
  }
  if (avg >= 75 && wr <= 0.35) {
    return { name: __ui("非酋之王"), desc: __ui("次次吃满大保底，心疼地抱抱你…"), tone: "bad", rankPercent: 4 };
  }
  if (wr <= 0.3 && n >= 3) {
    return { name: __ui("常驻守护者"), desc: __ui("已确认的小保底样本中，非UP结果较多。"), tone: "bad", rankPercent: 14 };
  }
  if (avg >= 74) {
    return { name: __ui("沉重保底人"), desc: __ui("每次出金都要垫入深水区，不过下次一定会转运！"), tone: "bad", rankPercent: 20 };
  }
  return { name: __ui("略带非气"), desc: __ui("保底偶尔迟到，蓄力等待下一次大爆发。"), tone: "bad", rankPercent: 35 };
}

export function summarize(game: GameKey, records: Rec[], settings: AnalysisSettings = emptyAnalysis()): Summary {
  const g = GAMES[game];
  const byPool = new Map<string, Rec[]>();
  for (const r of records) {
    const list = byPool.get(r._pool);
    if (list) list.push(r);
    else byPool.set(r._pool, [r]);
  }
  const pools = g.pools.map((def) => analyzePool(game, def, byPool.get(def.id) || [], settings));
  const counted = pools.filter((p) => !p.def.novice);
  const total = pools.reduce((s, p) => s + p.total, 0);
  const cost = pools.filter((p) => p.def.cost).reduce((s, p) => s + p.total, 0) * 160;
  const fives = pools.flatMap((p) => p.fives).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const doneAll = counted.reduce((s, p) => s + (p.total - p.pity), 0);
  const nAll = counted.reduce((s, p) => s + p.fives.length, 0);

  const upPools = counted.filter((p) => p.def.up);
  const doneUp = upPools.reduce((s, p) => s + (p.total - p.pity), 0);
  const nUp = upPools.reduce((s, p) => s + p.upCount, 0);
  const small = upPools.reduce((s, p) => s + p.small, 0);
  const win = upPools.reduce((s, p) => s + p.win, 0);
  const complete = counted.flatMap(p => p.fives.filter(f => !f.partial));
  const avg5 = complete.length ? complete.reduce((n,f) => n + f.pulls, 0) / complete.length : null;
  const upSamples = upPools.reduce((n,p) => n + p.upSamples, 0);
  const winRate = small > 0 ? win / small : null;
  const luckParts = counted.map(p => ({ n: p.fives.filter(f => !f.partial).length, v: p.luck })).filter(x => x.v !== null && x.n > 0);
  const luckN = luckParts.reduce((n, x) => n + x.n, 0);
  const luck = luckN ? luckParts.reduce((n, x) => n + (x.v as number) * x.n, 0) / luckN : null;

  const countedFives = counted.flatMap((p) => p.fives);
  const luckiest = countedFives.reduce<Five | undefined>((a, f) => (!a || f.pulls < a.pulls ? f : a), undefined);
  const unluckiest = countedFives.reduce<Five | undefined>((a, f) => (!a || f.pulls > a.pulls ? f : a), undefined);

  const badges: string[] = [];
  const oneShot = countedFives.filter((f) => f.pulls === 1).length;
  if (oneShot) badges.push(__msg("一发入魂 ×{0}", oneShot));
  let doubles = 0;
  for (const p of pools) for (let i = 1; i < p.fives.length; i++) if (p.fives[i].time === p.fives[i - 1].time) doubles++;
  if (doubles) badges.push(__msg("十连双金 ×{0}", doubles));
  let streak = 0;
  let best = 0;
  for (const f of upPools.flatMap((p) => p.fives).sort((a, b) => (a.time < b.time ? -1 : 1))) {
    if (f.tag === "up" && f.smallTrial) best = Math.max(best, ++streak);
    else if (f.tag === "off" || f.tag === "unknown") streak = 0;
  }
  if (best >= 2) badges.push(__msg("小保底连胜 {0} 次", best));
  const early = countedFives.filter((f) => f.pulls <= 10).length;
  if (early >= 2) badges.push(__msg("十抽内出金 ×{0}", early));
  const fullPity = counted.reduce((s, p) => s + p.fives.filter((f) => f.pulls >= p.def.hard - 2).length, 0);
  if (fullPity) badges.push(__msg("吃满硬保底 ×{0}", fullPity));
  if (small >= 3 && win / small >= 0.75) badges.push(__ui("不歪大师"));
  if (small >= 3 && win / small <= 0.25) badges.push(__ui("常驻常客"));

  return {
    pools,
    total,
    cost,
    fives,
    count4: pools.reduce((s, p) => s + p.count4, 0),
    count3: pools.reduce((s, p) => s + p.count3, 0),
    avg5,
    avgUp: upSamples ? upPools.reduce((n,p) => n + (p.avgUp || 0) * p.upSamples, 0) / upSamples : null,
    small,
    win,
    luck,
    title: titleFor(avg5, winRate, nAll),
    badges,
    luckiest,
    unluckiest,
  };
}

// ── 辅助工具 ────────────────────────────────────────────────────────────

async function api<T>(sub: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/api/gacha/${sub}`, { method: "POST", body: JSON.stringify(args) });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error((data && typeof data.error === "string" && data.error) || __msg("请求失败（{0}）", res.status));
  return data as T;
}

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
const fmt = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !isFinite(n) ? "—" : n.toFixed(d).replace(/\.0+$/, ""));
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1).replace(/\.0$/, "")}%` : "—");

/** 抽数颜色阶梯：≤40 极欧翠绿；41-73 正常金黄；≥74 沉底红 */
const getPullLuckType = (n: number) => {
  if (n <= 40) return "green";
  if (n <= 73) return "amber";
  return "red";
};

const pullBarColor = (n: number) => {
  const type = getPullLuckType(n);
  if (type === "green") return "from-emerald-500 to-teal-400";
  if (type === "amber") return "from-amber-400 to-yellow-500";
  return "from-rose-500 to-red-600";
};

const pullTextColor = (n: number) => {
  const type = getPullLuckType(n);
  if (type === "green") return "text-emerald-500 font-extrabold";
  if (type === "amber") return "text-amber-500 font-extrabold";
  return "text-rose-500 font-extrabold";
};

const pullBadgeBg = (n: number) => {
  const type = getPullLuckType(n);
  if (type === "green") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
  if (type === "amber") return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
  return "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
};

function openPath(p: string) {
  const w = window as unknown as { furinakit?: { openPath?: (p: string) => Promise<void> } };
  void w.furinakit?.openPath?.(p);
}

type Role = { uid: string; region: string; nickname: string; level?: number; regionName?: string };
type Account = {
  loggedIn: boolean;
  aid?: string;
  loginAt?: number;
  roles?: Partial<Record<GameKey, Role[]>>;
  isDedicated?: boolean;
  game?: string;
};
type Saved = { uid: string; nickname: string; updated?: number; count: number; canSync?: boolean };
type SyncStatus = {
  running?: boolean;
  done?: boolean;
  ok?: boolean;
  game?: string;
  message?: string;
  count?: number;
  error?: string;
  result?: { uid: string; added: number; total: number };
};
type QrState = { url: string; ticket: string; img: string; status: string; message?: string } | null;

function Section({
  icon,
  title,
  extra,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border/60 bg-card/75 backdrop-blur-sm p-4 shadow-sm", className)}>
      {(title || extra) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-primary font-medium">
            {icon}
            {title && <span className="text-sm font-semibold text-foreground">{__ui(title)}</span>}
          </div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

// ── 生成长图分享核心渲染器 ────────────────────────────────────────────────────────

// ── 主组件 ────────────────────────────────────────────────────────────

export function GachaAnalysisTool() {
  const __locale = __useLanguage();
  void __locale;
  const [game, setGame] = useState<GameKey>("genshin");
  const g = GAMES[game];

  const [account, setAccount] = useState<Account>({ loggedIn: false });
  const [saved, setSaved] = useState<Partial<Record<GameKey, Saved[]>>>({});
  const [probe, setProbe] = useState<Partial<Record<GameKey, boolean>>>({});
  const [uid, setUid] = useState("");
  const [records, setRecords] = useState<Rec[] | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisSettings>(emptyAnalysis);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const analysisSavingRef = useRef(false);
  // Banner database (which items were UP when). Refreshes silently at most every 6 h; can be switched off.
  const [dbTick, setDbTick] = useState(0);
  const [dbBusy, setDbBusy] = useState(false);
  const [dbMessage, setDbMessage] = useState("");
  const [autoDb, setAutoDb] = useState(() => { try { return localStorage.getItem("fk-gacha-banners-auto") !== "0"; } catch { return true; } });
  useEffect(() => onBannerDbChange(() => setDbTick((t) => t + 1)), []);
  const refreshDb = useCallback(async (force: boolean) => {
    setDbBusy(true);
    const r = await refreshBannerDb(force);
    setDbBusy(false);
    setDbMessage(force || !r.ok ? r.message : "");
  }, []);
  useEffect(() => { if (autoDb) void refreshDb(false); }, [autoDb, refreshDb]);
  const toggleAutoDb = (v: boolean) => { setAutoDb(v); try { localStorage.setItem("fk-gacha-banners-auto", v ? "1" : "0"); } catch { /* ignore */ } };
  const dbInfo = useMemo(() => bannerDbInfo(), [dbTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loadingRecs, setLoadingRecs] = useState(false);

  // 隐私模式：隐藏 UID 与昵称
  const [maskUid, setMaskUidState] = useState(() => { try { return localStorage.getItem("fk-gacha-privacy") === "1"; } catch { return false; } });
  const setMaskUid = (update: (v: boolean) => boolean) => setMaskUidState(v => {
    const next = update(v);
    try { localStorage.setItem("fk-gacha-privacy", next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });

  const [roleUid, setRoleUid] = useState("");
  const [qr, setQr] = useState<QrState>(null);
  const [qrBusy, setQrBusy] = useState(false);

  // 通行证登录方式扩展：扫码 / 短信验证码
  const [loginMode, setLoginMode] = useState<"qr" | "sms">("qr");
  const [loginDedicated, setLoginDedicated] = useState<boolean>(false);
  const [showAccountModal, setShowAccountModal] = useState<boolean>(false); // 是否仅绑定当前游戏
  const [loginEditing, setLoginEditing] = useState(false);
  const [pendingUpdateUid, setPendingUpdateUid] = useState<string | null>(null);
  const [smsPhone, setSmsPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsActionType, setSmsActionType] = useState("");
  const [smsCountdown, setSmsCountdown] = useState(0);
  const [smsSending, setSmsSending] = useState(false);
  const [smsLoggingIn, setSmsLoggingIn] = useState(false);

  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [startingSync, setStartingSync] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const syncRequest = useRef(false);
  const updateRequest = useRef(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [gameDir, setGameDir] = useState("");
  const [showMore, setShowMore] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [poolSel, setPoolSel] = useState<string>("");
  const [exportingImage, setExportingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const recordRequest = useRef(0);
  const activeGameRef = useRef(game);
  activeGameRef.current = game;
  const activeUidRef = useRef(uid);
  activeUidRef.current = uid;
  const accountRequest = useRef(0);
  const lastSelected = useRef<Partial<Record<GameKey, string>>>((() => {
    try { const value = JSON.parse(localStorage.getItem('fk-gacha-selected-accounts') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
  })());
  const rememberArchive = (gKey: GameKey, u: string) => {
    lastSelected.current[gKey] = u;
    try { localStorage.setItem('fk-gacha-selected-accounts', JSON.stringify(lastSelected.current)); } catch { /* Viewing records remains available without storage. */ }
  };
  const pendingImport = useRef<{game: GameKey; uid: string} | null>(null);

  const refreshSaved = useCallback(async () => {
    try {
      setSaved(await api<Partial<Record<GameKey, Saved[]>>>("list"));
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  // 刷新指定游戏的通行证状态
  const refreshAccount = useCallback(async (gKey: GameKey, archiveUid?: string) => {
    const request = ++accountRequest.current;
    try {
      const acc = await api<Account>("account", { game: gKey, ...(archiveUid ? { uid: archiveUid } : {}) });
      if (gKey !== activeGameRef.current || request !== accountRequest.current) return acc;
      setAccount(acc);
      const roles = acc.roles?.[gKey] || [];
      const preferred = archiveUid || activeUidRef.current;
      setRoleUid(current => roles.some(r => r.uid === preferred) ? preferred : roles.some(r => r.uid === current) ? current : roles[0]?.uid || "");
      return acc;
    } catch {
      if (gKey === activeGameRef.current && request === accountRequest.current) { setAccount({ loggedIn: false }); setRoleUid(''); }
      return { loggedIn: false } as Account;
    }
  }, []);

  // 初始化
  useEffect(() => {
    void (async () => {
      await refreshAccount(game);
      await refreshSaved();
      try {
        setProbe(await api<Partial<Record<GameKey, boolean>>>("probe"));
      } catch {
        /* ignore */
      }
      try {
        const st = await api<SyncStatus>("sync/status");
        if (st?.running) setSync(st);
      } catch {
        /* ignore */
      }
    })();
  }, [game, refreshAccount, refreshSaved]);

  // 短信倒计时定时器
  useEffect(() => {
    if (smsCountdown <= 0) return;
    const t = window.setTimeout(() => setSmsCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [smsCountdown]);

  // 切换游戏时
  const savedList = useMemo(() => saved[game] || [], [saved, game]);
  useEffect(() => {
    setLoadingRecs(false);
    setRecords(null);
    setAnalysis(emptyAnalysis());
    setNotice(null);
    setError(null);
    setSavedPath(null);
    setShowAccountModal(false);
    setLoginEditing(false);
    setPendingUpdateUid(null);
    void refreshAccount(game);

    recordRequest.current++;
    if (pendingImport.current?.game === game || savedList.length) {
      const remembered = lastSelected.current[game];
      const u = pendingImport.current?.game === game ? pendingImport.current.uid : savedList.find(s => s.uid === remembered)?.uid || savedList[0].uid;
      pendingImport.current = null;
      setUid(u);
      activeUidRef.current = u;
      rememberArchive(game, u);
      void refreshAccount(game, u);
      void loadRecords(game, u);
    } else {
      setUid("");
      activeUidRef.current = '';
    }
    setPoolSel(GAMES[game].pools[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const loadRecords = useCallback(async (gKey: GameKey, u: string) => {
    if (!u) return;
    const request = ++recordRequest.current;
    setLoadingRecs(true);
    setError(null);
    try {
      const doc = await api<{ list?: Rec[]; nickname?: string; _analysis?: AnalysisSettings }>("records", { game: gKey, uid: u });
      if (request !== recordRequest.current || gKey !== activeGameRef.current) return;
      setRecords(doc.list || []);
      setAnalysis(doc._analysis || emptyAnalysis());
    } catch (e) {
      if (request === recordRequest.current) { setError(errText(e)); setRecords(null); }
    } finally {
      if (request === recordRequest.current) setLoadingRecs(false);
    }
  }, []);

  const selectArchive = (u: string) => {
    if (sync?.running || startingSync || checkingUpdate || loadingRecs) return;
    rememberArchive(game, u);
    activeUidRef.current = u;
    setUid(u);
    setConfirmDel(false);
    setRecords(null);
    setAnalysis(emptyAnalysis());
    setPendingUpdateUid(null);
    setNotice(null);
    setSavedPath(null);
    void loadRecords(game, u);
    void refreshAccount(game, u);
  };

  useEffect(() => {
    if (!uid && savedList.length && !loadingRecs) {
      const next = savedList.find(s => s.uid === lastSelected.current[game])?.uid || savedList[0].uid;
      setUid(next);
      activeUidRef.current = next;
      rememberArchive(game, next);
      void refreshAccount(game, next);
      void loadRecords(game, next);
    }
  }, [game, savedList, uid, loadingRecs, loadRecords]);

  // 扫码登录流程
  const qrTimer = useRef<number | null>(null);
  const qrRequest = useRef(0);
  const stopQr = useCallback(() => {
    qrRequest.current++;
    if (qrTimer.current) {
      window.clearTimeout(qrTimer.current);
      qrTimer.current = null;
    }
  }, []);

  useEffect(() => () => stopQr(), [stopQr]);

  const finishLogin = async (loggedAccount?: Account) => {
    const acc = loggedAccount || await refreshAccount(game);
    await refreshSaved();
    if (game !== activeGameRef.current) return false;
    accountRequest.current++;
    setAccount(acc);
    const roles = acc.roles?.[game] || [];
    setRoleUid(roles.find(r => r.uid === pendingUpdateUid)?.uid || roles[0]?.uid || '');
    if (pendingUpdateUid && !acc.roles?.[game]?.some(r => r.uid === pendingUpdateUid)) {
      setLoginEditing(true);
      setError(__ui("本次登录的通行证没有所选存档对应的角色，请扫码登录该角色所属的通行证。当前存档不会被替换。"));
      return false;
    }
    setLoginEditing(false);
    setNotice(pendingUpdateUid ? __ui("授权已完成，请点击获取按钮更新所选账号的记录。") : __ui("登录成功，已保留之前的账号记录和授权。可选择角色获取记录。"));
    return true;
  };

  const startQr = async () => {
    stopQr();
    const request = qrRequest.current;
    setError(null);
    setQrBusy(true);
    try {
      const r = await api<{ url: string; ticket: string }>("qr/create");
      const img = await QRCode.toDataURL(r.url, { margin: 1, width: 220 });
      if (request !== qrRequest.current || game !== activeGameRef.current) return;
      setQr({ url: r.url, ticket: r.ticket, img, status: "Created" });
      const created = Date.now();

      const poll = async () => {
        if (request !== qrRequest.current) return;
        try {
          const q = await api<{ status: string; message?: string; account?: Account }>("qr/query", {
            ticket: r.ticket,
            game: loginDedicated ? game : "all",
          });
          if (request !== qrRequest.current || game !== activeGameRef.current) return;
          if (q.status === "Confirmed") {
            setQr(null);
            await finishLogin(q.account);
            return;
          }
          if (q.status === "Expired" || Date.now() - created > 170_000) {
            void startQr();
            return;
          }
          setQr((cur) => (cur && cur.ticket === r.ticket ? { ...cur, status: q.status } : cur));
        } catch (e) {
          setQr((cur) => (cur && cur.ticket === r.ticket ? { ...cur, message: errText(e) } : cur));
        }
        if (request === qrRequest.current) qrTimer.current = window.setTimeout(() => void poll(), 2000);
      };
      qrTimer.current = window.setTimeout(() => void poll(), 2000);
    } catch (e) {
      if (request === qrRequest.current) { setError(errText(e)); setQr(null); }
    } finally {
      if (request === qrRequest.current) setQrBusy(false);
    }
  };

  const cancelQr = () => {
    stopQr();
    setQrBusy(false);
    setQr(null);
  };

  // 短信验证码发送
  const handleSendSms = async () => {
    const p = smsPhone.trim();
    if (p.length !== 11 || !/^\d{11}$/.test(p)) {
      setError(__ui("请输入正确的11位中国大陆手机号"));
      return;
    }
    setError(null);
    setSmsSending(true);
    try {
      const res = await api<{ ok: boolean; action_type: string; countdown?: number }>("sms/send", { mobile: p });
      setSmsActionType(res.action_type || "");
      setSmsCountdown(res.countdown || 60);
      setNotice(__ui("验证码短信已下发，请在手机查收"));
    } catch (e) {
      setError(errText(e));
    } finally {
      setSmsSending(false);
    }
  };

  // 短信验证码提交登录
  const handleSmsLogin = async () => {
    const p = smsPhone.trim();
    const c = smsCode.trim();
    if (p.length !== 11) {
      setError(__ui("手机号格式不正确"));
      return;
    }
    if (!c || c.length < 4) {
      setError(__ui("请输入收到的短信验证码"));
      return;
    }
    setError(null);
    setSmsLoggingIn(true);
    try {
      const result = await api<{account?: Account}>("sms/login", {
        mobile: p,
        code: c,
        action_type: smsActionType,
        game: loginDedicated ? game : "all",
      });
      const success = await finishLogin(result.account);
      setSmsCode("");
      return success;
    } catch (e) {
      setError(errText(e));
    } finally {
      setSmsLoggingIn(false);
    }
  };

  const logout = async (scope: "current" | "all" = "all") => {
    try {
      await api("logout", { game: scope === "current" ? game : "all" });
      await refreshAccount(game, uid);
      await refreshSaved();
      setNotice(scope === "current" ? __msg("已解绑当前游戏【{0}】凭据", g.name) : __ui("已退出登录，本机保存的通行证凭据已删除（历史抽卡记录永久保留）"));
    } catch (e) {
      setError(errText(e));
    }
  };

  const reloadRoles = async () => {
    setError(null);
    try {
      const target = pendingUpdateUid || roleUid;
      await api("roles", { game, ...(target ? { uid: target } : {}) });
      await refreshAccount(game, target);
      setNotice(__ui("游戏角色列表已成功刷新"));
    } catch (e) {
      setError(errText(e));
    }
  };

  // ── 抽卡记录同步 ──
  const syncTimer = useRef<number | null>(null);
  const lastSyncSource = useRef<"account" | "cache" | "url">("cache");
  const accountRef = useRef(account);
  accountRef.current = account;
  const pollSync = useCallback(() => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(async () => {
      try {
        const st = await api<SyncStatus>("sync/status");
        setSync(st);
        if (st?.running) {
          pollSync();
          return;
        }
        if (st?.done && st.ok && st.result) {
          const gk = (st.game as GameKey) || game;
          setNotice(st.result.added ? __msg("获取完成：新增 {0} 条，累计保存 {1} 条", st.result.added, st.result.total) : __msg("已是最新：共 {0} 条，无新增记录", st.result.total));
          await refreshSaved();
          rememberArchive(gk, st.result.uid);
          if (gk === activeGameRef.current) {
            setUid(st.result.uid);
            activeUidRef.current = st.result.uid;
            setPendingUpdateUid(null);
            void refreshAccount(gk, st.result.uid);
            void loadRecords(gk, st.result.uid);
          }
        } else if (st?.done && !st.ok) {
          const gk = (st.game as GameKey) || game;
          // 原神 / 绝区零没登录时走的是游戏缓存：缓存过期就提示可以改用账号一键获取，不必再进游戏
          const loginHint = lastSyncSource.current === "cache" && GAMES[gk]?.mihoyo && gk !== "starrail" && !accountRef.current.loggedIn
            ? " " + __ui("也可以点「登录账号」用米游社扫码登录，之后点「更新抽卡记录」会直接用账号获取，不用再进游戏。") : "";
          setError((st.error ? __msg(st.error) + loginHint : __ui("获取失败")) + ' ' + __ui("如授权已过期，请重新扫码登录所选账号；如使用游戏缓存或链接，请在该账号的游戏中重新打开抽卡记录后再获取。"));
          if (lastSyncSource.current === 'account' && /过期|失效|登录|授权|凭据|retcode.?[=:： ]*-100/i.test(st.error || '')) {
            setLoginEditing(true);
            setShowAccountModal(true);
          }
        }
      } catch (e) {
        setError(errText(e));
      }
    }, 800);
  }, [game, loadRecords, refreshSaved]);

  useEffect(() => {
    if (sync?.running) pollSync();
    return () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
    };
  }, [sync?.running, pollSync]);

  const startSync = async (source: "account" | "cache" | "url", targetUid = pendingUpdateUid || uid || roleUid) => {
    if (syncRequest.current || sync?.running) return;
    syncRequest.current = true;
    setStartingSync(true);
    lastSyncSource.current = source;
    setError(null);
    setNotice(null);
    setSavedPath(null);
    try {
      await api("sync", { game, source, uid: targetUid, url: pasteUrl.trim(), gameDir: gameDir.trim() || undefined });
      setSync({ running: true, game, message: __ui("准备拉取中…"), count: 0 });
    } catch (e) {
      setError(errText(e));
    } finally { syncRequest.current = false; setStartingSync(false); }
  };

  const requestUpdate = async (targetUid = uid) => {
    if (updateRequest.current || syncRequest.current || sync?.running || loadingRecs) return;
    if (targetUid && targetUid !== uid) selectArchive(targetUid);
    updateRequest.current = true;
    setCheckingUpdate(true);
    setError(null);
    setNotice(null);
    setPendingUpdateUid(targetUid || null);
    try {
      const acc = await refreshAccount(game, targetUid);
      if (game !== activeGameRef.current) return;
      if (g.mihoyo && game !== 'starrail' && acc.loggedIn && acc.roles?.[game]?.some(r => r.uid === targetUid)) {
        await startSync('account', targetUid);
      } else {
        setLoginEditing(!acc.loggedIn);
        setNotice(g.mihoyo && game !== 'starrail'
          ? __ui("此存档没有可用的账号授权，请重新扫码登录该角色所属的通行证；也可以打开该账号的游戏抽卡记录，再读取缓存或粘贴链接。")
          : __ui("更新此账号前，请在游戏中登录对应角色并打开抽卡记录，然后读取缓存或粘贴完整记录链接。过期链接需要重新获取。"));
        setShowAccountModal(true);
      }
    } finally { updateRequest.current = false; setCheckingUpdate(false); }
  };

  // 星穹铁道：官方目前不接受米游社账号生成的跃迁记录凭证，只能用游戏里的链接（游戏缓存 / 粘贴链接）
  const accountGachaBlocked = game === "starrail";

  const renderStarRailGuide = (isModal: boolean) => (
    <div className="gk-auth-body">
      <div className="gk-auth-guide"><h4>{__ui("从游戏中获取跃迁记录")}</h4><p>{__ui("星穹铁道需要使用游戏内的跃迁记录链接，扫码登录无法直接获取。先在游戏中打开「跃迁记录」，再读取本机缓存；也可以粘贴完整链接。")}</p></div>
      {renderRecordSources(isModal)}
    </div>
  );

  const cancelSync = async () => {
    try {
      await api("sync/cancel");
    } catch {
      /* ignore */
    }
  };

  // ── 导入导出 / 删除 ──
  const doImport = async (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) { setError(__ui("文件超过 50 MB，请分账号导出后导入。")); return; }
    setError(null);
    setNotice(null);
    try {
      const text = await f.text();
      const r = await api<{ added: number; accounts: { game: GameKey; uid: string; added: number }[] }>("import", { text });
      await refreshSaved();
      const first = r.accounts[0];
      if (first) {
        pendingImport.current = first;
        setGame(first.game);
        setUid(first.uid);
        rememberArchive(first.game, first.uid);
        if (first.game === game) { pendingImport.current = null; activeUidRef.current = first.uid; void refreshAccount(first.game, first.uid); void loadRecords(first.game, first.uid); }
      }
      setNotice(__msg("导入完成：新增 {0} 条记录", r.added));
    } catch (e) {
      setError(errText(e));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doExport = async () => {
    if (!uid) return;
    setError(null);
    try {
      const data = await api<Record<string, unknown>>("export", { game, uid });
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const name = game === "ww" ? `鸣潮抽卡记录_${uid}_${day}.json` : `UIGF_${g.name.replace(/[：:]/g, "")}_${uid}_${day}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const path = (await saveOutputBlob(blob, name)).replace(/^\\\\\?\\/, "");
      reportOutputSaved(path);
      setSavedPath(path);
    } catch (e) {
      setError(errText(e));
      reportOutputError(e);
    }
  };

  const doDelete = async () => {
    if (!confirmDel) {
      setConfirmDel(true);
      return;
    }
    setConfirmDel(false);
    try {
      await api("delete", { game, uid });
      setNotice(__msg("已删除本机保存的 {0} 的抽卡记录", uid));
      setRecords(null);
      await refreshSaved();
      rememberArchive(game, '');
      recordRequest.current++;
      setAnalysis(emptyAnalysis());
      setUid('');
      activeUidRef.current = '';
    } catch (e) {
      setError(errText(e));
    }
  };

  const saveAnalysis = async (patch: AnalysisPatch) => {
    if (analysisSavingRef.current || !uid) return;
    analysisSavingRef.current = true;
    setSavingAnalysis(true);
    const request = recordRequest.current;
    try {
      const next = await api<AnalysisSettings>('analysis/set', { game, uid, ...patch });
      if (request === recordRequest.current && game === activeGameRef.current) {
        setAnalysis(next);
        setNotice(__ui("判定已保存到此游戏、此账号的本地分析设置；原始抽卡记录未改动。"));
      }
    } catch (e) {
      if (request === recordRequest.current) setError(errText(e));
    } finally { analysisSavingRef.current = false; setSavingAnalysis(false); }
  };

  // ── 分析结果 ──
  const summary = useMemo(() => (records ? summarize(game, records, analysis) : null), [game, records, analysis, dbTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const currentPool = useMemo(() => {
    if (!summary) return null;
    return summary.pools.find((p) => p.def.id === poolSel) || summary.pools[0];
  }, [summary, poolSel]);

  const running = !!sync?.running || startingSync || checkingUpdate;

  const displayUid = useMemo(() => {
    if (!uid) return "";
    if (!maskUid) return uid;
    if (uid.length <= 4) return "****";
    return `${uid.slice(0, 2)}****${uid.slice(-2)}`;
  }, [uid, maskUid]);

  const activeNickname = useMemo(() => {
    const s = savedList.find((x) => x.uid === uid);
    if (s?.nickname) return s.nickname;
    const r = account.roles?.[game]?.find((x) => x.uid === uid);
    return r?.nickname || "";
  }, [savedList, uid, account, game]);

  // 一键生成高清长图分享
  const handleExportLongImage = async (targetPool: PoolStat | null = currentPool) => {
    if (!targetPool || exportingImage) return;
    setExportingImage(true);
    setError(null);
    try {
      const blob = await renderHeyboxLongImage({
        game: g,
        pool: targetPool,
        records: records || [],
        summary,
        uid: displayUid,
        nickname: maskUid ? __ui("匿名档案") : activeNickname,
      });

      const fileName = `FurinaKit_${game}_${targetPool.def.name}_${maskUid ? "private" : uid || "archive"}_${Date.now()}.png`;
      const path = (await saveOutputBlob(blob, fileName)).replace(/^\\\\\?\\/, "");
      reportOutputSaved(path);
      setSavedPath(path);

      setNotice(null);
    } catch (e) {
      setError(errText(e));
      reportOutputError(e);
    } finally {
      setExportingImage(false);
    }
  };

  const renderRecordSources = (isModal: boolean) => (
    <div className="gk-auth-fields">
      <p className="gk-auth-hint">{__ui("先在游戏中打开抽卡记录，加载完成后回到这里读取。")}</p>
      <button type="button" className="gk-btn gk-auth-wide" disabled={running} onClick={() => { void startSync("cache", pendingUpdateUid || roleUid || uid); if (isModal) setShowAccountModal(false); }}>
        {running ? <Loader2 size={16} className="spin" /> : <FolderOpen size={16} />}{__ui("读取本机游戏客户端缓存")}
      </button>
      <label className="gk-auth-field">{__ui("游戏安装目录（可选）")}
        <input className="gk-input" value={gameDir} onChange={(e) => setGameDir(e.target.value)} placeholder={__ui("自动识别失败时填写游戏目录")} />
      </label>
      <label className="gk-auth-field">{__ui("或使用抽卡记录链接")}
        <div className="gk-auth-row">
          <input className="gk-input" type="password" autoComplete="off" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder={__ui("粘贴完整的抽卡记录链接…")} />
          <button type="button" className="gk-btn" disabled={running || !pasteUrl.trim()} onClick={() => { void startSync("url", pendingUpdateUid || roleUid || uid); if (isModal) setShowAccountModal(false); }}>{__ui("解析")}</button>
        </div>
      </label>
    </div>
  );

  const renderAuthContent = (isModal = false) => {
    if (!g.mihoyo) return (
      <div className="gk-auth-body">
        <div className="gk-auth-guide"><h4>{__ui("从游戏中获取唤取记录")}</h4><p>{__ui("打开鸣潮的「唤取记录」，等待加载完成。工具会从本机日志提取链接；在其他设备上玩，也可以粘贴完整链接。")}</p></div>
        {renderRecordSources(isModal)}
      </div>
    );
    if (account.loggedIn && !loginEditing) {
      const roles = account.roles?.[game] || [];
      return (
        <div className="gk-auth-body">
          <div className="gk-auth-passport">
            <div className="gk-auth-passport-icon"><ShieldCheck size={21} /></div>
            <div><strong>{__ui("米哈游通行证：")}{maskUid ? __ui("已隐藏") : account.aid || __ui("已授权登录")}</strong><p>{account.isDedicated ? __msg("仅用于{0}", g.name) : __ui("原神 · 星穹铁道 · 绝区零共享")}</p></div>
            <span className="gk-auth-status">{__ui("已授权")}</span>
          </div>
          <div className="gk-auth-fields">
            <div className="gk-auth-label-row"><label htmlFor="gk-sync-role">{__ui("选择要同步的游戏角色")}</label><button type="button" className="gk-auth-link" disabled={running} onClick={() => void reloadRoles()}><RefreshCw size={12} />{__ui("刷新角色")}</button></div>
            {roles.length ? <Select id="gk-sync-role" className="gk-auth-select" triggerClassName="gk-select" value={pendingUpdateUid || roleUid || roles[0]?.uid} disabled={!!pendingUpdateUid || running} onChange={(e) => setRoleUid(e.target.value)}>
              {roles.map((r) => <option key={r.uid} value={r.uid}>{`${maskUid ? __ui("匿名角色") : r.nickname} · ${maskUid ? `${r.uid.slice(0, 2)}****${r.uid.slice(-2)}` : r.uid}${r.regionName ? ` (${r.regionName})` : ""}`}</option>)}
            </Select> : <p className="gk-auth-hint">{__msg("此通行证下暂未检测到{0}角色，可以刷新角色或添加其他通行证。", g.name)}</p>}
            {accountGachaBlocked ? renderStarRailGuide(isModal) : <button type="button" className="gk-btn primary gk-auth-wide" disabled={running || !roles.length} onClick={() => { void startSync("account", pendingUpdateUid || roleUid || roles[0]?.uid); if (isModal) setShowAccountModal(false); }}>
              {running ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}{__ui("一键拉取最新抽卡流水")}
            </button>}
          </div>
          <button type="button" className="gk-btn gk-auth-wide" disabled={running} onClick={() => { cancelQr(); setLoginEditing(true); }}><QrCode size={16} />{__ui("添加其他通行证")}</button>
          <details className="gk-auth-details"><summary>{__ui("授权管理")}</summary><div className="gk-auth-fields">
            {account.loginAt && <p className="gk-auth-hint">{__ui("授权时间：")}{new Date(account.loginAt * 1000).toLocaleString()}</p>}
            <div className="gk-auth-row"><button type="button" className="gk-btn" disabled={running} onClick={() => void logout("current")}>{__ui("仅解绑此游")}</button><button type="button" className="gk-btn danger" disabled={running} onClick={() => void logout("all")}>{__ui("退出全部凭据")}</button></div>
          </div></details>
          <p className="gk-auth-security"><ShieldCheck size={13} />{__ui("授权信息仅加密保存在本机，可随时解除绑定。")}</p>
        </div>
      );
    }
    return (
      <div className="gk-auth-body">
        {accountGachaBlocked && renderStarRailGuide(isModal)}
        <div className="gk-auth-tabs" role="tablist" aria-label={__ui("登录方式")}>
          <button type="button" id="gk-qr-tab" role="tab" aria-selected={loginMode === "qr"} aria-controls="gk-login-panel" tabIndex={loginMode === "qr" ? 0 : -1} onClick={() => { setLoginMode("qr"); cancelQr(); }} onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setLoginMode("sms"); cancelQr(); document.getElementById("gk-sms-tab")?.focus(); } }}><QrCode size={15} />{__ui("米游社扫码登录")}</button>
          <button type="button" id="gk-sms-tab" role="tab" aria-selected={loginMode === "sms"} aria-controls="gk-login-panel" tabIndex={loginMode === "sms" ? 0 : -1} onClick={() => { setLoginMode("sms"); cancelQr(); }} onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setLoginMode("qr"); cancelQr(); document.getElementById("gk-qr-tab")?.focus(); } }}><Smartphone size={15} />{__ui("手机验证码登录")}</button>
        </div>
        <div id="gk-login-panel" role="tabpanel" aria-labelledby={loginMode === "qr" ? "gk-qr-tab" : "gk-sms-tab"} className="gk-auth-login">
          <div className="gk-auth-scope"><label htmlFor="gk-auth-scope">{__ui("授权范围")}</label><Select id="gk-auth-scope" aria-label={__ui("授权范围")} className="gk-auth-select" triggerClassName="gk-select" value={loginDedicated ? "game" : "all"} disabled={qrBusy || !!qr || smsLoggingIn} onChange={(e) => setLoginDedicated(e.target.value === "game")}><option value="all">{__ui("三款游戏共享")}</option><option value="game">{__msg("仅{0}", g.name)}</option></Select></div>
          {loginMode === "qr" ? qr ? <div className="gk-auth-qr">
            <div className="gk-auth-qr-frame"><img src={qr.img} alt={__ui("米游社扫码登录")} /></div>
            <strong>{qr.status === "Scanned" ? __ui("已扫码！请在手机端点击「确认登录」") : __ui("打开米游社 App「扫一扫」登录")}</strong>
            <p>{__ui("确认后将自动保存授权，返回这里更新记录。")}</p>
            {qr.message && <p className="gk-auth-qr-error" role="alert">{qr.message}</p>}
            <button type="button" className="gk-btn ghost" onClick={cancelQr}>{__ui("取消扫码")}</button>
          </div> : <div className="gk-auth-qr-intro">
            <div className="gk-auth-qr-symbol"><QrCode size={32} strokeWidth={1.5} /></div>
            <h4>{__ui("用米游社轻松授权")}</h4><p>{__ui("使用手机米游社 App 扫码，确认后即可同步抽卡记录。")}</p>
            <button type="button" className="gk-btn primary gk-auth-wide" onClick={() => void startQr()} disabled={qrBusy}>{qrBusy ? <Loader2 size={16} className="spin" /> : <QrCode size={16} />}{__ui("生成米游社授权二维码")}</button>
          </div> : <div className="gk-auth-fields gk-auth-sms">
            <label className="gk-auth-field">{__ui("手机号码")}<input className="gk-input" type="tel" inputMode="numeric" autoComplete="tel" value={smsPhone} onChange={(e) => setSmsPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} placeholder={__ui("请输入11位中国大陆手机号")} /></label>
            <label className="gk-auth-field">{__ui("短信验证码")}<div className="gk-auth-row"><input className="gk-input" inputMode="numeric" autoComplete="one-time-code" value={smsCode} onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={__ui("6位短信验证码")} /><button type="button" className="gk-btn" disabled={smsSending || smsCountdown > 0 || smsPhone.trim().length !== 11} onClick={() => void handleSendSms()}>{smsSending ? <Loader2 size={14} className="spin" /> : smsCountdown > 0 ? `${smsCountdown}s` : __ui("获取验证码")}</button></div></label>
            <button type="button" className="gk-btn primary gk-auth-wide" disabled={smsLoggingIn || smsPhone.trim().length !== 11 || smsCode.trim().length < 4} onClick={() => void handleSmsLogin()}>{smsLoggingIn ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}{__ui("验证并登录")}</button>
          </div>}
        </div>
        {!accountGachaBlocked && <details className="gk-auth-details"><summary><FolderOpen size={15} />{__ui("缓存与链接获取")}<span>{__ui("无需登录")}</span></summary>{renderRecordSources(isModal)}</details>}
        {account.loggedIn && loginEditing && <button type="button" className="gk-auth-link gk-auth-back" onClick={() => { cancelQr(); setLoginEditing(false); }}>{__ui("返回已授权通行证")}</button>}
        <p className="gk-auth-security"><ShieldCheck size={13} />{__ui("授权信息仅加密保存在本机，可随时解除绑定。")}</p>
      </div>
    );
  };

  return (
    <div className="gk" data-game={game}>
      <header className="gk-top">
        <nav className="gk-games" aria-label={__ui("游戏选择")}>
          {GAME_ORDER.map((k) => (
            <button key={k} className={game === k ? "on" : ""} disabled={running || smsLoggingIn} aria-label={GAMES[k].name} aria-pressed={game === k} title={GAMES[k].name} onClick={() => { cancelQr(); setGame(k); }}>
              <img src={gameIcons[k]} alt="" />
              <span>{GAMES[k].name}</span>
            </button>
          ))}
        </nav>
        <div className="gk-actions">
          <button className="gk-btn primary" disabled={running || loadingRecs} title={accountGachaBlocked ? __ui("星穹铁道从游戏缓存读取：请先在游戏里打开一次跃迁记录") : undefined} onClick={() => void requestUpdate()}>{running ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}{__ui("更新抽卡记录")}</button>
          <button className="gk-btn" onClick={() => fileRef.current?.click()} disabled={running}><Upload size={15} />{__ui("导入记录")}</button>
          {!!records?.length && <button className="gk-btn" onClick={() => void doExport()}><Download size={15} />{__ui("导出 JSON")}</button>}
          <button className="gk-btn" disabled={running} onClick={() => { setPendingUpdateUid(null); setLoginEditing(false); setShowAccountModal(true); }}><Settings size={15} />{__ui("账号管理")}</button>
        </div>
      </header>
      <input type="file" ref={fileRef} accept=".json,application/json" style={{ display: "none" }} onChange={(e) => void doImport(e.target.files?.[0])} />
      {savedPath && <div className="gk-saved-result" role="status">
        <div className="gk-saved-icon"><CheckCircle2 size={20} /></div>
        <div className="gk-saved-info"><strong>{__ui("已保存：")}{savedPath.split(/[\\/]/).pop()}</strong><span title={savedPath}>{savedPath.slice(0, Math.max(savedPath.lastIndexOf("\\"), savedPath.lastIndexOf("/")))}</span></div>
        <button className="gk-btn" onClick={() => void revealOutputFile(savedPath).catch(reportOutputError)}><FolderOpen size={15} />{__ui("定位文件")}</button>
        <button className="gk-btn ghost icon" aria-label={__ui("关闭保存提示")} onClick={() => setSavedPath(null)}><X size={15} /></button>
      </div>}
      {error && !showAccountModal && <div className="gk-notice error" role="alert"><AlertTriangle size={17} /><span>{__msg(error)}</span><button aria-label={__ui("关闭错误")} onClick={() => setError(null)}><X size={15} /></button></div>}
      {notice && !showAccountModal && <div className="gk-notice" role="status"><CheckCircle2 size={17} /><span>{__msg(notice)}</span><button aria-label={__ui("关闭提示")} onClick={() => setNotice(null)}><X size={15} /></button></div>}
      {sync?.running && <div className="gk-notice" role="status"><Loader2 size={17} className="spin" /><span>{__msg(sync.message) || __ui("正在同步")} {__ui("· 已读取")} {sync.count || 0} {__ui("条")}</span><button onClick={() => void cancelSync()}>{__ui("取消同步")}</button></div>}
      {loadingRecs ? (
        <div className="gk-loading"><Loader2 size={28} className="spin" /><span>{__ui("正在读取本地抽卡记录…")}</span></div>
      ) : summary && currentPool ? (
        <GachaDashboard key={`${game}:${uid}`} game={g} summary={summary} records={records || []} pool={currentPool} onPool={setPoolSel} nickname={maskUid ? __ui("匿名档案") : activeNickname} uid={displayUid} archives={savedList.map(s => ({ ...s, nickname: maskUid ? __ui("匿名档案") : s.nickname || g.playerTitle, displayUid: maskUid ? `${s.uid.slice(0, 2)}****${s.uid.slice(-2)}` : s.uid }))} activeUid={uid} onArchive={selectArchive} onUpdateArchive={(u) => void requestUpdate(u)} accountBusy={running || loadingRecs || savingAnalysis || smsLoggingIn} onShare={(pool) => void handleExportLongImage(pool)} exporting={exportingImage} analysis={analysis} onAnalysis={saveAnalysis} savingAnalysis={savingAnalysis} dbInfo={dbInfo} onRefreshDb={() => void refreshDb(true)} refreshingDb={dbBusy} dbMessage={dbMessage} autoDb={autoDb} onAutoDb={toggleAutoDb} />
      ) : (
        <section className="gk-empty" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!running) void doImport(e.dataTransfer.files[0]); }}>
          <Layers size={40} />
          <h2>{g.name} {__ui("· 抽卡记录分析")}</h2>
          <p>{__ui("导入已有记录，查看每一个卡池的出金历程。支持 UIGF / SRGF JSON 文件，也可以从游戏客户端获取。")}</p>
          <div className="gk-actions" style={{ justifyContent: "center", marginTop: 6 }}>
            <button className="gk-btn primary" onClick={() => fileRef.current?.click()}>{__ui("导入抽卡记录")}</button>
            <button className="gk-btn" onClick={() => setShowAccountModal(true)}>{accountGachaBlocked ? __ui("获取跃迁记录") : g.mihoyo ? __ui("登录并同步") : __ui("从客户端获取")}</button>
          </div>
          <small>{__ui("也可以将 JSON 文件拖到这里。已有存档会增量合并，不以示例数据代替真实记录。")}</small>
        </section>
      )}
      <details className="gk-source">
        <summary>{__ui("其他获取方式与存档管理")}</summary>
        <div className="gk-archive-settings">
          <label className="gk-privacy-setting"><input type="checkbox" checked={maskUid} onChange={() => setMaskUid((v) => !v)} />{__ui("隐私模式：隐藏昵称、UID 和账号信息")}</label>
        </div>
        <p>{__ui("使用自己的官方抽卡记录链接；链接含临时授权信息，不要分享给他人。未备份的过期历史无法恢复。")}</p>
        <div className="gk-source-row">
          <input className="gk-input" type="password" autoComplete="off" aria-label={__ui("抽卡链接")} placeholder={__ui("粘贴完整抽卡记录链接")} value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} />
          <button className="gk-btn" disabled={running || !pasteUrl.trim()} onClick={() => void startSync("url")}>{__ui("从链接同步")}</button>
        </div>
        <div className="gk-source-row">
          <input className="gk-input" aria-label={__ui("游戏目录")} placeholder={__ui("游戏安装目录（自动识别失败时填写）")} value={gameDir} onChange={(e) => setGameDir(e.target.value)} />
          <button className="gk-btn" disabled={running} onClick={() => void startSync("cache")}>{__ui("读取游戏缓存")}</button>
        </div>
        {uid && <button className="gk-btn danger" disabled={running || loadingRecs || savingAnalysis} onClick={() => void doDelete()} onBlur={() => setConfirmDel(false)}>{confirmDel ? __ui("再次点击确认删除此存档") : __ui("删除当前账号的本地抽卡存档")}</button>}
      </details>
      {showAccountModal && (
        <div className="gk-modal-wrap" onClick={(e) => { if (e.target === e.currentTarget) { cancelQr(); setShowAccountModal(false); } }} onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelQr(); setShowAccountModal(false); }
          if (e.key === "Tab") {
            const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(el => el.checkVisibility() && el.tabIndex >= 0);
            const first = controls[0], last = controls.at(-1);
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
          }
        }}>
          <section className="gk-modal" role="dialog" aria-modal="true" aria-labelledby="gk-account-title">
            <header><div className="gk-modal-heading"><img src={gameIcons[game]} alt="" /><div><h3 id="gk-account-title">{__ui("账号与同步")}</h3><p>{g.name}{__ui(" · 抽卡记录管理")}</p></div></div><button aria-label={__ui("关闭账号窗口")} autoFocus onClick={() => { cancelQr(); setShowAccountModal(false); }}><X size={19} /></button></header>
            {pendingUpdateUid && <div className="gk-auth-target"><span>{__ui("正在更新所选存档")}</span><strong>{maskUid ? __ui("匿名档案") : pendingUpdateUid}</strong></div>}
            {error && <div className="gk-auth-message error" role="alert"><AlertTriangle size={16} /><span>{__msg(error)}</span></div>}
            {notice && <div className="gk-auth-message" role="status"><Info size={16} /><span>{__msg(notice)}</span></div>}
            {renderAuthContent(true)}
          </section>
        </div>
      )}
    </div>
  );
}
export default GachaAnalysisTool;
