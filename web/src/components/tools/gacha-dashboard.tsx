import { createUiText as __createUiText, uiMessage as __msg } from "@/lib/language";
const __ui = __createUiText("components/tools/gacha-dashboard.tsx");
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Download, Columns2, Rows3, ChartColumn, ChevronDown, Check, X, ArrowDownUp, Info, RefreshCw, Loader2 } from 'lucide-react';
import type { GameDef, PoolStat, Rec, Summary, Five } from './gacha-analysis-tool';
import './gacha-dashboard.css';
import gameIcons from './gacha-game-icons.json';
import { Portrait, ResultChip, basisText } from './gacha-ui';
import { emptyAnalysis, recordKey, type AnalysisSettings, type AnalysisPatch } from './gacha-outcomes';
import type { bannerDbInfo } from './gacha-banners';

type Props = {
  game: GameDef; summary: Summary; records: Rec[]; pool: PoolStat; onPool: (id: string) => void;
  nickname: string; uid: string; onShare: (pool?: PoolStat) => void; exporting: boolean;
  analysis?: AnalysisSettings; onAnalysis?: (patch: AnalysisPatch) => Promise<void>; savingAnalysis?: boolean;
  dbInfo?: ReturnType<typeof bannerDbInfo>; onRefreshDb?: () => void; refreshingDb?: boolean; dbMessage?: string; autoDb?: boolean; onAutoDb?: (v: boolean) => void;
  archives?: { uid: string; displayUid: string; nickname: string; count: number; canSync?: boolean }[];
  activeUid?: string; onArchive?: (uid: string) => void; onUpdateArchive?: (uid: string) => void; accountBusy?: boolean;
};
export type PullSegment = { five: Five | null; pulls: number; items: { name: string; count: number; id?: string }[]; time: string };

export function buildSegments(g: GameDef, p: PoolStat, records: Rec[]): PullSegment[] {
  const fives = new Map(p.fives.map(f => [f.id, f]));
  const result: PullSegment[] = [];
  let count = 0;
  let items = new Map<string, { count: number; id?: string }>();
  const flat = () => [...items].map(([name, v]) => ({ name, count: v.count, id: v.id }));
  for (const r of records) {
    if (r._pool !== p.def.id) continue;
    count++;
    if (r.rank_type === g.mid) { const cur = items.get(r.name); items.set(r.name, { count: (cur?.count || 0) + 1, id: cur?.id || r.item_id }); }
    if (r.rank_type === g.top) { result.push({ five: fives.get(r.id) || null, pulls: count, items: flat(), time: r.time }); count = 0; items = new Map(); }
  }
  result.push({ five: null, pulls: count, items: flat(), time: __ui("至今") });
  return result;
}

const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: d }));
export const barTone = (n: number, p: PoolStat) => (n <= Math.floor(p.def.hard * 0.45) ? 'green' : n < p.def.soft ? 'yellow' : 'red');
export const poolName = (name: string) => name.replace('角色活动祈愿', '限定池').replace('武器活动祈愿', '武器池').replace('集录祈愿', '集录池').replace('常驻祈愿', '常驻池').replace('新手祈愿', '新手池').replace('角色活动跃迁', '限定池').replace('光锥活动跃迁', '光锥池').replace('角色联动跃迁', '联动角色池').replace('光锥联动跃迁', '联动光锥池').replace('常驻跃迁', '常驻池').replace('新手跃迁', '新手池').replace('独家频段', '限定池').replace('音擎频段', '武器池').replace('常驻频段', '常驻池').replace('邦布频段', '邦布池').replace('角色活动唤取', '限定池').replace('武器活动唤取', '武器池').replace('角色常驻唤取', '常驻角色池').replace('武器常驻唤取', '常驻武器池').replace('唤取', '');
function MidStrip({ g, items, empty }: { g: GameDef; items: PullSegment['items']; empty: string }) {
  if (!items.length) return <span className="gk-mids"><em>{empty}</em></span>;
  return (
    <span className="gk-mids">
      {items.map(x => (
        <span key={x.name} className="gk-mid-item" title={`${x.name} ×${x.count}`}>
          <Portrait game={g.key} name={x.name} id={x.id} small rank="mid" />
          {x.count > 1 && <b>{x.count}</b>}
        </span>
      ))}
    </span>
  );
}

function PullRow({ g, p, seg, onSelect }: { g: GameDef; p: PoolStat; seg: PullSegment; onSelect: (seg: PullSegment) => void }) {
  const f = seg.five;
  const pct = Math.max(9, Math.min(100, (seg.pulls / p.def.hard) * 100));
  return (
    <button className={`gk-row ${f ? '' : 'current'}`} onClick={() => onSelect(seg)} title={f ? __msg("{0} · {1} · {2}{3} 抽", f.name, f.time, f.partial ? __ui("至少") : '', f.pulls) : __msg("至今已记录 {0} 抽", seg.pulls)}>
      <span className="gk-row-av"><Portrait game={g.key} name={f?.name || '?'} id={undefined} /><time>{f ? f.time.slice(5, 10) : __ui("至今")}</time></span>
      <span className="gk-row-main">
        <span className="gk-row-head">
          <b className="gk-name">{f ? f.name : __ui("尚未出金")}</b>
          {f && <ResultChip f={f} def={p.def} />}
          <span className="gk-row-time">{f ? f.time.slice(11, 16) : ''}</span>
        </span>
        <span className="gk-track">
          <span className={`gk-fill ${barTone(seg.pulls, p)}`} style={{ width: `${pct}%` }}><b>{f?.partial ? '≥' : ''}{seg.pulls}</b><i>{__ui("抽")}</i></span>
          <span className="gk-tick" style={{ left: `${(p.def.soft / p.def.hard) * 100}%` }} title={__msg("软保底约 {0} 抽", p.def.soft)} />
        </span>
        <MidStrip g={g} items={seg.items} empty={f ? __msg("这一段没有{0}", g.midLabel) : seg.pulls ? __msg("暂无{0}", g.midLabel) : __msg("等待下一次{0}", g.pull)} />
      </span>
    </button>
  );
}

function stateOf(p: PoolStat): { text: string; tone: string } | null {
  if (p.def.guaranteedUp || p.def.isBangboo) return { text: __ui("定向必中"), tone: 'gold' };
  if (!p.def.up) return null;
  if (p.guaranteed === true) return { text: __ui("大保底 · 下次必出 UP"), tone: 'gold' };
  if (p.guaranteed === false) return { text: __ui("小保底"), tone: 'good' };
  return { text: __ui("保底状态未知"), tone: '' };
}

function PoolReport({ g, p, records, query, asc, onDetail, onShare, onChangePool }: { g: GameDef; p: PoolStat; records: Rec[]; query: string; asc: boolean; onDetail: (seg: PullSegment, p: PoolStat) => void; onShare: () => void; onChangePool?: () => void }) {
  const [limit, setLimit] = useState(20);
  const segs = useMemo(() => {
    const all = buildSegments(g, p, records);
    const q = query.trim();
    const v = q ? all.filter(s => `${s.five?.name || __ui("至今")} ${s.time} ${s.items.map(x => x.name).join(' ')}`.includes(q)) : all;
    return asc ? v : [...v].reverse();
  }, [g, p, records, query, asc]);
  const shown = segs.slice(0, limit);
  const st = stateOf(p);
  return (
    <section className="gk-card" id={'gk-pool-' + p.def.id}>
      <header>
        <h3>{poolName(p.def.name)}<small>{__ui("共")} {fmt(p.total, 0)} {__ui("抽")}</small></h3>
        <div className="gk-count"><span title={g.topLabel}>{g.topLabel} {p.fives.length}</span><span className="mid" title={g.midLabel}>{g.midLabel} {p.count4}</span></div>
      </header>
      <div className="gk-meta">
        <span>{__ui("平均出金")} <b>{fmt(p.avg5)}</b> {__ui("抽")}</span>
        <span>{__ui("已垫")} <b>{p.pity}</b> {__ui("抽")}</span>
        {st && <span className={`gk-state ${st.tone}`} title={p.pityStatusText}>{st.text}</span>}
        <span className="grow" />
        {onChangePool && <button className="gk-change-pool" onClick={onChangePool} title={__ui("更换卡池")}><RefreshCw size={12} />{__ui("更换卡池")}</button>}
        <button className="gk-btn ghost icon" onClick={onShare} title={__ui("导出这个卡池的长图")} aria-label={__ui("导出长图")}><Download size={15} /></button>
      </div>
      <div className="gk-rows">
        {shown.map((seg, i) => (
          <React.Fragment key={seg.five?.id || 'current'}>
            {seg.five && (i === 0 || shown[i - 1].time.slice(0, 4) !== seg.time.slice(0, 4)) && <div className="gk-year">{seg.time.slice(0, 4)} {__ui("年")}</div>}
            <PullRow g={g} p={p} seg={seg} onSelect={v => onDetail(v, p)} />
          </React.Fragment>
        ))}
        {!shown.length && <div className="gk-empty-line">{__ui("没有匹配的记录")}</div>}
      </div>
      {shown.length < segs.length && <button className="gk-more" onClick={() => setLimit(x => x + 30)}>{__ui("展开更多（")}{shown.length} / {segs.length}）</button>}
    </section>
  );
}

function PoolStats({ g, p, onChangePool }: { g: GameDef; p: PoolStat; onChangePool?: () => void }) {
  const bins = Array.from({ length: Math.ceil(p.def.hard / 10) }, (_, i) => p.fives.filter(f => !f.partial && f.pulls > i * 10 && f.pulls <= (i + 1) * 10).length);
  const max = Math.max(1, ...bins);
  return (
    <section className="gk-card">
      <header><h3>{poolName(p.def.name)}<small>{__ui("出金分布")}</small></h3>{onChangePool && <button className="gk-change-pool" onClick={onChangePool}><RefreshCw size={12} />{__ui("更换卡池")}</button>}</header>
      <div className="gk-histo">{bins.map((n, i) => <div key={i}><b>{n || ''}</b><div><i className={barTone(i * 10 + 5, p)} style={{ height: `${(n / max) * 100}%` }} /></div><span>{i * 10 + 1}–{(i + 1) * 10}</span></div>)}</div>
      <div className="gk-section">
        <h4 className="gk-h4">{__msg("{0}获取明细", g.midLabel)}</h4>
        <div className="gk-grid-items">{p.fours.map(x => <div className="gk-collect" key={x.name}><Portrait game={g.key} name={x.name} small rank="mid" /><span>{x.name}</span><b>×{x.count}</b></div>)}{!p.fours.length && <small>{__ui("暂无记录")}</small>}</div>
      </div>
    </section>
  );
}

export function GachaDashboard({ game: g, summary: s, records, onPool, nickname, uid, onShare, exporting, analysis = emptyAnalysis(), onAnalysis = async () => {}, savingAnalysis = false, dbInfo, onRefreshDb, refreshingDb = false, dbMessage = '', autoDb = true, onAutoDb, archives = [], activeUid, onArchive, onUpdateArchive, accountBusy = false }: Props) {
  const [selected, setSelected] = useState(s.pools[0].def.id);
  const [rightPoolId, setRightPoolId] = useState<string | null>(s.pools[1]?.def.id ?? null);
  const [choosingRight, setChoosingRight] = useState(false);
  const [view, setView] = useState<'report' | 'stats'>('report');
  const [columns, setColumns] = useState(2);
  const [q, setQ] = useState('');
  const [asc, setAsc] = useState(false);
  const [detail, setDetail] = useState<{ seg: PullSegment; p: PoolStat } | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const archiveMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!archiveOpen) return;
    const closeOutside = (event: PointerEvent) => { if (!archiveMenu.current?.contains(event.target as Node)) setArchiveOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setArchiveOpen(false); archiveMenu.current?.querySelector<HTMLButtonElement>('.gk-profile-trigger')?.focus(); } };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [archiveOpen]);

  const leftPool = s.pools.find(v => v.def.id === selected) ?? s.pools[0];
  const rightPool = s.pools.find(v => v.def.id === rightPoolId && v.def.id !== leftPool.def.id);
  const visiblePools = s.pools.filter(v => (!v.def.novice && !v.def.optional) || v.total > 0);
  const sum = (f: (v: PoolStat) => number) => s.pools.reduce((n, v) => n + f(v), 0);
  const inferred = sum(v => v.inferred), conflicts = sum(v => v.conflicts), wins = sum(v => v.win), small = sum(v => v.small);
  const offs = sum(v => v.fives.filter(f => f.tag === 'off').length);
  const upSamples = sum(v => v.upSamples);
  const complete = s.fives.filter(f => !f.partial).length;
  const switchPool = (id: string) => {
    setSelected(id);
    setColumns(1);
    setRightPoolId(null);
    setChoosingRight(false);
    onPool(id);
  };
  const toggleColumns = () => {
    if (columns === 2) {
      setColumns(1);
      setChoosingRight(false);
    } else {
      setColumns(2);
      setRightPoolId(null);
      setChoosingRight(true);
    }
  };

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  const kpis: [string, string, string, string, string?][] = [
    [__ui("总抽数"), fmt(s.total, 0), __ui("抽"), `≈ ${Math.round(s.cost).toLocaleString('zh-CN')} ${g.currency}`],
    [__msg("累计{0}", g.topLabel), String(s.fives.length), __ui("个"), offs ? __msg("其中歪 {0} 次", offs) : __ui("暂无歪")],
    [__ui("平均出金"), fmt(s.avg5), __ui("抽"), complete ? __msg("{0} 个完整区间", complete) : __ui("样本不足")],
    [__ui("UP 平均花费"), fmt(s.avgUp), __ui("抽"), upSamples ? __msg("{0} 段完整样本", upSamples) : __ui("样本不足")],
    [__ui("小保底不歪率"), small ? `${((wins / small) * 100).toFixed(0)}%` : '—', '', small ? __msg("{0} / {1} 次小保底", wins, small) : __ui("样本不足")],
  ];
  // The drawer always reads the CURRENT verdict (a manual correction re-derives the summary).
  const liveFive = detail?.seg.five ? s.pools.find(v => v.def.id === detail.p.def.id)?.fives.find(f => f.id === detail.seg.five!.id) ?? detail.seg.five : null;
  const detailKey = liveFive && detail ? recordKey(detail.p.def.id, liveFive.id) : '';
  const manual = detailKey ? analysis.overrides[detailKey] : undefined;
  const setManual = (value: 'auto' | 'up' | 'off') => detail?.seg.five && void onAnalysis({ record: { pool: detail.p.def.id, id: detail.seg.five.id, value } });
  const renderPool = (pool: PoolStat, onChangePool?: () => void) => view === 'stats'
    ? <PoolStats key={`${g.key}-${pool.def.id}-stats`} g={g} p={pool} onChangePool={onChangePool} />
    : <PoolReport key={`${g.key}-${pool.def.id}`} g={g} p={pool} records={records} query={q} asc={asc} onDetail={(seg, pl) => setDetail({ seg, p: pl })} onShare={() => onShare(pool)} onChangePool={onChangePool} />;

  return (
    <div className={`gk-scene ${g.key}`} style={{ display: 'grid', gap: 14 }}>
      <section className="gk-hero">
        <div className="gk-id">
          <img src={gameIcons[g.key]} alt={__msg("{0}游戏图标", g.name)} />
          <div className="gk-profile" ref={archiveMenu}>
            <h2>{onArchive && archives.length ? <button className="gk-profile-trigger" aria-label={__ui("切换账号记录")} aria-expanded={archiveOpen} aria-haspopup="menu" disabled={accountBusy} onClick={() => setArchiveOpen(v => !v)}><span>{nickname || __msg("{0}的抽卡档案", g.playerTitle)}</span><ChevronDown size={15} /></button> : nickname || __msg("{0}的抽卡档案", g.playerTitle)}</h2>
            <p>{g.name} · UID {uid || '—'} {__ui("· 本地记录")}</p>
            {archiveOpen && <div className="gk-archive-menu" role="menu" aria-label={__ui("已提取的账号记录")}>
              {archives.map(archive => <div className="gk-archive-row" key={archive.uid}>
                <button className="gk-archive-item" role="menuitemradio" aria-checked={archive.uid === activeUid} disabled={accountBusy} onClick={() => { setArchiveOpen(false); onArchive?.(archive.uid); }}>
                  <span><b>{archive.nickname || g.playerTitle}</b><small>UID {archive.displayUid} · {__msg("{0} 抽", archive.count)}</small>{archive.canSync === false && <small>{__ui("更新时需重新获取记录")}</small>}</span>
                  {archive.uid === activeUid && <Check size={15} />}
                </button>
                {onUpdateArchive && <button className="gk-change-pool" role="menuitem" disabled={accountBusy} aria-label={__msg("更新账号 {0} 的记录", archive.displayUid)} onClick={() => { setArchiveOpen(false); onUpdateArchive(archive.uid); }}><RefreshCw size={12} />{__ui("更新")}</button>}
              </div>)}
            </div>}
          </div>
        </div>
        <div className="gk-kpis">
          {kpis.map(([label, value, unit, cap, tip]) => (
            <div className="gk-kpi" key={label} title={tip}><span>{label}{tip && <Info size={11} style={{ marginLeft: 4, verticalAlign: -1, opacity: .6 }} />}</span><b>{value}{unit && <i>{unit}</i>}</b><small>{cap}</small></div>
          ))}
        </div>
      </section>

      {(inferred > 0 || conflicts > 0 || dbMessage) && (
        <aside className="gk-info" role="status">
          <Info size={14} />
          <span>
            {inferred > 0 && <>{__ui("有")} <b>{inferred}</b> {__ui("条结果所在时段不在卡池资料内，已按常驻名单与保底规则推断（标签带虚线）。")}</>}
            {conflicts > 0 && <> {__ui("另有")} <b>{conflicts}</b> {__ui("处连续歪与保底规则冲突，可能是历史记录缺失。")}</>}
            {dbMessage && <> {dbMessage}</>}
          </span>
          {onRefreshDb && <button onClick={onRefreshDb} disabled={refreshingDb}>{refreshingDb ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}{__ui("更新卡池数据")}</button>}
        </aside>
      )}

      <div className="gk-bar">
        <nav className="gk-pools" aria-label={__ui("卡池筛选")}>
          {visiblePools.map(v => (
            <button key={v.def.id} className={`gk-pool ${selected === v.def.id ? 'on' : ''}`} aria-pressed={selected === v.def.id} onClick={() => switchPool(v.def.id)} title={v.def.name}>
              <span className="gk-pool-name">{poolName(v.def.name)}</span>
            </button>
          ))}
        </nav>
        <div className="gk-tools">
          <label className="gk-search"><Search size={15} /><input placeholder={__ui("搜索角色、装备或日期")} aria-label={__ui("搜索记录")} value={q} onChange={e => setQ(e.target.value)} />{q && <button onClick={() => setQ('')} aria-label={__ui("清空搜索")}><X size={13} /></button>}</label>
          <button className={`gk-btn icon ${view === 'stats' ? 'on' : ''}`} aria-label={__ui("数据统计")} aria-pressed={view === 'stats'} title={view === 'stats' ? __ui("返回抽卡记录") : __ui("数据统计")} onClick={() => setView(v => v === 'report' ? 'stats' : 'report')}><ChartColumn size={16} /></button>
          <button className="gk-btn" onClick={() => setAsc(!asc)} title={__ui("切换排序")}><ArrowDownUp size={14} />{asc ? __ui("最早在前") : __ui("最新在前")}</button>
          <button className="gk-btn" title={columns === 2 ? __ui("切换单栏") : __ui("切换双栏")} onClick={toggleColumns}>{columns === 2 ? <Rows3 size={15} /> : <Columns2 size={15} />}{columns === 2 ? __ui("单栏") : __ui("双栏")}</button>
          <button className="gk-btn primary" onClick={() => onShare(leftPool)} disabled={exporting} title={__msg("保存{0}长图", leftPool.def.name)}>{exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />}{exporting ? __ui("生成中…") : __ui("保存长图")}</button>
        </div>
      </div>

      <div className={`gk-cols ${columns === 2 ? 'c2' : ''}`} data-columns={columns}>
        <div className="gk-panel" data-side="left">{renderPool(leftPool)}</div>
        {columns === 2 && <div className="gk-panel" data-side="right">
          {choosingRight || !rightPool ? (
            <section className="gk-card gk-pool-picker" aria-label={__ui("选择右侧卡池")}>
              <div className="gk-picker-content">
                <Columns2 size={24} aria-hidden="true" />
                <h3>{__ui("选择右侧卡池")}</h3>
                <div className="gk-picker-options">
                  {visiblePools.filter(v => v.def.id !== leftPool.def.id).map(v => <button className="gk-btn" key={v.def.id} onClick={() => { setRightPoolId(v.def.id); setChoosingRight(false); }}>{poolName(v.def.name)}</button>)}
                </div>
                {rightPool && <button className="gk-change-pool" onClick={() => setChoosingRight(false)}>{__ui("取消")}</button>}
              </div>
            </section>
          ) : renderPool(rightPool, () => setChoosingRight(true))}
        </div>}
      </div>

      <footer className="gk-foot">
        <span>FurinaKit · {__msg("{0}{1}分析", g.name, g.pull)}{dbInfo ? __msg(" · 卡池资料 {0}", dbInfo.live ? __ui("已联网更新 ") + dbInfo.live.slice(0, 10) : __ui("内置 ") + dbInfo.built) : ''}</span>
        {onRefreshDb && <button className="link" onClick={onRefreshDb} disabled={refreshingDb}>{refreshingDb ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}{__ui("更新卡池数据")}</button>}
        {onAutoDb && <label title={__ui("打开时联网读取公开的卡池资料：原神、绝区零读取哔哩哔哩 WIKI，星穹铁道由本机转发读取 Star Rail Station；每个来源最多每 6 小时一次，不会发送任何账号或抽卡信息。")} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}><input type="checkbox" checked={autoDb} onChange={e => onAutoDb(e.target.checked)} />{__ui("打开时自动更新卡池资料")}</label>}
        <details className="gk-note">
          <summary>{__ui("统计说明")}</summary>
          <p>{__ui("歪 = 这次出的最高稀有度不是你抽的那个卡池的当期 UP；是否在你的自选可歪名单里不影响判定，同一个角色在自己的卡池里是 UP、在别的卡池里是歪。判定直接对照公开的卡池资料（原神按时段与 301/400 池，绝区零按同期全部限定频段，星铁按期次 ID，鸣潮按同期全部限定角色池），无需手动确认。资料没覆盖的时段按常驻名单和「歪后必出 UP」规则推断，并标为虚线。")}</p>
          <p>{__ui("首条出金的真实起点未知，以 ≥ 标记，不参与完整间隔平均。本地记录不会自动补回已过期的历史。图片仅用于辨认物品，版权归游戏权利方所有。")}</p>
        </details>
      </footer>

      {detail && (
        <div className="gk-veil" role="presentation" onClick={e => { if (e.target === e.currentTarget) setDetail(null); }}>
          <aside className="gk-drawer" role="dialog" aria-modal="true" aria-label={__ui("抽卡区间详情")}>
            <button className="gk-drawer-x" autoFocus onClick={() => setDetail(null)} aria-label={__ui("关闭详情")}><X size={18} /></button>
            <div className="gk-drawer-head">
              <Portrait game={g.key} name={detail.seg.five?.name || '?'} big />
              <div><h3>{detail.seg.five?.name || __ui("当前未出金区间")}</h3>{liveFive && <ResultChip f={liveFive} def={detail.p.def} />}</div>
            </div>
            <dl className="gk-facts">
              <div><dt>{__ui("抽数")}</dt><dd>{detail.seg.five?.partial ? __ui("至少 ") : ''}{detail.seg.pulls} {__ui("抽")}{detail.seg.five?.partial ? __ui("（起点早于已保存记录）") : ''}</dd></div>
              <div><dt>{__ui("时间")}</dt><dd>{detail.seg.time}</dd></div>
              <div><dt>{__ui("卡池")}</dt><dd>{detail.p.def.name}</dd></div>
              {liveFive?.ups && liveFive.ups.length > 0 && <div><dt>{__ui("当期 UP")}</dt><dd>{liveFive.ups.join('、')}</dd></div>}
              {liveFive && detail.p.def.up && <div><dt>{__ui("判定来源")}</dt><dd>{basisText(liveFive.basis)}</dd></div>}
            </dl>
            {liveFive && detail.p.def.up && <p className="gk-why">{liveFive.evidence}</p>}
            {liveFive && detail.p.def.up && (
              <div style={{ display: 'grid', gap: 6 }}>
                <small>{__ui("判定不对？只对这一条记录生效，不影响原始数据：")}</small>
                <div className="gk-seg" role="group" aria-label={__ui("手动修正")}>
                  {([['auto', __ui("自动")], ['up', 'UP'], ['off', __ui("歪")]] as const).map(([v, label]) => (
                    <button key={v} disabled={savingAnalysis} className={(manual || 'auto') === v ? 'on' : ''} onClick={() => setManual(v)}>{label}</button>
                  ))}
                </div>
              </div>
            )}
            <h4 className="gk-h4">{__ui("这一段获得的")}{g.midLabel}</h4>
            <div className="gk-grid-items">{detail.seg.items.map(x => <div className="gk-collect" key={x.name}><Portrait game={g.key} name={x.name} id={x.id} small rank="mid" /><span>{x.name}</span><b>×{x.count}</b></div>)}{!detail.seg.items.length && <small>{__ui("这一段没有")}{g.midLabel}</small>}</div>
          </aside>
        </div>
      )}
    </div>
  );
}
