"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/food-tools.tsx");


/**
 * 食物热量与营养成分工具：食物热量查询、营养成分查询。
 *
 * 布局选择：
 *   · 食物热量查询 —— **模式 D（表格数据）+ 小计卡片**：核心动作是"查一样食物、按吃的克数算热量、
 *     把几样加起来看看今天大概吃了多少"。所以左边是搜索+列表，右边是"已加入的食物"清单与合计，
 *     清单必须能改份数、能删 —— 这是这个工具真正会被反复用的地方。
 *   · 营养成分查询 —— **模式 D**：一次看一种食物的完整营养构成（蛋白/脂肪/碳水/纤维/钠），
 *     并和"每日参考摄入量"对照。用横向比例条呈现三大营养素供能比最直观。
 *
 * 数据说明：数值取自公开的《中国食物成分表》常见条目与品牌公开营养标签的**近似值**，
 * 单位统一为「每 100 克可食部」。不同品种、做法差异很大，这里给的是参考量级，不宣称精确。
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Apple,
  Beef,
  Coffee,
  Eraser,
  Fish,
  Info,
  Leaf,
  ListPlus,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wheat,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { CopyButton } from "./copy-button";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

function SectionCard({
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
  const __locale = __useLanguage();
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md", className)}>
      {(title || extra) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            {icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
            )}
            {title && <span className="text-sm font-semibold text-foreground">{__ui(title)}</span>}
          </div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

interface Food {
  name: string;
  kcal: number;
  protein: number; // g
  fat: number; // g
  carb: number; // g
  fiber: number; // g
  sodium: number; // mg
  cat: string;
}

/** 数据行格式：名称|热量|蛋白|脂肪|碳水|纤维|钠|分类（均为每 100 克可食部） */
const RAW = `
米饭（蒸）|116|2.6|0.3|25.9|0.3|2|主食
白粥|46|1.1|0.2|9.9|0.1|2|主食
馒头|223|7.0|1.1|47.0|1.3|165|主食
面条（煮）|110|3.9|0.4|24.3|0.5|38|主食
挂面（干）|346|11.0|0.7|75.0|0.8|154|主食
全麦面包|246|9.0|3.3|45.0|6.0|380|主食
白面包|312|7.9|5.1|58.1|2.0|230|主食
玉米（鲜）|112|4.0|1.2|22.8|2.9|1|主食
红薯|86|1.1|0.2|20.1|1.6|28|主食
紫薯|82|1.9|0.3|17.7|1.4|20|主食
土豆|77|2.0|0.2|17.2|0.7|6|主食
山药|57|1.9|0.2|12.4|0.8|18|主食
燕麦片|367|15.0|6.7|61.0|10.6|6|主食
小米（干）|361|9.0|3.1|75.1|1.6|4|主食
糙米（干）|348|7.7|2.7|72.7|3.4|4|主食
年糕|154|3.3|0.6|34.7|0.8|35|主食
米粉（干）|346|8.0|0.1|81.5|0.3|20|主食
饺子（猪肉白菜）|240|9.0|10.0|28.0|1.2|430|主食
包子（肉馅）|227|8.5|8.0|30.0|1.0|400|主食
油条|386|6.9|17.6|51.0|0.9|585|主食
春卷|300|6.0|14.0|38.0|1.2|420|主食
猪里脊肉|155|20.2|7.9|0.7|0|43|肉类
猪五花肉|508|9.5|50.8|0|0|40|肉类
猪蹄|260|22.6|18.8|0|0|101|肉类
猪肉馅|395|13.6|37.0|0|0|60|肉类
牛腩|332|17.1|29.3|0|0|60|肉类
牛里脊|107|22.2|0.9|2.4|0|53|肉类
牛肉丸|210|14.0|13.0|8.0|0|700|肉类
羊腿肉|111|20.5|1.9|0.4|0|54|肉类
鸡胸肉|133|19.4|5.0|2.5|0|34|肉类
鸡腿（去皮）|181|16.0|13.0|0|0|85|肉类
鸡翅|194|17.4|11.8|4.6|0|50|肉类
烤鸭|436|16.6|38.4|6.0|0|80|肉类
香肠|508|24.1|40.7|11.2|0|2309|肉类
火腿肠|212|14.0|10.4|15.6|0|1080|肉类
培根|541|22.3|44.0|9.0|0|1900|肉类
腊肉|498|16.0|48.0|0|0|1200|肉类
午餐肉|229|12.0|17.0|7.0|0|1000|肉类
鸭血|108|13.6|0.4|12.4|0|146|肉类
草鱼|113|16.6|5.2|0|0|46|水产
鲫鱼|108|17.1|2.7|3.8|0|41|水产
三文鱼|139|17.2|7.8|0|0|63|水产
带鱼|127|17.7|4.9|3.1|0|150|水产
虾（基围虾）|101|18.2|1.4|3.9|0|172|水产
螃蟹|103|17.5|2.6|2.3|0|260|水产
鱿鱼|84|17.4|1.4|0|0|134|水产
蛤蜊|62|10.1|1.1|2.8|0|425|水产
海带（鲜）|13|1.2|0.1|2.1|0.5|8|水产
紫菜（干）|250|26.7|1.1|44.1|21.6|711|水产
虾仁|93|18.6|0.8|2.8|0|165|水产
鱼丸|107|11.0|3.0|9.0|0|600|水产
鸡蛋|144|13.3|8.8|2.8|0|131|蛋奶
蛋清|60|11.6|0.1|3.1|0|166|蛋奶
蛋黄|328|15.2|28.2|3.4|0|54|蛋奶
鹌鹑蛋|160|12.8|11.1|2.1|0|106|蛋奶
牛奶（全脂）|54|3.0|3.2|3.4|0|37|蛋奶
牛奶（脱脂）|33|3.4|0.3|5.0|0|45|蛋奶
酸奶（原味）|72|2.5|2.7|9.3|0|39|蛋奶
奶酪（切达）|328|25.7|23.5|3.5|0|584|蛋奶
黄油|888|1.4|98.0|0|0|40|蛋奶
豆浆（无糖）|31|3.0|1.6|1.2|1.1|3|豆制品
豆腐（北）|98|12.2|4.8|1.5|0.5|7|豆制品
豆腐（南）|87|6.2|5.8|2.4|0.4|3|豆制品
豆腐干|140|16.2|3.6|11.5|0.8|76|豆制品
腐竹|459|44.6|21.7|22.3|1.0|27|豆制品
豆皮|409|44.6|17.4|18.8|0.2|10|豆制品
黄豆（干）|390|35.0|16.0|34.2|15.5|2|豆制品
毛豆|131|13.1|5.0|10.5|4.0|4|豆制品
豆芽（黄豆）|44|4.5|1.6|4.5|1.5|7|豆制品
大白菜|17|1.5|0.1|3.2|0.8|57|蔬菜
小白菜|15|1.5|0.3|2.7|1.1|73|蔬菜
菠菜|24|2.6|0.3|4.5|1.7|85|蔬菜
生菜|13|1.3|0.3|2.0|0.7|33|蔬菜
油麦菜|15|1.4|0.4|2.1|0.6|80|蔬菜
西兰花|33|4.1|0.6|4.3|1.6|18|蔬菜
花椰菜|20|2.1|0.2|4.6|1.2|31|蔬菜
番茄|15|0.9|0.2|3.3|0.5|5|蔬菜
黄瓜|15|0.8|0.2|2.9|0.5|5|蔬菜
茄子|21|1.1|0.2|4.9|1.3|5|蔬菜
青椒|22|1.4|0.3|5.4|1.4|3|蔬菜
胡萝卜|39|1.0|0.2|8.8|1.1|71|蔬菜
白萝卜|16|0.9|0.1|5.0|1.0|62|蔬菜
洋葱|40|1.1|0.2|9.0|0.9|4|蔬菜
韭菜|26|2.4|0.4|4.6|1.4|8|蔬菜
芹菜|17|1.2|0.2|4.5|1.2|159|蔬菜
莴笋|15|1.0|0.1|2.8|0.6|36|蔬菜
南瓜|22|0.7|0.1|5.3|0.8|1|蔬菜
冬瓜|11|0.4|0.2|2.6|0.7|2|蔬菜
苦瓜|19|1.0|0.1|3.5|1.4|2|蔬菜
香菇（鲜）|26|2.2|0.3|5.2|3.3|2|蔬菜
金针菇|32|2.4|0.4|6.0|2.7|4|蔬菜
木耳（干）|205|12.1|1.5|65.6|29.9|49|蔬菜
银耳（干）|200|10.0|1.4|67.3|30.4|82|蔬菜
莲藕|70|1.9|0.2|16.4|1.2|44|蔬菜
竹笋|19|2.6|0.2|3.6|1.8|0|蔬菜
苹果|53|0.2|0.2|13.5|1.2|1|水果
香蕉|93|1.4|0.2|22.0|1.2|1|水果
橙子|48|0.8|0.2|11.1|0.6|1|水果
橘子|44|0.7|0.2|10.2|0.4|1|水果
葡萄|45|0.5|0.2|10.3|0.4|1|水果
西瓜|31|0.5|0.3|6.8|0.2|3|水果
哈密瓜|34|0.5|0.1|7.9|0.2|27|水果
草莓|32|1.0|0.2|7.1|1.1|4|水果
蓝莓|57|0.7|0.3|14.5|2.4|1|水果
猕猴桃|61|0.8|0.6|14.5|2.6|10|水果
芒果|35|0.6|0.2|8.3|1.3|2|水果
菠萝|44|0.5|0.1|10.8|1.3|1|水果
梨|51|0.4|0.2|13.3|3.1|2|水果
桃子|51|0.9|0.1|12.2|1.3|6|水果
樱桃|46|1.1|0.2|10.2|0.3|8|水果
荔枝|71|0.9|0.2|16.6|0.5|2|水果
龙眼|71|1.2|0.1|16.6|0.4|4|水果
牛油果|171|2.0|15.3|7.4|2.1|7|水果
椰子|241|4.0|12.1|31.3|4.7|55|水果
柠檬|37|1.1|1.2|6.2|1.3|1|水果
花生（炒）|589|23.9|48.0|21.7|6.3|18|坚果
核桃|646|14.9|58.8|19.1|9.5|6|坚果
杏仁|578|22.5|45.4|23.9|8.0|8|坚果
腰果|559|17.3|36.7|41.6|3.6|251|坚果
开心果|614|20.6|53.0|21.9|8.2|757|坚果
瓜子（葵花）|606|22.6|52.8|17.3|4.5|5|坚果
榛子|594|20.0|44.8|24.3|9.6|4|坚果
栗子（熟）|214|4.8|1.5|46.0|1.2|13|坚果
巧克力（黑 70%）|589|7.8|42.6|45.9|10.9|20|零食
巧克力（牛奶）|546|6.8|35.9|53.4|1.5|110|零食
薯片|548|6.3|37.6|49.7|4.1|500|零食
饼干（苏打）|408|8.4|7.7|76.2|0.2|312|零食
蛋糕（奶油）|379|5.0|20.0|44.0|0.5|200|零食
月饼（豆沙）|406|5.5|14.5|63.0|1.5|180|零食
冰淇淋|127|2.4|5.3|17.3|0|54|零食
果冻|60|0.1|0|15.0|0.2|20|零食
牛肉干|550|45.6|40.0|1.9|0|412|零食
爆米花|459|8.7|21.0|61.0|9.0|490|零食
可乐|43|0|0|10.8|0|4|饮料
雪碧|43|0|0|10.5|0|5|饮料
橙汁（鲜榨）|45|0.7|0.2|10.4|0.2|1|饮料
牛奶咖啡（拿铁）|55|2.9|2.6|4.8|0|35|饮料
美式咖啡|2|0.1|0|0.3|0|3|饮料
奶茶（全糖）|68|1.0|1.9|12.0|0|30|饮料
啤酒|32|0.4|0|2.8|0|4|饮料
红酒|74|0.1|0|2.3|0|4|饮料
豆奶|47|2.4|1.5|5.1|0.4|30|饮料
运动饮料|27|0|0|6.6|0|41|饮料
能量饮料|45|0.4|0|10.8|0|40|饮料
方便面（油炸）|472|9.5|21.1|61.6|0.9|1144|快餐
汉堡包|295|12.9|13.0|31.5|1.4|500|快餐
薯条|298|4.0|15.0|37.0|3.0|210|快餐
披萨|270|11.4|10.4|33.0|2.3|600|快餐
炸鸡（带皮）|279|20.6|17.8|8.5|0.3|700|快餐
烤冷面|196|5.0|7.0|28.0|0.8|500|快餐
麻辣烫（素）|90|3.0|5.0|8.0|1.5|700|快餐
牛肉面|128|6.0|3.5|18.0|0.7|600|快餐
煎饼果子|260|8.0|9.0|37.0|1.2|520|快餐
小笼包|240|8.0|9.0|32.0|0.9|450|快餐
`;

const FOODS: Food[] = RAW.trim()
  .split("\n")
  .map((line) => {
    const [name, kcal, protein, fat, carb, fiber, sodium, cat] = line.split("|");
    return {
      name,
      kcal: Number(kcal),
      protein: Number(protein),
      fat: Number(fat),
      carb: Number(carb),
      fiber: Number(fiber),
      sodium: Number(sodium),
      cat,
    };
  })
  .filter((f) => f.name);

const CATEGORIES = ["全部", ...Array.from(new Set(FOODS.map((f) => f.cat)))];

const CAT_ICON: Record<string, React.ReactNode> = {
  主食: <Wheat className="h-3.5 w-3.5" />,
  肉类: <Beef className="h-3.5 w-3.5" />,
  水产: <Fish className="h-3.5 w-3.5" />,
  蛋奶: <Apple className="h-3.5 w-3.5" />,
  豆制品: <Leaf className="h-3.5 w-3.5" />,
  蔬菜: <Leaf className="h-3.5 w-3.5" />,
  水果: <Apple className="h-3.5 w-3.5" />,
  坚果: <Apple className="h-3.5 w-3.5" />,
  零食: <Coffee className="h-3.5 w-3.5" />,
  饮料: <Coffee className="h-3.5 w-3.5" />,
  快餐: <Beef className="h-3.5 w-3.5" />,
};

// ══════════════════════════════════════════════════════════════════════
// 工具一：食物热量查询（含"今天吃了多少"小计）
// ══════════════════════════════════════════════════════════════════════

interface PlateItem {
  food: Food;
  grams: number;
}

export function FoodCaloriesTool() {
  const __locale = __useLanguage();
  const [keyword, setKeyword] = useToolDraft("food-calories", "keyword", "");
  const [category, setCategory] = useToolDraft("food-calories", "category", "全部");
  const [plate, setPlate] = useState<PlateItem[]>([]);
  const [pickerFood, setPickerFood] = useState<Food | null>(null);
  const [grams, setGrams] = useState("100");
  const [budget, setBudget] = useToolDraft("food-calories", "budget", "2000");

  const list = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return FOODS.filter((f) => (category === "全部" || f.cat === category) && (!kw || f.name.toLowerCase().includes(kw)));
  }, [keyword, category, __locale]);

  const totals = useMemo(() => {
    const t = plate.reduce(
      (acc, item) => {
        const r = item.grams / 100;
        acc.kcal += item.food.kcal * r;
        acc.protein += item.food.protein * r;
        acc.fat += item.food.fat * r;
        acc.carb += item.food.carb * r;
        acc.sodium += item.food.sodium * r;
        return acc;
      },
      { kcal: 0, protein: 0, fat: 0, carb: 0, sodium: 0 },
    );
    return t;
  }, [plate, __locale]);

  const budgetNum = Number(budget) || 2000;
  const percent = Math.min(100, (totals.kcal / budgetNum) * 100);

  const copyText = plate.length
    ? plate.map((p) => `${p.food.name} ${p.grams} 克 —— ${Math.round((p.food.kcal * p.grams) / 100)} 千卡`).join("\n") +
      `\n合计：${Math.round(totals.kcal)} 千卡（蛋白 ${totals.protein.toFixed(1)} g / 脂肪 ${totals.fat.toFixed(1)} g / 碳水 ${totals.carb.toFixed(1)} g）`
    : "";

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：食物库 */}
        <div className="thin-scroll space-y-4 lg:col-span-6">
          <SectionCard
            icon={<Search className="h-4 w-4" />}
            title={__msg("食物库（{0} 种）", list.length)}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setKeyword("鸡");
                  setCategory("全部");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("试搜「鸡」")}</Button>
            }
          >
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={__ui("搜食物名，如「米饭」「鸡胸」「拿铁」")}
                className="pl-9 text-xs"
              />
            </div>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    category === c ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {__msg(c)}
                </button>
              ))}
            </div>

            {list.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">{__ui("未找到该食物，可尝试更短的关键词")}</p>
            ) : (
              <div className="thin-scroll max-h-[420px] overflow-auto rounded-xl border border-border/60">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("食物（每 100 克）")}</th>
                      <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("热量")}</th>
                      <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("蛋白")}</th>
                      <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("操作")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((f) => (
                      <tr key={f.name} className="border-t border-border/40 even:bg-muted/20">
                        <td className="px-3 py-1.5">
                          <span className="flex items-center gap-1.5 text-foreground">
                            <span className="text-primary">{CAT_ICON[f.cat]}</span>
                            {__ui(f.name)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-foreground">{f.kcal}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{f.protein.toFixed(1)} g</td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setPickerFood(f);
                              setGrams(f.cat === "饮料" ? "330" : "100");
                            }}
                            className="rounded-md px-1.5 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/10"
                          >
                            <Plus className="mr-0.5 inline h-3 w-3" />
                            {__ui("加入")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("热量单位：千卡（大卡）/ 100 克可食部。数据为公开食物成分表的近似值，不同做法差异较大。")}</p>
          </SectionCard>
        </div>

        {/* 右：今天吃了多少 */}
        <div className="thin-scroll space-y-4 lg:col-span-6">
          {pickerFood && (
            <SectionCard
              icon={<ListPlus className="h-4 w-4" />}
              title={__msg("加入「{0}」", pickerFood.name)}
              className="border-primary/30"
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fc-grams">{__ui("吃了多少（克 / 毫升）")}</Label>
                  <Input
                    id="fc-grams"
                    type="number"
                    value={grams}
                    onChange={(e) => setGrams(e.target.value)}
                    className="w-32 text-xs"
                  />
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">{__ui("相当于")}</span>
                  <b className="font-mono text-foreground">
                    {Math.round((pickerFood.kcal * (Number(grams) || 0)) / 100)}
                  </b>
                  <span className="text-muted-foreground"> {__ui("千卡")}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      const g = Number(grams) || 0;
                      if (g <= 0) return;
                      setPlate((prev) => [...prev, { food: pickerFood, grams: g }]);
                      setPickerFood(null);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> {__ui("确认加入")}</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPickerFood(null)}>
                    {__ui("取消")}</Button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(pickerFood.cat === "饮料" ? [250, 330, 500] : [50, 100, 200, 300]).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGrams(String(g))}
                    className="rounded-md bg-secondary/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                  >
                    {__msg(g)} {pickerFood.cat === "饮料" ? "ml" : "g"}
                  </button>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard
            icon={<ListPlus className="h-4 w-4" />}
            title={__msg("今天吃了什么（{0} 项）", plate.length)}
            extra={
              <div className="flex items-center gap-2">
                {plate.length > 0 && <CopyButton value={copyText} label={__ui("复制清单")} />}
                {plate.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setPlate([])}>
                    <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
                )}
              </div>
            }
          >
            {plate.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ListPlus className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("从左侧列表中将食物「加入」此处")}</p>
                <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                  {__ui("添加若干项后即可看到本次合计热量与三大营养素占比。")}</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  {plate.map((item, i) => (
                    <div key={`${item.food.name}-${i}`} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground">{__ui(item.food.name)}</span>
                      <Input
                        type="number"
                        value={String(item.grams)}
                        onChange={(e) => {
                          const g = Number(e.target.value) || 0;
                          setPlate((prev) => prev.map((p, pi) => (pi === i ? { ...p, grams: g } : p)));
                        }}
                        className="h-7 w-20 text-[11.5px]"
                      />
                      <span className="text-[11px] text-muted-foreground">{__ui("克")}</span>
                      <span className="w-16 text-right font-mono text-xs text-foreground">
                        {Math.round((item.food.kcal * item.grams) / 100)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPlate((prev) => prev.filter((_, pi) => pi !== i))}
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={__ui("移除")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-[11.5px] text-muted-foreground">{__ui("合计热量")}</div>
                      <div className="font-mono text-2xl font-bold text-primary">
                        {Math.round(totals.kcal)} <span className="text-sm font-normal">{__ui("千卡")}</span>
                      </div>
                    </div>
                    <div className="text-right text-[11.5px] text-muted-foreground">
                      {__ui("蛋白")}{totals.protein.toFixed(1)} {__ui("g · 脂肪")}{totals.fat.toFixed(1)} {__ui("g · 碳水")}{totals.carb.toFixed(1)} g
                      <div>{__ui("钠")}{Math.round(totals.sodium)} mg</div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{__ui("占每日预算")}</span>
                        <span className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={budget}
                            onChange={(e) => setBudget(e.target.value)}
                            className="h-6 w-20 text-[11px]"
                          />
                          <span className="text-muted-foreground">{__ui("千卡")}</span>
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className={cn("h-full rounded-full transition-all", percent >= 100 ? "bg-destructive/70" : "bg-primary")}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <div className="text-right text-[11px] text-muted-foreground">
                        {Math.round(percent)}%
                        {totals.kcal > budgetNum && <span className="ml-1 text-destructive">{__ui("已超出预算")}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：营养成分查询
// ══════════════════════════════════════════════════════════════════════

export function NutritionFactsTool() {
  const __locale = __useLanguage();
  const [foodName, setFoodName] = useToolDraft("nutrition-facts", "foodName", "鸡胸肉");
  const [amount, setAmount] = useToolDraft("nutrition-facts", "amount", "150");

  const food = useMemo(() => FOODS.find((f) => f.name === foodName) || FOODS[0], [foodName, __locale]);
  const grams = Number(amount) || 0;
  const r = grams / 100;

  const macro = useMemo(() => {
    const p = food.protein * r * 4;
    const f = food.fat * r * 9;
    const c = food.carb * r * 4;
    const total = p + f + c || 1;
    return { p, f, c, pPct: (p / total) * 100, fPct: (f / total) * 100, cPct: (c / total) * 100 };
  }, [food, r, __locale]);

  const copyText =
    `${food.name}　${grams} 克\n` +
    `热量 ${Math.round(food.kcal * r)} 千卡\n` +
    `蛋白 ${(food.protein * r).toFixed(1)} g　脂肪 ${(food.fat * r).toFixed(1)} g　碳水 ${(food.carb * r).toFixed(1)} g\n` +
    `膳食纤维 ${(food.fiber * r).toFixed(1)} g　钠 ${Math.round(food.sodium * r)} mg`;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard icon={<Apple className="h-4 w-4" />} title={__ui("选一种食物")}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="nf-food">{__ui("食物（共")}{FOODS.length} {__ui("种）")}</Label>
                <Select id="nf-food" value={food.name} onChange={(e) => setFoodName(e.target.value)} className="w-full text-xs">
                  {CATEGORIES.filter((c) => c !== "全部").map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {FOODS.filter((f) => f.cat === cat).map((f) => (
                        <option key={f.name} value={f.name}>
                          {__ui(f.name)} · {f.kcal} {__ui("千卡")}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nf-amount">{__ui("吃多少（克）")}</Label>
                <Input id="nf-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-xs" />
                <div className="flex gap-1.5">
                  {[50, 100, 150, 200].map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setAmount(String(g))}
                      className="rounded-md bg-secondary/40 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                    >
                      {__msg(g)} g
                    </button>
                  ))}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setFoodName("鸡胸肉");
                  setAmount("150");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("回到示例")}</Button>
            </div>
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("怎么看这份数据")}>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {__ui("数据为每 100 克可食部的近似值，来自公开食物成分表与品牌营养标签。 同一食材因品种、部位、做法（蒸煮煎炸）差别可以很大，这里给的是量级参考。 每日参考摄入量按 2000 千卡膳食计算（成人常见基准）。")}</p>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          <SectionCard
            icon={<Apple className="h-4 w-4" />}
            title={__msg("{0} · {1} 克", food.name, grams)}
            extra={<CopyButton value={copyText} label={__ui("复制营养信息")} />}
          >
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-3 py-2.5">
                <div className="text-[11px] text-muted-foreground">{__ui("热量")}</div>
                <div className="mt-0.5 font-mono text-xl font-bold text-primary">{Math.round(food.kcal * r)}</div>
                <div className="text-[10.5px] text-muted-foreground">{__ui("千卡")}</div>
              </div>
              {[
                { label: "蛋白质", v: food.protein * r, unit: "g", ref: 60 },
                { label: "脂肪", v: food.fat * r, unit: "g", ref: 60 },
                { label: "碳水化合物", v: food.carb * r, unit: "g", ref: 300 },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                  <div className="text-[11px] text-muted-foreground">{__ui(m.label)}</div>
                  <div className="mt-0.5 font-mono text-xl font-bold text-foreground">{m.v.toFixed(1)}</div>
                  <div className="text-[10.5px] text-muted-foreground">
                    {__ui(m.unit)} {__ui("· 约占每日")}{Math.round((m.v / m.ref) * 100)}%
                  </div>
                </div>
              ))}
            </div>

            {/* 三大营养素供能比 */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                <span className="text-muted-foreground">{__ui("三大营养素供能比")}</span>
                <span className="font-mono text-muted-foreground">
                  {__ui("蛋白")}{macro.pPct.toFixed(0)}{__ui("% · 脂肪")}{macro.fPct.toFixed(0)}{__ui("% · 碳水")}{macro.cPct.toFixed(0)}%
                </span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full border border-border/60">
                <div className="bg-primary" style={{ width: `${macro.pPct}%` }} title={__msg("蛋白 {0}%", macro.pPct.toFixed(0))} />
                <div className="bg-amber-400/80" style={{ width: `${macro.fPct}%` }} title={__msg("脂肪 {0}%", macro.fPct.toFixed(0))} />
                <div className="bg-emerald-400/80" style={{ width: `${macro.cPct}%` }} title={__msg("碳水 {0}%", macro.cPct.toFixed(0))} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded bg-primary" /> {__ui("蛋白")}{macro.p.toFixed(0)} {__ui("千卡")}</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded bg-amber-400/80" /> {__ui("脂肪")}{macro.f.toFixed(0)} {__ui("千卡")}</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-3 rounded bg-emerald-400/80" /> {__ui("碳水")}{macro.c.toFixed(0)} {__ui("千卡")}</span>
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={<Search className="h-4 w-4" />} title={__ui("完整营养表")}>
            <div className="overflow-hidden rounded-xl border border-border/60">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("项目")}</th>
                    <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("每 100 克")}</th>
                    <th className="px-3 py-2 text-right font-semibold text-foreground">{grams} {__ui("克")}</th>
                    <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("每日参考")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { k: "热量", per: `${food.kcal} 千卡`, now: `${Math.round(food.kcal * r)} 千卡`, ref: "2000 千卡" },
                    { k: "蛋白质", per: `${food.protein.toFixed(1)} g`, now: `${(food.protein * r).toFixed(1)} g`, ref: "60 g" },
                    { k: "脂肪", per: `${food.fat.toFixed(1)} g`, now: `${(food.fat * r).toFixed(1)} g`, ref: "60 g" },
                    { k: "碳水化合物", per: `${food.carb.toFixed(1)} g`, now: `${(food.carb * r).toFixed(1)} g`, ref: "300 g" },
                    { k: "膳食纤维", per: `${food.fiber.toFixed(1)} g`, now: `${(food.fiber * r).toFixed(1)} g`, ref: "25 g" },
                    { k: "钠", per: `${food.sodium} mg`, now: `${Math.round(food.sodium * r)} mg`, ref: "2000 mg" },
                  ].map((row, i) => (
                    <tr key={row.k} className={cn("border-t border-border/40 even:bg-muted/20", i === 0 && "border-t-0")}>
                      <td className="px-3 py-1.5 text-foreground">{__msg(row.k)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{row.per}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold text-foreground">{row.now}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{row.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {food.sodium * r > 600 && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border-l-4 border-l-amber-500 bg-amber-500/10 px-3 py-2 text-[11.5px] text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                {__ui("这份的钠接近每日参考量的")}{Math.round(((food.sodium * r) / 2000) * 100)}{__ui("%，注意当天其它菜少放盐。")}</div>
            )}
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("同类食物对比（每 100 克热量）")}>
            <div className="space-y-1.5">
              {FOODS.filter((f) => f.cat === food.cat)
                .sort((a, b) => b.kcal - a.kcal)
                .slice(0, 10)
                .map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => setFoodName(f.name)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                      f.name === food.name ? "bg-primary/[0.08]" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="w-28 shrink-0 truncate text-[11.5px] text-foreground">{__ui(f.name)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <span
                        className={cn("block h-full rounded-full", f.name === food.name ? "bg-primary" : "bg-primary/50")}
                        style={{ width: `${Math.min(100, (f.kcal / 900) * 100)}%` }}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{f.kcal}</span>
                  </button>
                ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{__ui("点击任意一行可直接切换到该食物。")}</p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
