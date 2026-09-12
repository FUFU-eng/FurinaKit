"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Coins,
  Building2,
  Receipt,
  User,
  ShoppingBag,
  FileSpreadsheet,
  Globe,
  Copy,
  Check,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { trackToolUsage } from "@/lib/analytics";

type TaxCategory =
  | "individual" // 个人所得税
  | "vat"        // 增值税
  | "corporate"  // 企业所得税
  | "additional" // 城建及附加税费
  | "stamp"      // 印花税
  | "consumption"// 消费税
  | "customs";   // 关税与出口退税

type IitType = "salary" | "bonus" | "labor" | "business";
type CitType = "standard" | "small_low_profit" | "high_tech";
type UrbanArea = "city" | "county" | "other";

interface IitResultData {
  totalIncome?: number;
  taxableYear?: number;
  totalTax?: number;
  afterTaxYear?: number;
  avgMonthTax?: number;
  avgMonthTakeHome?: number;
  rate?: number;
  deduct?: number;
  level?: number;
  brackets?: Array<{ max: number; rate: number; deduct: number; level: number }>;
  b?: number;
  monthly?: number;
  separateTax?: number;
  takeHome?: number;
  amount?: number;
  taxable?: number;
  quick?: number;
  prepayTax?: number;
  rev?: number;
  cost?: number;
  tax?: number;
  profit?: number;
}

interface TradeResultData {
  cif?: number;
  tariff?: number;
  importVat?: number;
  totalCustomsTax?: number;
  totalImportCost?: number;
  fob?: number;
  rebateRate?: string;
  rebateAmount?: number;
}

const STAMP_RATES: Record<string, { name: string; rate: number; desc: string }> = {
  sales: { name: "买卖合同", rate: 0.0003, desc: "按价款 0.03%" },
  borrow: { name: "借款合同 (银企借贷)", rate: 0.00005, desc: "按借款金额 0.005%" },
  lease: { name: "财产租赁合同", rate: 0.001, desc: "按租赁金额 0.1%" },
  construction: { name: "建设工程合同", rate: 0.0003, desc: "按承包金额 0.03%" },
  transport: { name: "运输合同", rate: 0.0003, desc: "按运输费用 0.03%" },
  tech: { name: "技术合同", rate: 0.0003, desc: "按报酬/使用费 0.03%" },
  stock: { name: "证券交易 (股票单边)", rate: 0.0005, desc: "按成交金额 0.05% (出让方单边)" },
};

/**
 * 工具级缓存：切到别的工具或回首页会让本组件卸载，用户填的所有税款参数就会丢。
 *
 * 这里把七个页签的全部输入（含默认值）固定在模块作用域里：组件挂载时用它初始化 useState，
 * 之后每次变化写回，只有用户自己修改 / 清空时才会被覆盖。
 * 计算结果不单独缓存：它们本来就是随这些参数实时派生的 useMemo，恢复参数后会经原有逻辑
 * 算出与离开前逐字节相同的结果（纯函数、同样输入），不存在「重算一遍可能算出别的数」的问题。
 * 与项目里已有的 fileHideCache / imagesToPdfCache / toolDraftCache 保持一致的模块缓存方案。
 */
type TaxCalculatorCache = {
  activeTab: TaxCategory;
  iitType: IitType;
  salaryMonth: string;
  socialInsurance: string;
  specialDeduction: string;
  monthsCount: string;
  bonusAmount: string;
  laborAmount: string;
  businessRevenue: string;
  businessCost: string;
  vatCategory: "general" | "small";
  vatInputMode: "withTax" | "withoutTax";
  vatAmount: string;
  vatRate: string;
  vatInputTaxDeduction: string;
  citProfit: string;
  citEnterpriseType: "standard" | "small_low_profit" | "high_tech";
  citRdExpense: string;
  actualVatPaid: string;
  actualCtPaid: string;
  urbanArea: UrbanArea;
  applyHalfReduction: boolean;
  stampDocType: string;
  stampAmount: string;
  stampHalfReduction: boolean;
  ctMethod: "value" | "quantity" | "compound";
  ctSalesAmount: string;
  ctAdValoremRate: string;
  ctSalesQty: string;
  ctUnitTax: string;
  tradeMode: "import" | "export";
  cifAmount: string;
  tariffRate: string;
  importVatRate: string;
  fobAmount: string;
  rebateRate: string;
};

const taxCalculatorCache: TaxCalculatorCache = {
  activeTab: "individual",
  iitType: "salary",
  salaryMonth: "15000",
  socialInsurance: "2500",
  specialDeduction: "2000",
  monthsCount: "12",
  bonusAmount: "50000",
  laborAmount: "10000",
  businessRevenue: "300000",
  businessCost: "80000",
  vatCategory: "general",
  vatInputMode: "withTax",
  vatAmount: "100000",
  vatRate: "13",
  vatInputTaxDeduction: "0",
  citProfit: "1500000",
  citEnterpriseType: "small_low_profit",
  citRdExpense: "0",
  actualVatPaid: "50000",
  actualCtPaid: "0",
  urbanArea: "city",
  applyHalfReduction: true,
  stampDocType: "sales",
  stampAmount: "500000",
  stampHalfReduction: true,
  ctMethod: "value",
  ctSalesAmount: "200000",
  ctAdValoremRate: "20",
  ctSalesQty: "1000",
  ctUnitTax: "0.5",
  tradeMode: "import",
  cifAmount: "100000",
  tariffRate: "6",
  importVatRate: "13",
  fobAmount: "200000",
  rebateRate: "13",
};

export function TaxCalculatorTool() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TaxCategory>(taxCalculatorCache.activeTab);
  const [copied, setCopied] = useState(false);

  // 复制结果
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "计算明细已复制到剪贴板", variant: "success" });
    setTimeout(() => setCopied(false), 2000);
  };

  // ========================================================
  // 1. 个人所得税状态
  // ========================================================
  const [iitType, setIitType] = useState<IitType>(taxCalculatorCache.iitType);
  // 工资薪金
  const [salaryMonth, setSalaryMonth] = useState(taxCalculatorCache.salaryMonth); // 月收入/月薪
  const [socialInsurance, setSocialInsurance] = useState(taxCalculatorCache.socialInsurance); // 个人五险一金
  const [specialDeduction, setSpecialDeduction] = useState(taxCalculatorCache.specialDeduction); // 专项附加扣除
  const [monthsCount, setMonthsCount] = useState(taxCalculatorCache.monthsCount); // 累计月数
  // 年终奖
  const [bonusAmount, setBonusAmount] = useState(taxCalculatorCache.bonusAmount);
  // 劳务报酬
  const [laborAmount, setLaborAmount] = useState(taxCalculatorCache.laborAmount);
  // 经营所得
  const [businessRevenue, setBusinessRevenue] = useState(taxCalculatorCache.businessRevenue);
  const [businessCost, setBusinessCost] = useState(taxCalculatorCache.businessCost);

  // 个税计算逻辑
  const iitResult: IitResultData = useMemo(() => {
    if (iitType === "salary") {
      const s = Math.max(0, Number(salaryMonth) || 0);
      const si = Math.max(0, Number(socialInsurance) || 0);
      const sd = Math.max(0, Number(specialDeduction) || 0);
      const m = Math.max(1, Math.min(12, Number(monthsCount) || 12));

      // 累计预扣法（年化/按月累计）
      const totalIncome = s * m;
      const totalThreshold = 5000 * m;
      const totalSi = si * m;
      const totalSd = sd * m;
      const taxableYear = Math.max(0, totalIncome - totalThreshold - totalSi - totalSd);

      // 年度综合所得超额累进税率表
      const brackets = [
        { max: 36000, rate: 0.03, deduct: 0, level: 1 },
        { max: 144000, rate: 0.10, deduct: 2520, level: 2 },
        { max: 300000, rate: 0.20, deduct: 16920, level: 3 },
        { max: 420000, rate: 0.25, deduct: 31920, level: 4 },
        { max: 660000, rate: 0.30, deduct: 52920, level: 5 },
        { max: 960000, rate: 0.35, deduct: 85920, level: 6 },
        { max: Infinity, rate: 0.45, deduct: 181920, level: 7 },
      ];

      let curBracket = brackets[0];
      for (const b of brackets) {
        if (taxableYear <= b.max) {
          curBracket = b;
          break;
        }
      }

      const totalTax = Math.max(0, taxableYear * curBracket.rate - curBracket.deduct);
      const afterTaxYear = totalIncome - totalSi - totalTax;
      const avgMonthTax = totalTax / m;
      const avgMonthTakeHome = (s - si) - avgMonthTax;

      return {
        totalIncome,
        taxableYear,
        totalTax,
        afterTaxYear,
        avgMonthTax,
        avgMonthTakeHome,
        rate: curBracket.rate * 100,
        deduct: curBracket.deduct,
        level: curBracket.level,
        brackets,
      };
    } else if (iitType === "bonus") {
      const b = Math.max(0, Number(bonusAmount) || 0);
      const monthly = b / 12;
      // 按月换算后的综合所得税率表
      const bonusBrackets = [
        { max: 3000, rate: 0.03, deduct: 0 },
        { max: 12000, rate: 0.10, deduct: 210 },
        { max: 25000, rate: 0.20, deduct: 1410 },
        { max: 35000, rate: 0.25, deduct: 2660 },
        { max: 55000, rate: 0.30, deduct: 4410 },
        { max: 80000, rate: 0.35, deduct: 7160 },
        { max: Infinity, rate: 0.45, deduct: 15160 },
      ];
      let bBracket = bonusBrackets[0];
      for (const bb of bonusBrackets) {
        if (monthly <= bb.max) {
          bBracket = bb;
          break;
        }
      }
      const separateTax = Math.max(0, b * bBracket.rate - bBracket.deduct);
      const takeHome = b - separateTax;
      return {
        b,
        monthly,
        rate: bBracket.rate * 100,
        deduct: bBracket.deduct,
        separateTax,
        takeHome,
      };
    } else if (iitType === "labor") {
      const a = Math.max(0, Number(laborAmount) || 0);
      // 减除费用：<=4000 减800，>4000 减20%
      const deductCost = a <= 4000 ? 800 : a * 0.2;
      const taxable = Math.max(0, a - deductCost);
      // 预扣税率表 (20%, 30%, 40%)
      let rate = 0.2;
      let quick = 0;
      if (taxable > 50000) {
        rate = 0.4;
        quick = 7000;
      } else if (taxable > 20000) {
        rate = 0.3;
        quick = 2000;
      }
      const prepayTax = Math.max(0, taxable * rate - quick);
      return {
        amount: a,
        taxable,
        rate: rate * 100,
        quick,
        prepayTax,
        takeHome: a - prepayTax,
      };
    } else {
      // 经营所得 (5% - 35% 五级超额累进)
      const rev = Math.max(0, Number(businessRevenue) || 0);
      const cost = Math.max(0, Number(businessCost) || 0);
      const taxable = Math.max(0, rev - cost - 60000); // 扣减生计费 60000
      const bBrackets = [
        { max: 30000, rate: 0.05, deduct: 0 },
        { max: 90000, rate: 0.10, deduct: 1500 },
        { max: 300000, rate: 0.20, deduct: 10500 },
        { max: 500000, rate: 0.30, deduct: 40500 },
        { max: Infinity, rate: 0.35, deduct: 65500 },
      ];
      let bBracket = bBrackets[0];
      for (const bb of bBrackets) {
        if (taxable <= bb.max) {
          bBracket = bb;
          break;
        }
      }
      const tax = Math.max(0, taxable * bBracket.rate - bBracket.deduct);
      return {
        rev,
        cost,
        taxable,
        rate: bBracket.rate * 100,
        deduct: bBracket.deduct,
        tax,
        profit: rev - cost - tax,
      };
    }
  }, [
    iitType,
    salaryMonth,
    socialInsurance,
    specialDeduction,
    monthsCount,
    bonusAmount,
    laborAmount,
    businessRevenue,
    businessCost,
  ]);

  // ========================================================
  // 2. 增值税状态
  // ========================================================
  const [vatCategory, setVatCategory] = useState<"general" | "small">(taxCalculatorCache.vatCategory);
  const [vatInputMode, setVatInputMode] = useState<"withTax" | "withoutTax">(taxCalculatorCache.vatInputMode);
  const [vatAmount, setVatAmount] = useState(taxCalculatorCache.vatAmount);
  const [vatRate, setVatRate] = useState(taxCalculatorCache.vatRate); // 13%, 9%, 6%, 1%, 3%
  const [vatInputTaxDeduction, setVatInputTaxDeduction] = useState(taxCalculatorCache.vatInputTaxDeduction); // 进项税额抵扣

  const vatResult = useMemo(() => {
    const amt = Math.max(0, Number(vatAmount) || 0);
    const r = Math.max(0, Number(vatRate) || 0) / 100;
    const deduction = Math.max(0, Number(vatInputTaxDeduction) || 0);

    let withoutTax = 0;
    let outputTax = 0;
    let withTax = 0;

    if (vatInputMode === "withTax") {
      withTax = amt;
      withoutTax = amt / (1 + r);
      outputTax = amt - withoutTax;
    } else {
      withoutTax = amt;
      outputTax = amt * r;
      withTax = amt + outputTax;
    }

    const payableTax = Math.max(0, outputTax - deduction);

    // 小规模纳税人免征提示 (月销售额10万/季30万)
    const isSmallExempt = vatCategory === "small" && withoutTax <= 100000;

    return {
      withTax,
      withoutTax,
      outputTax,
      deduction,
      payableTax: isSmallExempt ? 0 : payableTax,
      isSmallExempt,
    };
  }, [vatCategory, vatInputMode, vatAmount, vatRate, vatInputTaxDeduction]);

  // ========================================================
  // 3. 企业所得税状态
  // ========================================================
  const [citProfit, setCitProfit] = useState(taxCalculatorCache.citProfit); // 利润总额 / 应纳税所得额
  const [citEnterpriseType, setCitEnterpriseType] = useState<"standard" | "small_low_profit" | "high_tech">(taxCalculatorCache.citEnterpriseType);
  const [citRdExpense, setCitRdExpense] = useState(taxCalculatorCache.citRdExpense); // 研发费用 (享受100%加计扣除)

  const citResult = useMemo(() => {
    const p = Math.max(0, Number(citProfit) || 0);
    const rd = Math.max(0, Number(citRdExpense) || 0);
    // 研发费用 100% 加计扣除
    const taxableIncome = Math.max(0, p - rd * 1.0);

    let finalTax = 0;
    let effectiveRate = 0;

    if (citEnterpriseType === "small_low_profit") {
      // 小型微利企业：应纳税所得额不超过300万部分，减按25%计入应纳税所得额，按20%税率（实际税负 5%）
      if (taxableIncome <= 3000000) {
        finalTax = taxableIncome * 0.25 * 0.20; // 实际 5%
        effectiveRate = taxableIncome > 0 ? (finalTax / taxableIncome) * 100 : 5;
      } else {
        finalTax = taxableIncome * 0.25;
        effectiveRate = 25;
      }
    } else if (citEnterpriseType === "high_tech") {
      // 高新技术企业 15%
      finalTax = taxableIncome * 0.15;
      effectiveRate = 15;
    } else {
      // 标准企业 25%
      finalTax = taxableIncome * 0.25;
      effectiveRate = 25;
    }

    return {
      taxableIncome,
      finalTax,
      effectiveRate,
      afterTaxProfit: p - finalTax,
    };
  }, [citProfit, citEnterpriseType, citRdExpense]);

  // ========================================================
  // 4. 附加税费状态
  // ========================================================
  const [actualVatPaid, setActualVatPaid] = useState(taxCalculatorCache.actualVatPaid); // 实际缴纳增值税
  const [actualCtPaid, setActualCtPaid] = useState(taxCalculatorCache.actualCtPaid); // 实际缴纳消费税
  const [urbanArea, setUrbanArea] = useState<"city" | "county" | "other">(taxCalculatorCache.urbanArea); // 7%, 5%, 1%
  const [applyHalfReduction, setApplyHalfReduction] = useState(taxCalculatorCache.applyHalfReduction); // 六税两费小微减半

  const additionalResult = useMemo(() => {
    const vat = Math.max(0, Number(actualVatPaid) || 0);
    const ct = Math.max(0, Number(actualCtPaid) || 0);
    const base = vat + ct;

    const urbanRate = urbanArea === "city" ? 0.07 : urbanArea === "county" ? 0.05 : 0.01;
    const eduRate = 0.03; // 教育费附加
    const localEduRate = 0.02; // 地方教育附加

    let urbanTax = base * urbanRate;
    let eduTax = base * eduRate;
    let localEduTax = base * localEduRate;

    if (applyHalfReduction) {
      urbanTax *= 0.5;
      eduTax *= 0.5;
      localEduTax *= 0.5;
    }

    const total = urbanTax + eduTax + localEduTax;
    return {
      base,
      urbanTax,
      eduTax,
      localEduTax,
      total,
      urbanRate: urbanRate * 100,
    };
  }, [actualVatPaid, actualCtPaid, urbanArea, applyHalfReduction]);

  // ========================================================
  // 5. 印花税状态
  // ========================================================
  const [stampDocType, setStampDocType] = useState(taxCalculatorCache.stampDocType);
  const [stampAmount, setStampAmount] = useState(taxCalculatorCache.stampAmount);
  const [stampHalfReduction, setStampHalfReduction] = useState(taxCalculatorCache.stampHalfReduction);

  const stampResult = useMemo(() => {
    const amt = Math.max(0, Number(stampAmount) || 0);
    const item = STAMP_RATES[stampDocType] || STAMP_RATES.sales;
    let tax = amt * item.rate;
    if (stampHalfReduction && stampDocType !== "stock") {
      tax *= 0.5;
    }
    return {
      amt,
      name: item.name,
      rateStr: `${(item.rate * 100).toFixed(3)}%`,
      desc: item.desc,
      tax,
    };
  }, [stampDocType, stampAmount, stampHalfReduction]);

  // ========================================================
  // 6. 消费税状态
  // ========================================================
  const [ctMethod, setCtMethod] = useState<"value" | "quantity" | "compound">(taxCalculatorCache.ctMethod);
  const [ctSalesAmount, setCtSalesAmount] = useState(taxCalculatorCache.ctSalesAmount); // 销售额
  const [ctAdValoremRate, setCtAdValoremRate] = useState(taxCalculatorCache.ctAdValoremRate); // 比例税率 20%
  const [ctSalesQty, setCtSalesQty] = useState(taxCalculatorCache.ctSalesQty); // 销售数量 (如升/斤)
  const [ctUnitTax, setCtUnitTax] = useState(taxCalculatorCache.ctUnitTax); // 定额税 (如0.5元/斤)

  const consumptionResult = useMemo(() => {
    const amt = Math.max(0, Number(ctSalesAmount) || 0);
    const rate = (Math.max(0, Number(ctAdValoremRate) || 0)) / 100;
    const qty = Math.max(0, Number(ctSalesQty) || 0);
    const unit = Math.max(0, Number(ctUnitTax) || 0);

    let valTax = 0;
    let qtyTax = 0;

    if (ctMethod === "value") {
      valTax = amt * rate;
    } else if (ctMethod === "quantity") {
      qtyTax = qty * unit;
    } else {
      // 复合计税 (如白酒 20% + 0.5元/斤)
      valTax = amt * rate;
      qtyTax = qty * unit;
    }

    return {
      valTax,
      qtyTax,
      totalTax: valTax + qtyTax,
    };
  }, [ctMethod, ctSalesAmount, ctAdValoremRate, ctSalesQty, ctUnitTax]);

  // ========================================================
  // 7. 关税与外贸退税状态
  // ========================================================
  const [tradeMode, setTradeMode] = useState<"import" | "export">(taxCalculatorCache.tradeMode);
  const [cifAmount, setCifAmount] = useState(taxCalculatorCache.cifAmount); // 进口完税价格 CIF (元)
  const [tariffRate, setTariffRate] = useState(taxCalculatorCache.tariffRate); // 关税税率 %
  const [importVatRate, setImportVatRate] = useState(taxCalculatorCache.importVatRate); // 进口环节增值税 %
  // 出口退税
  const [fobAmount, setFobAmount] = useState(taxCalculatorCache.fobAmount); // FOB 离岸价或专用发票不含税价
  const [rebateRate, setRebateRate] = useState(taxCalculatorCache.rebateRate); // 退税率 %

  // 上面七个页签的输入任一变化就整体写回缓存，保证离开工具（切工具 / 回首页）时缓存里是最新的一份，
  // 回来时 useState 用缓存初始化，用户填过的参数与对应的计算结果都会原样回来。
  useEffect(() => {
    taxCalculatorCache.activeTab = activeTab;
    taxCalculatorCache.iitType = iitType;
    taxCalculatorCache.salaryMonth = salaryMonth;
    taxCalculatorCache.socialInsurance = socialInsurance;
    taxCalculatorCache.specialDeduction = specialDeduction;
    taxCalculatorCache.monthsCount = monthsCount;
    taxCalculatorCache.bonusAmount = bonusAmount;
    taxCalculatorCache.laborAmount = laborAmount;
    taxCalculatorCache.businessRevenue = businessRevenue;
    taxCalculatorCache.businessCost = businessCost;
    taxCalculatorCache.vatCategory = vatCategory;
    taxCalculatorCache.vatInputMode = vatInputMode;
    taxCalculatorCache.vatAmount = vatAmount;
    taxCalculatorCache.vatRate = vatRate;
    taxCalculatorCache.vatInputTaxDeduction = vatInputTaxDeduction;
    taxCalculatorCache.citProfit = citProfit;
    taxCalculatorCache.citEnterpriseType = citEnterpriseType;
    taxCalculatorCache.citRdExpense = citRdExpense;
    taxCalculatorCache.actualVatPaid = actualVatPaid;
    taxCalculatorCache.actualCtPaid = actualCtPaid;
    taxCalculatorCache.urbanArea = urbanArea;
    taxCalculatorCache.applyHalfReduction = applyHalfReduction;
    taxCalculatorCache.stampDocType = stampDocType;
    taxCalculatorCache.stampAmount = stampAmount;
    taxCalculatorCache.stampHalfReduction = stampHalfReduction;
    taxCalculatorCache.ctMethod = ctMethod;
    taxCalculatorCache.ctSalesAmount = ctSalesAmount;
    taxCalculatorCache.ctAdValoremRate = ctAdValoremRate;
    taxCalculatorCache.ctSalesQty = ctSalesQty;
    taxCalculatorCache.ctUnitTax = ctUnitTax;
    taxCalculatorCache.tradeMode = tradeMode;
    taxCalculatorCache.cifAmount = cifAmount;
    taxCalculatorCache.tariffRate = tariffRate;
    taxCalculatorCache.importVatRate = importVatRate;
    taxCalculatorCache.fobAmount = fobAmount;
    taxCalculatorCache.rebateRate = rebateRate;
  }, [
    activeTab,
    iitType,
    salaryMonth,
    socialInsurance,
    specialDeduction,
    monthsCount,
    bonusAmount,
    laborAmount,
    businessRevenue,
    businessCost,
    vatCategory,
    vatInputMode,
    vatAmount,
    vatRate,
    vatInputTaxDeduction,
    citProfit,
    citEnterpriseType,
    citRdExpense,
    actualVatPaid,
    actualCtPaid,
    urbanArea,
    applyHalfReduction,
    stampDocType,
    stampAmount,
    stampHalfReduction,
    ctMethod,
    ctSalesAmount,
    ctAdValoremRate,
    ctSalesQty,
    ctUnitTax,
    tradeMode,
    cifAmount,
    tariffRate,
    importVatRate,
    fobAmount,
    rebateRate,
  ]);

  const tradeResult: TradeResultData = useMemo(() => {
    if (tradeMode === "import") {
      const cif = Math.max(0, Number(cifAmount) || 0);
      const tr = (Math.max(0, Number(tariffRate) || 0)) / 100;
      const vr = (Math.max(0, Number(importVatRate) || 0)) / 100;

      const tariff = cif * tr; // 关税
      const vatBase = cif + tariff; // 进口增值税组成计税价格
      const importVat = vatBase * vr; // 进口增值税
      const totalCustomsTax = tariff + importVat;

      return {
        cif,
        tariff,
        importVat,
        totalCustomsTax,
        totalImportCost: cif + totalCustomsTax,
      };
    } else {
      const fob = Math.max(0, Number(fobAmount) || 0);
      const rr = (Math.max(0, Number(rebateRate) || 0)) / 100;
      const rebateAmount = fob * rr;
      return {
        fob,
        rebateRate,
        rebateAmount,
      };
    }
  }, [tradeMode, cifAmount, tariffRate, importVatRate, fobAmount, rebateRate]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 税种选择 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/40">
        {[
          { id: "individual", label: "个人所得税", icon: User },
          { id: "vat", label: "增值税 (VAT)", icon: Receipt },
          { id: "corporate", label: "企业所得税", icon: Building2 },
          { id: "additional", label: "城市及附加税", icon: Coins },
          { id: "stamp", label: "印花税", icon: FileSpreadsheet },
          { id: "consumption", label: "消费税", icon: ShoppingBag },
          { id: "customs", label: "关税与退税", icon: Globe },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as TaxCategory);
                trackToolUsage("tax-calculator");
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-all text-center",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm shadow-black/5 font-bold border border-border/40"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/40"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ================= 1. 个人所得税 ================= */}
      {activeTab === "individual" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左侧输入参数 */}
          <div className="lg:col-span-2 space-y-4 rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <User className="h-4 w-4 text-emerald-500" />
                收入类型与扣除项设置
              </span>
              <div className="flex rounded-lg bg-muted/60 p-0.5 border border-border/40 text-[11px]">
                {[
                  { id: "salary", label: "工资薪金" },
                  { id: "bonus", label: "年终奖单独计税" },
                  { id: "labor", label: "劳务报酬" },
                  { id: "business", label: "经营所得" },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setIitType(t.id as IitType)}
                    className={cn(
                      "px-2.5 py-1 rounded-md transition-all font-medium",
                      iitType === t.id
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {iitType === "salary" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    税前月薪 / 月度收入 (元)
                  </label>
                  <input
                    type="number"
                    value={salaryMonth}
                    onChange={(e) => setSalaryMonth(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    每月个人缴纳五险一金 (元)
                  </label>
                  <input
                    type="number"
                    value={socialInsurance}
                    onChange={(e) => setSocialInsurance(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    每月专项附加扣除总额 (元)
                  </label>
                  <input
                    type="number"
                    value={specialDeduction}
                    onChange={(e) => setSpecialDeduction(e.target.value)}
                    placeholder="子女教育/租房/房贷/赡养老人等"
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    包括子女教育、房贷利息、租房租金、赡养老人、照护等合计
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    核算累计月数 (1-12个月)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={monthsCount}
                    onChange={(e) => setMonthsCount(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
              </div>
            )}

            {iitType === "bonus" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    全年一次性奖金 / 年终奖总额 (元)
                  </label>
                  <input
                    type="number"
                    value={bonusAmount}
                    onChange={(e) => setBonusAmount(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div className="rounded-xl bg-muted/30 p-3 text-xs text-muted-foreground space-y-1 border border-border/40">
                  <p>💡 <b>年终奖单独计税政策：</b>以全年奖金除以 12 个月后的商数，对照按月换算后的综合所得税率表确定适用税率和速算扣除数。</p>
                </div>
              </div>
            )}

            {iitType === "labor" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    劳务报酬单次含税金额 (元)
                  </label>
                  <input
                    type="number"
                    value={laborAmount}
                    onChange={(e) => setLaborAmount(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  扣除标准：≤4000 元扣 800 元，&gt;4000 元扣 20% 费用，适用 20%/30%/40% 三级超额累进预扣率。
                </p>
              </div>
            )}

            {iitType === "business" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    全年经营收入总额 (元)
                  </label>
                  <input
                    type="number"
                    value={businessRevenue}
                    onChange={(e) => setBusinessRevenue(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    成本、费用及损失 (元)
                  </label>
                  <input
                    type="number"
                    value={businessCost}
                    onChange={(e) => setBusinessCost(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>
              </div>
            )}
          </div>

          {/* 右侧结算卡片 */}
          <div className="rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <span className="text-sm font-semibold text-foreground">
                  个税核算结果
                </span>
                <button
                  onClick={() => handleCopy(JSON.stringify(iitResult, null, 2))}
                  className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  复制结果
                </button>
              </div>

              {iitType === "salary" && "totalTax" in iitResult && (
                <div className="space-y-3 pt-3">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                    <div className="text-xs text-muted-foreground">应纳个人所得税 (累计)</div>
                    <div className="text-2xl font-extrabold text-emerald-500 font-mono">
                      ¥ {(iitResult.totalTax ?? 0).toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 flex justify-between">
                      <span>适用税率: {iitResult.rate ?? 0}%</span>
                      <span>速算扣除数: ¥{iitResult.deduct ?? 0}</span>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">累计应纳税所得额:</span>
                      <span className="font-mono font-medium">¥ {(iitResult.taxableYear ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">平均每月应缴个税:</span>
                      <span className="font-mono font-medium text-emerald-500">¥ {(iitResult.avgMonthTax ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">平均每月税后到手:</span>
                      <span className="font-mono font-semibold text-foreground">¥ {(iitResult.avgMonthTakeHome ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">全年税后累计到手:</span>
                      <span className="font-mono font-bold text-foreground">¥ {(iitResult.afterTaxYear ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              {iitType === "bonus" && "separateTax" in iitResult && (
                <div className="space-y-3 pt-3">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                    <div className="text-xs text-muted-foreground">年终奖单独计税应纳税额</div>
                    <div className="text-2xl font-extrabold text-emerald-500 font-mono">
                      ¥ {(iitResult.separateTax ?? 0).toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 flex justify-between">
                      <span>适用税率: {iitResult.rate ?? 0}%</span>
                      <span>速扣数: ¥{iitResult.deduct ?? 0}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2 text-xs border-b border-border/30">
                    <span className="text-muted-foreground">实际到手奖金:</span>
                    <span className="font-mono font-bold text-foreground text-sm">¥ {(iitResult.takeHome ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              )}

              {iitType === "labor" && "prepayTax" in iitResult && (
                <div className="space-y-3 pt-3">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                    <div className="text-xs text-muted-foreground">劳务报酬预扣预缴税额</div>
                    <div className="text-2xl font-extrabold text-emerald-500 font-mono">
                      ¥ {(iitResult.prepayTax ?? 0).toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      预扣率: {iitResult.rate ?? 0}% (速扣数 ¥{iitResult.quick ?? 0})
                    </div>
                  </div>
                  <div className="flex justify-between py-2 text-xs border-b border-border/30">
                    <span className="text-muted-foreground">税后税款扣除后到手:</span>
                    <span className="font-mono font-bold text-foreground">¥ {(iitResult.takeHome ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              )}

              {iitType === "business" && "tax" in iitResult && (
                <div className="space-y-3 pt-3">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                    <div className="text-xs text-muted-foreground">经营所得应纳个税</div>
                    <div className="text-2xl font-extrabold text-emerald-500 font-mono">
                      ¥ {(iitResult.tax ?? 0).toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1 flex justify-between">
                      <span>适用税率: {iitResult.rate ?? 0}%</span>
                      <span>速算扣除数: ¥{iitResult.deduct ?? 0}</span>
                    </div>
                  </div>
                  <div className="flex justify-between py-2 text-xs border-b border-border/30">
                    <span className="text-muted-foreground">税后净留存利润:</span>
                    <span className="font-mono font-bold text-foreground">¥ {(iitResult.profit ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/30">
              📌 起征点标准：基本减除费用 5,000元/月 (60,000元/年)。个人所得税法已由汇算清缴全面合并实施。
            </div>
          </div>
        </div>
      )}

      {/* ================= 2. 增值税 (VAT) ================= */}
      {activeTab === "vat" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Receipt className="h-4 w-4 text-sky-500" />
                增值税计税参数与发票倒算
              </span>
              <div className="flex rounded-lg bg-muted/60 p-0.5 border border-border/40 text-[11px]">
                <button
                  onClick={() => {
                    setVatCategory("general");
                    setVatRate("13");
                  }}
                  className={cn(
                    "px-3 py-1 rounded-md font-medium transition-all",
                    vatCategory === "general"
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  一般纳税人 (抵扣制)
                </button>
                <button
                  onClick={() => {
                    setVatCategory("small");
                    setVatRate("1");
                  }}
                  className={cn(
                    "px-3 py-1 rounded-md font-medium transition-all",
                    vatCategory === "small"
                      ? "bg-background text-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  小规模纳税人 (简易计税)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  金额输入模式
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setVatInputMode("withTax")}
                    className={cn(
                      "py-2 px-3 text-xs rounded-lg border font-medium transition-all text-center",
                      vatInputMode === "withTax"
                        ? "bg-sky-500/10 border-sky-500 text-sky-500 font-semibold"
                        : "bg-background/60 border-border/50 text-muted-foreground"
                    )}
                  >
                    含税金额倒算
                  </button>
                  <button
                    onClick={() => setVatInputMode("withoutTax")}
                    className={cn(
                      "py-2 px-3 text-xs rounded-lg border font-medium transition-all text-center",
                      vatInputMode === "withoutTax"
                        ? "bg-sky-500/10 border-sky-500 text-sky-500 font-semibold"
                        : "bg-background/60 border-border/50 text-muted-foreground"
                    )}
                  >
                    不含税金额正算
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  {vatInputMode === "withTax" ? "含税销售总额 (元)" : "不含税销售总额 (元)"}
                </label>
                <input
                  type="number"
                  value={vatAmount}
                  onChange={(e) => setVatAmount(e.target.value)}
                  className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  适用税率 / 征收率
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(vatCategory === "general"
                    ? [
                        { label: "13% (制造业/货物)", val: "13" },
                        { label: "9% (交通/建筑/不动产)", val: "9" },
                        { label: "6% (现代服务/金融)", val: "6" },
                        { label: "0% (免税/出口)", val: "0" },
                      ]
                    : [
                        { label: "1% (小规模优惠)", val: "1" },
                        { label: "3% (法定征收率)", val: "3" },
                        { label: "5% (不动产出租)", val: "5" },
                      ]
                  ).map((opt) => (
                    <button
                      key={opt.val}
                      onClick={() => setVatRate(opt.val)}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded-md border transition-all",
                        vatRate === opt.val
                          ? "bg-sky-500 text-white border-sky-500 font-semibold shadow-xs"
                          : "bg-background/60 text-muted-foreground border-border/50 hover:bg-background"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {vatCategory === "general" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    进项税额抵扣 (元)
                  </label>
                  <input
                    type="number"
                    value={vatInputTaxDeduction}
                    onChange={(e) => setVatInputTaxDeduction(e.target.value)}
                    placeholder="专用发票已认证进项税额"
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <span className="text-sm font-semibold text-foreground">
                  增值税核算结果
                </span>
                <button
                  onClick={() => handleCopy(JSON.stringify(vatResult, null, 2))}
                  className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </button>
              </div>

              <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-4">
                <div className="text-xs text-muted-foreground">实际应缴纳增值税额</div>
                <div className="text-2xl font-extrabold text-sky-500 font-mono">
                  ¥ {vatResult.payableTax.toFixed(2)}
                </div>
                {vatResult.isSmallExempt && (
                  <div className="text-[11px] text-amber-500 font-medium mt-1">
                    🎉 享受小规模纳税人月度不含税销售额≤10万元免税政策！
                  </div>
                )}
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-border/30">
                  <span className="text-muted-foreground">不含税销售金额:</span>
                  <span className="font-mono font-medium">¥ {vatResult.withoutTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/30">
                  <span className="text-muted-foreground">销项税额:</span>
                  <span className="font-mono font-medium">¥ {vatResult.outputTax.toFixed(2)}</span>
                </div>
                {vatCategory === "general" && (
                  <div className="flex justify-between py-1 border-b border-border/30">
                    <span className="text-muted-foreground">进项抵扣税额:</span>
                    <span className="font-mono font-medium text-emerald-500">- ¥ {vatResult.deduction.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between py-1 border-b border-border/30">
                  <span className="text-muted-foreground">含税销售总额:</span>
                  <span className="font-mono font-bold text-foreground">¥ {vatResult.withTax.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/30">
              💡 公式：不含税额 = 含税额 ÷ (1 + 税率)；税额 = 不含税额 × 税率。
            </div>
          </div>
        </div>
      )}

      {/* ================= 3. 企业所得税 (CIT) ================= */}
      {activeTab === "corporate" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm">
            <span className="text-sm font-semibold text-foreground flex items-center gap-1.5 border-b border-border/40 pb-3">
              <Building2 className="h-4 w-4 text-indigo-500" />
              企业类型与利润总额
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  企业所得税主体类型
                </label>
                <div className="space-y-1.5">
                  {[
                    { id: "small_low_profit", label: "小型微利企业", desc: "年所得≤300万，减按25%计税，实际税负 5%" },
                    { id: "high_tech", label: "高新技术企业", desc: "国家重点扶持，优惠税率 15%" },
                    { id: "standard", label: "一般居民企业", desc: "法定标准税率 25%" },
                  ].map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setCitEnterpriseType(item.id as CitType)}
                      className={cn(
                        "p-2.5 rounded-lg border transition-all cursor-pointer",
                        citEnterpriseType === item.id
                          ? "bg-indigo-500/10 border-indigo-500/50 shadow-xs"
                          : "bg-background/60 border-border/40 hover:bg-background"
                      )}
                    >
                      <div className="text-xs font-semibold text-foreground">{item.label}</div>
                      <div className="text-[10px] text-muted-foreground">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    年度利润总额 / 应纳税所得额 (元)
                  </label>
                  <input
                    type="number"
                    value={citProfit}
                    onChange={(e) => setCitProfit(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    研发费用总额 (元)
                  </label>
                  <input
                    type="number"
                    value={citRdExpense}
                    onChange={(e) => setCitRdExpense(e.target.value)}
                    placeholder="未形成无形资产计入当期损益"
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    符合条件研发费用享受 100% 税前加计扣除政策
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <span className="text-sm font-semibold text-foreground">企税核算结果</span>
                <button
                  onClick={() => handleCopy(JSON.stringify(citResult, null, 2))}
                  className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1"
                >
                  <Copy className="h-3.5 w-3.5" />
                  复制
                </button>
              </div>

              <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-4">
                <div className="text-xs text-muted-foreground">应纳企业所得税额</div>
                <div className="text-2xl font-extrabold text-indigo-500 font-mono">
                  ¥ {citResult.finalTax.toFixed(2)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  综合实际有效税负率: <b className="text-foreground">{citResult.effectiveRate.toFixed(2)}%</b>
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-border/30">
                  <span className="text-muted-foreground">调整后应纳税所得额:</span>
                  <span className="font-mono font-medium">¥ {citResult.taxableIncome.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/30">
                  <span className="text-muted-foreground">税后净留存利润:</span>
                  <span className="font-mono font-bold text-foreground">¥ {citResult.afterTaxProfit.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/30">
              📌 小微企业判定：从事国家非限制和禁止行业，年度应纳税所得额不超过300万元、从业人数不超过300人、资产总额不超过5000万元。
            </div>
          </div>
        </div>
      )}

      {/* ================= 4. 附加税费 ================= */}
      {activeTab === "additional" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm">
            <span className="text-sm font-semibold text-foreground flex items-center gap-1.5 border-b border-border/40 pb-3">
              <Coins className="h-4 w-4 text-amber-500" />
              城建税与教育费附加税基
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  实际缴纳增值税 (元)
                </label>
                <input
                  type="number"
                  value={actualVatPaid}
                  onChange={(e) => setActualVatPaid(e.target.value)}
                  className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  实际缴纳消费税 (元)
                </label>
                <input
                  type="number"
                  value={actualCtPaid}
                  onChange={(e) => setActualCtPaid(e.target.value)}
                  className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  纳税人所在地 (城建税率)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "city", label: "市区 (7%)" },
                    { id: "county", label: "县城/镇 (5%)" },
                    { id: "other", label: "其他 (1%)" },
                  ].map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setUrbanArea(o.id as UrbanArea)}
                      className={cn(
                        "py-2 px-2 text-xs rounded-lg border font-medium transition-all text-center",
                        urbanArea === o.id
                          ? "bg-amber-500/10 border-amber-500 text-amber-500 font-semibold"
                          : "bg-background/60 border-border/50 text-muted-foreground"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 flex flex-col justify-end">
                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-muted/30 border border-border/40">
                  <input
                    type="checkbox"
                    checked={applyHalfReduction}
                    onChange={(e) => setApplyHalfReduction(e.target.checked)}
                    className="rounded border-border text-amber-500 focus:ring-amber-500 h-4 w-4"
                  />
                  <span className="text-xs text-foreground font-medium">
                    享受“六税两费”减半优惠政策 (减征 50%)
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <span className="text-sm font-semibold text-foreground">附加税核算结果</span>
              </div>

              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
                <div className="text-xs text-muted-foreground">附加税费合计应纳额</div>
                <div className="text-2xl font-extrabold text-amber-500 font-mono">
                  ¥ {additionalResult.total.toFixed(2)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  税基 (增值税+消费税): ¥{additionalResult.base.toFixed(2)}
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-border/30">
                  <span className="text-muted-foreground">城市维护建设税 ({additionalResult.urbanRate}%):</span>
                  <span className="font-mono font-medium">¥ {additionalResult.urbanTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/30">
                  <span className="text-muted-foreground">教育费附加 (3%):</span>
                  <span className="font-mono font-medium">¥ {additionalResult.eduTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/30">
                  <span className="text-muted-foreground">地方教育附加 (2%):</span>
                  <span className="font-mono font-medium">¥ {additionalResult.localEduTax.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/30">
              💡 城建税以实际缴纳的两税为基数；免抵税额也纳入计征范围。
            </div>
          </div>
        </div>
      )}

      {/* ================= 5. 印花税 ================= */}
      {activeTab === "stamp" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm">
            <span className="text-sm font-semibold text-foreground flex items-center gap-1.5 border-b border-border/40 pb-3">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
              凭证类型与计税金额
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  应税凭证/合同类别
                </label>
                <div className="space-y-1">
                  {Object.entries(STAMP_RATES).map(([key, val]) => (
                    <div
                      key={key}
                      onClick={() => setStampDocType(key)}
                      className={cn(
                        "p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between text-xs",
                        stampDocType === key
                          ? "bg-emerald-500/10 border-emerald-500/50 shadow-xs text-foreground font-semibold"
                          : "bg-background/60 border-border/40 text-muted-foreground hover:bg-background"
                      )}
                    >
                      <span>{val.name}</span>
                      <span className="font-mono text-[11px]">{val.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    合同/交易金额 (元)
                  </label>
                  <input
                    type="number"
                    value={stampAmount}
                    onChange={(e) => setStampAmount(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  />
                </div>

                {stampDocType !== "stock" && (
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-muted/30 border border-border/40">
                    <input
                      type="checkbox"
                      checked={stampHalfReduction}
                      onChange={(e) => setStampHalfReduction(e.target.checked)}
                      className="rounded border-border text-emerald-500 focus:ring-emerald-500 h-4 w-4"
                    />
                    <span className="text-xs text-foreground font-medium">
                      小微企业“六税两费”印花税减半 50% 征收
                    </span>
                  </label>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <span className="text-sm font-semibold text-foreground">印花税结果</span>
              </div>

              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                <div className="text-xs text-muted-foreground">应缴纳印花税</div>
                <div className="text-2xl font-extrabold text-emerald-500 font-mono">
                  ¥ {stampResult.tax.toFixed(2)}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  凭证: {stampResult.name} ({stampResult.rateStr})
                </div>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/30">
              📌 印花税法自2022年7月1日起施行，未列明的合同（如普通劳务合同）不征收印花税。
            </div>
          </div>
        </div>
      )}

      {/* ================= 6. 消费税 ================= */}
      {activeTab === "consumption" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <ShoppingBag className="h-4 w-4 text-purple-500" />
                应税消费品计税模式
              </span>
              <div className="flex rounded-lg bg-muted/60 p-0.5 border border-border/40 text-[11px]">
                <button
                  onClick={() => setCtMethod("value")}
                  className={cn("px-2.5 py-1 rounded-md font-medium", ctMethod === "value" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground")}
                >
                  从价计税
                </button>
                <button
                  onClick={() => setCtMethod("quantity")}
                  className={cn("px-2.5 py-1 rounded-md font-medium", ctMethod === "quantity" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground")}
                >
                  从量计税
                </button>
                <button
                  onClick={() => setCtMethod("compound")}
                  className={cn("px-2.5 py-1 rounded-md font-medium", ctMethod === "compound" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground")}
                >
                  复合计税 (白酒/卷烟)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(ctMethod === "value" || ctMethod === "compound") && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      应税销售额 (元)
                    </label>
                    <input
                      type="number"
                      value={ctSalesAmount}
                      onChange={(e) => setCtSalesAmount(e.target.value)}
                      className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      从价比例税率 (%)
                    </label>
                    <input
                      type="number"
                      value={ctAdValoremRate}
                      onChange={(e) => setCtAdValoremRate(e.target.value)}
                      placeholder="如白酒20%, 高档手表20%"
                      className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                  </div>
                </>
              )}

              {(ctMethod === "quantity" || ctMethod === "compound") && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      销售数量 (计量单位如升/斤/支)
                    </label>
                    <input
                      type="number"
                      value={ctSalesQty}
                      onChange={(e) => setCtSalesQty(e.target.value)}
                      className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      单位税额 (元/单位)
                    </label>
                    <input
                      type="number"
                      value={ctUnitTax}
                      onChange={(e) => setCtUnitTax(e.target.value)}
                      placeholder="如白酒0.5元/斤"
                      className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <span className="text-sm font-semibold text-foreground">消费税核算结果</span>
              </div>

              <div className="rounded-xl bg-purple-500/10 border border-purple-500/20 p-4">
                <div className="text-xs text-muted-foreground">应纳消费税额</div>
                <div className="text-2xl font-extrabold text-purple-500 font-mono">
                  ¥ {consumptionResult.totalTax.toFixed(2)}
                </div>
              </div>

              <div className="space-y-2 text-xs">
                {consumptionResult.valTax > 0 && (
                  <div className="flex justify-between py-1 border-b border-border/30">
                    <span className="text-muted-foreground">从价计税部分:</span>
                    <span className="font-mono font-medium">¥ {consumptionResult.valTax.toFixed(2)}</span>
                  </div>
                )}
                {consumptionResult.qtyTax > 0 && (
                  <div className="flex justify-between py-1 border-b border-border/30">
                    <span className="text-muted-foreground">从量计税部分:</span>
                    <span className="font-mono font-medium">¥ {consumptionResult.qtyTax.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/30">
              📌 消费税为单一环节征收的价内税，主要针对烟、酒、贵重首饰、成品油、小汽车等特定商品。
            </div>
          </div>
        </div>
      )}

      {/* ================= 7. 关税与出口退税 ================= */}
      {activeTab === "customs" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Globe className="h-4 w-4 text-sky-500" />
                进出口贸易税费核算
              </span>
              <div className="flex rounded-lg bg-muted/60 p-0.5 border border-border/40 text-[11px]">
                <button
                  onClick={() => setTradeMode("import")}
                  className={cn("px-3 py-1 rounded-md font-medium", tradeMode === "import" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground")}
                >
                  进口关税与增值税
                </button>
                <button
                  onClick={() => setTradeMode("export")}
                  className={cn("px-3 py-1 rounded-md font-medium", tradeMode === "export" ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground")}
                >
                  出口货物退免税
                </button>
              </div>
            </div>

            {tradeMode === "import" ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    完税价格 CIF (到岸价/元)
                  </label>
                  <input
                    type="number"
                    value={cifAmount}
                    onChange={(e) => setCifAmount(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    关税税率 (%)
                  </label>
                  <input
                    type="number"
                    value={tariffRate}
                    onChange={(e) => setTariffRate(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    进口增值税率 (%)
                  </label>
                  <input
                    type="number"
                    value={importVatRate}
                    onChange={(e) => setImportVatRate(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    退税计税金额 / FOB 离岸价 (元)
                  </label>
                  <input
                    type="number"
                    value={fobAmount}
                    onChange={(e) => setFobAmount(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">
                    出口退税率 (%)
                  </label>
                  <input
                    type="number"
                    value={rebateRate}
                    onChange={(e) => setRebateRate(e.target.value)}
                    className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-border/40">
                <span className="text-sm font-semibold text-foreground">外贸税费结果</span>
              </div>

              {tradeMode === "import" && "totalCustomsTax" in tradeResult && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-4">
                    <div className="text-xs text-muted-foreground">进口环节综合税费合计</div>
                    <div className="text-2xl font-extrabold text-sky-500 font-mono">
                      ¥ {(tradeResult.totalCustomsTax ?? 0).toFixed(2)}
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">进口关税:</span>
                      <span className="font-mono font-medium">¥ {(tradeResult.tariff ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">进口环节增值税:</span>
                      <span className="font-mono font-medium">¥ {(tradeResult.importVat ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/30">
                      <span className="text-muted-foreground">总进口成本 (CIF+税):</span>
                      <span className="font-mono font-bold text-foreground">¥ {(tradeResult.totalImportCost ?? 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              {tradeMode === "export" && "rebateAmount" in tradeResult && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4">
                    <div className="text-xs text-muted-foreground">应退增值税额 (出口退税)</div>
                    <div className="text-2xl font-extrabold text-emerald-500 font-mono">
                      ¥ {(tradeResult.rebateAmount ?? 0).toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      退税率: {tradeResult.rebateRate}%
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="text-[10px] text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/30">
              💡 公式：进口关税 = CIF × 关税率；进口增值税 = (CIF + 关税 + 消费税) × 增值税率。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
