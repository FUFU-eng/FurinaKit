// Offline game thumbnails (96px WebP, embedded): see docs/gacha-portrait-sources.md.
// Items newer than the bundle fall back to a public icon CDN addressed by the record's own item_id
// (HSR / ZZZ agents). The request carries only the item id – never a UID, record or credential.
import p0 from "./gacha-portrait-0.json";
import p1 from "./gacha-portrait-1.json";
import p2 from "./gacha-portrait-2.json";
import p3 from "./gacha-portrait-3.json";
import p4 from "./gacha-portrait-4.json";
import p5 from "./gacha-portrait-5.json";
import p6 from "./gacha-portrait-6.json";
import p7 from "./gacha-portrait-7.json";
import p8 from "./gacha-portrait-8.json";
import p9 from "./gacha-portrait-9.json";
import p10 from "./gacha-portrait-10.json";
import p11 from "./gacha-portrait-11.json";
import p12 from "./gacha-portrait-12.json";
import p13 from "./gacha-portrait-13.json";
import p14 from "./gacha-portrait-14.json";
import p15 from "./gacha-portrait-15.json";
import p16 from "./gacha-portrait-16.json";
import p17 from "./gacha-portrait-17.json";
import p18 from "./gacha-portrait-18.json";
import p19 from "./gacha-portrait-19.json";
import p20 from "./gacha-portrait-20.json";
import p21 from "./gacha-portrait-21.json";
import p22 from "./gacha-portrait-22.json";
import p23 from "./gacha-portrait-23.json"; // Genshin 6.x–7.x characters / Nod-Krai weapons
import p24 from "./gacha-portrait-24.json"; // Wuthering Waves 3.x
import p25 from "./gacha-portrait-25.json";
const images: Record<string, string> = Object.assign({}, p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25);
const clean = (s: string) => s.replace(/[\s·「」『』“”\-]/g, "");
const normalized: Record<string, string> = {};
for (const [k, v] of Object.entries(images)) normalized[clean(k)] = v;
const aliases: Record<string, string> = { "zzz:星见雅": "zzz:雅", "zzz:月城柳": "zzz:柳", "zzz:浅羽悠真": "zzz:悠真", "zzz:简·杜": "zzz:简", "zzz:猫宫又奈": "zzz:猫又", "zzz:亚历山德丽娜": "zzz:丽娜", "zzz:安比·德玛拉": "zzz:安比", "zzz:妮可·德玛拉": "zzz:妮可", "zzz:冯·莱卡恩": "zzz:莱卡恩", "zzz:凯撒·金": "zzz:凯撒", "ww:漂泊者": "ww:漂泊者·衍射" };

/** Embedded thumbnail only (safe for canvas export). */
export function portrait(game: string, name: string): string | undefined {
  const key = game + ":" + name;
  return images[key] || images[aliases[key]] || normalized[clean(key)];
}

/** Embedded thumbnail, else a public CDN icon derived from the record's item id (UI only). */
export function portraitOrRemote(game: string, name: string, itemId?: string): string | undefined {
  const local = portrait(game, name);
  if (local) return local;
  const id = String(itemId || "");
  if (!/^\d{3,6}$/.test(id)) return undefined;
  if (game === "zzz" && /^1\d{3}$/.test(id)) return `https://act-webstatic.hoyoverse.com/game_record/zzzv2/role_square_avatar/role_square_avatar_${id}.png`;
  if (game === "starrail" && /^1\d{3}$/.test(id)) return `https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/character/${id}.png`;
  if (game === "starrail" && /^2\d{4}$/.test(id)) return `https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/light_cone/${id}.png`;
  return undefined;
}
