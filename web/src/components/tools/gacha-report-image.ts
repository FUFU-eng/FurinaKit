import { createUiText as __createUiText, uiMessage as __msg } from "@/lib/language";
const __ui = __createUiText("components/tools/gacha-report-image.ts");
import type { GameDef, PoolStat, Rec, Summary, Five } from './gacha-analysis-tool';
import { buildSegments, barTone, poolName } from './gacha-dashboard';
import { portrait } from './gacha-portraits';
import gameIcons from './gacha-game-icons.json';

/** Long share image. Same look as the in-app report: host theme tokens, one accent per game, slim luck bars. */
const ACCENT: Record<string, string> = { genshin: '203 80% 52%', starrail: '262 70% 64%', zzz: '44 96% 48%', ww: '188 72% 42%' };
const TONE = { green: 'hsl(152 52% 40%)', yellow: 'hsl(38 90% 48%)', red: 'hsl(4 70% 54%)' };
const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif';

export async function renderHeyboxLongImage({ game: g, pool: p, records, summary, nickname, uid }: { game: GameDef; pool: PoolStat; records: Rec[]; summary: Summary | null; nickname: string; uid: string }): Promise<Blob> {
  const segs = buildSegments(g, p, records).reverse();
  const W = 720, pad = 24, rowPad = 16;
  const mainX = pad + rowPad + 46 + 14, mainW = W - pad - rowPad - mainX;
  const perLine = Math.floor(mainW / 30);
  const rowH = segs.map(s => 12 + 24 + 22 + (s.items.length ? 8 + Math.ceil(s.items.length / perLine) * 30 : 8) + 12);
  const pools = (summary?.pools || [p]).filter(v => v.total > 0 && !(v.def.novice && v.total === 0));
  const headerH = 238, titleH = 62;
  const H = headerH + titleH + rowH.reduce((a, b) => a + b, 0) + 92;
  const scale = Math.min(2, 28000 / H, Math.sqrt(30000000 / (W * H)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(__ui("无法创建图片画布"));
  ctx.scale(scale, scale);

  const css = getComputedStyle(document.querySelector('.gk') || document.documentElement);
  const tok = (name: string, fallback: string, alpha = 1) => { const v = css.getPropertyValue(name).trim(); return v ? `hsl(${v} / ${alpha})` : fallback; };
  const bg = tok('--background', '#f3f5f7'), card = tok('--card', '#ffffff'), ink = tok('--foreground', '#1f2933'), sub = tok('--muted-foreground', '#6b7480');
  const line = tok('--border', '#dfe3e8'), soft = tok('--muted', '#eceff2', 0.7);
  const accent = `hsl(${ACCENT[g.key] || ACCENT.genshin})`, accentSoft = `hsl(${ACCENT[g.key] || ACCENT.genshin} / .14)`;
  const gold = 'hsl(40 82% 52%)', violet = 'hsl(268 48% 60%)', bad = 'hsl(4 70% 54%)';

  const rr = (x: number, y: number, w: number, h: number, r: number, fill?: string, stroke?: string, dash?: number[]) => {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.save(); if (dash) ctx.setLineDash(dash); ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore(); }
  };
  const text = (s: string, x: number, y: number, size: number, color = ink, weight = 400, align: CanvasTextAlign = 'left') => {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); ctx.textAlign = 'left';
  };
  const width = (s: string, size: number, weight = 400) => { ctx.font = `${weight} ${size}px ${FONT}`; return ctx.measureText(s).width; };

  // artwork (embedded thumbnails only: remote icons would taint the canvas)
  const names = new Set<string>();
  segs.forEach(s => { if (s.five) names.add(s.five.name); s.items.forEach(x => names.add(x.name)); });
  const images = new Map<string, HTMLImageElement>();
  await Promise.all([...names].map(async n => { const src = portrait(g.key, n); if (!src) return; const im = new Image(); im.src = src; try { await im.decode(); images.set(n, im); } catch { /* text fallback */ } }));
  const icon = new Image(); icon.src = gameIcons[g.key]; try { await icon.decode(); } catch { /* none */ }

  const portraitAt = (name: string, x: number, y: number, size: number, mid: boolean) => {
    const ring = mid ? violet : gold;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, size, size, size * 0.26); ctx.clip();
    const grad = ctx.createLinearGradient(x, y, x + size, y + size); grad.addColorStop(0, mid ? 'hsl(268 48% 60% / .34)' : 'hsl(40 82% 52% / .38)'); grad.addColorStop(1, mid ? 'hsl(268 48% 60% / .07)' : 'hsl(40 82% 52% / .08)');
    ctx.fillStyle = grad; ctx.fillRect(x, y, size, size);
    const im = images.get(name);
    if (im) ctx.drawImage(im, x, y, size, size);
    else { text(name === '?' ? '?' : Array.from(name.replace(/[「」『』“”\s]/g, '')).slice(0, 2).join(''), x + size / 2, y + size * 0.62, size * 0.3, ink, 700, 'center'); }
    ctx.restore();
    rr(x + 0.75, y + 0.75, size - 1.5, size - 1.5, size * 0.26, undefined, ring);
  };
  const chip = (f: Five, x: number, y: number): number => {
    if (!p.def.up && !p.def.guaranteedUp && !p.def.isBangboo) return 0;
    let label = __ui("定向"), fg = sub, fill: string | undefined = soft, stroke: string | undefined, dash: number[] | undefined;
    if (!(p.def.guaranteedUp || p.def.isBangboo)) {
      label = f.tag === 'off' ? __ui("歪") : f.tag === 'guarantee' ? __ui("保底 UP") : f.tag === 'up' ? 'UP' : __ui("待判定");
      if (f.tag === 'off') { fill = bad; fg = '#fff'; }
      else if (f.tag === 'guarantee') { fill = 'hsl(40 82% 52% / .14)'; stroke = gold; fg = 'hsl(40 82% 38%)'; }
      else if (f.tag === 'up') { fill = accentSoft; stroke = accent; fg = ink; }
      if (f.basis === 'inferred') { dash = [3, 2]; if (f.tag === 'off') { fill = 'hsl(4 70% 54% / .14)'; stroke = bad; fg = bad; } }
    }
    const w = width(label, 12, 700) + 14;
    rr(x, y - 14, w, 19, 6, fill, stroke, dash);
    text(label, x + 7, y, 12, fg, 700);
    return w + 6;
  };

  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // header card
  rr(pad, pad, W - pad * 2, 160, 16, card, line);
  const glow = ctx.createLinearGradient(pad, pad, W * 0.7, pad + 120); glow.addColorStop(0, accentSoft); glow.addColorStop(1, 'hsl(0 0% 100% / 0)');
  ctx.save(); ctx.beginPath(); ctx.roundRect(pad, pad, W - pad * 2, 160, 16); ctx.clip(); ctx.fillStyle = glow; ctx.fillRect(pad, pad, W - pad * 2, 160); ctx.restore();
  if (icon.complete && icon.naturalWidth) { ctx.save(); ctx.beginPath(); ctx.roundRect(pad + 20, pad + 20, 56, 56, 15); ctx.clip(); ctx.drawImage(icon, pad + 20, pad + 20, 56, 56); ctx.restore(); rr(pad + 20, pad + 20, 56, 56, 15, undefined, accent); }
  text(nickname || __msg("{0}的抽卡档案", g.playerTitle), pad + 92, pad + 46, 22, ink, 700);
  text(__msg("{0} · UID {1} · 本地记录", g.name, uid || '—'), pad + 92, pad + 68, 13, sub);
  const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toLocaleString('zh-CN', { maximumFractionDigits: d }));
  const s = summary;
  const stats: [string, string][] = [
    [__ui("总抽数"), fmt(s?.total ?? p.total, 0)], [__msg("累计{0}", g.topLabel), String(s?.fives.length ?? p.fives.length)], [__ui("平均出金"), fmt(s?.avg5 ?? p.avg5)],
    [__ui("UP 平均花费"), fmt(s?.avgUp ?? p.avgUp)], [__ui("小保底不歪率"), s && s.small ? `${Math.round((s.win / s.small) * 100)}%` : '—'],
  ];
  const colW = (W - pad * 2 - 40) / stats.length;
  stats.forEach(([label, value], i) => { const x = pad + 20 + i * colW; text(label, x, pad + 110, 12, sub); text(value, x, pad + 138, 24, ink, 700); if (i) { ctx.fillStyle = line; ctx.fillRect(x - 10, pad + 96, 1, 52); } });

  // compact one-line pool summary keeps the image short
  const summaryY = pad + 160 + 30;
  let sx = pad + 4;
  pools.forEach(v => {
    const label = __msg("{0} {1} 抽 · {2} {3}{4}", poolName(v.def.name), v.total, v.fives.length, g.topLabel, v.def.up ? ` · ${__ui("歪")} ${v.fives.filter(f => f.tag === 'off').length}` : '');
    const w = width(label, 12.5, v.def.id === p.def.id ? 700 : 400) + 22;
    if (sx + w > W - pad) return;
    rr(sx, summaryY - 17, w, 26, 13, v.def.id === p.def.id ? accentSoft : soft, v.def.id === p.def.id ? accent : undefined);
    text(label, sx + 11, summaryY, 12.5, ink, v.def.id === p.def.id ? 700 : 400);
    sx += w + 8;
  });

  // report card
  const top = headerH;
  rr(pad, top, W - pad * 2, H - top - 70, 14, card, line);
  text(__msg("{0}抽卡记录", poolName(p.def.name)), pad + rowPad, top + 36, 19, ink, 700);
  text(__msg("{0} {1}  ·  {2} {3}  ·  已垫 {4} 抽", g.topLabel, p.fives.length, g.midLabel, p.count4, p.pity), W - pad - rowPad, top + 34, 13, sub, 400, 'right');
  let y = top + titleH;
  segs.forEach((seg, i) => {
    const f = seg.five, h = rowH[i];
    ctx.fillStyle = line; ctx.fillRect(pad + rowPad, y, W - (pad + rowPad) * 2, 1);
    portraitAt(f?.name || '?', pad + rowPad, y + 14, 46, false);
    text(f ? f.time.slice(5, 10) : __ui("至今"), pad + rowPad + 23, y + 74, 11.5, sub, 400, 'center');
    const nm = f ? f.name : __ui("尚未出金");
    text(nm, mainX, y + 26, 14.5, f ? ink : sub, 700);
    if (f) chip(f, mainX + width(nm, 14.5, 700) + 8, y + 26);
    text(f ? f.time.slice(11, 16) : '', W - pad - rowPad, y + 26, 12, sub, 400, 'right');
    const bw = Math.max(54, mainW * Math.min(1, seg.pulls / p.def.hard));
    rr(mainX, y + 36, mainW, 22, 8, soft);
    const tone = barTone(seg.pulls, p);
    rr(mainX, y + 36, bw, 22, 8, TONE[tone]);
    const label = `${f?.partial ? '≥' : ''}${seg.pulls}`;
    const fg = tone === 'yellow' ? 'hsl(30 70% 14%)' : '#fff';
    text(label, mainX + 10, y + 52, 13.5, fg, 700);
    text(__ui("抽"), mainX + 14 + width(label, 13.5, 700), y + 52, 11.5, fg);
    ctx.save(); ctx.strokeStyle = 'hsl(0 0% 50% / .45)'; ctx.setLineDash([2, 3]); const tx = mainX + mainW * (p.def.soft / p.def.hard); ctx.beginPath(); ctx.moveTo(tx, y + 40); ctx.lineTo(tx, y + 54); ctx.stroke(); ctx.restore();
    if (seg.items.length) {
      seg.items.forEach((it, j) => {
        const ix = mainX + (j % perLine) * 30, iy = y + 66 + Math.floor(j / perLine) * 30;
        portraitAt(it.name, ix, iy, 26, true);
        if (it.count > 1) { rr(ix + 14, iy + 14, 15, 15, 7.5, card, line); text(String(it.count), ix + 21.5, iy + 25, 10, ink, 700, 'center'); }
      });
    } else text(f ? __msg("这一段没有{0}", g.midLabel) : __msg("暂无{0}", g.midLabel), mainX, y + 76, 12, sub);
    y += h;
  });

  text(__msg("FurinaKit · {0}{1}分析", g.name, g.pull), W / 2, H - 42, 14, ink, 700, 'center');
  text(__ui("首条间隔为下界（≥）；UP / 歪按公开卡池资料判定，无资料时段按规则推断（虚线标签）"), W / 2, H - 20, 11, sub, 400, 'center');
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error(__ui("生成长图失败")))), 'image/png'));
}
