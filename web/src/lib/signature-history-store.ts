/**
 * 签名设计器「历史设计灵感」（一笔签的历史生成记录）的落盘存储。
 *
 * 为什么用 IndexedDB 而不是 localStorage：
 * - 每条记录带两张完整 PNG 的 data URL（原图 + 透明图），单条就可能几百 KB 到几 MB；
 *   localStorage 是同步写、总量只有 5MB 上下，存两条就爆，而且写的时候会卡住界面。
 * - IndexedDB 是异步的，容量按磁盘给，跨重启保留。
 * - 浏览器在重启后原样保留 IndexedDB；本应用每次启动都是 http://localhost:3001，
 *   来源不变，所以记录能一直读回来。
 *
 * 保留期：30 天。每次读 / 写都会顺手清掉过期记录，用户不需要手动维护。
 *
 * 内存卫生：这里存的是 data: URL 字符串（不是 blob: URL），
 * 不持有任何需要 revoke 的浏览器资源，所以本模块既不释放、也不需要释放链接。
 *
 * 降级：凡是 IndexedDB 不可用（服务端渲染、被禁用、配额异常）时，
 * 所有函数都安静地退化成空操作 / 空数组，绝不抛错影响签名工具本身。
 */

export type SignatureHistoryRecord = {
  id: string;
  name: string;
  fontName: string;
  /** 带背景的原图（canvas.toDataURL） */
  url: string;
  /** 去背后的纯透明 PNG */
  transparentUrl: string;
  /** 落盘时间戳（毫秒），用于 30 天保留期 */
  savedAt: number;
};

/** 保留期：一个月 */
export const SIGNATURE_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 条数上限（真正先触发的通常是下面的体积上限） */
export const SIGNATURE_HISTORY_MAX_ENTRIES = 60;
/** 与模块级缓存同一条口径：单张链接超过它就整条不落盘，避免一份超大结果撑爆存储 */
export const SIGNATURE_HISTORY_MAX_LINK_CHARS = 6 * 1024 * 1024;
/** 整份历史占用的字符总量上限，超出后从最旧的开始删 */
export const SIGNATURE_HISTORY_MAX_TOTAL_CHARS = 40 * 1024 * 1024;

const DB_NAME = "furinakit-signature";
const DB_VERSION = 1;
const STORE_NAME = "history";

/** 连接只开一次；失败也缓存 null，避免反复重试拖慢界面 */
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
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("savedAt", "savedAt");
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

/** 把 IDBRequest 包成 Promise；任何失败都走 reject，由调用方兜住 */
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 请求失败"));
  });
}

async function readAll(db: IDBDatabase): Promise<SignatureHistoryRecord[]> {
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const rows = await toPromise(tx.objectStore(STORE_NAME).getAll());
    return (rows ?? []) as SignatureHistoryRecord[];
  } catch {
    return [];
  }
}

async function writeRecords(db: IDBDatabase, records: SignatureHistoryRecord[]): Promise<void> {
  if (records.length === 0) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const record of records) store.put(record);
  } catch {
    /* 写不进去就算了，界面上照样有这份历史 */
  }
}

async function removeIds(db: IDBDatabase, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const id of ids) store.delete(id);
  } catch {
    /* 同上 */
  }
}

/** 一条记录的体积（按字符数近似，data URL 都是 ASCII） */
function recordChars(record: SignatureHistoryRecord): number {
  return (record.url?.length ?? 0) + (record.transparentUrl?.length ?? 0);
}

/**
 * 算出「该留下哪些、该删掉哪些」。
 * 规则按顺序生效：① 超过 30 天的删掉 ② 超过条数上限的删掉 ③ 超过体积上限的删掉。
 * 永远是先删最旧的。不修改传进来的数组。
 */
function planPrune(
  all: SignatureHistoryRecord[],
  now: number,
): { kept: SignatureHistoryRecord[]; removed: string[] } {
  const sorted = [...all].sort((a, b) => {
    if (b.savedAt !== a.savedAt) return b.savedAt - a.savedAt;
    return a.id < b.id ? 1 : -1;
  });

  const kept: SignatureHistoryRecord[] = [];
  const removed: string[] = [];
  let totalChars = 0;

  for (const record of sorted) {
    if (!Number.isFinite(record.savedAt) || now - record.savedAt > SIGNATURE_HISTORY_TTL_MS) {
      removed.push(record.id);
      continue;
    }
    if (kept.length >= SIGNATURE_HISTORY_MAX_ENTRIES) {
      removed.push(record.id);
      continue;
    }
    const chars = recordChars(record);
    if (kept.length > 0 && totalChars + chars > SIGNATURE_HISTORY_MAX_TOTAL_CHARS) {
      removed.push(record.id);
      continue;
    }
    kept.push(record);
    totalChars += chars;
  }

  return { kept, removed };
}

/** 链接是否允许落盘（太大就整条不存，与模块缓存规避超大结果的思路一致） */
function isStorableLink(url: string, transparentUrl: string): boolean {
  return (
    typeof url === "string" &&
    typeof transparentUrl === "string" &&
    url.length > 0 &&
    transparentUrl.length > 0 &&
    url.length <= SIGNATURE_HISTORY_MAX_LINK_CHARS &&
    transparentUrl.length <= SIGNATURE_HISTORY_MAX_LINK_CHARS
  );
}

/**
 * 读出仍然有效的历史（最新的在前），顺手把过期 / 超限的记录从磁盘删掉。
 * 任何异常都返回空数组，绝不影响签名工具本身。
 */
export async function loadSignatureHistory(): Promise<SignatureHistoryRecord[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const all = await readAll(db);
    if (all.length === 0) return [];
    const { kept, removed } = planPrune(all, Date.now());
    if (removed.length > 0) await removeIds(db, removed);
    return kept;
  } catch {
    return [];
  }
}

/**
 * 记一条历史。
 *
 * 去重口径：姓名 + 字体 + 透明图链接都一样，说明是同一枚签名（例如每次冷启动都会自动
 * 生成的那张默认签名），此时只把它的落盘时间刷新成现在，不新增一条，
 * 免得一个月里堆满一模一样的记录。
 *
 * 返回落盘后仍然有效的历史列表；IndexedDB 不可用时返回空数组，
 * 调用方应把空数组理解为「这次没落盘」，不要拿它去覆盖界面上的列表。
 */
export async function addSignatureHistoryRecord(input: {
  /** 调用方可以自带 id（界面上的 React key 就能一直不变）；不传则由这里生成 */
  id?: string;
  name: string;
  fontName: string;
  url: string;
  transparentUrl: string;
}): Promise<SignatureHistoryRecord[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    if (!isStorableLink(input.url, input.transparentUrl)) return [];

    const now = Date.now();
    const all = await readAll(db);

    const duplicate = all.find(
      (record) =>
        record.name === input.name &&
        record.fontName === input.fontName &&
        record.transparentUrl === input.transparentUrl,
    );

    const next: SignatureHistoryRecord[] = duplicate
      ? all.map((record) => (record.id === duplicate.id ? { ...record, savedAt: now } : record))
      : [
          ...all,
          {
            id: input.id ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            name: input.name,
            fontName: input.fontName,
            url: input.url,
            transparentUrl: input.transparentUrl,
            savedAt: now,
          },
        ];

    const { kept, removed } = planPrune(next, now);
    // 只写「新增的那一条」或「被刷新时间的那一条」，其余记录本来就已在磁盘上
    const changed = duplicate
      ? kept.filter((record) => record.id === duplicate.id)
      : kept.filter((record) => !all.some((old) => old.id === record.id));
    await writeRecords(db, changed);
    if (removed.length > 0) await removeIds(db, removed);
    return kept;
  } catch {
    return [];
  }
}
