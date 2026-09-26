/**
 * 番茄钟「自定义提示音」的本地落盘存储。
 *
 * 要解决的问题：用户导入的提示音以前只活在一个模块级 AudioBuffer 里，
 * 刷新页面 / 关掉软件就没了，界面上只能如实写「重启后需要重新导入」。
 * 用户明确要求「不能这次能用、下次就用不了了」，所以这里把**用户选的那个原始音频文件**
 * 存进 IndexedDB，下次打开工具时读出来重新解码。
 *
 * 为什么是 IndexedDB（与 lib/signature-history-store.ts 同一套理由）：
 * - 音频文件动辄几 MB，localStorage / sessionStorage 只存字符串、总量 5MB 上下，放不下；
 * - IndexedDB 能直接结构化克隆 `Blob`（二进制原样存，不做 base64 膨胀），容量按磁盘给；
 * - 它是异步的，写几 MB 不会卡住界面；跨刷新、跨重启保留。
 * - 本应用固定跑在 http://localhost:3001（开发实例是 127.0.0.1:3111），来源不变，读得回来。
 *
 * 为什么存 Blob 而不是 ArrayBuffer：
 * `AudioContext.decodeAudioData()` 会把传进去的 ArrayBuffer **detach 掉**（解码后该 ArrayBuffer
 * 长度变 0，无法再次使用）。如果把 ArrayBuffer 当唯一副本留在内存里，第一次解码后就没法再解码、
 * 也没法再落盘。存 Blob，每次要解码时 `await blob.arrayBuffer()` 拿一份新的副本，天然安全。
 *
 * 只保留一条记录（固定主键 "current"）：用户再导入一个就替换掉上一个，不会越存越多。
 *
 * 降级：凡是 IndexedDB 不可用（服务端渲染、被禁用、隐私模式、配额异常）时，
 * 所有函数都安静地返回「没成功」并给出人话原因，绝不抛错把番茄钟带崩。
 *
 * ⚠️ 本文件**不 import 任何东西**：纯逻辑（体积上限判断、错误分类）要能在 Node 里直接跑单测。
 */

/**
 * 单文件体积上限：16 MiB。上限取 16 MiB 的依据是：
 * - 128 kbps 的 MP3 约 16 分钟、44.1 kHz / 16 bit / 立体声的无压缩 WAV 约 93 秒 —— 覆盖
 *   任何一段正常的提示音（用户导入的是铃声，不是整张专辑）；
 * - 超过这个量级的文件存进去，每次打开工具都要从磁盘读十几 MB 再整段解码，界面会明显卡顿；
 * - 也不至于撞上浏览器给单个来源的配额（Chromium 下通常是可用磁盘的一个比例，远大于 16MB），
 *   把「配额用尽」留给真正异常的情况。
 */
export const POMODORO_SOUND_MAX_BYTES = 16 * 1024 * 1024;

/** 单条记录的主键：固定值，所以 put 天然就是「替换上一个」。 */
export const POMODORO_SOUND_RECORD_ID = "current";

const DB_NAME = "furinakit-pomodoro";
const DB_VERSION = 1;
const STORE_NAME = "sound";

/** 落盘的一条自定义提示音。 */
export type PomodoroStoredSound = {
  id: string;
  /** 原始文件名（界面直接展示给用户） */
  name: string;
  /** 原始 MIME（只作提示，解码仍由浏览器按内容判断） */
  mimeType: string;
  /** 文件字节数 */
  size: number;
  /** 落盘时间戳（毫秒） */
  savedAt: number;
  /** 原始文件字节 */
  blob: Blob;
};

/** 文件体积检查的结果（纯函数产物，可单测）。 */
export type PomodoroSoundFileCheck =
  | { ok: true }
  | { ok: false; reason: "empty" | "too-large"; message: string };

/**
 * 体积是否允许落盘。纯函数。
 * 空文件与超限都给出一句可以直接显示给用户的中文说明。
 */
export function checkSoundFileSize(sizeBytes: number): PomodoroSoundFileCheck {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, reason: "empty", message: "这个文件是空的，换一个有声音的文件再试一次。" };
  }
  if (sizeBytes > POMODORO_SOUND_MAX_BYTES) {
    return {
      ok: false,
      reason: "too-large",
      message:
        `这个文件太大（${formatSoundBytes(sizeBytes)}），存不进本地存储` +
        `（单个文件上限 ${formatSoundBytes(POMODORO_SOUND_MAX_BYTES)}）。` +
        "本次运行可以用它，但重启软件后需要重新导入。建议先用工具把它压到 16 MB 以内。",
    };
  }
  return { ok: true };
}

/** 字节数转人话（自带实现，避免依赖别的模块，方便在 Node 里直接跑单测）。 */
export function formatSoundBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${index === 0 ? value : Number(value.toFixed(1))} ${units[index]}`;
}

/** 落盘失败的原因分类。纯函数（只看 error 的 name / code / message）。 */
export type PomodoroSoundStoreFailure =
  | "empty"
  | "too-large"
  | "unsupported"
  | "quota"
  | "unknown";

/**
 * 把 IndexedDB 抛出来的各种异常翻译成有限几种原因。
 * 重点是 `QuotaExceededError`：磁盘/配额写满时必须单独识别，给出「腾点空间」这种可执行的话，
 * 而不是笼统的「导入失败」。
 */
export function classifySoundStoreError(error: unknown): PomodoroSoundStoreFailure {
  if (!error || typeof error !== "object") return "unknown";
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const code = typeof candidate.code === "number" ? candidate.code : 0;
  if (
    name === "QuotaExceededError" ||
    // Firefox / 老 WebKit 的同类错误名，一并识别
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    /quota/i.test(message)
  ) {
    return "quota";
  }
  if (name === "InvalidStateError" || name === "NotSupportedError" || name === "SecurityError") {
    return "unsupported";
  }
  return "unknown";
}

/** 每种失败原因对应的一句话（界面直接显示）。 */
export function soundStoreFailureMessage(reason: PomodoroSoundStoreFailure): string {
  switch (reason) {
    case "empty":
      return "这个文件是空的，换一个有声音的文件再试一次。";
    case "too-large":
      return `这个文件太大，存不进本地存储（单个文件上限 ${formatSoundBytes(POMODORO_SOUND_MAX_BYTES)}）。`;
    case "unsupported":
      return "这台机器上的本地存储用不了（可能被隐私模式或系统策略禁用），音频只在本次运行有效。";
    case "quota":
      return "本地存储空间不够了，音频没能保存下来。可以清理一下磁盘空间，或换一个更小的音频文件。";
    default:
      return "音频没能保存到本机（本地存储出错），本次运行仍然可以用它。";
  }
}

/** 保存结果。 */
export type PomodoroSoundSaveResult =
  | { ok: true; record: PomodoroStoredSound }
  | { ok: false; reason: PomodoroSoundStoreFailure; message: string };

/** 连接只开一次；失败也缓存 null，避免反复重试拖慢界面。 */
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    const done = (value: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 别的标签页要升级数据库时让路，并允许下次重新打开
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      done(db);
    };
    request.onerror = () => done(null);
    request.onblocked = () => done(null);
  });

  return dbPromise;
}

/** 把 IDBRequest 包成 Promise；任何失败都走 reject，由调用方兜住。 */
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

/** 把整个事务也接进 Promise：配额写满时是**事务** abort，只监听 request 会漏掉。 */
function toTransactionPromise(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB 事务被中止"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 事务出错"));
  });
}

/** 记录是否是一份可以用的音频（读出来时也校验一遍，防止历史脏数据把界面带崩）。 */
function isUsableRecord(value: unknown): value is PomodoroStoredSound {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PomodoroStoredSound>;
  return (
    typeof record.name === "string" &&
    typeof record.size === "number" &&
    record.size > 0 &&
    record.size <= POMODORO_SOUND_MAX_BYTES &&
    typeof record.blob === "object" &&
    record.blob !== null
  );
}

/** 读出上次保存的音频；没有、读不出、数据不可用都返回 null（界面按「没有自定义音频」处理）。 */
export async function loadStoredPomodoroSound(): Promise<PomodoroStoredSound | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const tx = db.transaction(STORE_NAME, "readonly");
    const row = await toPromise(tx.objectStore(STORE_NAME).get(POMODORO_SOUND_RECORD_ID));
    return isUsableRecord(row) ? row : null;
  } catch {
    return null;
  }
}

/**
 * 保存（或替换）自定义提示音。
 *
 * 只保留一条：同一个事务里先 clear 再 put，保证磁盘上永远只有一份音频，
 * 用户反复导入不会越存越多、把配额吃光。
 *
 * 返回结构化结果而不是抛错，调用方据此决定是「已保存」还是「本次运行有效」。
 */
export async function saveStoredPomodoroSound(input: {
  name: string;
  mimeType?: string;
  blob: Blob;
}): Promise<PomodoroSoundSaveResult> {
  const check = checkSoundFileSize(input.blob.size);
  if (!check.ok) {
    // 存不进去的新文件同样算「替换」：把上一个留在磁盘上，用户重启后会突然听到另一段音频，
    // 那比「什么都没有」更让人困惑。所以这里如实把旧的清掉，界面上也会说明这一点。
    if (check.reason === "too-large") await removeStoredPomodoroSound();
    return { ok: false, reason: check.reason, message: check.message };
  }

  const db = await openDb();
  if (!db) {
    return {
      ok: false,
      reason: "unsupported",
      message: soundStoreFailureMessage("unsupported"),
    };
  }

  const record: PomodoroStoredSound = {
    id: POMODORO_SOUND_RECORD_ID,
    name: input.name,
    mimeType: input.mimeType ?? input.blob.type ?? "",
    size: input.blob.size,
    savedAt: Date.now(),
    blob: input.blob,
  };

  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    // 先清空整张表：单条记录的存储，旧的一定要被删掉
    store.clear();
    // 请求级错误与事务级错误都要接住：配额用尽既可能表现为 put 请求报错，
    // 也可能只表现为整个事务 abort（Chromium 下两者都会出现），漏掉任何一个都会变成「假装保存成功」。
    const [write, commit] = await Promise.allSettled([
      toPromise(store.put(record)),
      toTransactionPromise(tx),
    ]);
    const failure =
      write.status === "rejected" ? write.reason : commit.status === "rejected" ? commit.reason : null;
    if (failure) {
      const reason = classifySoundStoreError(failure);
      return { ok: false, reason, message: soundStoreFailureMessage(reason) };
    }
    return { ok: true, record };
  } catch (error) {
    const reason = classifySoundStoreError(error);
    return { ok: false, reason, message: soundStoreFailureMessage(reason) };
  }
}

/** 移除保存的音频（移除按钮会用）。返回是否确认清干净了。 */
export async function removeStoredPomodoroSound(): Promise<boolean> {
  try {
    const db = await openDb();
    if (!db) return false;
    const tx = db.transaction(STORE_NAME, "readwrite");
    const [request, commit] = await Promise.allSettled([
      toPromise(tx.objectStore(STORE_NAME).clear()),
      toTransactionPromise(tx),
    ]);
    return request.status === "fulfilled" && commit.status === "fulfilled";
  } catch {
    return false;
  }
}

/** 磁盘上到底有没有存着音频（用来在界面上如实说明，而不是猜）。 */
export async function hasStoredPomodoroSound(): Promise<boolean> {
  return (await loadStoredPomodoroSound()) !== null;
}
