import { createUiText as __createUiText, uiMessage as __msg } from "@/lib/language";
const __ui = __createUiText("components/tools/gacha-ui.tsx");
import React, { useEffect, useState } from 'react';
import type { Five, GameKey, PoolDef } from './gacha-analysis-tool';
import type { Basis } from './gacha-outcomes';
import { portraitOrRemote } from './gacha-portraits';

const initials = (name: string) => Array.from(name.replace(/[「」『』“”\s]/g, '')).slice(0, 2).join('');

/** Item artwork: embedded thumbnail → public icon by item id → readable initials. Never a wrong picture. */
export function Portrait({ game, name, id, small = false, big = false, rank = 'top' }: { game: GameKey; name: string; id?: string; small?: boolean; big?: boolean; rank?: string }) {
  const url = name === '?' ? undefined : portraitOrRemote(game, name, id);
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [url]);
  return (
    <span className={`gk-pt ${rank === 'mid' ? 'mid' : ''} ${small ? 'small' : ''} ${big ? 'big' : ''}`} title={name === '?' ? '' : name}>
      {url && !bad ? <img src={url} alt={name} loading="lazy" onError={() => setBad(true)} /> : <span>{name === '?' ? '?' : initials(name)}</span>}
    </span>
  );
}

export const basisText = (b?: Basis) => (b === 'manual' ? __ui("你手动指定") : b === 'inferred' ? __ui("规则推断（该时段无卡池资料）") : __ui("卡池资料"));

export function ResultChip({ f, def }: { f: Five; def: PoolDef }) {
  if (def.guaranteedUp || def.isBangboo) return <span className="gk-chip direct" title={__ui("此卡池规则为定向必中")}>{__ui("定向")}</span>;
  if (!def.up) return null;
  const cls = f.tag === 'off' ? 'off' : f.tag === 'guarantee' ? 'guar' : f.tag === 'up' ? 'up' : 'unk';
  const text = f.tag === 'off' ? __ui("歪") : f.tag === 'guarantee' ? __ui("保底 UP") : f.tag === 'up' ? 'UP' : __ui("待判定");
  return <span className={`gk-chip ${cls} ${f.basis === 'inferred' ? 'inf' : ''} ${f.basis === 'manual' ? 'man' : ''}`} title={f.evidence}>{text}</span>;
}
