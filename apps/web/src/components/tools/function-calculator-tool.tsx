"use client";

import React, { useState, useMemo } from "react";
import {
  Sigma,
  FunctionSquare,
  Sliders,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { trackToolUsage } from "@/lib/analytics";

interface PresetFunc {
  id: string;
  name: string;
  category: "trade" | "finance" | "math";
  formulaStr: string;
  desc: string;
  params: { id: string; name: string; defaultValue: string; unit?: string }[];
  compute: (vals: Record<string, number>) => number;
}

const PRESET_FUNCTIONS: PresetFunc[] = [
  // ─── 进出口与外贸核算函数 (图三专属) ───
  {
    id: "trade_tax_unit_price",
    name: "进出口含税单价",
    category: "trade",
    formulaStr: "f(x) = round(不含税总金额 / 单价 * 1.03, 2)",
    desc: "以人民币为单位，结合外贸辅料/加价系数（1.03）折算出的进出口含税单价，精确到小数点后两位。",
    params: [
      { id: "total_notax", name: "不含税总金额", defaultValue: "100000", unit: "元" },
      { id: "unit_price", name: "基准单价", defaultValue: "25", unit: "元" },
    ],
    compute: (v) => {
      if (!v.unit_price) return 0;
      return (v.total_notax / v.unit_price) * 1.03;
    },
  },
  {
    id: "trade_material_notax_price",
    name: "进出口人带料不含税单价",
    category: "trade",
    formulaStr: "f(x) = round(不含税总金额 / 单价 * 1.03 * 1.13, 2)",
    desc: "外贸加工贸易人带料业务中，加乘1.03损耗及1.13综合税费后核算的人带料不含税单价，精确到用户设定的小数位。",
    params: [
      { id: "total_notax", name: "不含税总金额", defaultValue: "100000", unit: "元" },
      { id: "unit_price", name: "基准单价", defaultValue: "25", unit: "元" },
    ],
    compute: (v) => {
      if (!v.unit_price) return 0;
      return (v.total_notax / v.unit_price) * 1.03 * 1.13;
    },
  },
  {
    id: "trade_exchange_cost",
    name: "外贸出口换汇成本",
    category: "trade",
    formulaStr: "换汇成本 = 出口总成本(RMB) / 外汇净收入(USD)",
    desc: "衡量出口商品每换回 1 美元所需支出的人民币总成本。若换汇成本低于当前银行外汇买入价则出口盈利，反之亏损。",
    params: [
      { id: "cost_rmb", name: "出口总成本 (退税后)", defaultValue: "70000", unit: "元" },
      { id: "usd_income", name: "外汇净收入", defaultValue: "10000", unit: "美元" },
    ],
    compute: (v) => {
      if (!v.usd_income) return 0;
      return v.cost_rmb / v.usd_income;
    },
  },
  {
    id: "trade_fob_to_cif",
    name: "FOB 离岸价转 CIF 到岸价",
    category: "trade",
    formulaStr: "CIF = (FOB + 运费) / (1 - 投保加成率 × 保险费率)",
    desc: "国际贸易中将不含运保费的 FOB 离岸价换算为包含国际航运运费和海运货运险的 CIF 到岸价。",
    params: [
      { id: "fob", name: "FOB 报价", defaultValue: "50000", unit: "美元" },
      { id: "freight", name: "国际运费", defaultValue: "3500", unit: "美元" },
      { id: "insurance_rate", name: "保险费率 (如0.008)", defaultValue: "0.008" },
      { id: "markup_rate", name: "投保加成率 (通常1.1)", defaultValue: "1.1" },
    ],
    compute: (v) => {
      const denom = 1 - (v.markup_rate || 1.1) * (v.insurance_rate || 0.008);
      if (denom <= 0) return 0;
      return (v.fob + v.freight) / denom;
    },
  },
  {
    id: "trade_export_profit",
    name: "出口退税实得毛利",
    category: "trade",
    formulaStr: "毛利 = (出口销售额 × 汇率) + (不含税进价 × 退税率) - 含税采购成本",
    desc: "外贸单笔出口综合实得利润测算，含结汇收入与国税退税到账扣减采购成本。",
    params: [
      { id: "export_usd", name: "出口销售额 (USD)", defaultValue: "20000", unit: "美元" },
      { id: "rate_cny", name: "美元对人民币汇率", defaultValue: "7.25" },
      { id: "cost_with_tax", name: "国内含税采购总额", defaultValue: "130000", unit: "元" },
      { id: "rebate_rate", name: "退税率 (如0.13)", defaultValue: "0.13" },
      { id: "vat_rate", name: "进项增值税率 (如0.13)", defaultValue: "0.13" },
    ],
    compute: (v) => {
      const revenue = v.export_usd * v.rate_cny;
      const noTaxCost = v.cost_with_tax / (1 + (v.vat_rate || 0.13));
      const rebate = noTaxCost * (v.rebate_rate || 0.13);
      return revenue + rebate - v.cost_with_tax;
    },
  },

  // ─── 财税与投资理财函数 ───
  {
    id: "finance_compound_fv",
    name: "复利终值 (FV)",
    category: "finance",
    formulaStr: "FV = PV × (1 + r)^n",
    desc: "计算一笔初始本金在固定年化利率下，经过 n 期复利计息后的未来本息总额。",
    params: [
      { id: "pv", name: "初始本金 (PV)", defaultValue: "100000", unit: "元" },
      { id: "r", name: "年化收益率 (如0.05)", defaultValue: "0.05" },
      { id: "n", name: "投资年限 (期数)", defaultValue: "10", unit: "年" },
    ],
    compute: (v) => {
      return v.pv * Math.pow(1 + v.r, v.n);
    },
  },
  {
    id: "finance_compound_pv",
    name: "复利现值 (PV)",
    category: "finance",
    formulaStr: "PV = FV / (1 + r)^n",
    desc: "将未来特定时期的一笔确定资金，按给定的折现率折算到当下的资金价值。",
    params: [
      { id: "fv", name: "未来终值 (FV)", defaultValue: "200000", unit: "元" },
      { id: "r", name: "折现率 (如0.04)", defaultValue: "0.04" },
      { id: "n", name: "折现年限 (期数)", defaultValue: "5", unit: "年" },
    ],
    compute: (v) => {
      return v.fv / Math.pow(1 + v.r, v.n);
    },
  },
  {
    id: "finance_cagr",
    name: "复合年均增长率 (CAGR)",
    category: "finance",
    formulaStr: "CAGR = (期末值 / 期初值)^(1 / n) - 1",
    desc: "衡量投资或业务跨越多个年度时的平滑几何平均增长率，排除各年份剧烈波动的干扰。",
    params: [
      { id: "start_val", name: "期初价值", defaultValue: "500000", unit: "元" },
      { id: "end_val", name: "期末价值", defaultValue: "1200000", unit: "元" },
      { id: "years", name: "跨越年数", defaultValue: "5", unit: "年" },
    ],
    compute: (v) => {
      if (v.start_val <= 0 || v.years <= 0) return 0;
      const cagr = Math.pow(v.end_val / v.start_val, 1 / v.years) - 1;
      return cagr * 100; // 返回百分比形式数值
    },
  },
  {
    id: "finance_pmt",
    name: "等额本息每月还款 (PMT)",
    category: "finance",
    formulaStr: "PMT = [P × r × (1+r)^n] / [(1+r)^n - 1]",
    desc: "借款等额本息还款法下，借款人每月偿还的固定本息金额。",
    params: [
      { id: "loan", name: "贷款总额", defaultValue: "1000000", unit: "元" },
      { id: "annual_rate", name: "年利率 (如0.038)", defaultValue: "0.038" },
      { id: "months", name: "还款月数 (如360)", defaultValue: "360", unit: "月" },
    ],
    compute: (v) => {
      const mr = v.annual_rate / 12;
      const n = v.months;
      if (mr === 0) return v.loan / n;
      const pow = Math.pow(1 + mr, n);
      return (v.loan * mr * pow) / (pow - 1);
    },
  },

  // ─── 数学、工程与统计函数 ───
  {
    id: "math_quadratic",
    name: "一元二次方程判别式与正根",
    category: "math",
    formulaStr: "x = (-b + √(b² - 4ac)) / (2a)",
    desc: "求解标准一元二次方程 ax² + bx + c = 0 的根，含判别式 Δ 计算。",
    params: [
      { id: "a", name: "二次项系数 a", defaultValue: "1" },
      { id: "b", name: "一次项系数 b", defaultValue: "-5" },
      { id: "c", name: "常数项 c", defaultValue: "6" },
    ],
    compute: (v) => {
      const delta = v.b * v.b - 4 * v.a * v.c;
      if (delta < 0 || v.a === 0) return 0;
      return (-v.b + Math.sqrt(delta)) / (2 * v.a);
    },
  },
  {
    id: "math_permutation",
    name: "排列数 P(n, m)",
    category: "math",
    formulaStr: "P(n, m) = n! / (n - m)!",
    desc: "从 n 个不同元素中取出 m 个元素按一定顺序排成一列的排列总数。",
    params: [
      { id: "n", name: "总元素数 n", defaultValue: "7" },
      { id: "m", name: "取出元素数 m", defaultValue: "3" },
    ],
    compute: (v) => {
      const n = Math.floor(v.n);
      const m = Math.floor(v.m);
      if (n < 0 || m < 0 || m > n) return 0;
      let res = 1;
      for (let i = 0; i < m; i++) res *= n - i;
      return res;
    },
  },
  {
    id: "math_combination",
    name: "组合数 C(n, m)",
    category: "math",
    formulaStr: "C(n, m) = n! / [m! × (n - m)!]",
    desc: "从 n 个不同元素中取出 m 个元素不考虑顺序的组合总数。",
    params: [
      { id: "n", name: "总元素数 n", defaultValue: "10" },
      { id: "m", name: "取出元素数 m", defaultValue: "4" },
    ],
    compute: (v) => {
      const n = Math.floor(v.n);
      const m = Math.floor(v.m);
      if (n < 0 || m < 0 || m > n) return 0;
      let num = 1;
      let den = 1;
      for (let i = 1; i <= m; i++) {
        num *= n - (i - 1);
        den *= i;
      }
      return Math.round(num / den);
    },
  },
];

export function FunctionCalculatorTool() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"preset" | "custom">("preset");
  const [selectedCategory, setSelectedCategory] = useState<"all" | "trade" | "finance" | "math">("all");
  const [selectedFuncId, setSelectedFuncId] = useState<string>("trade_tax_unit_price");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [precision, setPrecision] = useState<number>(2);

  // 自定义函数输入状态
  const [customExpression, setCustomExpression] = useState("round(x / y * 1.03, 2)");
  const [customVars, setCustomVars] = useState<Record<string, string>>({ x: "100000", y: "25" });

  const currentFunc = useMemo(() => {
    return PRESET_FUNCTIONS.find((f) => f.id === selectedFuncId) || PRESET_FUNCTIONS[0];
  }, [selectedFuncId]);

  // 获取当前函数的实际参数值
  const currentNumericParams = useMemo(() => {
    const res: Record<string, number> = {};
    for (const p of currentFunc.params) {
      const valStr = paramValues[p.id] !== undefined ? paramValues[p.id] : p.defaultValue;
      res[p.id] = Number(valStr) || 0;
    }
    return res;
  }, [currentFunc, paramValues]);

  // 计算预设函数结果
  const computedPresetResult = useMemo(() => {
    try {
      return currentFunc.compute(currentNumericParams);
    } catch {
      return 0;
    }
  }, [currentFunc, currentNumericParams]);

  const formattedPresetResult = useMemo(() => {
    if (typeof computedPresetResult !== "number" || isNaN(computedPresetResult)) return "0";
    const prec = Math.max(0, Math.min(8, precision));
    if (currentFunc.id === "finance_cagr") {
      return `${computedPresetResult.toFixed(prec)}%`;
    }
    return computedPresetResult.toFixed(prec);
  }, [computedPresetResult, precision, currentFunc.id]);

  // 解析自定义表达式中的变量
  const detectedVariables = useMemo(() => {
    // 找出所有单字母或标识符变量，排除内置数学关键字
    const reserved = new Set([
      "round", "floor", "ceil", "abs", "sin", "cos", "tan", "sqrt", "pow", "log", "exp", "pi", "e", "math"
    ]);
    const matches = customExpression.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    const vars = Array.from(new Set(matches.filter((v) => !reserved.has(v.toLowerCase()))));
    return vars;
  }, [customExpression]);

  // 执行自定义表达式安全求值
  const customResult = useMemo(() => {
    try {
      let expr = customExpression;
      // 替换数学函数
      expr = expr.replace(/\bround\s*\(/gi, "Math.round(");
      expr = expr.replace(/\bsqrt\s*\(/gi, "Math.sqrt(");
      expr = expr.replace(/\babs\s*\(/gi, "Math.abs(");
      expr = expr.replace(/\bsin\s*\(/gi, "Math.sin(");
      expr = expr.replace(/\bcos\s*\(/gi, "Math.cos(");
      expr = expr.replace(/\btan\s*\(/gi, "Math.tan(");
      expr = expr.replace(/\bpow\s*\(/gi, "Math.pow(");
      expr = expr.replace(/\bpi\b/gi, "Math.PI");

      // 替换变量
      for (const v of detectedVariables) {
        const val = Number(customVars[v] ?? 0);
        const re = new RegExp(`\\b${v}\\b`, "g");
        expr = expr.replace(re, `(${val})`);
      }

      // 如果有包含 round(val, 2) 的特化处理
      if (/Math\.round\([^,]+,\s*\d+\)/.test(expr)) {
        expr = expr.replace(/Math\.round\(([^,]+),\s*(\d+)\)/g, "Number(Number($1).toFixed($2))");
      }

      // 检验非法字符（仅允许数学字符、数字、括号、点、加减乘除模）
      if (/[^0-9+\-*/().,% MathNumbertoFixed]/.test(expr)) {
        return "表达式含有不受支持的特殊字符";
      }

      const res = Function(`"use strict"; return (${expr});`)();
      if (typeof res === "number" && !isNaN(res)) {
        const prec = Math.max(0, Math.min(8, precision));
        return res.toFixed(prec);
      }
      return "计算无效";
    } catch {
      return "公式解析错误";
    }
  }, [customExpression, customVars, detectedVariables, precision]);

  const handleCopy = (val: string) => {
    navigator.clipboard.writeText(val);
    setCopied(true);
    toast({ title: "计算结果已复制", variant: "success" });
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredPresets = PRESET_FUNCTIONS.filter(
    (f) => selectedCategory === "all" || f.category === selectedCategory
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 顶部标题 */}
      <div className="rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-md shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-sky-500/20 text-sky-500 border border-sky-500/30">
              <FunctionSquare className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                函数计算与公式核算工具
                <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-500 border border-sky-500/20 font-medium">
                  专业外贸/金融/数学
                </span>
              </h1>
              <p className="text-xs text-muted-foreground">
                内置外贸进出口单价、人带料、换汇成本、金融工程及数学函数，附清晰文字说明，支持自由定制动态公式
              </p>
            </div>
          </div>

          <div className="flex rounded-xl bg-muted/60 p-1 border border-border/40">
            <button
              onClick={() => {
                setActiveTab("preset");
                trackToolUsage("func-calc");
              }}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all",
                activeTab === "preset"
                  ? "bg-background text-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sigma className="h-3.5 w-3.5 text-sky-500" />
              常用预设函数库
            </button>
            <button
              onClick={() => {
                setActiveTab("custom");
                trackToolUsage("func-calc");
              }}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all",
                activeTab === "custom"
                  ? "bg-background text-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              自定义函数 f(x)
            </button>
          </div>
        </div>
      </div>

      {/* ================= 模式 1: 预设函数库 ================= */}
      {activeTab === "preset" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧函数列表与分类 */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/40 text-xs">
              {[
                { id: "all", name: "全部" },
                { id: "trade", name: "外贸与进出口" },
                { id: "finance", name: "财税与金融" },
                { id: "math", name: "工程与数学" },
              ].map((c) => (
                <button
                  key={c.id}
                  onClick={() =>
                    setSelectedCategory(c.id as "all" | "trade" | "finance" | "math")
                  }
                  className={cn(
                    "flex-1 py-1.5 text-center rounded-lg font-medium transition-all",
                    selectedCategory === c.id
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div className="max-h-[460px] overflow-y-auto space-y-2 pr-1">
              {filteredPresets.map((f) => (
                <div
                  key={f.id}
                  onClick={() => {
                    setSelectedFuncId(f.id);
                    setParamValues({});
                  }}
                  className={cn(
                    "p-3 rounded-xl border transition-all cursor-pointer space-y-1",
                    selectedFuncId === f.id
                      ? "bg-sky-500/10 border-sky-500/50 shadow-xs"
                      : "bg-card/60 border-border/40 hover:bg-card/80"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      {f.name}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono">
                      {f.category === "trade" ? "进出口" : f.category === "finance" ? "金融" : "数学"}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground truncate">
                    {f.formulaStr}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧参数输入与计算面板 */}
          <div className="lg:col-span-2 rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-md shadow-sm flex flex-col justify-between space-y-6">
            <div className="space-y-5">
              {/* 函数名与公式卡片 */}
              <div className="rounded-xl bg-muted/30 p-4 border border-border/40 space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    {currentFunc.name}
                  </h3>
                  <div className="flex items-center gap-1 bg-muted/70 p-1 rounded-xl border border-border/40 self-start sm:self-auto">
                    <span className="text-[11px] text-muted-foreground px-1.5 font-medium">保留小数:</span>
                    {[0, 1, 2, 3, 4, 6].map((p) => (
                      <button
                        key={p}
                        onClick={() => setPrecision(p)}
                        className={cn(
                          "px-2 py-0.5 text-xs font-semibold rounded-md transition-all",
                          precision === p
                            ? "bg-sky-500 text-white shadow-xs font-bold"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {p}位
                      </button>
                    ))}
                    <input
                      type="number"
                      min={0}
                      max={8}
                      value={precision}
                      onChange={(e) => setPrecision(Math.max(0, Math.min(8, Number(e.target.value) || 0)))}
                      className="w-10 rounded bg-background/90 border border-border/60 px-1 py-0.5 text-xs text-center font-mono ml-0.5"
                      title="自定义小数位数"
                    />
                  </div>
                </div>
                <div className="font-mono text-xs text-foreground bg-background/80 p-2.5 rounded-lg border border-border/50 select-all">
                  {currentFunc.formulaStr}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                  💡 <b>说明：</b>{currentFunc.desc}
                </p>
              </div>

              {/* 动态输入参数表单 */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-sky-500" />
                  变量参数输入：
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {currentFunc.params.map((p) => (
                    <div key={p.id} className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground flex justify-between">
                        <span>{p.name}</span>
                        {p.unit && <span className="text-[10px]">{p.unit}</span>}
                      </label>
                      <input
                        type="number"
                        value={paramValues[p.id] !== undefined ? paramValues[p.id] : p.defaultValue}
                        onChange={(e) =>
                          setParamValues((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 运算结果展示 */}
            <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs text-muted-foreground">计算核算结果 ({precision}位小数)：</div>
                <div className="text-3xl font-extrabold text-sky-500 font-mono tracking-tight mt-1">
                  {formattedPresetResult}
                </div>
              </div>

              <Button
                onClick={() =>
                  handleCopy(
                    `${currentFunc.name} 计算结果: ${formattedPresetResult}`
                  )
                }
                className="bg-sky-500 hover:bg-sky-600 text-white shadow-sm"
              >
                {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                复制计算结果
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ================= 模式 2: 自定义动态公式 f(x) ================= */}
      {activeTab === "custom" && (
        <div className="rounded-2xl border border-border/40 bg-card/60 p-6 backdrop-blur-md shadow-sm space-y-6">
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                输入自定义公式表达式 (支持加减乘除、乘方、括号及常见函数)：
              </label>
              <div className="flex items-center gap-1 bg-muted/70 p-1 rounded-xl border border-border/40 self-start sm:self-auto">
                <span className="text-[11px] text-muted-foreground px-1.5 font-medium">保留小数:</span>
                {[0, 1, 2, 3, 4, 6].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPrecision(p)}
                    className={cn(
                      "px-2 py-0.5 text-xs font-semibold rounded-md transition-all",
                      precision === p
                        ? "bg-indigo-500 text-white shadow-xs font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {p}位
                  </button>
                ))}
                <input
                  type="number"
                  min={0}
                  max={8}
                  value={precision}
                  onChange={(e) => setPrecision(Math.max(0, Math.min(8, Number(e.target.value) || 0)))}
                  className="w-10 rounded bg-background/90 border border-border/60 px-1 py-0.5 text-xs text-center font-mono ml-0.5"
                  title="自定义小数位数"
                />
              </div>
            </div>

            <input
              type="text"
              value={customExpression}
              onChange={(e) => setCustomExpression(e.target.value)}
              placeholder="例如: round(x / y * 1.03, 2)"
              className="w-full rounded-xl bg-background/80 border border-border/60 px-4 py-3 text-base text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 shadow-inner"
            />

            {/* 快速预置常用片段 */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">常用示例公式:</span>
              {[
                { label: "进出口含税单价", expr: "round(x / y * 1.03, 2)" },
                { label: "人带料不含税单价", expr: "round(x / y * 1.03 * 1.13, 2)" },
                { label: "二次方和", expr: "x*x + y*y" },
                { label: "含税转不含税", expr: "round(x / (1 + r), 2)" },
                { label: "年化复利", expr: "x * pow(1 + r, n)" },
              ].map((ex) => (
                <button
                  key={ex.label}
                  onClick={() => setCustomExpression(ex.expr)}
                  className="px-2.5 py-1 rounded-lg bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground font-mono transition-colors"
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>

          {/* 自动识别提取的变量输入框 */}
          {detectedVariables.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-indigo-500" />
                识别到 {detectedVariables.length} 个自变量，请输入参数值：
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {detectedVariables.map((v) => (
                  <div key={v} className="space-y-1">
                    <label className="text-xs font-mono font-semibold text-foreground">
                      变量 {v} =
                    </label>
                    <input
                      type="number"
                      value={customVars[v] ?? ""}
                      onChange={(e) =>
                        setCustomVars((prev) => ({ ...prev, [v]: e.target.value }))
                      }
                      placeholder="0"
                      className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 自定义计算结果 */}
          <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-muted-foreground">自定义公式计算结果 ({precision}位小数)：</div>
              <div className="text-3xl font-extrabold text-indigo-500 font-mono tracking-tight mt-1">
                {customResult}
              </div>
            </div>

            <Button
              onClick={() => handleCopy(String(customResult))}
              className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
            >
              {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              复制运算结果
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
