// Regression checks for the gacha analysis: statistics, automatic UP/歪 resolution (GI / ZZZ / HSR / WuWa), banner
// parsing, live-refresh merging, SSR smoke test.
//   node scripts/verify-gacha-arena.cjs
const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const remote = fs.existsSync('web/src/components/tools/gacha-analysis-tool.tsx');
const dir = path.resolve(remote ? 'web/src/components/tools' : 'src/components/tools');
const deps = path.resolve(remote ? 'web' : '.');
const req = require('module').createRequire(path.join(deps, 'package.json'));
const esbuild = req('esbuild');

// 1) analysis engine = the pure part of the tool file + the resolver + the banner parsers
const source = fs.readFileSync(path.join(dir, 'gacha-analysis-tool.tsx'), 'utf8');
// i18n helpers (__ui / __msg) normally come from @/lib/language; the vm slice uses identity stand-ins (Chinese UI).
const GACHA_I18N_SHIM = 'const __ui = (s) => s; const __msg = (s, ...a) => (a.length && typeof s === "string" ? s.replace(/\\{(\\d+)\\}/g, (m, i) => (+i < a.length ? String(a[+i]) : m)) : s);\n';
const subset = 'import {resolveOutcome,emptyAnalysis,bannerFor} from "./gacha-outcomes"; import {parseZzzWiki,parseGiWiki,getBannerDb,parseHsrConfig,hsrNameMap,refreshBannerDb,bannerDbInfo,HSR_WARP,HSR_NAME_SOURCES} from "./gacha-banners"; export {resolveOutcome,emptyAnalysis,bannerFor,parseZzzWiki,parseGiWiki,getBannerDb,parseHsrConfig,hsrNameMap,refreshBannerDb,bannerDbInfo,HSR_WARP,HSR_NAME_SOURCES};\n'
  + GACHA_I18N_SHIM + source.slice(source.indexOf('export type GameKey'), source.indexOf('// ── 辅助工具'));
const bundle = esbuild.buildSync({ stdin: { contents: subset, loader: 'ts', resolveDir: dir }, bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} };
const store = new Map();                                                    // in-memory stand-in for the WebView's localStorage
const fakeStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
vm.runInNewContext(bundle.outputFiles[0].text, { module: mod, exports: mod.exports, localStorage: fakeStorage });
const { GAMES, analyzePool, summarize, resolveOutcome, emptyAnalysis, bannerFor, parseZzzWiki, parseGiWiki, getBannerDb, parseHsrConfig, hsrNameMap, refreshBannerDb, bannerDbInfo, HSR_WARP, HSR_NAME_SOURCES } = mod.exports;

// the Wuthering Waves source parser (pure ESM script shared with scripts/build-gacha-banners.mjs)
const wwBundle = esbuild.buildSync({ entryPoints: [path.resolve('scripts/gacha-ww-source.mjs')], bundle: true, platform: 'node', format: 'cjs', write: false });
const wwMod = { exports: {} };
vm.runInNewContext(wwBundle.outputFiles[0].text, { module: wwMod, exports: wwMod.exports });
const { postLines, fixtureLines, buildWwRows, parseWindow, officialName } = wwMod.exports;

let passed = 0;
const test = (name, fn) => { fn(); console.log('PASS ' + name); passed++; };
const later = [];                                                           // async tests run at the very end (they replace the cached database)
const atest = (name, fn) => later.push([name, fn]);
const rec = (o) => ({ id: String(o.id), name: o.name, rank_type: o.rank || '5', time: o.time, _pool: o.pool, ...o.extra });
// n pulls where the given pulls are top-rarity (others filler), all stamped in a period with no banner data (2019)
const gen = (stops, game = 'genshin', pool = GAMES[game].pools[0].id, time = '2019-01-01 10:00:00') => Array.from({ length: stops.at(-1)[0] }, (_, i) => {
  const f = stops.find(([n]) => n === i + 1);
  return { id: String(i + 1), name: f ? f[1] : '普通物品', rank_type: f ? GAMES[game].top : (i % 10 === 0 ? GAMES[game].mid : (game === 'zzz' ? '2' : '3')), time, _pool: pool };
});
const settings = (pool, values) => ({ schema: 1, overrides: Object.fromEntries(values.map(([id, value]) => [`${pool}:${id}`, value])), banners: {} });
const GI = GAMES.genshin.pools[0], GIW = GAMES.genshin.pools[1], ZZ = GAMES.zzz.pools[0], ZZW = GAMES.zzz.pools[1];

// ───────── statistics (explicit corrections make the cases independent of banner data) ─────────
test('Empty archive does not invent initial guarantee state', () => { const p = analyzePool('genshin', GI, []); assert.equal(p.avg5, null); assert.equal(p.small, 0); assert.equal(p.guaranteed, null); });
test('First interval is censored', () => { const p = analyzePool('genshin', GI, gen([[20, '芙宁娜']])); assert.equal(p.fives[0].partial, true); assert.equal(p.avg5, null); assert.equal(p.small, 0); });
test('Confirmed complete UP cycles and small pity counts', () => {
  const p = analyzePool('genshin', GI, gen([[20, '芙宁娜'], [90, '琴'], [100, '芙宁娜']]), settings('301', [[20, 'up'], [90, 'off'], [100, 'up']]));
  assert.equal(p.avg5, 40); assert.equal(p.small, 1); assert.equal(p.win, 0); assert.equal(p.avgUp, 80); assert.equal(p.fives[2].tag, 'guarantee');
});
test('A manually "unknown" result breaks UP cost and guarantee chains', () => {
  const p = analyzePool('genshin', GI, gen([[10, 'A'], [20, 'B'], [30, 'C'], [40, 'D']]), settings('301', [[10, 'up'], [20, 'unknown'], [30, 'up'], [40, 'up']]));
  assert.equal(p.avgUp, 10); assert.equal(p.upSamples, 1); assert.equal(p.small, 1); assert.equal(p.win, 1);
});
test('Latest manual "unknown" makes the next UP state unknown', () => {
  const p = analyzePool('genshin', GI, gen([[10, 'A'], [20, 'B']]), settings('301', [[10, 'off'], [20, 'unknown']]));
  assert.equal(p.guaranteed, null); assert.equal(p.fives[1].tag, 'unknown');
});
test('Consecutive off results flag contradictory history', () => {
  const p = analyzePool('zzz', ZZ, gen([[10, '凯撒'], [20, '月城柳']], 'zzz'), settings('2', [[10, 'off'], [20, 'off']]));
  assert.equal(p.conflicts, 1); assert.equal(p.small, 0);
});
test('Non-UP pools do not report wins', () => { const p = analyzePool('genshin', GAMES.genshin.pools[3], gen([[20, '琴'], [30, '莫娜']])); assert.equal(p.small, 0); assert.equal(p.unknownCount, 0); });
test('Guaranteed weapon and Bangboo rules stay direct', () => {
  for (const [game, pool] of [['ww', 1], ['zzz', 3]]) { const p = analyzePool(game, GAMES[game].pools[pool], gen([[20, '道具']], game)); assert.equal(p.fives[0].tag, 'direct'); assert.equal(p.unknownCount, 0); }
});
test('Summary averages exclude first interval and unclassified cycles', () => {
  const s = summarize('genshin', gen([[20, 'A'], [90, 'B'], [100, 'C']]), settings('301', [[20, 'up'], [90, 'off'], [100, 'up']]));
  assert.equal(s.avg5, 40); assert.equal(s.avgUp, 80);
});
test('Remaining hard pity uses selected game rules', () => {
  const r = gen([[20, '今汐']], 'ww'); r.push({ id: '21', name: '普通', rank_type: '3', time: '2026-10-02', _pool: '1' });
  const p = analyzePool('ww', GAMES.ww.pools[0], r); assert.equal(p.pity, 1); assert.equal(p.toHard, 79);
});
test('Luck estimate is a probability and early pulls rate luckier than pity-capped ones', () => {
  const lucky = summarize('genshin', gen([[5, 'A'], [15, 'B'], [30, 'C']])).luck, unlucky = summarize('genshin', gen([[5, 'A'], [85, 'B'], [170, 'C']])).luck;
  assert(lucky > 0.9 && lucky <= 1 && unlucky >= 0 && unlucky < 0.1, `${lucky} ${unlucky}`);
});

// ───────── automatic UP / 歪 from the banner database ─────────
const R = (game, def, id, name, time, extra = {}) => ({ id: String(id), name, rank_type: GAMES[game].top, time, _pool: def.id, ...extra });
test('Caesar regression: the real ZZZ 3.1 launch-day sequence resolves with no manual input', () => {
  const rows = [['柳', '2026-07-29 10:21:14'], ['蕾米埃尔', '2026-07-29 10:25:44'], ['凯撒', '2026-07-29 10:30:58'], ['蕾米埃尔', '2026-07-29 11:11:38'], ['蕾米埃尔', '2026-07-29 13:27:16']];
  const p = analyzePool('zzz', ZZ, rows.map(([n, t], i) => R('zzz', ZZ, i + 1, n, t, { gacha_id: '0' })));
  assert.deepEqual(p.fives.map(f => f.tag), ['off', 'guarantee', 'off', 'guarantee', 'up']);
  assert(p.fives.every(f => f.basis === 'banner')); assert.equal(p.unknownCount, 0); assert.equal(p.conflicts, 0);
});
test('The same character is UP on his own banner and 歪 on another (never a global flag)', () => {
  assert.equal(resolveOutcome('zzz', ZZ, R('zzz', ZZ, 1, '凯撒', '2025-06-26 10:00:00')).outcome, 'up');
  assert.equal(resolveOutcome('zzz', ZZ, R('zzz', ZZ, 2, '凯撒', '2026-07-29 10:30:58')).outcome, 'off');
});
test('Genshin: 301 and 400 are different banners of the same window', () => {
  const t = '2026-09-23 12:50:00';
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 1, '薇斯纳', t, { gacha_type: '301' })).outcome, 'up');
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 2, '薇斯纳', t, { gacha_type: '400' })).outcome, 'off');
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 3, '沃雅妮莎', t, { gacha_type: '400' })).outcome, 'up');
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 4, '刻晴', t, { gacha_type: '400' })).outcome, 'off');
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 5, '沃雅妮莎', t)).outcome, 'up'); // legacy import without gacha_type: union of the window
});
test('Genshin weapon banner: both featured weapons count, others are 歪', () => {
  const t = '2026-09-23 12:50:00';
  assert.equal(resolveOutcome('genshin', GIW, R('genshin', GIW, 1, '蝶变', t)).outcome, 'up');
  assert.equal(resolveOutcome('genshin', GIW, R('genshin', GIW, 2, '漩流颂歌', t)).outcome, 'up');
  assert.equal(resolveOutcome('genshin', GIW, R('genshin', GIW, 3, '天空之傲', t)).outcome, 'off');
});
test('Banner windows are half-open: the second the next phase starts, the previous UP is 歪', () => {
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 1, '薇斯纳', '2026-10-13 17:59:59', { gacha_type: '301' })).outcome, 'up');
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 2, '薇斯纳', '2026-10-13 18:00:00', { gacha_type: '301' })).outcome, 'off');
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 3, '丝柯克', '2026-10-13 18:00:00', { gacha_type: '301' })).outcome, 'up');
});
test('ZZZ rerun channel: every one of the three selectable limited agents counts as UP', () => {
  for (const n of ['琉音', '柚叶', '悠真']) assert.equal(resolveOutcome('zzz', ZZ, R('zzz', ZZ, 1, n, '2026-08-25 12:00:00')).outcome, 'up');
});
test('ZZZ engine channel is resolved the same way', () => {
  assert.equal(resolveOutcome('zzz', ZZW, R('zzz', ZZW, 1, '绯月银棺', '2026-10-02 03:03:39')).outcome, 'up');
  assert.equal(resolveOutcome('zzz', ZZW, R('zzz', ZZW, 2, '钢铁肉垫', '2026-10-02 03:03:39')).outcome, 'off');
});
test('Outside the database window results are inferred and clearly marked, never "banner"', () => {
  const a = resolveOutcome('zzz', ZZ, R('zzz', ZZ, 1, '「11号」', '2031-01-01 10:00:00')), b = resolveOutcome('zzz', ZZ, R('zzz', ZZ, 2, '某新角色', '2031-01-01 10:00:00'));
  assert.deepEqual([a.outcome, a.basis, b.outcome, b.basis], ['off', 'inferred', 'up', 'inferred']);
  assert.equal(resolveOutcome('genshin', GI, R('genshin', GI, 3, '莫娜', '2031-01-01 10:00:00')).outcome, 'off');
});
const WW1 = GAMES.ww.pools[0];
const wwOut = (name, time, extra) => resolveOutcome('ww', WW1, R('ww', WW1, 1, name, time, extra));
test('Wuthering Waves: judged from the banner periods that were open, not from a roster', () => {
  const t = '2026-10-05 12:00:00';                                         // 3.7 上半: 心 / 千咲 / 尤诺 featured
  for (const n of ['心', '千咲', '尤诺']) { const e = wwOut(n, t); assert.deepEqual([e.outcome, e.basis], ['up', 'banner'], n); }
  const lost = wwOut('卡卡罗', t);
  assert.deepEqual([lost.outcome, lost.basis], ['off', 'banner']); assert(lost.reason.includes('心') && lost.reason.includes('卡卡罗'));
  assert.deepEqual([wwOut('忌炎', '2024-05-30 12:00:00').outcome, wwOut('维里奈', '2024-05-30 12:00:00').outcome], ['up', 'off']);   // 1.0 launch banner
  assert.equal(wwOut('忌炎', '2026-10-05 12:00:00').outcome, 'up');       // not featured now, but a limited resonator can only be a win: inferred below
});
test('Wuthering Waves: concurrent banners with different windows form the union at the pull time (half-open bounds)', () => {
  const ups = t => [...bannerFor('ww', WW1, R('ww', WW1, 1, 'x', t)).ups].sort();
  assert.deepEqual(ups('2026-06-10 12:00:00'), ['丽贝卡', '露西']);                                                  // 3.4: only the collab pair is open
  assert.deepEqual(ups('2026-06-13 09:59:59'), ['丽贝卡', '露西']);
  assert.deepEqual(ups('2026-06-13 10:00:00'), ['丽贝卡', '洛瑟菈', '露西']);                                        // 洛瑟菈 opens
  assert.deepEqual(ups('2026-06-20 12:00:00'), ['丽贝卡', '卡提希娅', '洛瑟菈', '露西']);                              // 卡提希娅 rerun opens
  assert.equal(wwOut('洛瑟菈', '2026-06-20 12:00:00').basis, 'banner');
  assert.deepEqual(ups('2025-12-30 12:00:00'), ['卡提希娅', '夏空', '琳奈']);                                        // 3.0 上半: three parallel banners
});
test('Wuthering Waves: the six-resonator 忆旅 rerun counts as UP for its whole 3.5 run', () => {
  for (const n of ['忌炎', '吟霖', '今汐', '长离', '折枝', '相里要']) for (const t of ['2026-07-12 12:00:00', '2026-08-10 12:00:00']) assert.deepEqual([wwOut(n, t).outcome, wwOut(n, t).basis], ['up', 'banner'], n + t);
  assert.equal(wwOut('维里奈', '2026-08-10 12:00:00').outcome, 'off');
});
test('Wuthering Waves: the short gap before the next version belongs to the last open banner', () => {
  assert.deepEqual([wwOut('景燃', '2026-09-29 20:00:00').outcome, wwOut('景燃', '2026-09-29 20:00:00').basis], ['up', 'banner']);
  assert.equal(wwOut('景燃', '2026-09-30 06:00:00').basis, 'inferred');     // 3.7 has started: 景燃 is no longer featured (and not permanent)
});
test('Wuthering Waves: neither featured nor permanent is a stale list, never a false 歪 (inferred, flagged)', () => {
  const e = wwOut('今汐', '2026-10-05 12:00:00');
  assert.deepEqual([e.outcome, e.basis], ['up', 'inferred']); assert(e.reason.includes('不是常驻五星'));
});
test('Wuthering Waves outside the database window: roster fallback, clearly marked as inferred', () => {
  const a = wwOut('卡卡罗', '2031-01-01 10:00:00'), b = wwOut('今汐', '2031-01-01 10:00:00');
  assert.deepEqual([a.outcome, a.basis, b.outcome, b.basis], ['off', 'inferred', 'up', 'inferred']);
  const early = wwOut('忌炎', '2024-05-01 10:00:00'); assert.deepEqual([early.outcome, early.basis], ['up', 'inferred']);
});
test('Wuthering Waves guarantee chain runs on banner evidence only', () => {
  const rows = [['卡卡罗', '2026-10-02 10:00:00'], ['心', '2026-10-03 10:00:00'], ['千咲', '2026-10-04 10:00:00'], ['鉴心', '2026-10-05 10:00:00'], ['尤诺', '2026-10-06 10:00:00']];
  const p = analyzePool('ww', WW1, rows.map(([n, t], i) => R('ww', WW1, i + 1, n, t)));
  assert.deepEqual(p.fives.map(f => f.tag), ['off', 'guarantee', 'up', 'off', 'guarantee']);
  assert(p.fives.every(f => f.basis === 'banner')); assert.equal(p.unknownCount, 0); assert.equal(p.conflicts, 0);
});
test('HSR exact banner ID resolves the selected limited off-character', () => {
  let r = { id: '1', name: '刃', item_id: '1205', gacha_id: '2003', time: '2026-10-01', _pool: '11', rank_type: '5' };
  assert.equal(resolveOutcome('starrail', GAMES.starrail.pools[0], r).outcome, 'off');
  r = { ...r, item_id: '1102', name: '希儿' }; assert.equal(resolveOutcome('starrail', GAMES.starrail.pools[0], r).outcome, 'up');
});
test('An unknown HSR banner id is never guessed from dates', () => {
  const r = { id: '1', name: '希儿', item_id: '1102', gacha_id: '2003', time: '2026-10-01', _pool: '21', rank_type: '5' };
  assert.notEqual(resolveOutcome('starrail', GAMES.starrail.pools[2], r).basis, 'banner');
});
test('Manual corrections outrank the database and stay scoped to the account / pool / record', () => {
  const r = R('zzz', ZZ, 1, '洛克茜', '2026-10-01 02:33:55');
  assert.equal(resolveOutcome('zzz', ZZ, r).outcome, 'up');
  assert.equal(resolveOutcome('zzz', ZZ, r, settings('2', [[1, 'off']])).outcome, 'off');
  assert.equal(resolveOutcome('zzz', ZZ, r, settings('2', [[1, 'off']])).basis, 'manual');
  assert.equal(resolveOutcome('zzz', ZZ, r, settings('3', [[1, 'off']])).outcome, 'up');
  assert.equal(resolveOutcome('zzz', ZZ, r, emptyAnalysis()).outcome, 'up');
});
test('Account-scoped exact banner configuration still works and outranks the database', () => {
  const a = emptyAnalysis(); a.banners['2:9001'] = { upNames: ['星见雅'] }; a.banners['2:9002'] = { upNames: ['凯撒'] };
  const r = R('zzz', ZZ, 1, '凯撒', '2026-10-01 10:00:00', { gacha_id: '9001' });
  assert.equal(resolveOutcome('zzz', ZZ, r, a).outcome, 'off'); assert.equal(resolveOutcome('zzz', ZZ, { ...r, gacha_id: '9002' }, a).outcome, 'up');
  assert.equal(resolveOutcome('zzz', ZZ, { ...r, gacha_id: undefined }, a).basis, 'banner');
});

// ───────── wiki parsers (same code the app uses for live refresh) ─────────
test('ZZZ wikitext parser: nominal "版本更新后" start, year typo, exclusive end, rerun lists', () => {
  const rows = parseZzzWiki(`
{{调频/独家频段
|期数=035-1
|名称=复乐园
|开始时间=2025/07/29 11:00:00
|结束时间=2026/09/08 14:59:59
|开始时间描述=3.1版本更新后
|版本=3.1
|S级代理人=蕾米埃尔
}}
{{调频/独家重映
|期数=002
|开始时间=2026/08/19 12:00:00
|结束时间=2026/09/08 14:59:59
|开始时间描述=
|版本=3.1
|S级代理人=琉音、柚叶、悠真
}}<!-- {{调频/独家频段
|期数=999
}} -->`);
  assert.equal(rows.length, 2);
  const a = rows.find(r => r.n === '035-1'), b = rows.find(r => r.n === '002');
  assert.deepEqual([a.s, a.e], ['2026-07-29 06:00:00', '2026-09-08 15:00:00']);
  assert.deepEqual(b.u, ['琉音', '柚叶', '悠真']); assert.equal(b.k, '独家重映');
});
test('Genshin wikitext parser splits characters / weapons and banner 1 / 2', () => {
  const g = parseGiWiki(`
{{祈愿/角色活动祈愿
|期数=106
|名称=煦风欢舞时
|开始时间=2026/09/23 06:00
|结束时间=2026/10/13 17:59
|版本=7.1上半
|5星角色=薇斯纳
}}
{{祈愿/角色活动祈愿
|期数=106-2
|开始时间=2026/09/23 06:00
|结束时间=2026/10/13 17:59
|5星角色=沃雅妮莎
}}
{{祈愿/武器活动祈愿
|期数=106
|开始时间=2026/09/23 06:00
|结束时间=2026/10/13 17:59
|5星武器=蝶变、漩流颂歌
}}`);
  assert.equal(g['301'].length, 2); assert.equal(g['302'].length, 1);
  assert.deepEqual(g['301'].map(r => r.i), [1, 2]); assert.equal(g['301'][0].e, '2026-10-13 18:00:00'); assert.deepEqual(g['302'][0].u, ['蝶变', '漩流颂歌']);
});
test('Embedded database is complete and sane', () => {
  const db = getBannerDb();
  assert(db.genshin['301'].length >= 180 && db.genshin['302'].length >= 100 && db.zzz['2'].length >= 60 && db.zzz['3'].length >= 60 && Object.keys(db.starrail.banners).length >= 280);
  for (const rows of [db.genshin['301'], db.genshin['302'], db.zzz['2'], db.zzz['3'], db.ww['1']]) for (const r of rows) assert(r.s < r.e && r.u.length > 0, JSON.stringify(r));
});
test('Embedded Wuthering Waves data: official names only, contiguous coverage since launch', () => {
  const db = getBannerDb(), rows = db.ww['1'];
  assert(rows.length >= 40 && db.ww.five.length >= 40);
  for (const r of rows) for (const n of r.u) assert(db.ww.five.includes(n), `「${n}」(${r.n}) is not an official 5★ resonator`);
  for (const n of ['凌阳', '安可', '卡卡罗', '鉴心', '维里奈']) assert(db.ww.five.includes(n), n);                      // the permanent roster used for the fallback
  assert.equal(new Set(rows.map(r => r.n)).size, rows.length);                                                           // unique keys
  const sorted = [...rows].sort((a, b) => a.s.localeCompare(b.s)); let end = sorted[0].e;                                // no hole between the first and the last banner
  for (const r of sorted) { assert(r.s <= end, `hole before ${r.n} (${r.s}) — previous coverage ends ${end}`); if (r.e > end) end = r.e; }
  assert.equal(sorted[0].s.slice(0, 10), '2024-05-23');
  assert.equal(bannerDbInfo().covers.ww, end.slice(0, 10));
});
test('WuWa source parser: 更新後 start, inclusive end, groups with their own windows, name fixes, gap closing', () => {
  const rows = buildWwRows([
    '2.0版本 上半', '角色池「甲」+ 武器池「乙」', '• 五星UP角色：珂萊塔(NEW)、折枝', '• 四星UP角色：熾霞', '• 喚取時間：2025/01/02 (2.0版本更新後) - 2025/01/23 09:59',
    '2.0版本 下半', '• 五星UP角色：洛可可(NEW)、今汐 / 長離', '• 喚取時間：2025/01/23 10:00 - 2025/02/12 11:59',
    '2.1版本 上半', '角色池「丙」+ 武器池「丁」', '• 五星UP角色 (聯動限定)：蕾貝卡(NEW)', '• 喚取時間：2025/02/13 (2.1版本更新後) - 2025/03/06 09:59',
    '• 五星UP角色：卡提希婭', '• 喚取時間：2025/02/20 10:00  - 2025/03/06 09:59',
  ]);
  assert.deepEqual(rows.map(r => r.n), ['2.0a', '2.0b', '2.1a-1', '2.1a-2']);
  assert.deepEqual([rows[0].s, rows[0].e], ['2025-01-02 06:00:00', '2025-01-23 10:00:00']);                 // 更新後 → 06:00; hh:59 → exclusive
  assert.deepEqual([rows[1].s, rows[1].e], ['2025-01-23 10:00:00', '2025-02-13 06:00:00']);                 // 11:59 gap before the next update closed
  assert.deepEqual(rows[1].u, ['洛可可', '今汐', '长离']); assert.deepEqual(rows[2].u, ['丽贝卡']);          // slashes, (NEW), Taiwan → mainland name
  assert.deepEqual([rows[0].t, rows[2].t, rows[3].t], ['甲', '', '']);                                       // a title only when the phase has a single group
  assert.deepEqual(parseWindow('2026/09/30 (3.7版本更新後) - 2026/10/22 09:59'), { s: '2026-09-30 06:00:00', e: '2026-10-22 10:00:00' });
  assert.equal(parseWindow('2026/10/22 10:00 - 2026/09/30 09:59'), null);
  assert.equal(officialName('蕾貝卡(NEW)'), '丽贝卡'); assert.equal(officialName('陸·赫斯'), '陆·赫斯');
  assert.throws(() => buildWwRows(['3.9版本', '• 五星UP角色：心']), /缺少/);
});
test('WuWa source parser: post HTML → lines (first article only, entities decoded)', () => {
  const html = '<div class="x"><div class="c-article__content">3.7版本 上半<br>• 五星UP角色：心(NEW)、千咲<br>• 喚取時間：2026/09/30 (3.7版本更新後) &#45; 2026/10/22 09:59<br></div><div class="c-article__content">留言 &amp; 其他</div>';
  const lines = postLines(html);
  assert.deepEqual([...lines], ['3.7版本 上半', '• 五星UP角色：心(NEW)、千咲', '• 喚取時間：2026/09/30 (3.7版本更新後) - 2026/10/22 09:59']);
  assert.equal(fixtureLines(lines).length, 3);
  assert.throws(() => postLines('<html></html>'), /找不到正文/);
});
test('The shipped Wuthering Waves rows are exactly what the committed source text produces (no hand edits)', () => {
  const fixture = fs.readFileSync(path.resolve('scripts/fixtures/gacha-ww-post.txt'), 'utf8').split('\n').filter(Boolean);
  assert.equal(JSON.stringify(buildWwRows(fixture)), JSON.stringify(getBannerDb().ww['1']));
});
test('Star Rail config parser: pool by id range, CST window from the UTC epoch, items without a featured id skipped', () => {
  const E = (y, m, d, h) => Date.UTC(y, m - 1, d, h) / 1000;
  const rows = parseHsrConfig({
    2003: { rateup: 1102, start_time: E(2026, 1, 1, 2), end_time: E(2026, 1, 21, 10) }, 3003: { rateup: '23001', start_time: E(2026, 1, 1, 2), end_time: 0 },
    5001: { rateup: 1301 }, 6002: { rateup: 21001 }, 4001: { rateup: 5 }, 1001: { rateup: 6 }, 2004: { start_time: 1 }, 7000: { rateup: 9 },
  });
  assert.deepEqual(Object.keys(rows).sort(), ['11:2003', '12:3003', '21:5001', '22:6002']);
  assert.deepEqual(JSON.parse(JSON.stringify(rows['11:2003'])), { u: '1102', s: '2026-01-01 10:00:00', e: '2026-01-21 18:00:00' });
  assert.deepEqual(JSON.parse(JSON.stringify(rows['12:3003'])), { u: '23001', s: '2026-01-01 10:00:00', e: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(hsrNameMap(['1102', '23001', '9'], { 1102: { name: '希儿' } }, { 23001: { name: '于夜色中' }, 1102: { name: 'x' } }))), { 1102: '希儿', 23001: '于夜色中' });
  assert.deepEqual(Object.keys(parseHsrConfig(null)), []);
});
test('Rust forwarder allows exactly the URLs the front-end requests (fixed public sources only)', () => {
  const rs = path.resolve('src-tauri/src/gacha.rs');
  if (!fs.existsSync(rs)) { console.log('  (no src-tauri in this tree: checked in the project build only)'); return; }
  const text = fs.readFileSync(rs, 'utf8'), at = text.indexOf('const BANNER_SOURCES');
  assert(at > 0 && text.includes('"banners/fetch" => banners_fetch(args)'));
  const urls = [...text.slice(at, text.indexOf('];', at)).matchAll(/"(https:[^"]+)"/g)].map(m => m[1]).sort();
  assert.equal(JSON.stringify(urls), JSON.stringify([HSR_WARP, ...HSR_NAME_SOURCES.characters, ...HSR_NAME_SOURCES.light_cones].sort()));
  assert(urls.every(u => !/[?#]/.test(u)));
});


// ───────── dashboard server-render smoke test + interval accounting ─────────
const build = esbuild.buildSync({ entryPoints: [path.join(dir, 'gacha-dashboard.tsx')], bundle: true, platform: 'node', format: 'cjs', write: false, loader: { '.css': 'empty' }, mainFields: ['module', 'main'], nodePaths: [path.join(deps, 'node_modules')], external: ['react', 'react-dom'], jsx: 'automatic', alias: { '@': path.join(deps, 'src') } });
const dash = { exports: {} };
vm.runInNewContext(build.outputFiles[0].text, { module: dash, exports: dash.exports, require: req });
const React = req('react'), { renderToStaticMarkup } = req('react-dom/server');
const records = [R('genshin', GI, 1, '薇斯纳', '2026-09-23 12:49:04', { gacha_type: '301' })].concat(Array.from({ length: 30 }, (_, i) => ({ id: String(i + 2), name: i % 10 === 0 ? '迪奥娜' : '冷刃', rank_type: i % 10 === 0 ? '4' : '3', time: '2026-09-23 12:50:00', _pool: '301' })), [R('genshin', GI, 40, '刻晴', '2026-09-23 12:51:00', { gacha_type: '400' })]);
const sum = summarize('genshin', records);
const html = renderToStaticMarkup(React.createElement(dash.exports.GachaDashboard, { game: GAMES.genshin, summary: sum, records, pool: sum.pools[0], onPool: () => {}, nickname: '演示档案', uid: 'DEMO', onShare: () => {}, exporting: false }));
for (const label of ['数据统计', '原神游戏图标', 'DEMO', '已垫', '歪', 'UP', '更换卡池']) assert(html.includes(label), 'Missing ' + label);
for (const removed of ['全部记录', '判定依据', 'gk-tabs']) assert(!html.includes(removed), 'Removed UI still rendered: ' + removed);
assert(html.includes('data-columns="2"'), 'Default layout must show two columns');
assert(html.includes('id="gk-pool-301"') && html.includes('id="gk-pool-302"'), 'Default pair must be character and weapon pools');
assert(!html.includes('id="gk-pool-200"'), 'Default pair must not append the standard pool');
for (const bad of ['NaN', 'undefined']) assert(!html.includes(bad), 'Unexpected ' + bad);
assert(html.includes('保底状态未知'), 'An empty weapon pool must report unknown guarantee state');
console.log('PASS React server-render smoke check');
const segs = dash.exports.buildSegments(GAMES.genshin, sum.pools[0], records);
assert.equal(segs.reduce((n, s) => n + s.pulls, 0), records.length);
assert.equal(segs.reduce((n, s) => n + s.items.reduce((m, i) => m + i.count, 0), 0), sum.pools[0].count4);
console.log('PASS interval accounting');

// ───────── live refresh (Star Rail via the native forwarder, per-source freshness, failure fallback) ─────────
// Runs last: a successful refresh replaces the cached database of the module under test.
const T0 = Date.UTC(2026, 9, 9, 8, 0, 0);
const EMBEDDED_HSR = JSON.parse(JSON.stringify(getBannerDb().starrail.banners));                           // pristine copy: earlier tests replace the module's cached database
const warpFromEmbedded = () => Object.fromEntries(Object.entries(EMBEDDED_HSR).map(([k, v]) => [k.split(':')[1], {
  rateup: Number(v.u), start_time: v.s ? Date.parse(v.s.replace(' ', 'T') + 'Z') / 1000 - 8 * 3600 : 0, end_time: v.e ? Date.parse(v.e.replace(' ', 'T') + 'Z') / 1000 - 8 * 3600 : 0,
}]));
const HSR_EVENT = GAMES.starrail.pools[0];
const mockNative = (log, warp) => async url => {
  log.push(url);
  if (url === HSR_WARP) return { config: { banners: warp } };
  if (url === HSR_NAME_SOURCES.characters[0]) throw new Error('raw.githubusercontent.com blocked');       // first mirror down → the second one is used
  if (url === HSR_NAME_SOURCES.characters[1]) return { 9999: { name: '新角色甲' } };
  if (url.includes('light_cones')) return { 29999: { name: '新光锥乙' } };
  throw new Error('unexpected URL ' + url);
};
const noWiki = async () => '';                                                                              // BWiki unreachable / layout changed → sanity floor rejects it
atest('Star Rail live refresh: new banners merge over the embedded data, names come from the fallback mirror, nothing is lost', async () => {
  store.clear();
  const before = Object.keys(getBannerDb().starrail.banners).length, warp = warpFromEmbedded();
  warp[2901] = { rateup: 9999, start_time: Date.UTC(2026, 9, 20, 2) / 1000, end_time: Date.UTC(2027, 2, 1, 10) / 1000 };
  warp[3901] = { rateup: 29999, start_time: Date.UTC(2026, 9, 20, 2) / 1000, end_time: Date.UTC(2027, 2, 1, 10) / 1000 };
  const log = [], r = await refreshBannerDb(true, { native: mockNative(log, warp), wiki: noWiki, sleep: async () => {}, now: () => T0 });
  assert(r.ok && r.changed === 2, JSON.stringify(r)); assert(r.message.includes('星穹铁道') && r.message.includes('原神 / 绝区零'), r.message);   // HSR ok, BWiki rejected → partial result is reported
  const db = getBannerDb();
  assert.equal(Object.keys(db.starrail.banners).length, before + 2);
  assert.deepEqual(JSON.parse(JSON.stringify(db.starrail.banners['11:2901'])), { u: '9999', s: '2026-10-20 10:00:00', e: '2027-03-01 18:00:00' });
  assert.equal(db.starrail.names['9999'], '新角色甲'); assert.equal(db.starrail.names['29999'], '新光锥乙');
  assert.equal(log.filter(u => u === HSR_WARP).length, 1); assert(log.includes(HSR_NAME_SOURCES.characters[1]));
  const hit = (name, id, time = '2026-10-25 12:00:00') => resolveOutcome('starrail', HSR_EVENT, { id: '1', name, item_id: id, gacha_id: '2901', time, _pool: '11', rank_type: '5' });
  assert.deepEqual([hit('新角色甲', '9999').outcome, hit('新角色甲', '9999').basis], ['up', 'banner']);   // exact id: a banner the embedded data never knew
  assert.equal(hit('姬子', '1003').outcome, 'off');
  assert(hit('姬子', '1003').reason.includes('新角色甲'));
  assert.equal(bannerDbInfo().covers.starrail, '2027-03-01');
});
atest('Star Rail live refresh: an id whose name is unknown still judges correctly and never shows an empty UP list', async () => {
  store.clear();
  const warp = warpFromEmbedded(); warp[2902] = { rateup: 8888, start_time: Date.UTC(2026, 9, 20, 2) / 1000, end_time: Date.UTC(2026, 10, 10, 10) / 1000 };
  const native = async url => { if (url === HSR_WARP) return { config: { banners: warp } }; throw new Error('offline'); };
  const r = await refreshBannerDb(true, { native, wiki: noWiki, sleep: async () => {}, now: () => T0 });
  assert(r.ok, JSON.stringify(r));
  const e = resolveOutcome('starrail', HSR_EVENT, { id: '1', name: '某新角色', item_id: '8888', gacha_id: '2902', time: '2026-10-25 12:00:00', _pool: '11', rank_type: '5' });
  assert.deepEqual([e.outcome, e.basis], ['up', 'banner']);
  const o = resolveOutcome('starrail', HSR_EVENT, { id: '2', name: '姬子', item_id: '1003', gacha_id: '2902', time: '2026-10-25 12:00:00', _pool: '11', rank_type: '5' });
  assert.equal(o.outcome, 'off'); assert(o.reason.includes('物品#8888'), o.reason);
});
atest('Star Rail live refresh: a changed or partial response never replaces good data', async () => {
  store.clear();
  const before = JSON.stringify(getBannerDb().starrail);
  const tiny = { 2003: { rateup: 1102, start_time: 1, end_time: 2 }, 2004: { rateup: 1205, start_time: 1, end_time: 2 } };
  for (const bad of [{ config: { banners: tiny } }, { config: {} }, {}, null]) {
    const r = await refreshBannerDb(true, { native: async () => bad, wiki: noWiki, sleep: async () => {}, now: () => T0 });
    assert(!r.ok && r.message.includes('星穹铁道'), JSON.stringify(r));
  }
  const gone = await refreshBannerDb(true, { native: async () => { throw new Error('网络连接失败'); }, wiki: noWiki, sleep: async () => {}, now: () => T0 });
  assert(!gone.ok && gone.message.includes('继续使用现有数据') && gone.message.includes('网络连接失败'), gone.message);
  assert.equal(JSON.stringify(getBannerDb().starrail), before);
  const saved = JSON.parse(store.get('fk-gacha-banners-live-v2') || '{}');                       // only the attempt time is persisted (for the cooldown)
  assert(!saved.starrail && !saved.hsrAt && saved.tried && saved.tried.hsr, JSON.stringify(Object.keys(saved)));
});
atest('Live refresh keeps a 6 h freshness window per source and does not hammer a failing one (forced refresh bypasses both)', async () => {
  store.clear();
  const warp = warpFromEmbedded(); let wikiCalls = 0, nativeCalls = 0;
  const io = at => ({ native: async u => { nativeCalls++; return mockNative([], warp)(u); }, wiki: async () => { wikiCalls++; return ''; }, sleep: async () => {}, now: () => T0 + at });
  const a = await refreshBannerDb(false, io(0));
  assert(a.ok && wikiCalls === 3 && nativeCalls >= 1);                                         // first open: both sources tried, BWiki rejected, HSR stored
  const hsrCalls = nativeCalls, bwCalls = wikiCalls;
  const b = await refreshBannerDb(false, io(10 * 60e3));                                       // 10 min later: BWiki is cooling down, HSR is fresh
  assert(b.ok && b.message === '卡池数据近期已更新' && wikiCalls === bwCalls && nativeCalls === hsrCalls);
  await refreshBannerDb(false, io(40 * 60e3));                                                 // 40 min later: only the failing source is retried
  assert(wikiCalls === bwCalls + 3 && nativeCalls === hsrCalls);
  await refreshBannerDb(false, io(7 * 3600e3));                                                // 7 h later: HSR is due again
  assert(nativeCalls > hsrCalls);
  const n = nativeCalls; await refreshBannerDb(true, io(7 * 3600e3 + 1000));                  // forced
  assert(nativeCalls > n);
});
atest('Live data written by the previous build (only `at`, genshin, zzz) still loads and is merged, and a bad stored value is ignored', async () => {
  const KEY = 'fk-gacha-banners-live-v2';
  store.clear();
  const giRows = getBannerDb().genshin['301'].length, legacyAt = new Date(T0).toISOString();
  store.set(KEY, JSON.stringify({ at: legacyAt, genshin: { '301': [], '302': [] }, zzz: { '2': [], '3': [] } }));
  let wikiCalls = 0;
  const r = await refreshBannerDb(false, { native: mockNative([], warpFromEmbedded()), wiki: async () => { wikiCalls++; return ''; }, sleep: async () => {}, now: () => T0 + 3600e3 });
  assert(r.ok && wikiCalls === 0, JSON.stringify(r));                                            // BWiki is still fresh according to the legacy `at`
  const saved = JSON.parse(store.get(KEY)); assert.equal(saved.at, legacyAt); assert(saved.hsrAt && saved.starrail);
  assert.equal(getBannerDb().genshin['301'].length, giRows);                                      // the rebuilt database merged the legacy value: adds, never deletes
  store.set(KEY, '{not json');                                                                    // corrupt value: treated as "never refreshed"
  const r2 = await refreshBannerDb(false, { native: mockNative([], warpFromEmbedded()), wiki: noWiki, sleep: async () => {}, now: () => T0 });
  assert(r2.ok && JSON.parse(store.get(KEY)).hsrAt);
  store.clear();
});

atest('Concurrent refresh requests share one run (automatic refresh on open + a manual click while it is still running)', async () => {
  store.clear();
  let warpCalls = 0; const warp = warpFromEmbedded();
  const native = async u => { if (u === HSR_WARP) warpCalls++; await new Promise(r => setTimeout(r, 20)); return mockNative([], warp)(u); };
  const io = { native, wiki: noWiki, sleep: async () => {}, now: () => T0 };
  const [a, b] = await Promise.all([refreshBannerDb(false, io), refreshBannerDb(true, io)]);
  assert.equal(a, b); assert.equal(warpCalls, 1);
  await refreshBannerDb(true, io); assert.equal(warpCalls, 2);                                    // once finished, the next request starts a new run
});
atest('A damaged stored value only falls back for the damaged section and never breaks the database', async () => {
  const KEY = 'fk-gacha-banners-live-v2';
  store.clear();
  const base = getBannerDb(), giRows = base.genshin['301'].length, zzRows = base.zzz['2'].length;
  store.set(KEY, JSON.stringify({ genshin: {}, zzz: { '2': 'x', '3': [] }, starrail: { banners: null, names: 5 }, at: 12, hsrAt: {}, tried: 'no' }));
  const warp = warpFromEmbedded(); warp[2903] = { rateup: 9998, start_time: Date.UTC(2026, 9, 20, 2) / 1000, end_time: Date.UTC(2027, 3, 1, 10) / 1000 };
  const r = await refreshBannerDb(false, { native: mockNative([], warp), wiki: noWiki, sleep: async () => {}, now: () => T0 });
  assert(r.ok, JSON.stringify(r));
  const db = getBannerDb();
  assert.equal(db.genshin['301'].length, giRows); assert.equal(db.zzz['2'].length, zzRows);                // damaged sections ignored
  assert(db.starrail.banners['11:2903'], 'the valid new Star Rail section is still applied');
  store.set(KEY, 'null'); const r2 = await refreshBannerDb(true, { native: mockNative([], warp), wiki: noWiki, sleep: async () => {}, now: () => T0 }); assert(r2.ok);
  store.clear();
});

atest('Star Rail names learned by an earlier refresh survive the next one (names are only fetched for unknown items)', async () => {
  store.clear();
  const warp = warpFromEmbedded(); warp[2904] = { rateup: 9999, start_time: Date.UTC(2026, 9, 20, 2) / 1000, end_time: Date.UTC(2027, 4, 1, 10) / 1000 };
  const log = [], io = { native: mockNative(log, warp), wiki: noWiki, sleep: async () => {}, now: () => T0 };
  await refreshBannerDb(true, io);
  assert.equal(getBannerDb().starrail.names['9999'], '新角色甲');
  const fetchedBefore = log.filter(u => u.includes('StarRailRes')).length;
  await refreshBannerDb(true, { ...io, now: () => T0 + 8 * 3600e3 });
  assert.equal(log.filter(u => u.includes('StarRailRes')).length, fetchedBefore);                  // nothing missing → no name downloads
  assert.equal(getBannerDb().starrail.names['9999'], '新角色甲');
  assert.equal(JSON.parse(store.get('fk-gacha-banners-live-v2')).starrail.names['9999'], '新角色甲');
  store.clear();
});

(async () => {
  for (const [name, fn] of later) { await fn(); console.log('PASS ' + name); passed++; }
  console.log(`${passed} evidence/statistics/automatic-resolution/refresh tests + SSR + interval accounting passed.`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
