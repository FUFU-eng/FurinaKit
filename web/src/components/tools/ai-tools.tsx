"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/ai-tools.tsx");


import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, CheckCircle2, Copy, Download, FileText, Languages, Loader2,
  Settings2, Sparkles, Table2, Wand2, KeyRound, PlugZap, Save, RefreshCw,
} from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

/* ────────────────────────── 配置面板（设置页与工具页共用） ────────────────────────── */

interface AiConfig {
  provider: string;
  providerName?: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface Preset {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
}

export const DEFAULT_AI_PRESETS: Preset[] = [
  {
    id: "deepseek",
    name: "DeepSeek (深度求索)",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "openai",
    name: "OpenAI (官方 / 兼容代理)",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
  },
  {
    id: "kimi",
    name: "月之暗面 (Kimi / Moonshot)",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "qwen",
    name: "通义千问 (阿里云百炼)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
  },
  {
    id: "glm",
    name: "智谱清言 (BigModel)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-plus", "glm-4"],
  },
  {
    id: "ollama",
    name: "Ollama (本地私有大模型)",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3:latest", "qwen2.5:latest", "deepseek-r1:latest"],
  },
  {
    id: "custom",
    name: "自定义 OpenAI 兼容接口",
    baseUrl: "",
    models: [],
  },
];

export function useAiConfig() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [presets, setPresets] = useState<Preset[]>(DEFAULT_AI_PRESETS);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/config", { cache: "no-store" });
      const data = await res.json();
      setConfig(data.config ?? null);
      if (Array.isArray(data.presets) && data.presets.length > 0) {
        setPresets(data.presets);
      } else {
        setPresets(DEFAULT_AI_PRESETS);
      }
    } catch {
      setConfig(null);
      setPresets(DEFAULT_AI_PRESETS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { config, presets, loading, reload, setConfig };
}

export function AiConfigPanel({ compact = false }: { compact?: boolean }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const { config, presets, reload } = useAiConfig();
  const [provider, setProvider] = useState("deepseek");
  const [providerName, setProviderName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [model, setModel] = useState("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState("0.3");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    if (config && config.provider) {
      setProvider(presets.some(p=>p.id===config.provider)?config.provider:"custom");
      setProviderName(config.providerName || (presets.some(p=>p.id===config.provider)?"":config.provider));
      setBaseUrl(config.baseUrl || "");
      setModel(config.model || "");
      setTemperature(String(config.temperature ?? 0.3));
    } else if (presets.length) {
      const p = presets.find((x) => x.id === "deepseek") || presets[0];
      setProvider(p.id);
      setBaseUrl(p.baseUrl);
      setModel(p.models[0] ?? "");
    }
  }, [config, presets]);

  useEffect(()=>setTesting(null),[provider,baseUrl,model,apiKey]);

  const currentPreset = presets.find((p) => p.id === provider);

  const applyPreset = (id: string) => {
    setProvider(id);
    setTesting(null);
    setApiKey("");
    if(id==="custom"){setBaseUrl("");setModel("");setProviderName("");return;}
    const p = presets.find((x) => x.id === id);
    if (p && p.baseUrl) {
      setBaseUrl(p.baseUrl);
      if (p.models[0]) setModel(p.models[0]);
    }
  };

  const save = async () => {
    if(provider==="custom"&&!providerName.trim()){toast({title:"请输入服务商名称",variant:"error"});return;}
    setBusy("save");
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, providerName: provider === "custom" ? providerName.trim() : currentPreset?.name, baseUrl: baseUrl.trim(), model: model.trim(), temperature, ...(apiKey ? { apiKey } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setApiKey("");
      await reload();
      toast({ title: "已保存", description: "配置已保存；请点击连接验证确认当前模型可用", variant: "success" });
    } catch (err) {
      toast({ title: "保存失败", description: err instanceof Error ? err.message : "", variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    if(provider==="custom"&&!providerName.trim()){toast({title:"请输入服务商名称",variant:"error"});return;}
    // 1. 严格的前置拦截：禁止未填写任何配置直接报成功欺骗用户
    if (!baseUrl.trim()) {
      toast({ title: "请填写接口地址", description: "接口 Base URL 不能为空", variant: "error" });
      setTesting("接口地址不能为空");
      return;
    }
    setBusy("test");
    setTesting(null);
    try {
      // 2. 先持久化保存当前设置
      const saveRes = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, providerName: provider === "custom" ? providerName.trim() : currentPreset?.name, baseUrl: baseUrl.trim(), model: model.trim(), temperature, ...(apiKey ? { apiKey } : {}) }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json();
        throw new Error(d.error || "保存失败");
      }
      setApiKey("");
      await reload();

      // 3. 执行后端真实连通性探测
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = await res.json();
      const isOk = Boolean(data.ok);
      const msg = data.message || (isOk ? "连接正常" : "连接失败");
      setTesting(msg);
      toast({
        title: isOk ? "连接正常" : "连接失败",
        description: msg,
        variant: isOk ? "success" : "error",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "测试失败";
      setTesting(msg);
      toast({ title: "测试失败", description: msg, variant: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
      <header className="mb-3.5 flex flex-wrap items-center gap-2">
        <KeyRound size={16} />
        <h2 className={cn("font-semibold", compact ? "text-[13.5px]" : "text-[15px]")} style={{ color: colors.text }}>
          {__ui("AI 服务配置")}</h2>
        {config?.hasKey ? (
          <span className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]" style={{ background: `${colors.green}1a`, color: colors.green }}>
            <CheckCircle2 size={11} /> {__ui("已配置")}</span>
        ) : (
          <span className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]" style={{ background: `${colors.gold}1a`, color: colors.gold }}>
            <AlertCircle size={11} /> {__ui("未配置")}</span>
        )}
      </header>

      <fieldset disabled={!!busy} className="grid gap-3.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("服务商")}</span>
          <Select disabled={!!busy} value={provider} onChange={(e) => applyPreset(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.id === "custom" ? __ui("自行输入服务商名称（OpenAI 兼容）") : p.name}</option>
            ))}
          </Select>
          {provider === "custom" && <><Input aria-label={__ui("自定义服务商名称")} value={providerName} onChange={e=>setProviderName(e.target.value)} placeholder={__ui("输入服务商名称，例如新服务商或私有部署")}/><span className="text-[11px] text-muted-foreground">{__ui("名称用于标识；请填写服务商提供的兼容接口地址和模型 ID，不限制预设名单。")}</span></>}
        </label>

        <ModelField
          key={provider + baseUrl}
          requestConfig={{provider,providerName,baseUrl,model,...(apiKey?{apiKey}:{})}}
          value={model}
          onChange={setModel}
          presetModels={currentPreset?.models ?? []}
          baseUrl={baseUrl}
          colors={colors}
        />

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="flex items-center justify-between text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("接口地址")}{currentPreset?.baseUrl && <button type="button" className="text-xs text-sky-500" onClick={()=>setBaseUrl(currentPreset.baseUrl)}>{__ui("恢复服务商默认地址")}</button>}</span>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" className="font-mono text-[12.5px]" />
          <span className="text-[11px] text-muted-foreground">{__ui("选择内置服务商会自动填写地址，也可直接修改为兼容代理或私有端点。换地址后需重新填写密钥。")}</span>
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>
            API Key {config?.hasKey && <span style={{ color: colors.muted }}>{__ui("（已保存，留空则不修改）")}</span>}
          </span>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config?.hasKey ? __ui("••••••••（留空表示不修改）") : __ui("粘贴你的 API Key")}
            className="font-mono text-[12.5px]"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("创作随机度")}{temperature}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            className="w-full"
          />
          <span className="text-[11px]" style={{ color: colors.muted }}>{__ui("越低越稳定严谨，越高越发散（写作用 0.6~0.8 更自然）")}</span>
        </label>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button className="gap-1.5" onClick={() => void save()} disabled={busy !== null}>
          {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {__ui("保存配置")}</Button>
        <Button variant="outline" className="gap-1.5" onClick={() => void test()} disabled={busy !== null}>
          {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
          {__ui("测试连接")}</Button>
        {testing && (
          <span className="text-[12px]" style={{ color: testing.includes("正常") ? colors.green : colors.red }}>{testing}</span>
        )}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
        {__ui("配置与密钥保存在本机用户目录，请勿将配置文件分享给他人； 调用时在本机后端完成，不会把已保存密钥下发给页面。点击连接验证会发起一次真实模型请求，可能产生 API 费用；读取模型也会联网。")}</p>
    </section>
  );
}

/* ────────────────────────── 模型名输入（可自由填写 + 可拉取清单） ────────────────────────── */

/**
 * 模型名不是只能从预设里选。
 *  · 输入框可以随意填写，任何型号都能用；
 *  · 输入时给出常见型号建议（datalist）；
 *  · 「读取可用模型」按钮直接问服务商要当前清单（GET /models），
 *    厂商上新后点一下就能选到，不用等软件更新。
 */
function ModelField({
  value,
  onChange,
  presetModels,
  baseUrl,
  colors,
  requestConfig,
}: {
  requestConfig: Record<string, unknown>;
  value: string;
  onChange: (v: string) => void;
  presetModels: string[];
  baseUrl: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const __locale = __useLanguage();
  const { toast } = useToast();
  const [fetched, setFetched] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [manualMode, setManualMode] = useState(false);

  // Merge fetched + preset, deduplicated
  const options = useMemo(() => {
    return [...new Set([...fetched, ...presetModels])];
  }, [fetched, presetModels, __locale]);

  // If value is not in preset options and not empty, switch to manual mode automatically
  useEffect(() => {
    if (options.length === 0 || (value && !options.includes(value))) {
      setManualMode(true);
    }
  }, [options, value]);

  const fetchModels = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/ai/models", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(requestConfig) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "读取模型失败");
      if (data.models?.length) {
        setFetched(data.models);
        setManualMode(false);
        toast({ title: `读到 ${data.models.length} 个可用模型`, description: "已加入下拉列表，直接选择即可", variant: "success" });
      } else {
        toast({ title: "没读到模型列表", description: data.error || "请确认接口地址与密钥", variant: "error" });
      }
    } catch (e) {
      toast({ title: "读取失败", description: e instanceof Error ? e.message : String(e), variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "__custom__") {
      setManualMode(true);
    } else {
      onChange(val);
    }
  };

  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between gap-2 text-[12.5px] font-medium" style={{ color: colors.text }}>
        <span>{__ui("模型")}</span>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setManualMode(!manualMode)}
            className="text-[11.5px] font-normal transition-opacity hover:underline cursor-pointer"
            style={{ color: "hsl(var(--primary))" }}
          >
            {manualMode ? __ui("从预设选择") : __ui("手动输入")}
          </button>
          <button
            type="button"
            onClick={() => void fetchModels()}
            disabled={busy || !baseUrl}
            className="flex items-center gap-1 text-[11.5px] font-normal transition-opacity disabled:opacity-40 cursor-pointer"
            style={{ color: "hsl(var(--primary))" }}
            title={__ui("向服务商查询当前可用的模型（需要先填好接口地址与密钥）")}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {__ui("读取可用模型")}</button>
        </div>
      </span>

      {/* 与服务商完全一致的自定义 Select 下拉；可切换为自由输入 */}
      {manualMode ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={__ui("可以直接输入任意型号，例如 deepseek-chat")}
          className="font-mono text-[12.5px] h-11"
        />
      ) : (
        <Select
          value={value}
          onChange={handleSelectChange}
        >
          {options.length === 0 && (
            <option value="" disabled>{__ui("暂无预设，点击右上角手动输入")}</option>
          )}
          {options.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
          <option value="__custom__">{__ui("✏️ 手动输入其他型号...")}</option>
        </Select>
      )}

      <span className="text-[11px]" style={{ color: colors.muted }}>
        {manualMode
          ? __ui("当前为手动输入模式，可自由填写任意型号；点击右上角「从预设选择」可切回下拉")
          : __ui("预设为常用推荐；也可以点击右上角手动输入，或点「读取可用模型」自动拉取")}
      </span>
    </label>
  );
}


/* ────────────────────────── 通用：未配置时的引导 ────────────────────────── */

function NotConfigured({ onSaved }: { onSaved?: () => void }) {
  const __locale = __useLanguage();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5 rounded-xl border p-4" style={{ borderColor: "rgba(217,119,6,0.4)", background: "rgba(217,119,6,0.08)" }}>
        <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color: "#d97706" }} />
        <p className="text-[12.5px] leading-relaxed">
          {__ui("这个工具需要调用 AI 服务，请先填写 API Key。配置只保存在本机，一次配置后所有 AI 工具都能用。")}</p>
      </div>
      <AiConfigPanel compact />
      {onSaved && (
        <div>
          <Button variant="outline" onClick={onSaved}>{__ui("配置好了，刷新")}</Button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── 通用：结果面板 ────────────────────────── */

function ResultBox({
  text,
  title = "生成结果",
  actions,
  onChange,
  height = "h-80",
}: {
  text: string;
  title?: string;
  actions?: React.ReactNode;
  onChange?: (v: string) => void;
  height?: string;
}) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={15} style={{ color: colors.green }} />
          <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui(title)}</h2>
          <span className="text-[11.5px]" style={{ color: colors.muted }}>{text.length} {__ui("字")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                toast({ title: "已复制", variant: "success" });
              } catch {
                toast({ title: "复制失败，请手动选中", variant: "error" });
              }
            }}
          >
            <Copy size={13} /> {__ui("复制")}</Button>
        </div>
      </header>
      <textarea
        value={text}
        onChange={(e) => onChange?.(e.target.value)}
        readOnly={!onChange}
        className={cn("w-full resize-y rounded-xl border p-3.5 text-[13px] leading-relaxed focus:outline-none", height)}
        style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
      />
    </section>
  );
}

function downloadFile(name: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function useAiRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (payload: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ai/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "调用失败");
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "调用失败");
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/* ────────────────────────── 1. 文字润色 ────────────────────────── */

const POLISH_MODES = [
  { v: "formal", label: "改正式" },
  { v: "casual", label: "改口语" },
  { v: "concise", label: "精简" },
  { v: "expand", label: "扩写" },
  { v: "proofread", label: "纠错校对" },
  { v: "polite", label: "改礼貌" },
  { v: "summary", label: "提取要点" },
];

export function AiPolishTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { config } = useAiConfig();
  const { busy, error, run } = useAiRun();
  const [text, setText] = useState("");
  const [mode, setMode] = useState("formal");
  const [requirement, setRequirement] = useState("");
  const [result, setResult] = useState("");

  if (config && !config.hasKey) return <NotConfigured />;

  const go = async () => {
    const data = await run({ action: "polish", text, mode, requirement });
    if (data) setResult(String(data.result || ""));
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <header className="mb-3.5 flex items-center gap-2">
          <Wand2 size={16} />
          <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("原文")}</h2>
        </header>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={__ui("粘贴需要处理的文字，例如一份通知、一段自我介绍、一封邮件")}
          className="min-h-[180px]"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {POLISH_MODES.map((m) => (
            <button
              key={m.v}
              onClick={() => setMode(m.v)}
              className="rounded-xl border px-3.5 py-1.5 text-[12.5px] font-medium transition-all"
              style={{
                borderColor: mode === m.v ? "hsl(var(--primary))" : colors.borderSolid,
                background: mode === m.v ? colors.active : "transparent",
                color: colors.text,
              }}
            >
              {__ui(m.label)}
            </button>
          ))}
        </div>
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("补充要求（可选）")}</span>
          <Input
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder={__ui("例如：控制在 300 字以内；面向家长；不要用「赋能」这类词")}
          />
        </label>
        <div className="mt-4 flex items-center gap-3">
          <Button className="gap-2" onClick={() => void go()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {busy ? __ui("正在处理…") : __ui("开始处理")}
          </Button>
          <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("原文")}{text.length} {__ui("字")}</span>
        </div>
        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {__msg(error)}
          </p>
        )}
      </section>

      {result && (
        <ResultBox
          text={result}
          title={__ui("处理后")}
          onChange={setResult}
          actions={
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFile(`润色结果-${Date.now()}.txt`, result)}>
              <Download size={13} /> TXT
            </Button>
          }
        />
      )}
    </div>
  );
}

/* ────────────────────────── 2. 智能翻译 ────────────────────────── */

const LANGS = ["中文", "英语", "日语", "韩语", "法语", "德语", "西班牙语", "俄语", "葡萄牙语", "意大利语", "阿拉伯语", "泰语", "越南语"];

export function AiTranslateTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { config } = useAiConfig();
  const { busy, error, run } = useAiRun();
  const [text, setText] = useState("");
  const [target, setTarget] = useState("英语");
  const [source, setSource] = useState("auto");
  const [tone, setTone] = useState("neutral");
  const [terminology, setTerminology] = useState("");
  const [result, setResult] = useState("");

  if (config && !config.hasKey) return <NotConfigured />;

  const go = async () => {
    const data = await run({ action: "translate", text, target, language: source, tone, terminology });
    if (data) setResult(String(data.result || ""));
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <header className="mb-3.5 flex items-center gap-2">
          <Languages size={16} />
          <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("翻译内容")}</h2>
        </header>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={9}
          placeholder={__ui("粘贴需要翻译的段落，支持长文（会自动保留段落结构）")}
          className="min-h-[200px]"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("源语言")}</span>
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="auto">{__ui("自动识别")}</option>
              {LANGS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("目标语言")}</span>
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("语气")}</span>
            <Select value={tone} onChange={(e) => setTone(e.target.value)}>
              <option value="neutral">{__ui("中性")}</option>
              <option value="formal">{__ui("正式书面")}</option>
              <option value="casual">{__ui("口语自然")}</option>
            </Select>
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("术语表（可选）")}</span>
          <Input
            value={terminology}
            onChange={(e) => setTerminology(e.target.value)}
            placeholder={__ui("例如：FurinaKit=芙宁娜工具箱；prompt=提示词")}
          />
        </label>
        <div className="mt-4 flex items-center gap-3">
          <Button className="gap-2" onClick={() => void go()} disabled={busy || !text.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
            {busy ? __ui("正在翻译…") : __ui("开始翻译")}
          </Button>
          <span className="text-[11.5px]" style={{ color: colors.muted }}>{text.length} {__ui("字")}</span>
        </div>
        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {__msg(error)}
          </p>
        )}
      </section>

      {result && (
        <ResultBox
          text={result}
          title={__ui("译文")}
          onChange={setResult}
          actions={
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFile(`译文-${Date.now()}.txt`, result)}>
              <Download size={13} /> TXT
            </Button>
          }
        />
      )}
    </div>
  );
}

/* ────────────────────────── 3. 文档生成 ────────────────────────── */

export function AiDocumentTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { config } = useAiConfig();
  const { busy, error, run } = useAiRun();
  const [topic, setTopic] = useState("");
  const [docType, setDocType] = useState("说明文档");
  const [length, setLength] = useState("中等（800~1500 字）");
  const [audience, setAudience] = useState("");
  const [points, setPoints] = useState("");
  const [result, setResult] = useState("");

  if (config && !config.hasKey) return <NotConfigured />;

  const go = async () => {
    const data = await run({ action: "document", topic, docType, length, audience, points });
    if (data) setResult(String(data.result || ""));
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <header className="mb-3.5 flex items-center gap-2">
          <FileText size={16} />
          <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("想写什么")}</h2>
        </header>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("主题")}</span>
            <Textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              placeholder={__ui("例如：给新同事介绍我们团队的代码评审流程；或者：写一份咖啡机使用说明")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("文种")}</span>
            <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {["说明文档", "产品介绍", "工作总结", "活动方案", "通知公告", "技术方案", "演讲稿", "公众号文章", "学习笔记", "邮件"].map((t) => (
                <option key={t} value={t}>{__msg(t)}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("篇幅")}</span>
            <Select value={length} onChange={(e) => setLength(e.target.value)}>
              {["简短（300~600 字）", "中等（800~1500 字）", "详细（2000 字以上）"].map((t) => (
                <option key={t} value={t}>{__msg(t)}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("读者对象（可选）")}</span>
            <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder={__ui("例如：完全不懂技术的新同事")} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("必须覆盖的要点（可选）")}</span>
            <Input value={points} onChange={(e) => setPoints(e.target.value)} placeholder={__ui("每行一条，或用「；」分隔")} />
          </label>
        </div>
        <div className="mt-4">
          <Button className="gap-2" onClick={() => void go()} disabled={busy || !topic.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            {busy ? __ui("正在撰写…") : __ui("开始撰写")}
          </Button>
        </div>
        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {__msg(error)}
          </p>
        )}
      </section>

      {result && (
        <>
          <ResultBox
            text={result}
            title={__ui("Markdown 原文")}
            onChange={setResult}
            height="h-64"
            actions={
              <>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFile(`文档-${Date.now()}.md`, result, "text/markdown;charset=utf-8")}>
                  <Download size={13} /> Markdown
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFile(`文档-${Date.now()}.txt`, result)}>
                  <Download size={13} /> TXT
                </Button>
              </>
            }
          />
          <DocumentPreview markdown={result} />
        </>
      )}
    </div>
  );
}

/** 简易 Markdown 预览：只处理标题、列表、表格与加粗，够用且不引入依赖 */
function DocumentPreview({ markdown }: { markdown: string }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const blocks = useMemo(() => markdown.split(/\r?\n/), [markdown, __locale]);

  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.+?)`/g, '<code style="padding:0 4px;border-radius:4px;background:rgba(127,127,127,0.15)">$1</code>');

  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
      <header className="mb-3 flex items-center gap-2">
        <FileText size={15} />
        <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("排版预览")}</h2>
        <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("可导出 Markdown 后交给「Markdown 转 PDF」生成文档")}</span>
      </header>
      <div className="flex flex-col gap-1.5 text-[13.5px] leading-relaxed" style={{ color: colors.text }}>
        {blocks.map((line, i) => {
          const t = line.trim();
          if (!t) return <div key={i} className="h-2" />;
          if (t.startsWith("### ")) return <h4 key={i} className="mt-2 text-[14px] font-semibold" dangerouslySetInnerHTML={{ __html: inline(t.slice(4)) }} />;
          if (t.startsWith("## ")) return <h3 key={i} className="mt-2.5 text-[15.5px] font-semibold" dangerouslySetInnerHTML={{ __html: inline(t.slice(3)) }} />;
          if (t.startsWith("# ")) return <h2 key={i} className="mt-1 text-[18px] font-bold" dangerouslySetInnerHTML={{ __html: inline(t.slice(2)) }} />;
          if (/^[-*]\s+/.test(t)) return <div key={i} className="pl-4" dangerouslySetInnerHTML={{ __html: "• " + inline(t.replace(/^[-*]\s+/, "")) }} />;
          if (/^\d+[.、]\s*/.test(t)) return <div key={i} className="pl-4" dangerouslySetInnerHTML={{ __html: inline(t) }} />;
          if (t.startsWith("> ")) {
            return (
              <div key={i} className="border-l-2 pl-3 italic" style={{ borderColor: colors.borderSolid, color: colors.muted }} dangerouslySetInnerHTML={{ __html: inline(t.slice(2)) }} />
            );
          }
          if (t.startsWith("|")) return <div key={i} className="font-mono text-[12.5px]" dangerouslySetInnerHTML={{ __html: inline(t) }} />;
          return <p key={i} dangerouslySetInnerHTML={{ __html: inline(t) }} />;
        })}
      </div>
    </section>
  );
}

/* ────────────────────────── 4. 表格生成 ────────────────────────── */

interface TableData {
  title?: string;
  columns?: string[];
  rows?: (string | number)[][];
}

export function AiTableTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const { config } = useAiConfig();
  const { busy, error, run } = useAiRun();
  const [requirement, setRequirement] = useState("");
  const [rows, setRows] = useState("10");
  const [table, setTable] = useState<TableData | null>(null);
  const [raw, setRaw] = useState("");

  if (config && !config.hasKey) return <NotConfigured />;

  const go = async () => {
    const data = await run({ action: "table", requirement, rows });
    if (data?.table) {
      setTable(data.table as TableData);
      setRaw("");
    } else if (data?.raw) {
      setRaw(String(data.raw));
    }
  };

  const toCsv = () => {
    if (!table?.columns) return "";
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [table.columns.map(esc).join(",")];
    for (const r of table.rows ?? []) lines.push(r.map(esc).join(","));
    return lines.join("\r\n");
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <header className="mb-3.5 flex items-center gap-2">
          <Table2 size={16} />
          <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("需要什么表格")}</h2>
        </header>
        <Textarea
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          rows={3}
          placeholder={__ui("例如：一份 2026 年第一季度部门费用预算表，包含差旅、办公用品、市场推广三类，列出每月金额与季度合计")}
        />
        <div className="mt-3.5 flex flex-wrap items-end gap-3">
          <label className="flex w-32 flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("数据行数")}</span>
            <Select value={rows} onChange={(e) => setRows(e.target.value)}>
              {["5", "10", "20", "30", "50"].map((n) => (
                <option key={n} value={n}>{__count(n, "行")} </option>
              ))}
            </Select>
          </label>
          <Button className="gap-2" onClick={() => void go()} disabled={busy || !requirement.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Table2 size={14} />}
            {busy ? __ui("正在生成…") : __ui("生成表格")}
          </Button>
        </div>
        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {__msg(error)}
          </p>
        )}
      </section>

      {raw && (
        <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <p className="mb-2 text-[12.5px]" style={{ color: colors.muted }}>{__ui("模型没有返回规范结构，以下是原始输出，可手动整理：")}</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[12px]" style={{ color: colors.text }}>{raw}</pre>
        </section>
      )}

      {table?.columns && table.columns.length > 0 && (
        <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Table2 size={15} />
              <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{table.title || __ui("生成结果")}</h2>
              <span className="text-[11.5px]" style={{ color: colors.muted }}>
                {table.columns.length} {__ui("列 ·")}{__count((table.rows ?? []).length, "行")} </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(toCsv());
                    toast({ title: "已复制为 CSV", variant: "success" });
                  } catch {
                    toast({ title: "复制失败", variant: "error" });
                  }
                }}
              >
                <Copy size={13} /> {__ui("复制 CSV")}</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadFile(`${table.title || "表格"}-${Date.now()}.csv`, toCsv(), "text/csv;charset=utf-8")}>
                <Download size={13} /> {__ui("导出 CSV")}</Button>
            </div>
          </header>
          <div className="max-h-[520px] overflow-auto rounded-xl border" style={{ borderColor: colors.borderSolid }}>
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="sticky top-0" style={{ background: colors.card }}>
                <tr>
                  {table.columns.map((c, i) => (
                    <th key={i} className="whitespace-nowrap border-b px-3 py-2 text-left font-semibold" style={{ borderColor: colors.borderSolid, color: colors.text }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(table.rows ?? []).map((r, ri) => (
                  <tr key={ri}>
                    {r.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cn("border-b px-3 py-1.5", typeof cell === "number" && "text-right font-mono")}
                        style={{ borderColor: colors.border, color: colors.text }}
                      >
                        {String(cell ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2.5 text-[11.5px]" style={{ color: colors.muted }}>
            {__ui("需要 Excel 文件的话，把导出的 CSV 拖进「CSV ↔ Excel」工具即可转换。")}</p>
        </section>
      )}
    </div>
  );
}
