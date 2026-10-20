/**
 * 预加载下一节(2026-10-18)
 *
 * 这一节快看完时,提前给下一节换好播放票据,并用一个不进页面的 <video preload="metadata">
 * 把下一节的开头(索引 + 第一帧附近,约 1MB)取到浏览器缓存里。点「下一节」时直接用这张票,
 * 地址一样,浏览器从缓存出开头 → 几乎马上出画面。
 *
 * 刻意**不**整节提前下载: 电教室一个班共用 12M 带宽,每个孩子边看边下下一节,正在看的反而更卡;
 * 很多孩子也不会接着看下一节,流量白花。
 *
 * 换票走 prefetch=1: 后端**不扣次卡**(今天要扣的直接 409 不签,这里就不预加载,点开时照常扣)。
 * 预取的票只在**同一天**用: 跨过 0 点就作废,否则次卡新的一天不扣就能看。
 */
import { fetchPrefetchTicket, mediaUrl, type MediaTicket } from '../../api/phonetics';

interface Entry {
  ticket: MediaTicket;
  day: string;
  el: HTMLVideoElement;
  /** 取的是不是流畅版的开头 */
  lite: boolean;
}

const ready = new Map<number, Entry>();
/** 正在换票的(还没回来);点开时已经取走就标成作废,回来后不再建元素 */
const pending = new Map<number, { cancelled: boolean }>();

/** 票据至少还剩这么久才拿来用(秒),不够就重新换,免得刚播几分钟就过期 */
const MIN_TICKET_LEFT = 10 * 60;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function release(id: number) {
  const e = ready.get(id);
  if (!e) return;
  ready.delete(id);
  // 停掉还在进行的下载: 只清 src 不 load() 的话浏览器不会中断
  e.el.removeAttribute('src');
  e.el.load();
}

/**
 * 预加载这一节。同时只留一节,换了别的就把旧的停掉。
 * lite: 取流畅版的开头(孩子正在看流畅版时) —— 预加载的画质要和点开时一致才命中缓存
 */
export async function prefetchVideo(id: number, opts: { lite?: boolean } = {}): Promise<void> {
  const lite = !!opts.lite;
  if (pending.has(id)) return;
  const have = ready.get(id);
  if (have) {
    if (have.lite === lite) return;
    // 预加载之后孩子换了画质: 票照用(票只绑视频),只换成另一档的开头,点开时才命中缓存
    have.el.removeAttribute('src');
    have.el.load();
    have.el.src = mediaUrl(have.ticket.url) + (lite ? '&q=lite' : '');
    have.lite = lite;
    return;
  }
  // 用户开了「省流量」就不预加载
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  for (const other of [...ready.keys()]) release(other);
  const token = { cancelled: false };
  pending.set(id, token);
  try {
    const ticket = await fetchPrefetchTicket(id);
    if (token.cancelled) return;
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    // 票据只绑视频不绑画质,流畅版就是同一张票后面加 &q=lite(与 LessonStage 拼地址的方式一致)
    el.src = mediaUrl(ticket.url) + (lite ? '&q=lite' : '');
    ready.set(id, { ticket, day: today(), el, lite });
  } catch {
    // 409(今天点开才扣次卡)/ 403(没开通)/ 网络错: 不预加载,点开时照常换票
  } finally {
    pending.delete(id);
  }
}

/** 点开这一节时取预先换好的票(取走即作废);没有、过期、跨天都返回 null,调用方照常换票 */
export function takePrefetchedTicket(id: number): MediaTicket | null {
  const p = pending.get(id);
  if (p) p.cancelled = true;
  const e = ready.get(id);
  if (!e) return null;
  release(id);
  if (e.day !== today() || e.ticket.expires_at - Date.now() / 1000 < MIN_TICKET_LEFT) return null;
  return e.ticket;
}

/** 关播放器时调: 停掉所有预加载 */
export function releaseAllPrefetch(): void {
  for (const p of pending.values()) p.cancelled = true;
  for (const id of [...ready.keys()]) release(id);
}
