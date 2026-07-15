/**
 * 可靠提交队列 —— 解决"学生提交了但数据没到服务器就丢了"
 *
 * 问题背景(生产日志实证):
 * - 部署重启窗口:正在提交的请求 502,前端 .catch(()=>{}) 静默吞掉 → 数据永久丢失
 * - 并发撞库 500(已在后端 UPSERT 修复)、校园网抖动、孩子学完立刻合盖/关页
 *
 * 方案:提交前先把这批数据落到 localStorage(带幂等键 client_batch_id),
 * 发送成功才移除;网络错/超时/5xx 则留在队列里,由以下时机自动补交:
 * 页面加载、断网恢复(online)、切回前台、每 60 秒、下一次任何提交之前。
 * 后端按 client_batch_id 去重,补交至多生效一次,绝不重复计数。
 */
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import './_axiosBootstrap';

const KEY = 'pending_submits_v1';
const MAX_ITEMS = 120;               // 队列上限,超出丢最旧的(防 localStorage 爆)
const MAX_AGE_MS = 3 * 24 * 3600e3;  // 超过3天的不再补交(后端去重窗口7天,留足余量)
const MAX_TRIES = 40;                // 重试次数上限

interface PendingItem {
  id: string;                        // 幂等键,同时是队列主键
  method: 'post' | 'put';
  path: string;                      // 相对 API_BASE_URL 的路径
  payload: any;
  uid: number | null;                // 提交者,防止共用电脑换号后把 A 的数据记到 B 头上
  ts: number;
  tries: number;
  // 绝对值更新(PUT)的覆盖键:同键新提交入队时淘汰旧条目,
  // 防止"旧进度补交覆盖新进度"的乱序回退
  staleKey?: string;
}

function currentUid(): number | null {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return typeof u?.id === 'number' ? u.id : null;
  } catch { return null; }
}

function loadQueue(): PendingItem[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveQueue(q: PendingItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_ITEMS))); } catch { /* 满了就算了 */ }
}

function removeItem(id: string) {
  const q = loadQueue().filter(it => it.id !== id);
  saveQueue(q);
}

/** 生成幂等键(时间戳+随机,足够唯一) */
export function genClientId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 网络层失败/超时/5xx/429/401/408 值得重试;其余 4xx 是业务错误,重试也不会成功。
 *  401 保留可重试很关键:孩子应用常开着超过 token 有效期,交卷时 401 若当业务错误
 *  丢弃,刚学完的整组数据就没了。保留在队列,重新登录后按 uid 匹配自动补交。 */
function isRetryable(err: any): boolean {
  const st = err?.response?.status;
  if (st === undefined) return true;
  return st === 401 || st === 408 || st === 429 || st >= 500;
}

// 正在发送中的条目,防止 flush 和原始请求双发
const inflight = new Set<string>();

async function send(item: PendingItem): Promise<any> {
  const resp = await axios.request({
    method: item.method,
    url: `${API_BASE_URL}${item.path}`,
    data: item.payload,
    timeout: 15000,
  });
  return resp.data;
}

/**
 * 幂等可靠提交。成功返回响应数据;失败抛错(但数据已入队,之后会自动补交)。
 * dedupe=true 的接口 payload 会带上 client_batch_id(后端支持去重);
 * dedupe=false 用于天然幂等的接口(如 PUT 绝对值更新),重发无副作用。
 */
export async function submitReliably<T = any>(
  path: string,
  payload: any,
  opts: { method?: 'post' | 'put'; dedupe?: boolean; staleKey?: string } = {},
): Promise<T> {
  const { method = 'post', dedupe = true, staleKey } = opts;
  const id = genClientId();
  const item: PendingItem = {
    id,
    method,
    path,
    payload: dedupe ? { ...payload, client_batch_id: id } : payload,
    uid: currentUid(),
    ts: Date.now(),
    tries: 0,
    staleKey,
  };
  // 先落盘再发送:哪怕发送途中孩子直接关页/合盖,下次打开也能补交。
  // 同 staleKey 的旧条目直接淘汰(绝对值更新,最新的才是对的)
  const base = staleKey ? loadQueue().filter(it => it.staleKey !== staleKey) : loadQueue();
  saveQueue([...base, item]);
  inflight.add(id);
  try {
    const data = await send(item);
    removeItem(id);
    return data as T;
  } catch (err) {
    if (!isRetryable(err)) {
      removeItem(id); // 业务性 4xx:重试无意义,移除并把错误交给调用方
      throw err;
    }
    // 网络/服务端故障:留在队列,稍后自动补交
    setTimeout(() => { void flushQueue(); }, 5000);
    throw err;
  } finally {
    inflight.delete(id);
  }
}

let flushing = false;

/** 顺序补交队列(同用户的条目);服务器仍不可用时提前收工,等下个时机 */
export async function flushQueue(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const uid = currentUid();
  if (uid === null) return; // 未登录不补交
  flushing = true;
  try {
    let q = loadQueue();
    // 清理过期/超限条目
    const fresh = q.filter(it => Date.now() - it.ts < MAX_AGE_MS && it.tries < MAX_TRIES);
    if (fresh.length !== q.length) saveQueue(fresh);
    q = fresh;

    for (const item of q) {
      if (item.uid !== uid) continue;       // 别人的数据等本人登录时再补
      if (inflight.has(item.id)) continue;  // 原始请求还在飞
      inflight.add(item.id);
      try {
        await send(item);
        removeItem(item.id);
      } catch (err: any) {
        if (!isRetryable(err)) {
          removeItem(item.id);              // 永远不会成功的,丢弃
        } else if (err?.response === undefined) {
          // 没有响应 = 服务器/网络整体不可达:本轮到此为止,别把剩下的也白打一遍,等下个时机
          const cur = loadQueue();
          const found = cur.find(it => it.id === item.id);
          if (found) { found.tries += 1; saveQueue(cur); }
          break;
        } else {
          // 服务器有响应但报错(5xx/429):可能是这一条的问题(脏 payload),
          // 记一次尝试后跳过它继续补后面的,别让一条"毒数据"卡住整个队列头。
          // tries 累计到上限会被过滤淘汰,不会无限卡。
          const cur = loadQueue();
          const found = cur.find(it => it.id === item.id);
          if (found) { found.tries += 1; saveQueue(cur); }
        }
      } finally {
        inflight.delete(item.id);
      }
    }
  } finally {
    flushing = false;
  }
}

/** 队列里还有几条没送达(可用于显示"待同步"状态) */
export function pendingCount(): number {
  const uid = currentUid();
  return loadQueue().filter(it => it.uid === uid).length;
}

// ── 自动补交时机:模块加载(App 启动)、断网恢复、切回前台、每 60 秒 ──
if (typeof window !== 'undefined') {
  setTimeout(() => { void flushQueue(); }, 3000);   // 启动后稍等 token/路由就绪
  window.addEventListener('online', () => { void flushQueue(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void flushQueue();
  });
  setInterval(() => {
    if (loadQueue().length > 0) void flushQueue();
  }, 60_000);
}
