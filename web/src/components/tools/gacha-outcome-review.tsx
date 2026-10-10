import { createUiText as __createUiText, uiMessage as __msg } from "@/lib/language";
const __ui = __createUiText("components/tools/gacha-outcome-review.tsx");
import React, { useMemo, useState } from 'react';
import type { GameDef, Summary } from './gacha-analysis-tool';
import { recordKey, type AnalysisSettings, type AnalysisPatch } from './gacha-outcomes';
import { Portrait, ResultChip, basisText } from './gacha-ui';

type Props = { game: GameDef; summary: Summary; analysis: AnalysisSettings; onAnalysis: (patch: AnalysisPatch) => Promise<void>; saving: boolean; query: string };
type Filter = 'all' | 'off' | 'inferred' | 'manual';

/** Audit view: how every top-rarity result was decided. Corrections are optional, per record, per account. */
export function OutcomeReview({ game: g, summary: s, analysis, onAnalysis, saving, query }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(40);
  const rows = useMemo(
    () => s.pools.filter(p => p.def.up).flatMap(p => p.fives.map(f => ({ f, p })))
      .sort((a, b) => b.f.time.localeCompare(a.f.time) || b.f.id.length - a.f.id.length || b.f.id.localeCompare(a.f.id)),
    [s],
  );
  const q = query.trim();
  const visible = rows.filter(({ f }) => (filter === 'all' || (filter === 'off' ? f.tag === 'off' : f.basis === filter)) && (!q || `${f.name} ${f.time}`.includes(q)));
  const count = (k: Filter) => rows.filter(({ f }) => (k === 'all' ? true : k === 'off' ? f.tag === 'off' : f.basis === k)).length;
  return (
    <section className="gk-card" aria-label={__ui("UP与歪的判定依据")}>
      <header><h3>{__ui("判定依据")}<small>{__ui("每次出金的 UP / 歪 是怎么得出的")}</small></h3></header>
      <div className="gk-audit-filter">
        <div className="gk-seg" role="group" aria-label={__ui("筛选")}>
          {([['all', __ui("全部")], ['off', __ui("歪")], ['inferred', __ui("规则推断")], ['manual', __ui("手动")]] as [Filter, string][]).map(([k, label]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => { setFilter(k); setLimit(40); }}>{label} {count(k)}</button>
          ))}
        </div>
        <small>{__ui("自动判定无需确认；只有判定与你的记忆不一致时才需要在右侧修正。")}</small>
      </div>
      <div className="gk-audit">
        {visible.slice(0, limit).map(({ f, p }) => {
          const key = recordKey(p.def.id, f.id);
          const manual = analysis.overrides[key];
          return (
            <article className="gk-audit-row" key={key}>
              <Portrait game={g.key} name={f.name} />
              <div className="gk-audit-main">
                <div><b className="gk-name">{f.name}</b><ResultChip f={f} def={p.def} /><small>{f.time} · {p.def.name} · {basisText(f.basis)}</small></div>
                <p>{f.evidence}</p>
              </div>
              <div className="gk-seg" role="group" aria-label={__msg("{0} {1} 手动修正", f.name, f.time)}>
                {([['auto', __ui("自动")], ['up', 'UP'], ['off', __ui("歪")]] as const).map(([v, label]) => (
                  <button key={v} disabled={saving} className={(manual || 'auto') === v ? 'on' : ''} onClick={() => void onAnalysis({ record: { pool: p.def.id, id: f.id, value: v } })}>{label}</button>
                ))}
              </div>
            </article>
          );
        })}
        {!visible.length && <div className="gk-empty-line">{__ui("没有符合条件的记录")}</div>}
      </div>
      {visible.length > limit && <button className="gk-more" onClick={() => setLimit(v => v + 40)}>{__ui("展开更多（")}{limit} / {visible.length}）</button>}
    </section>
  );
}
