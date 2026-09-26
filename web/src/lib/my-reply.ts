/**
 * 我的建议有没有被回复 —— 给界面用的状态小模块。
 *
 * 流程：
 *   用户提交建议 → 拿到"查询码"（存在 localStorage）→ 应用定期用这个码去问作者有没有回复
 *   → 有回复且用户还没看过 → 界面在「设置」按钮上打一个小绿点（和更新提醒同样的做法）
 *   → 用户点开设置就能看到回复内容，点"我知道了"后小绿点消失。
 */

const CODE_KEY = "furina:feedback-code";
const REPLY_KEY = "furina:feedback-reply";
const SEEN_KEY = "furina:feedback-reply-seen";

export interface MyReply {
  code: string;
  text: string;
  status?: string;
  at?: string;
  /** 本地记录：最近一次看到的内容（用来判断是不是"新回复"） */
  seenText?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

/** 订阅变化（界面用 useSyncExternalStore 或 useEffect 接） */
export function subscribeMyReply(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function read(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {}
}

/** 用户的查询码（没有就说明他没提过建议） */
export function getMyCode(): string {
  return read(CODE_KEY);
}

/** 上次拿到的回复（可能已经看过） */
export function getCachedReply(): MyReply | null {
  const raw = read(REPLY_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as MyReply;
    if (!o || !o.text) return null;
    o.seenText = read(SEEN_KEY);
    return o;
  } catch {
    return null;
  }
}

/** 有没有"还没看过的新回复" → 界面上打小绿点 */
export function hasUnseenReply(): boolean {
  const r = getCachedReply();
  if (!r) return false;
  return r.text !== r.seenText;
}

/** 用户点了"我知道了" */
export function markReplySeen() {
  const r = getCachedReply();
  if (!r) return;
  write(SEEN_KEY, r.text);
  emit();
}

/** 去问一次作者有没有回复 */
export async function checkMyReply(): Promise<MyReply | null> {
  const code = getMyCode();
  if (!code) return null;
  try {
    const res = await fetch(`/api/feedback/replies?code=${encodeURIComponent(code)}`);
    if (!res.ok) return getCachedReply();
    const data = await res.json();
    if (!data?.success || !data.found || !data.text) return getCachedReply();
    const reply: MyReply = {
      code,
      text: String(data.text),
      status: data.status ? String(data.status) : "",
      at: data.at ? String(data.at) : "",
    };
    write(REPLY_KEY, JSON.stringify(reply));
    emit();
    return { ...reply, seenText: read(SEEN_KEY) };
  } catch {
    return getCachedReply();
  }
}

let started = false;

/** 启动后台轮询：应用打开时查一次，之后每 10 分钟一次 */
export function startReplyWatcher() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!getMyCode()) return; // 没提过建议就什么都不用做
  void checkMyReply();
  window.setInterval(() => void checkMyReply(), 10 * 60 * 1000);
}
