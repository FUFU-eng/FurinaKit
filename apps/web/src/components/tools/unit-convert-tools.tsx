"use client";

/**
 * 单位换算（合并了旧的 长度/面积/体积/重量/时间/字节/综合单位转换 七个工具）
 *
 * 数据口径说明（全部取精确值或公认标准值，逐条写在每个单位的 note 里）：
 * - 英制长度/质量：1 in = 25.4 mm、1 lb = 0.45359237 kg 均为**定义值**（精确）；
 * - 国际海里 1852 m、天文单位 149597870700 m、光年 9460730472580800 m 为 IAU 定义值；
 * - 市制：1 尺 = 1/3 m、1 里 = 500 m、1 亩 = 6000/9 m²（= 60 平方丈）等按法定换算；
 * - 数据存储：KB/MB/GB… 是 1000 进制（1 GB = 1e9 B），KiB/MiB/GiB… 是 1024 进制；
 * - 温度**不用系数**，四套刻度（℃ / ℉ / K / °R，另加 °Re）全部走公式先归一到开尔文；
 * - 燃油消耗是倒数关系（L/100km 与 km/L、mpg 互为倒数），单独用公式处理。
 * 参考站（lddgo 在线单位换算）有货币换算，这里**故意不做**：汇率必须联网，
 * 与「纯前端、零依赖、离线可用」的约束冲突，详见交付报告。
 */

import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  Copy,
  Eraser,
  Search,
  Sparkles,
  Star,
  Wand2,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * 1. 数据模型
 * ------------------------------------------------------------------ */

export type UnitDef = {
  key: string;
  /** 中文名 */
  name: string;
  /** 符号 */
  symbol: string;
  /** 相对基准单位的比例：基准值 = 该单位值 × factor（线性类别用） */
  factor?: number;
  /** 非线性类别（温度）用公式代替系数：本单位 → 基准单位 */
  toBase?: (value: number) => number;
  /** 非线性类别用公式代替系数：基准单位 → 本单位 */
  fromBase?: (value: number) => number;
  /** 「本单位 → 基准单位」的可读公式（温度用） */
  formulaTo?: string;
  /** 「基准单位 → 本单位」的可读公式（温度用） */
  formulaFrom?: string;
  /** 依据 / 口径备注（精确值来源） */
  note?: string;
};

export type UnitGroup = { name: string; units: UnitDef[] };

export type UnitCategory = {
  key: string;
  name: string;
  en: string;
  /** 基准单位 key */
  base: string;
  groups: UnitGroup[];
  /** 「填入示例」用的示例 */
  sample: { value: string; unit: string };
  /** 允许负值（负值有物理意义，不再提示） */
  signed?: boolean;
  /** 类别级说明 */
  note?: string;
};

/* ------------------------------------------------------------------ *
 * 2. 单位数据（28 个类别）
 * ------------------------------------------------------------------ */

/** 与中国市制一致：1 尺 = 1/3 m */
const CHI = 1 / 3;

export const UNIT_CATEGORIES: UnitCategory[] = [
  {
    key: "length",
    name: "长度",
    en: "Length",
    base: "m",
    sample: { value: "1", unit: "mi" },
    note: "市制长度按 1 尺 = 1/3 米（1 丈 = 10 尺）换算。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "nm", name: "纳米", symbol: "nm", factor: 1e-9 },
          { key: "um", name: "微米", symbol: "μm", factor: 1e-6 },
          { key: "mm", name: "毫米", symbol: "mm", factor: 0.001 },
          { key: "cm", name: "厘米", symbol: "cm", factor: 0.01 },
          { key: "dm", name: "分米", symbol: "dm", factor: 0.1 },
          { key: "m", name: "米", symbol: "m", factor: 1 },
          { key: "km", name: "千米", symbol: "km", factor: 1000 },
        ],
      },
      {
        name: "英制 / 美制",
        units: [
          { key: "mil", name: "密尔", symbol: "mil", factor: 0.0000254, note: "1 mil = 0.001 英寸" },
          { key: "in", name: "英寸", symbol: "in", factor: 0.0254, note: "定义值，精确：1 in = 25.4 mm" },
          { key: "ft", name: "英尺", symbol: "ft", factor: 0.3048, note: "定义值，精确：1 ft = 12 in" },
          { key: "yd", name: "码", symbol: "yd", factor: 0.9144, note: "定义值，精确：1 yd = 3 ft" },
          { key: "ch", name: "链", symbol: "ch", factor: 20.1168, note: "1 ch = 66 ft" },
          { key: "fur", name: "弗隆", symbol: "fur", factor: 201.168, note: "1 fur = 1/8 英里" },
          { key: "mi", name: "英里", symbol: "mi", factor: 1609.344, note: "定义值，精确：1 mi = 1760 yd" },
          { key: "nmi", name: "海里", symbol: "nMi", factor: 1852, note: "国际海里，精确值 1852 m" },
          { key: "ftm", name: "英寻", symbol: "ftm", factor: 1.8288, note: "1 ftm = 6 ft" },
        ],
      },
      {
        name: "中国市制",
        units: [
          { key: "li", name: "里", symbol: "里", factor: 500, note: "1 里 = 500 米" },
          { key: "zhang", name: "丈", symbol: "丈", factor: 10 * CHI, note: "1 丈 = 10 尺" },
          { key: "chi", name: "尺", symbol: "尺", factor: CHI, note: "1 尺 = 1/3 米" },
          { key: "cun", name: "寸", symbol: "寸", factor: CHI / 10, note: "1 寸 = 1/10 尺" },
          { key: "lifen", name: "分", symbol: "分", factor: CHI / 100 },
          { key: "lilimi", name: "厘", symbol: "厘", factor: CHI / 1000 },
          { key: "lihao", name: "毫", symbol: "毫", factor: CHI / 10000 },
        ],
      },
      {
        name: "天文",
        units: [
          { key: "au", name: "天文单位", symbol: "AU", factor: 149597870700, note: "IAU 2012 定义值" },
          { key: "ly", name: "光年", symbol: "ly", factor: 9460730472580800, note: "儒略年 × 真空光速" },
          { key: "pc", name: "秒差距", symbol: "pc", factor: (149597870700 * 648000) / Math.PI, note: "1 pc = 648000/π AU" },
        ],
      },
    ],
  },
  {
    key: "area",
    name: "面积",
    en: "Area",
    base: "m2",
    sample: { value: "1", unit: "mu" },
    note: "市制面积按 1 亩 = 60 平方丈 = 2000/3 平方米换算。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "nm2", name: "平方纳米", symbol: "nm²", factor: 1e-18 },
          { key: "um2", name: "平方微米", symbol: "μm²", factor: 1e-12 },
          { key: "mm2", name: "平方毫米", symbol: "mm²", factor: 0.000001 },
          { key: "cm2", name: "平方厘米", symbol: "cm²", factor: 0.0001 },
          { key: "dm2", name: "平方分米", symbol: "dm²", factor: 0.01 },
          { key: "m2", name: "平方米", symbol: "m²", factor: 1 },
          { key: "ha", name: "公顷", symbol: "ha", factor: 10000, note: "1 ha = 10000 m²" },
          { key: "km2", name: "平方千米", symbol: "km²", factor: 1000000 },
        ],
      },
      {
        name: "英制 / 美制",
        units: [
          { key: "in2", name: "平方英寸", symbol: "in²", factor: 0.00064516, note: "0.0254² 精确值" },
          { key: "ft2", name: "平方英尺", symbol: "ft²", factor: 0.09290304, note: "0.3048² 精确值" },
          { key: "yd2", name: "平方码", symbol: "yd²", factor: 0.83612736, note: "0.9144² 精确值" },
          { key: "ac", name: "英亩", symbol: "ac", factor: 4046.8564224, note: "1 ac = 4840 yd²" },
          { key: "mi2", name: "平方英里", symbol: "mi²", factor: 2589988.110336, note: "1609.344² 精确值" },
        ],
      },
      {
        name: "中国市制",
        units: [
          { key: "sqli", name: "平方里", symbol: "里²", factor: 250000, note: "500² m²" },
          { key: "qing", name: "顷", symbol: "顷", factor: 200000 / 3, note: "1 顷 = 100 亩" },
          { key: "mu", name: "亩", symbol: "亩", factor: 2000 / 3, note: "1 亩 = 60 平方丈 ≈ 666.6667 m²" },
          { key: "mufen", name: "分", symbol: "分", factor: 200 / 3, note: "1 分 = 1/10 亩" },
          { key: "sqchi", name: "平方尺", symbol: "尺²", factor: CHI * CHI, note: "(1/3)² m²" },
          { key: "sqcun", name: "平方寸", symbol: "寸²", factor: (CHI / 10) * (CHI / 10), note: "(1/30)² m²" },
        ],
      },
    ],
  },
  {
    key: "volume",
    name: "体积 / 容积",
    en: "Volume",
    base: "l",
    sample: { value: "1", unit: "usgal" },
    note: "加仑分英制（4.54609 L）与美制（3.785411784 L），两者不通用。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "mm3", name: "立方毫米", symbol: "mm³", factor: 0.000001 },
          { key: "cm3", name: "立方厘米", symbol: "cm³", factor: 0.001 },
          { key: "ml", name: "毫升", symbol: "mL", factor: 0.001, note: "1 mL = 1 cm³" },
          { key: "dm3", name: "立方分米", symbol: "dm³", factor: 1, note: "1 dm³ = 1 L" },
          { key: "l", name: "升", symbol: "L", factor: 1 },
          { key: "m3", name: "立方米", symbol: "m³", factor: 1000 },
          { key: "km3", name: "立方千米", symbol: "km³", factor: 1e12 },
          { key: "dou", name: "斗", symbol: "斗", factor: 10, note: "市制：1 斗 = 10 升" },
          { key: "dan", name: "石", symbol: "石", factor: 100, note: "市制：1 石 = 10 斗" },
        ],
      },
      {
        name: "英制",
        units: [
          { key: "uktsp", name: "英制茶匙", symbol: "UK tsp", factor: 0.005919388020833333, note: "英制汤匙的 1/3" },
          { key: "uktbs", name: "英制汤匙", symbol: "UK tbsp", factor: 0.0177581640625, note: "英制液盎司的 5/8" },
          { key: "ukoz", name: "英制液盎司", symbol: "UK fl oz", factor: 0.0284130625, note: "英制加仑的 1/160，精确值" },
          { key: "ukcup", name: "英制杯", symbol: "UK cup", factor: 0.284130625, note: "1/2 英制品脱" },
          { key: "ukpt", name: "英制品脱", symbol: "UK pt", factor: 0.56826125, note: "英制加仑的 1/8，精确值" },
          { key: "ukqt", name: "英制夸脱", symbol: "UK qt", factor: 1.1365225, note: "英制加仑的 1/4，精确值" },
          { key: "ukgal", name: "英制加仑", symbol: "UK gal", factor: 4.54609, note: "定义值，精确 4.54609 L" },
          { key: "ukbu", name: "英制蒲式耳", symbol: "UK bu", factor: 36.36872, note: "8 英制加仑，精确值" },
        ],
      },
      {
        name: "美制",
        units: [
          { key: "ustsp", name: "美制茶匙", symbol: "US tsp", factor: 0.00492892159375, note: "美制液盎司的 1/6，精确值" },
          { key: "ustbs", name: "美制汤匙", symbol: "US tbsp", factor: 0.01478676478125, note: "美制液盎司的 1/2，精确值" },
          { key: "usoz", name: "美制液盎司", symbol: "US fl oz", factor: 0.0295735295625, note: "美制加仑的 1/128，精确值" },
          { key: "uscup", name: "美制杯", symbol: "US cup", factor: 0.2365882365, note: "8 美制液盎司，精确值" },
          { key: "uspt", name: "美制品脱", symbol: "US pt", factor: 0.473176473, note: "美制加仑的 1/8，精确值" },
          { key: "usqt", name: "美制夸脱", symbol: "US qt", factor: 0.946352946, note: "美制加仑的 1/4，精确值" },
          { key: "usgal", name: "美制加仑", symbol: "US gal", factor: 3.785411784, note: "定义值，精确 3.785411784 L" },
          { key: "usbbl", name: "美制石油桶", symbol: "bbl", factor: 158.987294928, note: "42 美制加仑，精确值" },
          { key: "usbu", name: "美制蒲式耳", symbol: "US bu", factor: 35.23907016688, note: "2150.42 in³" },
        ],
      },
      {
        name: "立方英制",
        units: [
          { key: "in3", name: "立方英寸", symbol: "in³", factor: 0.016387064, note: "0.0254³ 精确值" },
          { key: "ft3", name: "立方英尺", symbol: "ft³", factor: 28.316846592, note: "0.3048³ 精确值" },
          { key: "yd3", name: "立方码", symbol: "yd³", factor: 764.554857984, note: "0.9144³ 精确值" },
        ],
      },
    ],
  },
  {
    key: "mass",
    name: "质量 / 重量",
    en: "Mass",
    base: "g",
    sample: { value: "1", unit: "jin" },
    note: "市制质量按 1 斤 = 500 克（1 两 = 50 克）换算。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "ug", name: "微克", symbol: "μg", factor: 0.000001 },
          { key: "mg", name: "毫克", symbol: "mg", factor: 0.001 },
          { key: "g", name: "克", symbol: "g", factor: 1 },
          { key: "kg", name: "千克", symbol: "kg", factor: 1000 },
          { key: "t", name: "公吨", symbol: "t", factor: 1000000, note: "1 t = 1000 kg" },
          { key: "kt", name: "千吨", symbol: "kt", factor: 1000000000 },
          { key: "quintal", name: "公担", symbol: "q", factor: 100000, note: "1 q = 100 kg" },
          { key: "ct", name: "克拉", symbol: "ct", factor: 0.2, note: "1 ct = 0.2 g（精确）" },
          { key: "u", name: "原子质量单位", symbol: "u", factor: 1.6605390666e-24, note: "CODATA 2018：1 u = 1.66053906660e-27 kg" },
        ],
      },
      {
        name: "英制 / 美制",
        units: [
          { key: "gr", name: "格令", symbol: "gr", factor: 0.06479891, note: "1/7000 磅，精确值" },
          { key: "dr", name: "打兰", symbol: "dr", factor: 1.7718451953125, note: "1/16 盎司，精确值" },
          { key: "oz", name: "盎司", symbol: "oz", factor: 28.349523125, note: "1/16 磅，精确值" },
          { key: "lb", name: "磅", symbol: "lb", factor: 453.59237, note: "定义值，精确 0.45359237 kg" },
          { key: "st", name: "英石", symbol: "st", factor: 6350.29318, note: "14 磅" },
          { key: "qr", name: "夸特", symbol: "qr", factor: 12700.58636, note: "英制 28 磅" },
          { key: "cwt", name: "英担", symbol: "cwt", factor: 50802.34544, note: "英制 112 磅" },
          { key: "longton", name: "长吨", symbol: "long ton", factor: 1016046.9088, note: "2240 磅" },
          { key: "shortton", name: "短吨", symbol: "short ton", factor: 907184.74, note: "美制 2000 磅" },
        ],
      },
      {
        name: "中国市制",
        units: [
          { key: "dan", name: "担", symbol: "担", factor: 50000, note: "1 担 = 100 斤" },
          { key: "jin", name: "斤", symbol: "斤", factor: 500, note: "1 斤 = 500 克（精确）" },
          { key: "liang", name: "两", symbol: "两", factor: 50, note: "1 两 = 50 克（精确）" },
          { key: "qian", name: "钱", symbol: "钱", factor: 5, note: "1 钱 = 5 克（精确）" },
        ],
      },
    ],
  },
  {
    key: "temperature",
    name: "温度",
    en: "Temperature",
    base: "k",
    signed: true,
    sample: { value: "100", unit: "c" },
    note: "温度不是按比例缩放的量，全部用公式先换算到开尔文再换出，不用系数。",
    groups: [
      {
        name: "温标",
        units: [
          {
            key: "c",
            name: "摄氏度",
            symbol: "℃",
            toBase: (v) => v + 273.15,
            fromBase: (k) => k - 273.15,
            formulaTo: "K = ℃ + 273.15",
            formulaFrom: "℃ = K − 273.15",
          },
          {
            key: "f",
            name: "华氏度",
            symbol: "℉",
            toBase: (v) => ((v + 459.67) * 5) / 9,
            fromBase: (k) => (k * 9) / 5 - 459.67,
            formulaTo: "K = (℉ + 459.67) × 5/9",
            formulaFrom: "℉ = K × 9/5 − 459.67",
          },
          {
            key: "k",
            name: "开尔文",
            symbol: "K",
            toBase: (v) => v,
            fromBase: (k) => k,
            formulaTo: "K = K",
            formulaFrom: "K = K",
          },
          {
            key: "r",
            name: "兰氏度",
            symbol: "°R",
            toBase: (v) => (v * 5) / 9,
            fromBase: (k) => (k * 9) / 5,
            formulaTo: "K = °R × 5/9",
            formulaFrom: "°R = K × 9/5",
          },
          {
            key: "re",
            name: "列氏度",
            symbol: "°Re",
            toBase: (v) => (v * 5) / 4 + 273.15,
            fromBase: (k) => ((k - 273.15) * 4) / 5,
            formulaTo: "K = °Re × 5/4 + 273.15",
            formulaFrom: "°Re = (K − 273.15) × 4/5",
          },
        ],
      },
    ],
  },
  {
    key: "time",
    name: "时间",
    en: "Time",
    base: "s",
    sample: { value: "1", unit: "day" },
    note: "年按儒略年（365.25 天）计，月取儒略年的 1/12。",
    groups: [
      {
        name: "常用",
        units: [
          { key: "as", name: "阿秒", symbol: "as", factor: 1e-18 },
          { key: "fs", name: "飞秒", symbol: "fs", factor: 1e-15 },
          { key: "ps", name: "皮秒", symbol: "ps", factor: 1e-12 },
          { key: "ns", name: "纳秒", symbol: "ns", factor: 1e-9 },
          { key: "us", name: "微秒", symbol: "μs", factor: 0.000001 },
          { key: "ms", name: "毫秒", symbol: "ms", factor: 0.001 },
          { key: "s", name: "秒", symbol: "s", factor: 1 },
          { key: "min", name: "分", symbol: "min", factor: 60 },
          { key: "h", name: "时", symbol: "h", factor: 3600 },
          { key: "day", name: "天", symbol: "d", factor: 86400 },
          { key: "week", name: "周", symbol: "wk", factor: 604800 },
        ],
      },
      {
        name: "历法",
        units: [
          { key: "month", name: "月", symbol: "mo", factor: 2629800, note: "儒略年的 1/12（30.4375 天）" },
          { key: "year", name: "年", symbol: "a", factor: 31557600, note: "儒略年 = 365.25 天" },
          { key: "decade", name: "十年", symbol: "decade", factor: 315576000 },
          { key: "century", name: "世纪", symbol: "century", factor: 3155760000 },
        ],
      },
    ],
  },
  {
    key: "speed",
    name: "速度",
    en: "Speed",
    base: "mps",
    sample: { value: "100", unit: "kmh" },
    note: "马赫按 15 ℃ 标准大气声速 340.3 m/s 计。",
    groups: [
      {
        name: "常用",
        units: [
          { key: "cmps", name: "厘米每秒", symbol: "cm/s", factor: 0.01 },
          { key: "mps", name: "米每秒", symbol: "m/s", factor: 1 },
          { key: "kmh", name: "千米每时", symbol: "km/h", factor: 1 / 3.6, note: "精确值：1 km/h = 1/3.6 m/s" },
          { key: "kmps", name: "千米每秒", symbol: "km/s", factor: 1000 },
          { key: "mph", name: "英里每时", symbol: "mph", factor: 0.44704, note: "定义值，精确" },
          { key: "fps", name: "英尺每秒", symbol: "ft/s", factor: 0.3048, note: "定义值，精确" },
          { key: "ftmin", name: "英尺每分", symbol: "ft/min", factor: 0.00508, note: "定义值，精确" },
          { key: "ips", name: "英寸每秒", symbol: "in/s", factor: 0.0254, note: "定义值，精确" },
          { key: "kn", name: "节", symbol: "kn", factor: 1852 / 3600, note: "1 海里/小时 = 1.852 km/h 精确" },
          { key: "mach", name: "马赫", symbol: "Ma", factor: 340.3, note: "15 ℃ 海平面声速" },
          { key: "c", name: "光速", symbol: "c", factor: 299792458, note: "真空光速，定义值精确" },
        ],
      },
    ],
  },
  {
    key: "acceleration",
    name: "加速度",
    en: "Acceleration",
    base: "mps2",
    sample: { value: "1", unit: "g0" },
    groups: [
      {
        name: "加速度",
        units: [
          { key: "mps2", name: "米每二次方秒", symbol: "m/s²", factor: 1 },
          { key: "g0", name: "重力加速度", symbol: "g", factor: 9.80665, note: "标准重力加速度，定义值精确" },
          { key: "fps2", name: "英尺每二次方秒", symbol: "ft/s²", factor: 0.3048, note: "定义值，精确" },
          { key: "ips2", name: "英寸每二次方秒", symbol: "in/s²", factor: 0.0254, note: "定义值，精确" },
          { key: "gal", name: "伽", symbol: "Gal", factor: 0.01, note: "1 Gal = 0.01 m/s²" },
        ],
      },
    ],
  },
  {
    key: "pressure",
    name: "压力 / 压强",
    en: "Pressure",
    base: "pa",
    sample: { value: "1", unit: "atm" },
    note: "psi 等英制单位按 lbf/in² 计算；水柱按 4 ℃、汞柱按 0 ℃ 的常规值。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "pa", name: "帕", symbol: "Pa", factor: 1 },
          { key: "hpa", name: "百帕", symbol: "hPa", factor: 100 },
          { key: "kpa", name: "千帕", symbol: "kPa", factor: 1000 },
          { key: "mpa", name: "兆帕", symbol: "MPa", factor: 1000000 },
          { key: "gpa", name: "吉帕", symbol: "GPa", factor: 1000000000 },
          { key: "bar", name: "巴", symbol: "bar", factor: 100000, note: "1 bar = 100000 Pa 精确" },
          { key: "mbar", name: "毫巴", symbol: "mbar", factor: 100 },
          { key: "ubar", name: "微巴", symbol: "μbar", factor: 0.1 },
        ],
      },
      {
        name: "常用 / 标准大气",
        units: [
          { key: "atm", name: "标准大气压", symbol: "atm", factor: 101325, note: "定义值，精确 101325 Pa" },
          { key: "at", name: "工程大气压", symbol: "at", factor: 98066.5, note: "1 kgf/cm²" },
          { key: "torr", name: "托", symbol: "Torr", factor: 101325 / 760, note: "1 atm 的 1/760，精确" },
          { key: "mmhg", name: "毫米汞柱", symbol: "mmHg", factor: 133.322387415, note: "0 ℃ 常规值" },
          { key: "cmhg", name: "厘米汞柱", symbol: "cmHg", factor: 1333.22387415 },
          { key: "inhg", name: "英寸汞柱", symbol: "inHg", factor: 3386.389, note: "32 ℉ 常规值" },
          { key: "mmh2o", name: "毫米水柱", symbol: "mmH₂O", factor: 9.80665, note: "4 ℃ 常规值" },
          { key: "cmh2o", name: "厘米水柱", symbol: "cmH₂O", factor: 98.0665 },
          { key: "inh2o", name: "英寸水柱", symbol: "inH₂O", factor: 249.08891, note: "4 ℃ 常规值" },
          { key: "fth2o", name: "英尺水柱", symbol: "ftH₂O", factor: 2989.06692 },
        ],
      },
      {
        name: "英制 / 美制",
        units: [
          { key: "psi", name: "磅力每平方英寸", symbol: "psi", factor: 6894.757293168361, note: "lbf/in² 精确推导" },
          { key: "ksi", name: "千磅力每平方英寸", symbol: "ksi", factor: 6894757.293168361 },
          { key: "psf", name: "磅力每平方英尺", symbol: "psf", factor: 47.88025898033584, note: "lbf/ft² 精确推导" },
        ],
      },
      {
        name: "力学",
        units: [
          { key: "nm2p", name: "牛顿每平方米", symbol: "N/m²", factor: 1 },
          { key: "ncm2", name: "牛顿每平方厘米", symbol: "N/cm²", factor: 10000 },
          { key: "nmm2", name: "牛顿每平方毫米", symbol: "N/mm²", factor: 1000000 },
          { key: "kgfm2", name: "千克力每平方米", symbol: "kgf/m²", factor: 9.80665 },
          { key: "kgfcm2", name: "千克力每平方厘米", symbol: "kgf/cm²", factor: 98066.5 },
          { key: "dyncm2", name: "达因每平方厘米", symbol: "dyn/cm²", factor: 0.1, note: "1 dyn/cm² = 1 Ba" },
        ],
      },
    ],
  },
  {
    key: "energy",
    name: "能量 / 功",
    en: "Energy",
    base: "j",
    signed: true,
    sample: { value: "1", unit: "kwh" },
    note: "卡路里用热化学卡（4.184 J 精确），英热单位用 IT 值。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "j", name: "焦耳", symbol: "J", factor: 1 },
          { key: "kj", name: "千焦", symbol: "kJ", factor: 1000 },
          { key: "mj", name: "兆焦", symbol: "MJ", factor: 1000000 },
          { key: "gj", name: "吉焦", symbol: "GJ", factor: 1000000000 },
          { key: "erg", name: "尔格", symbol: "erg", factor: 1e-7, note: "1 erg = 1e-7 J 精确" },
          { key: "ev", name: "电子伏特", symbol: "eV", factor: 1.602176634e-19, note: "SI 2019 定义值精确" },
        ],
      },
      {
        name: "电 / 热",
        units: [
          { key: "wh", name: "瓦时", symbol: "Wh", factor: 3600 },
          { key: "kwh", name: "千瓦时", symbol: "kWh", factor: 3600000, note: "俗称「度」" },
          { key: "mwh", name: "兆瓦时", symbol: "MWh", factor: 3600000000 },
          { key: "gwh", name: "吉瓦时", symbol: "GWh", factor: 3600000000000 },
          { key: "cal", name: "卡路里", symbol: "cal", factor: 4.184, note: "热化学卡，定义值精确" },
          { key: "kcal", name: "千卡路里", symbol: "kcal", factor: 4184, note: "俗称「大卡」" },
          { key: "tnt", name: "吨 TNT", symbol: "tTNT", factor: 4184000000, note: "定义值 4.184 GJ 精确" },
        ],
      },
      {
        name: "英制",
        units: [
          { key: "btu", name: "英热单位", symbol: "BTU", factor: 1055.05585262, note: "IT 值，精确" },
          { key: "ftlb", name: "英尺磅", symbol: "ft·lbf", factor: 1.3558179483314004, note: "0.3048 × 4.4482216152605 精确" },
          { key: "hph", name: "英制马力时", symbol: "hp·h", factor: 2684519.537696174, note: "550 ft·lbf/s × 3600 s" },
        ],
      },
      {
        name: "其他",
        units: [
          { key: "nmw", name: "牛米", symbol: "N·m", factor: 1, note: "做功意义上的 J" },
          { key: "psh", name: "公制马力时", symbol: "PS·h", factor: 2647795.5, note: "75 kgf·m/s × 3600 s 精确" },
        ],
      },
    ],
  },
  {
    key: "power",
    name: "功率",
    en: "Power",
    base: "w",
    signed: true,
    sample: { value: "1", unit: "hp" },
    note: "马力分公制（PS，735.49875 W）与英制（hp，550 ft·lbf/s），数值不同。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "mw", name: "毫瓦", symbol: "mW", factor: 0.001 },
          { key: "w", name: "瓦", symbol: "W", factor: 1 },
          { key: "kw", name: "千瓦", symbol: "kW", factor: 1000 },
          { key: "mwatt", name: "兆瓦", symbol: "MW", factor: 1000000 },
          { key: "gw", name: "吉瓦", symbol: "GW", factor: 1000000000 },
          { key: "ps", name: "公制马力", symbol: "PS", factor: 735.49875, note: "75 kgf·m/s，精确值" },
        ],
      },
      {
        name: "英制 / 其他",
        units: [
          { key: "hp", name: "英制马力", symbol: "hp", factor: 745.6998715822702, note: "550 ft·lbf/s，精确推导" },
          { key: "hpe", name: "电马力", symbol: "hp(E)", factor: 746, note: "定义值 746 W 精确" },
          { key: "btus", name: "英热单位每秒", symbol: "BTU/s", factor: 1055.05585262 },
          { key: "btuh", name: "英热单位每时", symbol: "BTU/h", factor: 1055.05585262 / 3600 },
          { key: "ftlbs", name: "英尺磅每秒", symbol: "ft·lbf/s", factor: 1.3558179483314004 },
          { key: "cals", name: "卡每秒", symbol: "cal/s", factor: 4.184 },
          { key: "kcals", name: "千卡每秒", symbol: "kcal/s", factor: 4184 },
          { key: "kcalsh", name: "千卡每时", symbol: "kcal/h", factor: 1.163, note: "1 kcal/h = 1.163 W 精确" },
          { key: "rt", name: "冷吨", symbol: "RT", factor: 3516.8528420666666, note: "12000 BTU/h" },
        ],
      },
    ],
  },
  {
    key: "force",
    name: "力",
    en: "Force",
    base: "n",
    sample: { value: "1", unit: "kgf" },
    groups: [
      {
        name: "力",
        units: [
          { key: "n", name: "牛顿", symbol: "N", factor: 1 },
          { key: "kn", name: "千牛", symbol: "kN", factor: 1000 },
          { key: "dyn", name: "达因", symbol: "dyn", factor: 1e-5, note: "1 dyn = 1e-5 N 精确" },
          { key: "kgf", name: "千克力", symbol: "kgf", factor: 9.80665, note: "标准重力 × 1 kg，精确" },
          { key: "gf", name: "克力", symbol: "gf", factor: 0.00980665 },
          { key: "tf", name: "吨力", symbol: "tf", factor: 9806.65 },
          { key: "lbf", name: "磅力", symbol: "lbf", factor: 4.4482216152605, note: "0.45359237 × 9.80665 精确" },
          { key: "ozf", name: "盎司力", symbol: "ozf", factor: 0.27801385095378125, note: "lbf 的 1/16" },
          { key: "kip", name: "千磅力", symbol: "kip", factor: 4448.2216152605, note: "1000 lbf" },
          { key: "pdl", name: "磅达", symbol: "pdl", factor: 0.138254954376, note: "1 lb·ft/s²，精确" },
        ],
      },
    ],
  },
  {
    key: "angle",
    name: "角度",
    en: "Angle",
    base: "deg",
    sample: { value: "90", unit: "deg" },
    note: "密位分北约制（1/6400 圈）与中国制（1/6000 圈），数值不同。",
    groups: [
      {
        name: "常用",
        units: [
          { key: "deg", name: "度", symbol: "°", factor: 1 },
          { key: "rad", name: "弧度", symbol: "rad", factor: 180 / Math.PI, note: "1 rad = 180/π 度" },
          { key: "arcmin", name: "角分", symbol: "′", factor: 1 / 60, note: "1° 的 1/60" },
          { key: "arcsec", name: "角秒", symbol: "″", factor: 1 / 3600, note: "1° 的 1/3600" },
          { key: "mas", name: "毫角秒", symbol: "mas", factor: 1 / 3600000 },
          { key: "uas", name: "微角秒", symbol: "μas", factor: 1 / 3600000000 },
        ],
      },
      {
        name: "其他刻度",
        units: [
          { key: "turn", name: "圈", symbol: "turn", factor: 360, note: "1 整圈 = 360°" },
          { key: "grad", name: "梯度", symbol: "grad", factor: 0.9, note: "1 直角 = 100 grad" },
          { key: "gon", name: "百分度", symbol: "gon", factor: 0.9, note: "与梯度同值" },
          { key: "quad", name: "象限", symbol: "quadrant", factor: 90 },
          { key: "right", name: "直角", symbol: "∟", factor: 90 },
          { key: "sextant", name: "六分仪度", symbol: "sextant", factor: 60, note: "1/6 圈" },
          { key: "ha", name: "时角", symbol: "HA", factor: 15, note: "1 小时时角 = 15°" },
          { key: "point", name: "罗经点", symbol: "point", factor: 11.25, note: "1/32 圈" },
          { key: "milnato", name: "密位（北约）", symbol: "mil", factor: 360 / 6400, note: "1/6400 圈" },
          { key: "milcn", name: "密位（中国）", symbol: "mil", factor: 360 / 6000, note: "1/6000 圈" },
        ],
      },
    ],
  },
  {
    key: "data",
    name: "数据存储",
    en: "Data",
    base: "b",
    sample: { value: "1", unit: "gb" },
    note: "KB/MB/GB 是 1000 进制，KiB/MiB/GiB 是 1024 进制（i 表示 binary），两套口径不能混用。",
    groups: [
      {
        name: "通用",
        units: [
          { key: "bit", name: "比特", symbol: "bit", factor: 0.125, note: "1 B = 8 bit" },
          { key: "b", name: "字节", symbol: "B", factor: 1 },
          { key: "nibble", name: "半字节", symbol: "nibble", factor: 0.5, note: "4 bit" },
        ],
      },
      {
        name: "1024 进制（KiB / MiB / GiB）",
        units: [
          { key: "kibit", name: "Kibibit", symbol: "Kibit", factor: 128, note: "1024 bit" },
          { key: "kib", name: "Kibibyte", symbol: "KiB", factor: 1024, note: "1024 B" },
          { key: "mibit", name: "Mebibit", symbol: "Mibit", factor: 131072 },
          { key: "mib", name: "Mebibyte", symbol: "MiB", factor: 1048576, note: "1024 KiB" },
          { key: "gibit", name: "Gibibit", symbol: "Gibit", factor: 134217728 },
          { key: "gib", name: "Gibibyte", symbol: "GiB", factor: 1073741824, note: "1024 MiB" },
          { key: "tibit", name: "Tebibit", symbol: "Tibit", factor: 137438953472 },
          { key: "tib", name: "Tebibyte", symbol: "TiB", factor: 1099511627776 },
          { key: "pib", name: "Pebibyte", symbol: "PiB", factor: 1125899906842624 },
          { key: "eib", name: "Exbibyte", symbol: "EiB", factor: 1152921504606846976 },
        ],
      },
      {
        name: "1000 进制（KB / MB / GB）",
        units: [
          { key: "kbit", name: "千比特", symbol: "kbit", factor: 125, note: "1000 bit" },
          { key: "kb", name: "千字节", symbol: "KB", factor: 1000, note: "1000 B（本工具中 KB 只表示 1000 进制）" },
          { key: "mbit", name: "兆比特", symbol: "Mbit", factor: 125000 },
          { key: "mb", name: "兆字节", symbol: "MB", factor: 1000000 },
          { key: "gbit", name: "吉比特", symbol: "Gbit", factor: 125000000 },
          { key: "gb", name: "吉字节", symbol: "GB", factor: 1000000000 },
          { key: "tbit", name: "太比特", symbol: "Tbit", factor: 125000000000 },
          { key: "tb", name: "太字节", symbol: "TB", factor: 1000000000000 },
          { key: "pb", name: "拍字节", symbol: "PB", factor: 1000000000000000 },
          { key: "eb", name: "艾字节", symbol: "EB", factor: 1000000000000000000 },
        ],
      },
    ],
  },
  {
    key: "bandwidth",
    name: "带宽 / 传输速率",
    en: "Bandwidth",
    base: "bps",
    sample: { value: "100", unit: "mbps" },
    note: "网络标称速率是 1000 进制（1 Mbit/s = 1e6 bit/s），KiB/s 一类走 1024 进制。",
    groups: [
      {
        name: "1000 进制",
        units: [
          { key: "bps", name: "比特每秒", symbol: "bit/s", factor: 1 },
          { key: "kbps", name: "千比特每秒", symbol: "kbit/s", factor: 1000 },
          { key: "mbps", name: "兆比特每秒", symbol: "Mbit/s", factor: 1000000 },
          { key: "gbps", name: "吉比特每秒", symbol: "Gbit/s", factor: 1000000000 },
          { key: "tbps", name: "太比特每秒", symbol: "Tbit/s", factor: 1000000000000 },
          { key: "Bps", name: "字节每秒", symbol: "B/s", factor: 8, note: "1 B/s = 8 bit/s" },
          { key: "kBps", name: "千字节每秒", symbol: "KB/s", factor: 8000 },
          { key: "MBps", name: "兆字节每秒", symbol: "MB/s", factor: 8000000 },
          { key: "GBps", name: "吉字节每秒", symbol: "GB/s", factor: 8000000000 },
          { key: "TBps", name: "太字节每秒", symbol: "TB/s", factor: 8000000000000 },
        ],
      },
      {
        name: "1024 进制",
        units: [
          { key: "Kibits", name: "Kibibit 每秒", symbol: "Kibit/s", factor: 1024 },
          { key: "Mibits", name: "Mebibit 每秒", symbol: "Mibit/s", factor: 1048576 },
          { key: "Gibits", name: "Gibibit 每秒", symbol: "Gibit/s", factor: 1073741824 },
          { key: "Kibs", name: "Kibibyte 每秒", symbol: "KiB/s", factor: 8192 },
          { key: "Mibs", name: "Mebibyte 每秒", symbol: "MiB/s", factor: 8388608 },
          { key: "Gibs", name: "Gibibyte 每秒", symbol: "GiB/s", factor: 8589934592 },
          { key: "Tibs", name: "Tebibyte 每秒", symbol: "TiB/s", factor: 8796093022208 },
        ],
      },
    ],
  },
  {
    key: "frequency",
    name: "频率",
    en: "Frequency",
    base: "hz",
    sample: { value: "1", unit: "ghz" },
    groups: [
      {
        name: "频率",
        units: [
          { key: "mhz", name: "毫赫兹", symbol: "mHz", factor: 0.001 },
          { key: "hz", name: "赫兹", symbol: "Hz", factor: 1 },
          { key: "khz", name: "千赫兹", symbol: "kHz", factor: 1000 },
          { key: "mhz2", name: "兆赫兹", symbol: "MHz", factor: 1000000 },
          { key: "ghz", name: "吉赫兹", symbol: "GHz", factor: 1000000000 },
          { key: "thz", name: "太赫兹", symbol: "THz", factor: 1000000000000 },
          { key: "rpm", name: "转每分", symbol: "rpm", factor: 1 / 60, note: "1 rpm = 1/60 Hz 精确" },
          { key: "degs", name: "度每秒", symbol: "°/s", factor: 1 / 360 },
          { key: "rads", name: "弧度每秒", symbol: "rad/s", factor: 1 / (2 * Math.PI) },
        ],
      },
    ],
  },
  {
    key: "illuminance",
    name: "光照度",
    en: "Illuminance",
    base: "lx",
    sample: { value: "500", unit: "lx" },
    groups: [
      {
        name: "光照度",
        units: [
          { key: "nox", name: "诺克斯", symbol: "nox", factor: 0.001, note: "1 nox = 1e-3 lx" },
          { key: "mlx", name: "毫勒克斯", symbol: "mlx", factor: 0.001 },
          { key: "lx", name: "勒克斯", symbol: "lx", factor: 1, note: "1 lx = 1 lm/m²" },
          { key: "lmm2", name: "流明每平方米", symbol: "lm/m²", factor: 1 },
          { key: "klx", name: "千勒克斯", symbol: "klx", factor: 1000 },
          { key: "ph", name: "辐透", symbol: "ph", factor: 10000, note: "1 ph = 1e4 lx" },
          { key: "fc", name: "英尺烛光", symbol: "fc", factor: 1 / 0.09290304, note: "1 lm/ft²，精确推导" },
        ],
      },
    ],
  },
  {
    key: "fuel",
    name: "燃油消耗",
    en: "Fuel Consumption",
    base: "kmpl",
    sample: { value: "8", unit: "l100" },
    note: "L/100km 与 km/L、mpg 是倒数关系（不是比例），0 与负数无法换算。",
    groups: [
      {
        name: "燃油消耗",
        units: [
          {
            key: "l100",
            name: "升每百千米",
            symbol: "L/100km",
            toBase: (v) => (v === 0 ? NaN : 100 / v),
            fromBase: (b) => (b === 0 ? NaN : 100 / b),
            formulaTo: "km/L = 100 ÷ (L/100km)",
            formulaFrom: "L/100km = 100 ÷ (km/L)",
            note: "国内常用口径",
          },
          { key: "kmpl", name: "千米每升", symbol: "km/L", factor: 1 },
          { key: "mpl", name: "英里每升", symbol: "mi/L", factor: 1.609344, note: "1 mi = 1.609344 km" },
          {
            key: "mpgus",
            name: "英里每加仑（美制）",
            symbol: "mpg (US)",
            factor: 1.609344 / 3.785411784,
            note: "1.609344 ÷ 3.785411784，精确推导",
          },
          {
            key: "mpguk",
            name: "英里每加仑（英制）",
            symbol: "mpg (UK)",
            factor: 1.609344 / 4.54609,
            note: "1.609344 ÷ 4.54609，精确推导",
          },
        ],
      },
    ],
  },
  {
    key: "kinematic-viscosity",
    name: "运动黏度",
    en: "Kinematic Viscosity",
    base: "m2s",
    sample: { value: "1", unit: "cst" },
    note: "1 St（斯）= 1 cm²/s，1 cSt（厘斯）= 1 mm²/s。",
    groups: [
      {
        name: "运动黏度",
        units: [
          { key: "mm2s", name: "平方毫米每秒", symbol: "mm²/s", factor: 0.000001, note: "等于 1 cSt" },
          { key: "cst", name: "厘斯", symbol: "cSt", factor: 0.000001 },
          { key: "cm2s", name: "平方厘米每秒", symbol: "cm²/s", factor: 0.0001, note: "等于 1 St" },
          { key: "st", name: "斯", symbol: "St", factor: 0.0001 },
          { key: "m2s", name: "平方米每秒", symbol: "m²/s", factor: 1 },
          { key: "in2s", name: "平方英寸每秒", symbol: "in²/s", factor: 0.00064516, note: "0.0254² 精确" },
          { key: "ft2s", name: "平方英尺每秒", symbol: "ft²/s", factor: 0.09290304, note: "0.3048² 精确" },
        ],
      },
    ],
  },
  {
    key: "dynamic-viscosity",
    name: "动力黏度",
    en: "Dynamic Viscosity",
    base: "pas",
    sample: { value: "1", unit: "cp" },
    note: "1 P（泊）= 0.1 Pa·s，1 cP（厘泊）= 1 mPa·s。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "mpas", name: "毫帕秒", symbol: "mPa·s", factor: 0.001 },
          { key: "cp", name: "厘泊", symbol: "cP", factor: 0.001 },
          { key: "pas", name: "帕秒", symbol: "Pa·s", factor: 1 },
          { key: "nsm2", name: "牛秒每平方米", symbol: "N·s/m²", factor: 1 },
          { key: "kgms", name: "千克每米秒", symbol: "kg/(m·s)", factor: 1 },
          { key: "p", name: "泊", symbol: "P", factor: 0.1 },
          { key: "gcms", name: "克每厘米秒", symbol: "g/(cm·s)", factor: 0.1 },
          { key: "dynscm2", name: "达因秒每平方厘米", symbol: "dyn·s/cm²", factor: 0.1 },
          { key: "kgfsm2", name: "千克力秒每平方米", symbol: "kgf·s/m²", factor: 9.80665 },
        ],
      },
      {
        name: "英制",
        units: [
          { key: "lbfts", name: "磅每英尺秒", symbol: "lb/(ft·s)", factor: 1.4881639435695537, note: "0.45359237 ÷ 0.3048 精确" },
          { key: "lbfths", name: "磅每英尺时", symbol: "lb/(ft·h)", factor: 0.0004133788732137649 },
          { key: "pdlft2", name: "磅达秒每平方英尺", symbol: "pdl·s/ft²", factor: 1.4881639435695537 },
          { key: "lbfsft2", name: "磅力秒每平方英尺", symbol: "lbf·s/ft²", factor: 47.88025898033584 },
          { key: "lbfsin2", name: "磅力秒每平方英寸", symbol: "lbf·s/in²", factor: 6894.757293168361 },
        ],
      },
    ],
  },
  {
    key: "density",
    name: "密度",
    en: "Density",
    base: "kgm3",
    sample: { value: "1", unit: "gcm3" },
    groups: [
      {
        name: "公制",
        units: [
          { key: "ugl", name: "微克每升", symbol: "μg/L", factor: 0.000001 },
          { key: "mgl", name: "毫克每升", symbol: "mg/L", factor: 0.001 },
          { key: "gl", name: "克每升", symbol: "g/L", factor: 1 },
          { key: "kgm3", name: "千克每立方米", symbol: "kg/m³", factor: 1 },
          { key: "gcm3", name: "克每立方厘米", symbol: "g/cm³", factor: 1000, note: "即 g/mL = t/m³" },
          { key: "kgdm3", name: "千克每立方分米", symbol: "kg/dm³", factor: 1000 },
          { key: "kgl", name: "千克每升", symbol: "kg/L", factor: 1000 },
          { key: "tm3", name: "吨每立方米", symbol: "t/m³", factor: 1000 },
        ],
      },
      {
        name: "英制 / 美制",
        units: [
          { key: "lbft3", name: "磅每立方英尺", symbol: "lb/ft³", factor: 16.018463373960138, note: "0.45359237 ÷ 0.028316846592 精确" },
          { key: "lbin3", name: "磅每立方英寸", symbol: "lb/in³", factor: 27679.904710203125, note: "0.45359237 ÷ 1.6387064e-5 精确" },
          { key: "ozin3", name: "盎司每立方英寸", symbol: "oz/in³", factor: 1729.9940443876953 },
          { key: "lbgalus", name: "磅每加仑（美制）", symbol: "lb/gal (US)", factor: 0.45359237 / 3.785411784, note: "精确推导" },
          { key: "lbgaluk", name: "磅每加仑（英制）", symbol: "lb/gal (UK)", factor: 0.45359237 / 4.54609, note: "精确推导" },
          { key: "slugft3", name: "斯勒格每立方英尺", symbol: "slug/ft³", factor: 515.3788183932017 },
        ],
      },
    ],
  },
  {
    key: "flow",
    name: "体积流量",
    en: "Flow",
    base: "ls",
    sample: { value: "1", unit: "m3h" },
    note: "加仑分美制（3.785411784 L）与英制（4.54609 L）。",
    groups: [
      {
        name: "公制",
        units: [
          { key: "mls", name: "毫升每秒", symbol: "mL/s", factor: 0.001 },
          { key: "ls", name: "升每秒", symbol: "L/s", factor: 1 },
          { key: "lmin", name: "升每分", symbol: "L/min", factor: 1 / 60 },
          { key: "lh", name: "升每时", symbol: "L/h", factor: 1 / 3600 },
          { key: "m3h", name: "立方米每时", symbol: "m³/h", factor: 1000 / 3600 },
          { key: "m3min", name: "立方米每分", symbol: "m³/min", factor: 1000 / 60 },
          { key: "m3s", name: "立方米每秒", symbol: "m³/s", factor: 1000 },
          { key: "m3d", name: "立方米每天", symbol: "m³/d", factor: 1000 / 86400 },
        ],
      },
      {
        name: "英制 / 美制",
        units: [
          { key: "ft3s", name: "立方英尺每秒", symbol: "ft³/s", factor: 28.316846592, note: "0.3048³ 精确" },
          { key: "ft3min", name: "立方英尺每分", symbol: "ft³/min", factor: 28.316846592 / 60 },
          { key: "gpmus", name: "加仑每分（美制）", symbol: "gal/min (US)", factor: 3.785411784 / 60, note: "精确推导" },
          { key: "gpmuk", name: "加仑每分（英制）", symbol: "gal/min (UK)", factor: 4.54609 / 60, note: "精确推导" },
          { key: "bblusd", name: "石油桶每天（美制）", symbol: "bbl/d", factor: 158.987294928 / 86400 },
          { key: "bblusmin", name: "石油桶每分（美制）", symbol: "bbl/min", factor: 158.987294928 / 60 },
        ],
      },
    ],
  },
  {
    key: "current",
    name: "电流",
    en: "Current",
    base: "a",
    signed: true,
    sample: { value: "1", unit: "a" },
    groups: [
      {
        name: "电流",
        units: [
          { key: "na", name: "纳安培", symbol: "nA", factor: 1e-9 },
          { key: "ua", name: "微安培", symbol: "μA", factor: 0.000001 },
          { key: "ma", name: "毫安培", symbol: "mA", factor: 0.001 },
          { key: "a", name: "安培", symbol: "A", factor: 1 },
          { key: "ka", name: "千安培", symbol: "kA", factor: 1000 },
        ],
      },
    ],
  },
  {
    key: "voltage",
    name: "电压",
    en: "Voltage",
    base: "v",
    signed: true,
    sample: { value: "220", unit: "v" },
    groups: [
      {
        name: "电压",
        units: [
          { key: "uv", name: "微伏特", symbol: "μV", factor: 0.000001 },
          { key: "mv", name: "毫伏特", symbol: "mV", factor: 0.001 },
          { key: "v", name: "伏特", symbol: "V", factor: 1 },
          { key: "kv", name: "千伏特", symbol: "kV", factor: 1000 },
          { key: "mvv", name: "兆伏特", symbol: "MV", factor: 1000000 },
        ],
      },
    ],
  },
  {
    key: "resistance",
    name: "电阻",
    en: "Resistance",
    base: "ohm",
    sample: { value: "1", unit: "kohm" },
    groups: [
      {
        name: "电阻",
        units: [
          { key: "uohm", name: "微欧", symbol: "μΩ", factor: 0.000001 },
          { key: "mohm", name: "毫欧", symbol: "mΩ", factor: 0.001 },
          { key: "ohm", name: "欧姆", symbol: "Ω", factor: 1 },
          { key: "kohm", name: "千欧", symbol: "kΩ", factor: 1000 },
          { key: "Mohm", name: "兆欧", symbol: "MΩ", factor: 1000000 },
          { key: "Gohm", name: "吉欧", symbol: "GΩ", factor: 1000000000 },
        ],
      },
    ],
  },
  {
    key: "capacitance",
    name: "电容",
    en: "Capacitance",
    base: "f",
    sample: { value: "100", unit: "uf" },
    groups: [
      {
        name: "电容",
        units: [
          { key: "ff", name: "飞法", symbol: "fF", factor: 1e-15 },
          { key: "pf", name: "皮法", symbol: "pF", factor: 1e-12 },
          { key: "nf", name: "纳法", symbol: "nF", factor: 1e-9 },
          { key: "uf", name: "微法", symbol: "μF", factor: 0.000001 },
          { key: "mf", name: "毫法", symbol: "mF", factor: 0.001 },
          { key: "f", name: "法拉", symbol: "F", factor: 1 },
        ],
      },
    ],
  },
  {
    key: "charge",
    name: "电荷量",
    en: "Charge",
    base: "c",
    signed: true,
    sample: { value: "1", unit: "ah" },
    note: "电池容量常用的 Ah 是电荷量：1 Ah = 3600 C。",
    groups: [
      {
        name: "电荷量",
        units: [
          { key: "pc", name: "皮库仑", symbol: "pC", factor: 1e-12 },
          { key: "nc", name: "纳库仑", symbol: "nC", factor: 1e-9 },
          { key: "uc", name: "微库仑", symbol: "μC", factor: 0.000001 },
          { key: "mc", name: "毫库仑", symbol: "mC", factor: 0.001 },
          { key: "c", name: "库仑", symbol: "C", factor: 1 },
          { key: "mah", name: "毫安时", symbol: "mAh", factor: 3.6, note: "1 mAh = 3.6 C 精确" },
          { key: "ah", name: "安时", symbol: "Ah", factor: 3600, note: "1 Ah = 3600 C 精确" },
        ],
      },
    ],
  },
  {
    key: "inductance",
    name: "电感",
    en: "Inductance",
    base: "h",
    sample: { value: "1", unit: "mh" },
    groups: [
      {
        name: "电感",
        units: [
          { key: "ph", name: "皮亨", symbol: "pH", factor: 1e-12 },
          { key: "nh", name: "纳亨", symbol: "nH", factor: 1e-9 },
          { key: "uh", name: "微亨", symbol: "μH", factor: 0.000001 },
          { key: "mh", name: "毫亨", symbol: "mH", factor: 0.001 },
          { key: "h", name: "亨利", symbol: "H", factor: 1 },
          { key: "kh", name: "千亨", symbol: "kH", factor: 1000 },
        ],
      },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * 3. 纯逻辑（可单测）
 * ------------------------------------------------------------------ */

export function categoryByKey(key: string): UnitCategory | undefined {
  return UNIT_CATEGORIES.find((c) => c.key === key);
}

export function allUnitsOf(category: UnitCategory): UnitDef[] {
  return category.groups.flatMap((g) => g.units);
}

export function findUnit(category: UnitCategory, key: string): UnitDef | undefined {
  return allUnitsOf(category).find((u) => u.key === key);
}

/** 该单位是否属于这个类别 */
export function unitGroupName(category: UnitCategory, key: string): string | undefined {
  return category.groups.find((g) => g.units.some((u) => u.key === key))?.name;
}

/** 单位值 → 基准值 */
export function toBaseValue(unit: UnitDef, value: number): number {
  if (unit.toBase) return unit.toBase(value);
  return value * (unit.factor as number);
}

/** 基准值 → 单位值 */
export function fromBaseValue(unit: UnitDef, base: number): number {
  if (unit.fromBase) return unit.fromBase(base);
  return base / (unit.factor as number);
}

/** 一个类别内两个单位互转：先归一到基准单位，再换出 */
export function convertValue(
  category: UnitCategory,
  fromKey: string,
  toKey: string,
  value: number,
): number {
  const from = findUnit(category, fromKey);
  const to = findUnit(category, toKey);
  if (!from || !to || !Number.isFinite(value)) return NaN;
  const base = toBaseValue(from, value);
  return fromBaseValue(to, base);
}

/** 线性类别的换算比例：1 个 from = k 个 to（非线性类别返回 NaN） */
export function linearRatio(
  category: UnitCategory,
  fromKey: string,
  toKey: string,
): number {
  const from = findUnit(category, fromKey);
  const to = findUnit(category, toKey);
  if (!from || !to || from.toBase || to.toBase) return NaN;
  return (from.factor as number) / (to.factor as number);
}

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false; message: string };

const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * 把用户输入解析成数字，失败时给出人话提示（绝不返回 NaN 让界面显示出来）。
 * 容忍：前后空格、千分位逗号、全角数字、全角小数点、Unicode 减号。
 */
export function parseUserNumber(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, message: "还没有填数值：输入一个数字，或者点上面的「填入示例」。" };
  }
  const normalized = trimmed
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, ".")
    .replace(/[，,]/g, "")
    .replace(/[－−–—]/g, "-")
    .replace(/\s+/g, "");
  if (!NUMBER_PATTERN.test(normalized)) {
    const shown = trimmed.length > 16 ? `${trimmed.slice(0, 16)}…` : trimmed;
    return {
      ok: false,
      message: `「${shown}」不是一个数字。请输入纯数字，例如 12.5、0.375 或 1e3。`,
    };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      message: "这个数字太大或太小了，超出了双精度浮点能算的范围（约 ±1.8e308）。",
    };
  }
  return { ok: true, value };
}

export type FormatOptions = {
  /** 小数位；null 表示自动（按有效数字决定） */
  decimals: number | null;
  thousands: boolean;
};

/** 抹掉二进制浮点毛刺：压到 15 位有效数字（0.1 + 0.2 -> 0.3） */
export function cleanFloat(value: number): number {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toPrecision(15));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function trimZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

function groupThousands(text: string): string {
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [intPart, fracPart] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fracPart ? `.${fracPart}` : ""}`;
}

/** 科学计数法字符串：9.46073e+15 */
function toScientific(value: number, significant: number): string {
  const abs = Math.abs(value);
  let exponent = Math.floor(Math.log10(abs));
  let mantissa = value / Math.pow(10, exponent);
  let digits = Math.max(1, Math.min(15, significant));
  let text = trimZeros(mantissa.toFixed(digits - 1));
  if (Math.abs(Number(text)) >= 10) {
    exponent += 1;
    mantissa = value / Math.pow(10, exponent);
    digits = Math.max(1, Math.min(15, digits));
    text = trimZeros(mantissa.toFixed(digits - 1));
  }
  return `${text}e${exponent >= 0 ? "+" : "-"}${Math.abs(exponent)}`;
}

/**
 * 数字显示：自动/指定位数、千分位、极大极小自动切科学计数法，且不出现浮点毛刺。
 * NaN -> 「—」，溢出 -> 「超出范围」。
 */
export function formatNumber(value: number, options: FormatOptions): string {
  if (Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "超出范围";
  const v = cleanFloat(value);
  if (v === 0) return "0";
  const abs = Math.abs(v);

  // 极大 / 极小：一律走科学计数法，避免出现 0.000000 或几十位长数字
  if (abs >= 1e15 || abs < 1e-4) {
    const significant = options.decimals === null ? 6 : Math.min(15, options.decimals + 1);
    return toScientific(v, significant);
  }

  if (options.decimals === null) {
    // 自动：按量级给到约 10 位有效数字
    const decimals = Math.max(0, Math.min(12, 9 - Math.floor(Math.log10(abs))));
    const text = trimZeros(v.toFixed(decimals));
    return options.thousands ? groupThousands(text) : text;
  }

  const text = trimZeros(v.toFixed(options.decimals));
  // 指定位数会把非零值四舍五入成 0（例如 0.0006 米显示成 0 米）：改用科学计数法，
  // 宁可显示 6e-4 也不能显示一个假的 0。
  if (Number(text) === 0) {
    return toScientific(v, Math.max(3, Math.min(15, options.decimals + 1)));
  }
  return options.thousands ? groupThousands(text) : text;
}

/** 「用作输入」用的干净数字串（不带千分位，可直接回填输入框） */
export function plainNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(cleanFloat(value));
}

export type UnitHit = { category: UnitCategory; unit: UnitDef; group: string };

/** 搜索类别名 / 单位名 / 符号 / 英文名；单位优先 */
export function searchUnits(query: string, limit = 24): UnitHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: UnitHit[] = [];
  for (const category of UNIT_CATEGORIES) {
    for (const group of category.groups) {
      for (const unit of group.units) {
        const haystack = [
          unit.name,
          unit.symbol,
          unit.key,
          category.name,
          category.en,
        ]
          .join(" ")
          .toLowerCase();
        if (haystack.includes(q)) {
          hits.push({ category, unit, group: group.name });
          if (hits.length >= limit) return hits;
        }
      }
    }
  }
  return hits;
}

/** 类别搜索：匹配类别名、英文名，或类别下任一单位名/符号 */
export function matchCategories(query: string): UnitCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return UNIT_CATEGORIES;
  return UNIT_CATEGORIES.filter((category) => {
    if (category.name.toLowerCase().includes(q) || category.en.toLowerCase().includes(q)) return true;
    return allUnitsOf(category).some((u) =>
      `${u.name} ${u.symbol} ${u.key}`.toLowerCase().includes(q),
    );
  });
}

/** 「1 个源单位 = ? 目标单位」的公式说明行 */
export function formulaLines(
  category: UnitCategory,
  fromKey: string,
  toKey: string,
  format: (n: number) => string,
): string[] {
  const from = findUnit(category, fromKey);
  const to = findUnit(category, toKey);
  if (!from || !to) return [];
  if (from.toBase && from.formulaTo && to.toBase && to.formulaFrom) {
    return [`先归一到基准单位：${from.formulaTo}`, `再换出目标单位：${to.formulaFrom}`];
  }
  if (!from.toBase && !to.toBase) {
    const ratio = linearRatio(category, fromKey, toKey);
    return [`1 ${from.name} = ${format(ratio)} ${to.name}`, `${to.name} = ${from.name} × ${format(ratio)}`];
  }
  const ratio = convertValue(category, fromKey, toKey, 1);
  return [`1 ${from.name} = ${format(ratio)} ${to.name}`];
}

/* ------------------------------------------------------------------ *
 * 4. 界面
 * ------------------------------------------------------------------ */

const PRECISION_OPTIONS = [
  { value: "auto", label: "自动（按量级取有效数字）" },
  { value: "0", label: "0 位小数" },
  { value: "1", label: "1 位小数" },
  { value: "2", label: "2 位小数" },
  { value: "3", label: "3 位小数" },
  { value: "4", label: "4 位小数" },
  { value: "6", label: "6 位小数" },
  { value: "8", label: "8 位小数" },
  { value: "10", label: "10 位小数" },
  { value: "12", label: "12 位小数" },
];

type Mode = "table" | "pair";

export function UnitConvertTool() {
  const { toast } = useToast();

  const [mode, setMode] = useToolDraft<Mode>("unit-converter", "mode", "table");
  const [categoryKey, setCategoryKey] = useToolDraft("unit-converter", "category", "length");
  const [unitKey, setUnitKey] = useToolDraft("unit-converter", "unit", "m");
  const [rawValue, setRawValue] = useToolDraft("unit-converter", "value", "1");
  const [precision, setPrecision] = useToolDraft("unit-converter", "precision", "auto");
  const [thousands, setThousands] = useToolDraft("unit-converter", "thousands", true);
  const [favorites, setFavorites] = useToolDraft<string[]>("unit-converter", "favorites", []);
  const [query, setQuery] = useToolDraft("unit-converter", "query", "");

  const [pairFrom, setPairFrom] = useToolDraft("unit-converter", "pairFrom", "mi");
  const [pairTo, setPairTo] = useToolDraft("unit-converter", "pairTo", "km");
  const [pairLeft, setPairLeft] = useToolDraft("unit-converter", "pairLeft", "1");
  const [pairRight, setPairRight] = useToolDraft("unit-converter", "pairRight", "1.609344");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 草稿可能来自旧版本（类别/单位已被删掉），这里一律回落到合法值
  const category = categoryByKey(categoryKey) ?? UNIT_CATEGORIES[0];
  const units = useMemo(() => allUnitsOf(category), [category]);
  const sourceUnit = findUnit(category, unitKey) ?? findUnit(category, category.base) ?? units[0];

  const formatOptions: FormatOptions = useMemo(
    () => ({ decimals: precision === "auto" ? null : Number(precision), thousands }),
    [precision, thousands],
  );
  const format = useCallback(
    (value: number) => formatNumber(value, formatOptions),
    [formatOptions],
  );

  const parsed = useMemo(() => parseUserNumber(rawValue), [rawValue]);

  const rows = useMemo(() => {
    const list = units.map((unit) => ({
      unit,
      favorite: favorites.includes(`${category.key}:${unit.key}`),
      result: parsed.ok ? convertValue(category, sourceUnit.key, unit.key, parsed.value) : NaN,
    }));
    // 收藏的置顶（保持收藏顺序），其余保持原始分组顺序
    const pinned = favorites
      .map((fav) => {
        const [cat, key] = fav.split(":");
        if (cat !== category.key) return undefined;
        return list.find((row) => row.unit.key === key);
      })
      .filter((row): row is (typeof list)[number] => Boolean(row));
    const rest = list.filter((row) => !pinned.includes(row));
    return [...pinned, ...rest];
  }, [units, category, parsed, sourceUnit.key, favorites]);

  const toggleFavorite = useCallback(
    (key: string) => {
      const token = `${category.key}:${key}`;
      setFavorites((prev) => (prev.includes(token) ? prev.filter((t) => t !== token) : [token, ...prev]));
    },
    [category.key, setFavorites],
  );

  const copyText = useCallback(
    async (text: string, key: string, tip: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        toast({ title: tip, variant: "success", duration: 1500 });
        setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1400);
      } catch {
        toast({ title: "复制失败，请手动选中文字复制", variant: "error" });
      }
    },
    [toast],
  );

  const applySample = useCallback(() => {
    setRawValue(category.sample.value);
    setUnitKey(category.sample.unit);
  }, [category.sample.unit, category.sample.value, setRawValue, setUnitKey]);

  const clearAll = useCallback(() => {
    setRawValue("");
    setQuery("");
  }, [setQuery, setRawValue]);

  const pickUnit = useCallback(
    (catKey: string, key: string) => {
      setCategoryKey(catKey);
      setUnitKey(key);
      setQuery("");
    },
    [setCategoryKey, setQuery, setUnitKey],
  );

  const categoryHits = useMemo(() => matchCategories(query), [query]);
  const unitHits = useMemo(() => searchUnits(query, 12), [query]);

  const signedCategory = Boolean(category.signed);
  const negativeWarning =
    parsed.ok && parsed.value < 0 && !signedCategory
      ? "输入是负数：这类量通常没有负值，结果仅供数学参考。"
      : null;

  const copyAllText = useMemo(() => {
    if (!parsed.ok) return "";
    const head = `${plainNumber(parsed.value)} ${sourceUnit.symbol} (${sourceUnit.name})`;
    const body = rows
      .filter((row) => !Number.isNaN(row.result))
      .map((row) => `${row.unit.name} (${row.unit.symbol}) = ${format(row.result)}`)
      .join("\n");
    return `${head}\n${body}`;
  }, [format, parsed, rows, sourceUnit]);

  /* ---------------- 双向换算（pair 模式） ---------------- */

  const pairCategory = category;
  const pairFromUnit = findUnit(pairCategory, pairFrom) ?? findUnit(pairCategory, pairCategory.base) ?? units[0];
  const pairToUnit = findUnit(pairCategory, pairTo) ?? units[0];

  const setPairCategory = useCallback(
    (nextKey: string) => {
      const next = categoryByKey(nextKey) ?? UNIT_CATEGORIES[0];
      const first = allUnitsOf(next);
      const from = first[0];
      const to = findUnit(next, next.base) ?? first[1] ?? first[0];
      setCategoryKey(next.key);
      setPairFrom(from.key);
      setPairTo(to.key);
      const left = parseUserNumber(pairLeft);
      const seed = left.ok ? left.value : 1;
      setPairRight(formatNumber(convertValue(next, from.key, to.key, seed), formatOptions));
    },
    [formatOptions, pairLeft, setCategoryKey, setPairFrom, setPairTo, setPairRight],
  );

  const onPairLeftChange = useCallback(
    (next: string) => {
      setPairLeft(next);
      const p = parseUserNumber(next);
      if (p.ok) {
        setPairRight(formatNumber(convertValue(pairCategory, pairFromUnit.key, pairToUnit.key, p.value), formatOptions));
      }
    },
    [formatOptions, pairCategory, pairFromUnit.key, pairToUnit.key, setPairLeft, setPairRight],
  );

  const onPairRightChange = useCallback(
    (next: string) => {
      setPairRight(next);
      const p = parseUserNumber(next);
      if (p.ok) {
        setPairLeft(formatNumber(convertValue(pairCategory, pairToUnit.key, pairFromUnit.key, p.value), formatOptions));
      }
    },
    [formatOptions, pairCategory, pairFromUnit.key, pairToUnit.key, setPairLeft, setPairRight],
  );

  const swapPair = useCallback(() => {
    const nextLeft = pairRight;
    const nextRight = pairLeft;
    setPairFrom(pairToUnit.key);
    setPairTo(pairFromUnit.key);
    setPairLeft(nextLeft);
    setPairRight(nextRight);
  }, [pairFromUnit.key, pairLeft, pairRight, pairToUnit.key, setPairFrom, setPairLeft, setPairRight, setPairTo]);

  const pairRatioText = useMemo(
    () => format(convertValue(pairCategory, pairFromUnit.key, pairToUnit.key, 1)),
    [format, pairCategory, pairFromUnit.key, pairToUnit.key],
  );

  return (
    <div className="space-y-5">
      {/* 顶部操作条：只放控件（模式切换 + 显示精度），不放工具名与描述 */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={mode === "table" ? "default" : "ghost"}
            onClick={() => setMode("table")}
          >
            <Sparkles className="h-3.5 w-3.5" />
            多单位换算表
          </Button>
          <Button
            size="sm"
            variant={mode === "pair" ? "default" : "ghost"}
            onClick={() => setMode("pair")}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            双向换算
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <div className="w-[190px]">
              <Select
                value={precision}
                onChange={(e) => setPrecision(e.target.value)}
              >
                {PRECISION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              variant={thousands ? "secondary" : "ghost"}
              onClick={() => setThousands((prev) => !prev)}
              title="在整数部分加千分位分隔符"
            >
              千分位
            </Button>
          </div>
        </div>
      </div>

      {mode === "table" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(210px,240px)_minmax(0,1fr)]">
          {/* 左：类别 + 搜索 */}
          <div className="space-y-3">
            <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4 shadow-xs">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="fk-unit-search"
                  className="h-9 pl-8 text-xs"
                  placeholder="搜单位或类别，如 亩 / mpg"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {query ? (
                <div className="space-y-1">
                  {unitHits.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-muted-foreground">
                      没有匹配的单位，换个写法试试（也可以搜「长度」「数据」这类类别名）。
                    </p>
                  ) : (
                    unitHits.map((hit) => (
                      <button
                        key={`${hit.category.key}:${hit.unit.key}`}
                        type="button"
                        onClick={() => pickUnit(hit.category.key, hit.unit.key)}
                        data-search-hit={`${hit.category.key}:${hit.unit.key}`}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border/50 bg-background/40 px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
                      >
                        <span className="truncate text-xs text-foreground">
                          {hit.unit.name}
                          <span className="ml-1 font-mono-accent text-[11px] text-muted-foreground">
                            {hit.unit.symbol}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">{hit.category.name}</span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}

              <div className="thin-scroll -mr-1 max-h-[200px] space-y-0.5 overflow-y-auto pr-1 lg:max-h-[520px]">
                {categoryHits.map((cat) => {
                  const active = cat.key === category.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      data-category={cat.key}
                      onClick={() => {
                        setCategoryKey(cat.key);
                        const base = findUnit(cat, cat.base);
                        if (base) setUnitKey(base.key);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                        active
                          ? "bg-primary/15 font-medium text-primary"
                          : "text-foreground hover:bg-secondary/60",
                      )}
                    >
                      <span className="truncate">{cat.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {allUnitsOf(cat).length}
                      </span>
                    </button>
                  );
                })}
                {categoryHits.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的类别。</p>
                ) : null}
              </div>
            </div>
          </div>

          {/* 右：输入 + 全部单位结果 */}
          <div className="space-y-5">
            <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[160px] flex-1">
                  <Label>数值</Label>
                  <Input
                    id="fk-unit-value"
                    className="h-12 font-mono-accent text-lg"
                    inputMode="decimal"
                    placeholder="例如 12.5"
                    value={rawValue}
                    onChange={(e) => setRawValue(e.target.value)}
                  />
                </div>
                <div className="w-full sm:w-[220px]">
                  <Label>源单位</Label>
                  <Select
                    id="fk-unit-from"
                    value={sourceUnit.key}
                    onChange={(e) => setUnitKey(e.target.value)}
                  >
                    {category.groups.map((group) => (
                      <optgroup key={group.name} label={group.name}>
                        {group.units.map((unit) => (
                          <option key={unit.key} value={unit.key}>
                            {unit.name}（{unit.symbol}）
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={applySample}>
                    <Wand2 className="h-4 w-4" />
                    填入示例
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearAll}>
                    <Eraser className="h-4 w-4" />
                    清空
                  </Button>
                </div>
              </div>

              {favorites.filter((f) => f.startsWith(`${category.key}:`)).length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">常用</span>
                  {favorites
                    .filter((f) => f.startsWith(`${category.key}:`))
                    .map((f) => {
                      const key = f.split(":")[1];
                      const unit = findUnit(category, key);
                      if (!unit) return null;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setUnitKey(unit.key)}
                          className={cn(
                            "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                            unit.key === sourceUnit.key
                              ? "border-primary/40 bg-primary/15 text-primary"
                              : "border-border/60 text-muted-foreground hover:bg-secondary/60",
                          )}
                        >
                          {unit.name}（{unit.symbol}）
                        </button>
                      );
                    })}
                </div>
              ) : null}

              {parsed.ok ? (
                negativeWarning ? (
                  <p className="text-xs text-muted-foreground">{negativeWarning}</p>
                ) : null
              ) : rawValue.trim() ? (
                <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
                  {parsed.message}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border/70 bg-background/40 px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    输入一个数值，下面会同时给出「{category.name}」里全部 {units.length} 个单位的结果。
                  </span>
                  <Button variant="outline" size="sm" onClick={applySample}>
                    <Wand2 className="h-4 w-4" />
                    填入示例
                  </Button>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border/70 bg-card shadow-xs">
              <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-5 py-3">
                <span className="text-sm font-medium">换算结果</span>
                <Badge variant="secondary">{category.name}</Badge>
                <span className="text-[11px] text-muted-foreground">
                  {units.length} 个单位 · 源单位 {sourceUnit.name}
                </span>
                <Button
                  className="ml-auto"
                  variant="ghost"
                  size="sm"
                  disabled={!parsed.ok}
                  onClick={() => copyText(copyAllText, "__all__", "已复制全部换算结果")}
                >
                  {copiedKey === "__all__" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  复制全部
                </Button>
              </div>

              <div className="thin-scroll max-h-[560px] overflow-auto" data-fk="unit-results">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-card text-[11px] font-medium text-muted-foreground">
                      <th className="border-b border-border/60 px-5 py-2 text-left">单位</th>
                      <th className="border-b border-border/60 px-3 py-2 text-left">符号</th>
                      <th className="border-b border-border/60 px-3 py-2 text-right">数值</th>
                      <th className="border-b border-border/60 px-5 py-2 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isSource = row.unit.key === sourceUnit.key;
                      return (
                        <tr
                          key={row.unit.key}
                          data-unit={row.unit.key}
                          className={cn(
                            "border-b border-border/40 transition-colors last:border-b-0",
                            isSource ? "bg-primary/10" : "hover:bg-secondary/40",
                          )}
                        >
                          <td className="px-5 py-2.5">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-foreground">{row.unit.name}</span>
                              {isSource ? <Badge>源</Badge> : null}
                              {row.favorite ? <Badge variant="outline">常用</Badge> : null}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono-accent text-xs text-muted-foreground">
                            {row.unit.symbol}
                          </td>
                          <td
                            className="px-3 py-2.5 text-right font-mono-accent text-xs tabular-nums text-foreground"
                            data-value={row.unit.key}
                          >
                            {parsed.ok ? format(row.result) : "—"}
                          </td>
                          <td className="px-5 py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                title={row.favorite ? "取消常用" : "标为常用并置顶"}
                                onClick={() => toggleFavorite(row.unit.key)}
                              >
                                <Star
                                  className={cn("h-3.5 w-3.5", row.favorite ? "text-primary" : "")}
                                  fill={row.favorite ? "currentColor" : "none"}
                                />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="复制这个数值"
                                disabled={!parsed.ok || !Number.isFinite(row.result)}
                                onClick={() =>
                                  copyText(
                                    plainNumber(row.result),
                                    row.unit.key,
                                    `已复制 ${format(row.result)}`,
                                  )
                                }
                              >
                                {copiedKey === row.unit.key ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                data-use-as-input={row.unit.key}
                                title="把这个结果当成输入，保持同一物理量"
                                disabled={!parsed.ok || !Number.isFinite(row.result)}
                                onClick={() => {
                                  setUnitKey(row.unit.key);
                                  setRawValue(plainNumber(row.result));
                                }}
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {category.note ? (
                <p className="border-t border-border/50 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
                  {category.note}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        /* 双向换算 */
        <div className="space-y-5">
          <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-[240px]">
                <Label>类别</Label>
                <Select
                  id="fk-pair-category"
                  value={category.key}
                  onChange={(e) => setPairCategory(e.target.value)}
                >
                  {UNIT_CATEGORIES.map((cat) => (
                    <option key={cat.key} value={cat.key}>
                      {cat.name}
                    </option>
                  ))}
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                两边都能改：改哪一边，另一边跟着算。适合精确核对「1 个单位等于多少」。
              </p>
            </div>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
              <div>
                <Label>数值</Label>
                <Input
                  id="fk-pair-left"
                  className="h-12 font-mono-accent text-lg"
                  inputMode="decimal"
                  value={pairLeft}
                  onChange={(e) => onPairLeftChange(e.target.value)}
                />
              </div>
              <div>
                <Label>源单位</Label>
                <Select
                  id="fk-pair-from"
                  value={pairFromUnit.key}
                  onChange={(e) => {
                    setPairFrom(e.target.value);
                    const p = parseUserNumber(pairLeft);
                    const seed = p.ok ? p.value : 1;
                    setPairRight(
                      formatNumber(
                        convertValue(pairCategory, e.target.value, pairToUnit.key, seed),
                        formatOptions,
                      ),
                    );
                  }}
                >
                  {pairCategory.groups.map((group) => (
                    <optgroup key={group.name} label={group.name}>
                      {group.units.map((unit) => (
                        <option key={unit.key} value={unit.key}>
                          {unit.name}（{unit.symbol}）
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-center lg:pt-16">
              <Button variant="outline" size="sm" onClick={swapPair} title="交换两边">
                <ArrowLeftRight className="h-4 w-4" />
                交换
              </Button>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
              <div>
                <Label>数值</Label>
                <Input
                  id="fk-pair-right"
                  className="h-12 font-mono-accent text-lg"
                  inputMode="decimal"
                  value={pairRight}
                  onChange={(e) => onPairRightChange(e.target.value)}
                />
              </div>
              <div>
                <Label>目标单位</Label>
                <Select
                  id="fk-pair-to"
                  value={pairToUnit.key}
                  onChange={(e) => {
                    setPairTo(e.target.value);
                    const p = parseUserNumber(pairLeft);
                    const seed = p.ok ? p.value : 1;
                    setPairRight(
                      formatNumber(
                        convertValue(pairCategory, pairFromUnit.key, e.target.value, seed),
                        formatOptions,
                      ),
                    );
                  }}
                >
                  {pairCategory.groups.map((group) => (
                    <optgroup key={group.name} label={group.name}>
                      {group.units.map((unit) => (
                        <option key={unit.key} value={unit.key}>
                          {unit.name}（{unit.symbol}）
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">换算依据</span>
              <Badge variant="secondary">
                1 {pairFromUnit.symbol} = {pairRatioText} {pairToUnit.symbol}
              </Badge>
              <Button
                className="ml-auto"
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyText(
                    `1 ${pairFromUnit.name}(${pairFromUnit.symbol}) = ${pairRatioText} ${pairToUnit.name}(${pairToUnit.symbol})`,
                    "pair",
                    "已复制换算依据",
                  )
                }
              >
                {copiedKey === "pair" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                复制
              </Button>
            </div>
            <ul className="space-y-1">
              {formulaLines(pairCategory, pairFromUnit.key, pairToUnit.key, format).map((line) => (
                <li key={line} className="font-mono-accent text-xs text-muted-foreground">
                  {line}
                </li>
              ))}
            </ul>
            {pairFromUnit.note || pairCategory.note ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {pairFromUnit.note ?? pairCategory.note}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
