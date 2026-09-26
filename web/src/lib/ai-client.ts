import crypto from "crypto";
import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

/**
 * AI 能力接入（OpenAI 兼容接口）
 *
 * 支持 DeepSeek、OpenAI 以及任何兼容 /chat/completions 的服务；密钥与模型配置保存在
 * 用户数据目录下，并用「绑定本机的密钥」做 AES-256-GCM 加密 —— 把配置文件夹拷到别的
 * 电脑、或换一个 Windows 账户，都解不开里面存的东西。
 *
 * 说明：这里没有引入任何第三方依赖，用的是 Node 自带的 crypto。
 */

export interface AiConfig {
  /** 服务商预设，用于界面回显 */
  provider: string;
  /** 接口地址，例如 https://api.deepseek.com/v1 */
  baseUrl: string;
  /** 模型名，例如 deepseek-chat */
  model: string;
  /** 是否已配置密钥（不返回密钥本身） */
  hasKey: boolean;
  /** 生成温度 */
  temperature?: number;
  /** 单次回复上限 */
  maxTokens?: number;
}

export interface AiConfigInput {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}

/** 常见服务商预设（界面上一键切换） */
/**
 * 服务商预设。
 *
 * 注意：models 只是「常见型号建议」，绝不是完整清单 —— 各家上新很快，
 * 所以界面上模型名是**可以自由填写**的，另外还提供了「从服务商读取可用模型」
 * 按钮（走标准的 GET /models），新模型出来直接拉一次就行。
 */
export const PROVIDER_PRESETS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o4-mini", "o3-mini"],
  },
  {
    id: "moonshot",
    name: "月之暗面 Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k2-0905-preview", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-air", "glm-4-flash", "glm-4-long"],
  },
  {
    id: "dashscope",
    name: "阿里通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-long"],
  },
  {
    id: "siliconflow",
    name: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
  },
  {
    id: "volcengine",
    name: "火山方舟（豆包）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-pro-32k", "doubao-lite-32k"],
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    models: ["abab6.5s-chat", "abab6.5-chat"],
  },
  {
    id: "ollama",
    name: "本地 Ollama（无需密钥）",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["qwen2.5:7b", "llama3.1:8b", "deepseek-r1:7b"],
  },
  { id: "custom", name: "自定义（兼容 OpenAI 接口）", baseUrl: "", models: [] },
];

/** 配置文件位置：优先用主进程给的用户数据目录，其次退回系统 AppData */
function configDir(): string {
  const fromEnv = process.env.FURINAKIT_AI_CONFIG_DIR;
  if (fromEnv) return fromEnv;
  const base = process.env.APPDATA || process.env.LOCALAPPDATA || os.homedir();
  return path.join(base, "FurinaKit");
}

function configPath(): string {
  return path.join(configDir(), "ai-config.json");
}

/**
 * 由「机器标识 + 当前用户」派生出加密密钥。
 * 机器标识取自 Windows 的 MachineGuid（注册表），换机器就解不开。
 */
function machineSecret(): string {
  const parts: string[] = [];
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf8", timeout: 10_000, windowsHide: true },
      );
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
      if (m) parts.push(m[1]);
    }
  } catch {
    /* 取不到就退化为只用用户名 */
  }
  parts.push(process.env.USERNAME || process.env.USER || "user");
  parts.push(os.hostname() || "host");
  return parts.join("|");
}

function deriveKey(): Buffer {
  return crypto.scryptSync(machineSecret(), "furinakit-ai-config-v1", 32);
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("配置损坏");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

interface StoredConfig {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
  temperature?: number;
  maxTokens?: number;
}

function readStored(): StoredConfig {
  try {
    const p = configPath();
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf8")) as StoredConfig;
  } catch {
    return {};
  }
}

/** 读取配置（不含密钥明文） */
export function getAiConfig(): AiConfig {
  const stored = readStored();
  return {
    provider: stored.provider || "deepseek",
    baseUrl: stored.baseUrl || PROVIDER_PRESETS[0].baseUrl,
    model: stored.model || PROVIDER_PRESETS[0].models[0],
    hasKey: Boolean(stored.apiKeyEnc),
    temperature: stored.temperature ?? 0.3,
    maxTokens: stored.maxTokens ?? 4096,
  };
}

/** 取密钥明文（只在服务端调用接口时使用） */
export function getApiKey(): string | null {
  const stored = readStored();
  if (!stored.apiKeyEnc) return null;
  try {
    return decrypt(stored.apiKeyEnc);
  } catch {
    return null;
  }
}

/** 保存配置；apiKey 传空字符串表示清除密钥 */
export async function saveAiConfig(input: AiConfigInput): Promise<AiConfig> {
  const stored = readStored();
  if (input.provider !== undefined) stored.provider = input.provider;
  if (input.baseUrl !== undefined) stored.baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  if (input.model !== undefined) stored.model = input.model.trim();
  if (input.temperature !== undefined) stored.temperature = Math.max(0, Math.min(2, Number(input.temperature)));
  if (input.maxTokens !== undefined) stored.maxTokens = Math.max(256, Math.min(32000, Number(input.maxTokens)));
  if (input.apiKey !== undefined) {
    stored.apiKeyEnc = input.apiKey.trim() ? encrypt(input.apiKey.trim()) : undefined;
  }
  await fs.mkdir(configDir(), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(stored, null, 2), { encoding: "utf8", mode: 0o600 });
  return getAiConfig();
}

/** 是否已经配置好可以调用 */
export function isAiReady(): boolean {
  const c = getAiConfig();
  return c.hasKey && Boolean(c.baseUrl) && Boolean(c.model);
}

/* ────────────────────────── 调用 ────────────────────────── */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** 覆盖默认模型（例如表格生成想用更强的模型） */
  model?: string;
  /** 单次超时（毫秒） */
  timeoutMs?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/** 把各种网络/接口错误翻译成用户能看懂的话 */
function friendlyAiError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 401 || lower.includes("invalid_api_key") || lower.includes("unauthorized")) {
    return "密钥无效或已过期，请在设置里重新填写 API Key";
  }
  if (status === 402 || lower.includes("insufficient") || lower.includes("balance")) {
    return "账户余额不足，请到服务商控制台充值后重试";
  }
  if (status === 429 || lower.includes("rate limit")) {
    return "请求太频繁或超出配额，稍等片刻再试";
  }
  if (status === 404 || lower.includes("model_not_found") || lower.includes("does not exist")) {
    return "模型名不正确，或该账号没有这个模型的权限";
  }
  if (lower.includes("context_length") || lower.includes("too long") || lower.includes("maximum context")) {
    return "输入内容太长，超出了模型的上下文上限，建议分段处理";
  }
  if (status >= 500) {
    return "服务商暂时不可用，稍后重试";
  }
  return `接口返回错误（HTTP ${status}）：${body.slice(0, 200)}`;
}

/** 单轮对话调用（OpenAI 兼容协议） */
export async function chat(options: ChatOptions): Promise<ChatResult> {
  const config = getAiConfig();
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("还没有配置 API Key，请先在设置或工具页面里填写");
  if (!config.baseUrl) throw new Error("接口地址为空，请先在设置里填写");

  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const model = options.model || config.model;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? config.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? config.maxTokens ?? 4096,
        stream: false,
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) throw new Error(friendlyAiError(res.status, raw));

    let data: {
      choices?: { message?: { content?: string } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("服务商返回的内容无法解析，请确认接口地址填的是兼容 OpenAI 的地址");
    }

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("模型没有返回内容，请稍后重试或换一个模型");

    return {
      text,
      model: data.model || model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("请求超时。内容较长时可能需要更久，请重试或缩短输入");
    }
    if (err instanceof Error && /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(err.message)) {
      throw new Error("连不上服务商。请检查网络，或确认接口地址是否正确");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从服务商读取可用模型列表（标准 OpenAI 兼容接口 GET /models）。
 * 用来解决「厂商上新了但内置清单还没跟上」的问题：用户点一下就能拿到当前可用的型号。
 */
export async function listModels(): Promise<{ models: string[]; error?: string }> {
  const config = getAiConfig();
  const apiKey = getApiKey();
  if (!config.baseUrl) return { models: [], error: "接口地址为空，请先填写" };

  const url = `${config.baseUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      return { models: [], error: friendlyAiError(res.status, raw) };
    }
    const data = JSON.parse(raw) as {
      data?: ({ id?: string; name?: string } | string)[];
      models?: ({ id?: string; name?: string } | string)[];
    };
    const list = (data.data ?? data.models ?? [])
      .map((m) => (typeof m === "string" ? m : m.id ?? m.name ?? ""))
      .filter((x): x is string => Boolean(x));
    if (list.length === 0) return { models: [], error: "服务商没有返回可用的模型清单" };
    return { models: [...new Set(list)].sort() };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { models: [], error: "读取模型列表超时" };
    return { models: [], error: "连不上服务商，无法读取模型列表" };
  } finally {
    clearTimeout(timer);
  }
}

/** 测试连通性：发一句最短的请求 */
export async function testConnection(): Promise<{ ok: boolean; message: string; model?: string }> {
  try {
    const r = await chat({
      messages: [{ role: "user", content: "回复两个字：正常" }],
      maxTokens: 16,
      timeoutMs: 30_000,
    });
    return { ok: true, message: `连接正常，模型回复：${r.text.slice(0, 40)}`, model: r.model };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "连接失败" };
  }
}

/** 内部用：从可能带 ```json 围栏的回复里取出 JSON */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("]"), cleaned.lastIndexOf("}"));
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("模型返回的不是有效 JSON，请重试");
  }
}
