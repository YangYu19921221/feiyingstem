import { useEffect, useRef, useState } from 'react';
import { clamp, clock, looksTampered, nextSpot, type Spot } from './watermarkGeometry';

/**
 * 音标视频的移动水印(2026-10-30,用户「先做水印？防录屏之类的」)。
 *
 * 浏览器没有办法禁止录屏,也检测不到有人在录。能做的是让录出来的每一段都带着是谁的号:
 * - **会走**: 每 6–10 秒跳到另一格(画面分 3×3,正中间不去 —— 那里是老师的口型,见 watermarkGeometry)。
 *   直接跳不滑过去: 一直在动的字比隔几秒跳一下更抢眼。
 *   以前固定在右上角,录屏后裁掉一个角就没了;走起来会经过画面中间,裁不掉。
 * - **带时间**: 「飞鹰教育 · 姓名 · ID · 月-日 时:分」,流出去能对上访问日志里是哪一次看的。
 * - **被藏了就停**: 每 2 秒查一次水印还在不在、看不看得见(被开发者工具删掉、设成透明、
 *   挪到画面外、缩成一个点),不在就暂停视频、把水印重新放回去。懂技术的人仍能绕过(比如改脚本),
 *   这一道挡的是「顺手删掉水印再录」。
 *
 * ⚠️ 水印那行字**不交给 React 管**,用 document.createElement 自己建、自己放: 被人在开发者工具里删掉后,
 * React 重建时会去 removeChild 一个已经不在的节点,直接抛错把整个播放器打进错误页。自己管就能安全放回去。
 * 外面那层框是 React 的: 框被删了只能一直暂停,刷新页面才能再看。
 *
 * 字号跟着视频框宽度走(录屏压缩后还要认得出),12–20px。pointer-events-none 不挡播放控件;
 * translate="no": 浏览器自动翻译不改它的字。讲义页的水印是服务器烧进图里的,不走这里。
 */

const MOVE_MIN_MS = 6000;
const MOVE_MAX_MS = 10000;
const CHECK_MS = 2000;
const NOTICE_MS = 8000;
const SPAN_CLASS = 'absolute select-none whitespace-normal break-all font-medium leading-snug tracking-wide';

function makeSpan(box: HTMLElement): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = SPAN_CLASS;
  s.setAttribute('translate', 'no');
  box.appendChild(s);
  return s;
}

function paint(s: HTMLSpanElement, text: string, spot: Spot, fontPx: number) {
  if (s.textContent !== text) s.textContent = text;
  s.style.left = `${spot.x}%`;
  s.style.top = `${spot.y}%`;
  // 左上角 = x% × (框宽 − 字宽): 不用量字有多宽,永远在框里
  s.style.transform = `translate(-${spot.x}%, -${spot.y}%)`;
  s.style.fontSize = `${fontPx}px`;
  // 宽度按字本身算(max-content),不按 left 右边剩多少地方算: 不写的话跳到最右边(left 接近 100%)时
  // 浏览器把它挤成一个字宽的竖条,还会被下面的检查当成「被缩小了」误停视频(浏览器实测踩到)
  s.style.width = 'max-content';
  s.style.maxWidth = '92%';
  s.style.color = 'rgba(255, 255, 255, 0.6)';
  s.style.opacity = '1';
  s.style.display = 'block';
  s.style.visibility = 'visible';
  // 白板底上也要看得见
  s.style.textShadow = '0 0 2px rgba(0, 0, 0, 0.75), 0 1px 1px rgba(0, 0, 0, 0.5)';
}

interface Props {
  /** 「飞鹰教育 · 姓名 · ID」,时间这里自己加 */
  label: string;
  /** 顶上让出多少像素(浮窗模式顶上是拖动条,水印只走画面那块) */
  topInset?: number;
  /** 发现水印被藏了: 父组件暂停视频 */
  onTamper: () => void;
}

export default function MovingWatermark({ label, topInset = 0, onTamper }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const [notice, setNotice] = useState(false);
  // 画法要的最新值放 ref: 计时器回调里读,不用把计时器跟着重建
  const state = useRef({ text: '', spot: nextSpot(-1), fontPx: 13 });
  const tamperRef = useRef(onTamper);
  useEffect(() => { tamperRef.current = onTamper; });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const st = state.current;
    const redraw = () => {
      if (spanRef.current) paint(spanRef.current, st.text, st.spot, st.fontPx);
    };
    st.text = `${label} · ${clock()}`;
    spanRef.current = makeSpan(box);
    redraw();

    const ro = new ResizeObserver(([e]) => {
      st.fontPx = clamp(Math.round(e.contentRect.width * 0.02), 12, 20);
      redraw();
    });
    ro.observe(box);

    let moveT = 0;
    const step = () => {
      st.spot = nextSpot(st.spot.cell);
      st.text = `${label} · ${clock()}`;
      redraw();
      moveT = window.setTimeout(step, MOVE_MIN_MS + Math.random() * (MOVE_MAX_MS - MOVE_MIN_MS));
    };
    moveT = window.setTimeout(step, MOVE_MIN_MS + Math.random() * (MOVE_MAX_MS - MOVE_MIN_MS));

    const checkT = window.setInterval(() => {
      if (!looksTampered(spanRef.current, boxRef.current)) return;
      tamperRef.current();
      setNotice(true);
      // 能放回去就放回去(框还在的话)。删掉被改过的那个,换一个新的
      const b = boxRef.current;
      if (b && b.isConnected) {
        try { spanRef.current?.remove(); } catch { /* 已经不在了 */ }
        spanRef.current = makeSpan(b);
        redraw();
      }
    }, CHECK_MS);

    return () => {
      ro.disconnect();
      window.clearTimeout(moveT);
      window.clearInterval(checkT);
      try { spanRef.current?.remove(); } catch { /* 忽略 */ }
      spanRef.current = null;
    };
  }, [label]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(false), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  return (
    <>
      <div ref={boxRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" style={{ top: topInset }} aria-hidden="true" />
      {notice && (
        <div role="status" className="absolute inset-x-0 top-1/3 z-20 flex justify-center px-4">
          <span className="rounded-full bg-black/80 px-4 py-2 text-center text-xs text-white shadow">
            画面上的名字被挡住了,视频先停了。点播放接着看,还是会停就刷新一下页面
          </span>
        </div>
      )}
    </>
  );
}
