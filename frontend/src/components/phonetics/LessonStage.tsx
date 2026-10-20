/**
 * 授课舞台:视频与讲义各是一块**可自由拖放、各自改大小、互不重叠**的浮窗
 *
 * 三版演进(都是用户当场指出来的,记着别走回头路):
 *  ① 全屏弹层盖住视频 + 暂停 —— 把「看视频」和「看讲义」做成了互斥,错的;
 *  ② 左右并排各占一半 —— 两个都是 16:9,1366 屏上讲义只剩 467px,幻灯片正文 ~6px,看不清;
 *  ③ 讲义铺满 + 视频浮在角上(只能吸四角)—— 清楚了,但两块**重叠**,小窗压住翻页条;
 *  ④ 现在:两块对等浮窗,拖到哪都能停,谁也不压谁。
 *
 * 「不重叠」的代价要认:讲义拿不到整个舞台了(1366 屏 1318 → 990px)。仍是 ② 的两倍多,
 * 想更大就把视频拖窄,或点「重排」。
 *
 * 几何全在 stageLayout.ts(纯函数,已穷举验算 5 万次随机拖动零重叠零出界)。
 * 这里只管:指针事件 → 调几何 → 写 state,外加播放票据和防拷贝那几件事。
 *
 * ⚠️ <video> 必须始终在树里的同一位置,只换 className/style ——
 * 两块都是同一个 relative 舞台下的 absolute 子节点,DOM 顺序永远不变;
 * 写成「按布局分支各放一个 <video>」,切布局那一下就重挂、播放进度归零。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Expand, GripHorizontal, LayoutTemplate, LoaderCircle,
  RotateCw, Shrink, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { fetchVideoTicket, mediaUrl, type PhoneticVideo, type StudentMaterial } from '../../api/phonetics';
import { useMaterialPages } from './useMaterialPages';
import { useWatchHeartbeat } from './useWatchHeartbeat';
import { prefetchVideo, takePrefetchedTicket } from './nextPrefetch';
import {
  CHROME_H, MIN_W, canHostFloating, defaultLayout, makeBox, maxWidthIn, paneHeight, refit,
  settle, widthCapAgainst, type Box, type Layout, type PaneKind, type Size,
} from './stageLayout';

interface Props {
  video: PhoneticVideo;
  materials: StudentMaterial[];
  /** 正在看的讲义;null = 只看视频(舞台退化成普通播放器) */
  viewing: StudentMaterial | null;
  onViewing: (m: StudentMaterial | null) => void;
  /** 播放面板的 DOM,全屏就是把它整个送进 requestFullscreen */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** 这个视频被看完了(就地把列表里的卡片标成「已看完」,不必重拉整页) */
  onCompleted?: (videoId: number) => void;
  /** 每次上报观看进度时交出当前位置(秒),父组件就地更新卡片的续播位置与「看到 N%」 */
  onProgress?: (videoId: number, position: number) => void;
  /**
   * 交出「现在播到第几秒」的读法,提问时用它带上位置。
   *
   * 给的是**函数不是数值**: 位置每秒都在变,当 prop 往上抛会让父组件每秒重渲染
   * (连带整个播放弹层),而这个数只在学生点「提交」的那一刻需要。
   */
  onPositionGetter?: (get: () => number) => void;
  /**
   * 选集里的下一节(null = 这一组最后一节)。快看完时预加载它的开头;看完后倒计时自动播
   * (讲义开着或下一节锁着时不自动,只给按钮)
   */
  nextVideo?: PhoneticVideo | null;
  /** 播下一节(倒计时到点 / 点「立即播放」/ 下一节锁着时点「去开通」) */
  onPlayNext?: () => void;
}

/**
 * 挡顺手另存:禁右键、禁拖出、禁长按菜单(iOS 长按存图)。
 * 截屏和抓包在用户自己设备上**防不住**,这些只挡最顺手的那几下;
 * 真正的抓手是服务端烧进图里的姓名+ID —— 传出去一眼看得出是谁传的。
 */
const NO_COPY: React.CSSProperties = { WebkitTouchCallout: 'none', userSelect: 'none' };
const block = (e: React.SyntheticEvent) => e.preventDefault();

/** 水印上的品牌(2026-10-02 用户要求「水印改成飞鹰教育」;讲义烧的水印本来就带这四个字) */
const WATERMARK_BRAND = '飞鹰教育';

/**
 * 水印串:飞鹰教育 · 姓名 · ID。身份部分与后端讲义水印同口径(_viewer_label = "{name} · ID{id}")。
 * 取自 localStorage 登录用户(与 StudentIdentityBadge 同源)。读不到身份时只剩品牌,不会整条消失。
 * ⚠️ 这是**前端**水印,防不住改 DOM / 录屏裁掉 —— 它只让顺手录屏转发的人留下名字,
 * 真溯源仍靠服务端访问日志(每次换票记一条 IP+设备+时间)。所以别把它当硬防线。
 */
function readViewerLabel(): string {
  try {
    const me = JSON.parse(localStorage.getItem('user') || '{}');
    const name = String(me.full_name || me.username || '').trim();
    return [WATERMARK_BRAND, name, me.id ? `ID${me.id}` : ''].filter(Boolean).join(' · ');
  } catch {
    return WATERMARK_BRAND;
  }
}

/** 续播提示停留多久(毫秒):够看清并点「从头看」,又不一直挡画面 */
const RESUME_HINT_MS = 8000;

/**
 * 倍速档位(2026-10-18)。不给 2x: 音标要看口型、听清发音,太快没用;0.75 跟读最有用。
 * 「看完」按视频内容的秒数判(心跳累计 currentTime 的差值),1.5x 看完照样算看完
 */
const RATES = [0.5, 0.75, 1, 1.25, 1.5];
/** 剩这么多秒(且已过半)时预加载下一节的开头 */
const PREFETCH_LEAD_SEC = 60;
/** 看完后几秒自动播下一节 */
const AUTO_NEXT_SEC = 5;
/** 缓冲超过这么久才提示「网络有点慢」—— 一两秒的小卡顿不提示,免得一直闪 */
const SLOW_HINT_MS = 2500;

/** 倍速记在本地、按用户分键(一台平板几个孩子轮着用,不串) */
function rateKey(): string {
  let uid = 'anon';
  try {
    const me = JSON.parse(localStorage.getItem('user') || 'null');
    if (me?.id) uid = String(me.id);
  } catch { /* 读不出来当匿名 */ }
  return `phonetics.rate.${uid}`;
}
function readRate(): number {
  try {
    const r = Number(localStorage.getItem(rateKey()));
    return RATES.includes(r) ? r : 1;
  } catch {
    return 1;
  }
}

/** 秒 → 3:20(续播提示用) */
function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const BTN = 'rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20 disabled:opacity-30';
const BTN_SM = 'rounded-md p-1 text-slate-200 hover:bg-white/15';

/**
 * 布局存成**比例**而非像素:换屏幕/换窗口大小后还能大致还原。
 * ⚠️ 带版本号:高度公式(paneHeight)改过之后,旧版本存的比例还原出来会被新的
 * 上下限夹小 —— 实测存 320 宽刷新后变成 200。公式变了就升 V,旧数据直接当没存过。
 */
const LAYOUT_KEY = 'phonetic-stage-layout';
const LAYOUT_V = 2;
type Frac = { x: number; y: number; w: number };
type SavedLayout = { video: Frac; material: Frac };

function toFrac(b: Box, s: Size): Frac {
  return { x: b.x / s.w, y: b.y / s.h, w: b.w / s.w };
}
function fromFrac(f: Frac, s: Size, kind: PaneKind): Box {
  return makeBox(Math.round(f.x * s.w), Math.round(f.y * s.h),
    Math.max(MIN_W, Math.min(maxWidthIn(s, kind), Math.round(f.w * s.w))), kind);
}

function loadSaved(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p?.v !== LAYOUT_V) return null;       // 旧公式存的,还原会被夹小,当没存过
    const okFrac = (f: unknown): f is Frac => {
      if (!f || typeof f !== 'object') return false;
      const o = f as Record<string, unknown>;
      return ['x', 'y', 'w'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
    };
    return okFrac(p?.video) && okFrac(p?.material) ? { video: p.video, material: p.material } : null;
  } catch {
    return null;   // 存的东西坏了就当没存过,别让它把整个页面搞崩
  }
}

/**
 * 只看视频时进全屏:横版画面锁成横屏 —— 手机竖着拿时 16:9 只占屏幕中间一条,上下全是黑的。
 * 只有 Android Chrome 这类支持;桌面 / iOS 会 reject 或干脆没有 lock,吞掉即可,不影响全屏本身。
 * 不用手动解锁:规范规定退出全屏时浏览器自动解除方向锁定。
 * (TS 的 lib.dom 已把 lock 拿掉了,所以自己补个可选签名)
 */
type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };
function lockLandscape() {
  const o = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
  o?.lock?.('landscape').catch(() => { /* 不支持就保持原方向,画面照样居中 */ });
}

/** 横屏/桌面为 true。竖屏走上下堆叠,不做浮窗 */
function useLandscape(): boolean {
  const Q = '(orientation: landscape)';
  const [land, setLand] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(Q).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const m = window.matchMedia(Q);
    const on = () => setLand(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return land;
}

export default function LessonStage({
  video, materials, viewing, onViewing, panelRef, onCompleted, onProgress, onPositionGetter,
  nextVideo, onPlayNext,
}: Props) {
  const landscape = useLandscape();
  const [zoomed, setZoomed] = useState(false);
  const [fs, setFs] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pages = useMaterialPages(viewing);
  // 水印身份:登录期间不变,算一次即可
  const viewerLabel = useMemo(() => readViewerLabel(), []);

  // ---- 舞台尺寸:浮窗的一切几何都相对它算 ----
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setStage({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 浮窗模式:横屏 + 正在看讲义 + 舞台放得下两块不重叠的窗 */
  const floating = !!viewing && landscape && stage.w > 0 && canHostFloating(stage);

  /** 画面宽高比:元数据到了按真实值(4:3 的老录屏也有),之前先按 16:9 */
  const [videoAR, setVideoAR] = useState(16 / 9);
  /**
   * 只看视频 + 全屏:视频吃掉面板顶栏以下的全部高度(2026-10-14 用户反馈「全屏下方黑色空白太多」)。
   * 弹窗口径的 max-h-[70vh] 在全屏下就是「下面三成空着」,面板那边同时收起简介/提问区,见 PhoneticsHub panelFs。
   * 视频框按**画面比例**算出能放下的最大尺寸、在舞台里居中 —— 不让 <video> 铺满舞台再 object-contain:
   * 那样黑边长在视频框里面,水印 / 全屏按钮 / 续播提示都贴着框的角,会落进黑边(录屏一裁水印就没了)
   */
  const fillScreen = fs && !viewing;
  const fit = fillScreen && stage.w > 0 && stage.h > 0
    ? (stage.w / stage.h > videoAR
      ? { w: Math.round(stage.h * videoAR), h: stage.h }
      : { w: stage.w, h: Math.round(stage.w / videoAR) })
    : null;

  // ---- 布局 ----
  const [layout, setLayout] = useState<Layout | null>(null);
  /**
   * 用户调过的布局,存成**比例**。
   * ⚠️ 每次舞台变化都从这份比例**重新推导**,而不是拿上一帧结果去 refit ——
   * 首帧舞台还没撑开(高度小),refit 会把尺寸夹小,而它只夹不涨,
   * 舞台长大之后再也回不去。实测过两次:一次是「讲义 544 / 视频 200 空着 600px」,
   * 一次是「刷新后 320 变 200」。比例是唯一真源,像素每次算。
   */
  const prefRef = useRef<SavedLayout | null>(loadSaved());
  const [customized, setCustomized] = useState(() => prefRef.current !== null);

  useEffect(() => {
    if (!floating) return;
    if (!customized || !prefRef.current) {
      setLayout(defaultLayout(stage));       // 没调过:跟着舞台走
      return;
    }
    const p = prefRef.current;
    // 从比例还原 → 解开重叠。舞台大小随便变,结果都按比例缩放,不会被夹死
    setLayout(refit({
      video: fromFrac(p.video, stage, 'video'),
      material: fromFrac(p.material, stage, 'material'),
    }, stage));
  }, [floating, stage, customized]);

  const persist = useCallback((L: Layout) => {
    if (!stage.w || !stage.h) return;
    const frac: SavedLayout = { video: toFrac(L.video, stage), material: toFrac(L.material, stage) };
    prefRef.current = frac;                  // 内存里的真源,和 localStorage 一起更新
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ v: LAYOUT_V, ...frac }));
    } catch { /* 隐私模式写不了,不影响本次 */ }
  }, [stage]);

  const retile = () => {
    setLayout(defaultLayout(stage));
    prefRef.current = null;
    setCustomized(false);        // 回到「跟着舞台自动算」
    try { localStorage.removeItem(LAYOUT_KEY); } catch { /* 同上 */ }
  };

  /**
   * 一次拖动或改大小。
   * @param which 用户正在操作哪一块 —— 它说话算数,另一块让位
   * @param mode  'move' 拖位置 | 'x' 拖宽度 | 'corner' 斜角(横竖都吃)
   * @param grow  改大小时:往哪个方向算变大(跟着把手在左边还是右边)
   */
  const startGesture = (
    e: React.PointerEvent, which: 'video' | 'material',
    mode: 'move' | 'x' | 'corner', grow: { x: 1 | -1; y: 1 | -1 } = { x: 1, y: 1 },
  ) => {
    if (!layout || !floating) return;
    e.stopPropagation();       // 别和别的把手抢同一次按下
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    // 指针捕获:拖过视频区域时事件仍回到这个把手上,不会被 <video> 控件吃掉
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX, startY = e.clientY;
    // 以拖动**开始时**的两块为基准算让位:不拿上一帧结果累积,
    // 否则会抖,而且拖开之后对方回不到原来大小
    const self0 = which === 'video' ? layout.video : layout.material;
    const other0 = which === 'video' ? layout.material : layout.video;
    const selfKind: PaneKind = which;
    const otherKind: PaneKind = which === 'video' ? 'material' : 'video';
    let latest: Layout = layout;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      let self: Box;
      if (mode === 'move') {
        self = { ...self0, x: self0.x + dx, y: self0.y + dy };
      } else {
        // 16:9 锁死,只有宽度一个自由度。斜角取**主导方向**(位移大的那个轴),
        // 不是两轴相加 —— 相加会冲过头,手感不跟手
        const byX = grow.x * dx;
        const delta = mode === 'corner' && Math.abs(grow.y * dy * (16 / 9)) > Math.abs(byX)
          ? grow.y * dy * (16 / 9)
          : byX;
        const cap = widthCapAgainst(self0, other0, stage, selfKind);
        const w = Math.round(Math.min(cap, Math.max(MIN_W, self0.w + delta)));
        // 把手在左/上边时,拖大要让右/下边钉住 → 起点跟着走
        self = makeBox(
          grow.x < 0 ? self0.x + (self0.w - w) : self0.x,
          grow.y < 0 ? self0.y + (self0.h - paneHeight(w, selfKind)) : self0.y,
          w, selfKind);
      }
      const s = settle(self, other0, stage, otherKind);
      if (!s) return;          // 挤不开:这一帧不动,不闪
      latest = which === 'video'
        ? { video: s.moved, material: s.other }
        : { material: s.moved, video: s.other };
      setLayout(latest);
    };
    const onUp = () => {
      el.releasePointerCapture?.(e.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      setCustomized(true);       // 用户亲手调过:此后按他的尺寸 refit,不再自动重算
      persist(latest);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  // ---- 播放票据:URL 里放的不再是整站会话 token,而是只能播这一个视频的两小时票 ----
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState('');
  const [srcError, setSrcError] = useState('');
  const ticketExp = useRef(0);
  const resumeRef = useRef<{ t: number; playing: boolean } | null>(null);
  const wasPlaying = useRef(false);

  const loadTicket = useCallback(async () => {
    const tk = await fetchVideoTicket(video.id);
    ticketExp.current = tk.expires_at;
    setSrc(mediaUrl(tk.url));
    setSrcError('');
  }, [video.id]);

  useEffect(() => {
    setSrc('');
    // 预加载过这一节(上一节快看完时取的): 直接用那张票,地址一样,开头从浏览器缓存出,几乎马上出画面
    const pre = takePrefetchedTicket(video.id);
    if (pre) {
      ticketExp.current = pre.expires_at;
      setSrc(mediaUrl(pre.url));
      setSrcError('');
      return;
    }
    loadTicket().catch(() => setSrcError('视频地址获取失败,请刷新页面重试'));
  }, [loadTicket, video.id]);

  // ---- 倍速 ----
  const [rate, setRate] = useState(readRate);
  const [rateOpen, setRateOpen] = useState(false);
  // 浏览器换 src 时会把 playbackRate 重置回 1,所以每次加载元数据后都要重新设(见 onLoadedMetadata)
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);
  const pickRate = (r: number) => {
    setRate(r);
    setRateOpen(false);
    try { localStorage.setItem(rateKey(), String(r)); } catch { /* 隐私模式写不了,本次照样生效 */ }
  };

  // ---- 网络慢提示: 缓冲超过 SLOW_HINT_MS 才出,播起来就收 ----
  const [slow, setSlow] = useState(false);
  const slowTimer = useRef<number | null>(null);
  const onWaiting = () => {
    if (slowTimer.current !== null) return;
    slowTimer.current = window.setTimeout(() => setSlow(true), SLOW_HINT_MS);
  };
  const clearSlow = () => {
    if (slowTimer.current !== null) { window.clearTimeout(slowTimer.current); slowTimer.current = null; }
    setSlow(false);
  };
  useEffect(() => () => { if (slowTimer.current !== null) window.clearTimeout(slowTimer.current); }, []);

  // ---- 预加载下一节 + 看完自动下一节 ----
  const nextId = nextVideo?.id ?? null;
  const nextLocked = !!nextVideo?.locked;
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v || nextId === null || nextLocked) return;
    // 切节的那一下,元素里还是上一节的画面(停在快结尾),这时的 timeupdate 会配上新的「下一节」,
    // 把下下节提前预加载了 —— 只认当前这一节自己的媒体
    if (!v.currentSrc.includes(`/videos/${video.id}/stream`)) return;
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    if (dur > 0 && v.currentTime > dur / 2 && dur - v.currentTime <= PREFETCH_LEAD_SEC) {
      void prefetchVideo(nextId);
    }
  };
  /** 看完后的倒计时(秒);null = 没在倒计时 */
  const [countdown, setCountdown] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  useEffect(() => { setEnded(false); setCountdown(null); clearSlow(); }, [video.id]);
  const onEnded = () => {
    setEnded(true);
    // 讲义开着时不自动跳(孩子可能还在翻讲义);下一节锁着也不跳,只给「去开通」
    if (nextId !== null && !nextLocked && !viewing) setCountdown(AUTO_NEXT_SEC);
  };
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); onPlayNext?.(); return; }
    const t = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, onPlayNext]);
  const cancelAutoNext = () => { setCountdown(null); setEnded(false); };

  // 把「现在播到第几秒」的读法交给父组件(提问时带位置用)。
  // 播放器没就绪时给 0,后端会当"没带位置"处理
  useEffect(() => {
    onPositionGetter?.(() => Math.floor(videoRef.current?.currentTime || 0));
  }, [onPositionGetter]);

  // 票据两小时过期:暂停放着超过两小时再点播,后续 Range 请求 401 → 元素报错。
  // 只在票据确实到期时换票(不是到期的错误不重试,免死循环),并从原进度继续
  const onVideoError = () => {
    const v = videoRef.current;
    if (!v || Date.now() / 1000 < ticketExp.current - 30) return;
    resumeRef.current = { t: v.currentTime, playing: wasPlaying.current };
    loadTicket().catch(() => setSrcError('视频地址已过期且刷新失败,请刷新页面'));
  };
  // 续播:上次退出的位置(服务端记的,换设备也接得上)。
  // **看完的也续播**(2026-10-02 改):旧规则「看完的从头放」让回来复习、看到一半退出的孩子
  // 下次又被拉回 0:00 —— 生产 28 条「已看完」里有 5 条停在片中。现在只有停在最后 15 秒内
  // (真看到结尾了)才从头;接着放时顶上给一句提示 +「从头看」,想重看整节一键回去
  const resumedOnce = useRef(false);
  useEffect(() => { resumedOnce.current = false; }, [video.id]);
  // 按视频 id 记:换视频不串;几秒后自动收起,不一直挡画面
  const [resumedAt, setResumedAt] = useState<{ vid: number; t: number } | null>(null);
  useEffect(() => {
    if (!resumedAt) return;
    const timer = window.setTimeout(() => setResumedAt(null), RESUME_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [resumedAt]);
  const restartFromBeginning = () => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      // 从「看完了」那一层点进来时视频是停着的,要接着放
      if (v.ended || v.paused) v.play().catch(() => {});
    }
    setResumedAt(null);
    setEnded(false);
    setCountdown(null);
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current, r = resumeRef.current;
    if (!v) return;
    v.playbackRate = rate;   // 换 src 后浏览器把倍速重置回 1,这里补回孩子选的那档
    if (v.videoWidth > 0 && v.videoHeight > 0) setVideoAR(v.videoWidth / v.videoHeight);
    if (r) {
      // 换票导致的重载:接着原处放(这条优先,它是同一次观看的延续)
      resumeRef.current = null;
      v.currentTime = r.t;
      if (r.playing) v.play().catch(() => {});
      return;
    }
    // 首次加载:从服务端记的位置续播。只做一次(换票重载不该再跳回去)
    if (resumedOnce.current) return;
    resumedOnce.current = true;
    const pos = video.my_position_seconds || 0;
    // 太靠前(<10s)没必要跳;距结尾不到 15 秒的当作看到头了,从头放。
    // **不看 my_completed**:「看完过」不等于「这次也看完了」,见上方续播注释
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    if (pos < 10 || (dur > 0 && pos > dur - 15)) return;
    v.currentTime = pos;
    setResumedAt({ vid: video.id, t: pos });
  };

  // 观看心跳:看了多久 / 停在哪 / 看完没有(口径见 useWatchHeartbeat)
  useWatchHeartbeat(
    videoRef, video.id,
    () => onCompleted?.(video.id),
    (p) => onProgress?.(video.id, p),
  );

  // 换讲义 / 关讲义:不再缩放
  const viewingId = viewing?.id ?? null;
  useEffect(() => { setZoomed(false); }, [viewingId]);
  useEffect(() => { setZoomed(false); }, [pages.page]);

  // ---- 全屏:拿走浏览器地址栏那截。iOS Safari 不支持非 video 元素全屏,按钮直接不给 ----
  useEffect(() => {
    const on = () => {
      setFs(!!document.fullscreenElement);
      // 原生视频全屏(双击画面 / 控件栏按钮)只画 <video> 本身,叠在上面的姓名水印就没了 ——
      // 录屏最可能用的恰是这个模式。截下来改成**整块面板**全屏(水印在面板里)
      if (document.fullscreenElement && document.fullscreenElement === videoRef.current) {
        void document.exitFullscreen()
          .then(() => panelRef.current?.requestFullscreen?.())
          .catch(() => { /* 浏览器不给二次请求就退回窗口模式,至少水印还在 */ });
      }
    };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, [panelRef]);
  const canFs = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const toggleFs = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    const p = panelRef.current?.requestFullscreen?.();
    // 讲义打开时不锁:竖屏的上下堆叠是给讲义设计的,锁成横屏反而把讲义挤小
    if (!viewing && videoAR > 1) void p?.then(lockLandscape).catch(() => { /* 进不了全屏就不锁 */ });
  };

  // ---- 键盘翻页。e.repeat 挡按住连翻;焦点在 <video>/输入控件上时不接管
  //      (那时左右箭头是快退/快进,两边都响应会一按既跳页又跳进度) ----
  const go = pages.go;
  useEffect(() => {
    if (!viewing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'VIDEO' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewing, go]);

  // ---- 手机滑动翻页。放大状态下不接管(那时滑动是拖着看局部) ----
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = zoomed ? null : e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 50) return;      // 小位移当误触
    go(dx < 0 ? 1 : -1);
  };

  /**
   * 浮窗定位样式;非浮窗模式交给 className 里的 flex 布局。
   * ⚠️ **高度也要写死**(不是只给宽度):碰撞是按模型高度判的,
   * 让实际高度等于模型高度,而不是让模型去追实际 —— 否则讲义块多出的
   * 顶栏+翻页条会把它撑高 108px,模型说不重叠、屏幕上却压住,底边还捅出舞台。
   */
  const boxStyle = (b: Box | undefined): React.CSSProperties | undefined =>
    floating && b ? { position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h } : undefined;

  /** 顶上的抓手条:按住它拖整块。左边留一条抓手图标提示可拖 */
  const chrome = (which: 'video' | 'material', title: string, extra?: React.ReactNode) => (
    <div
      onPointerDown={(e) => startGesture(e, which, 'move')}
      className="flex shrink-0 touch-none select-none items-center gap-1 bg-slate-800/95 px-2 py-1
                 cursor-grab active:cursor-grabbing"
      style={{ height: CHROME_H }}
    >
      <GripHorizontal className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{title}</span>
      {extra}
    </div>
  );

  /**
   * 改大小的两个把手:右下斜角 + 右侧竖边(块的右/下沿,朝外拖变大,最直觉)。
   * 双击任一还原默认铺位。
   */
  const grips = (which: 'video' | 'material') => (
    <>
      <div
        onPointerDown={(e) => startGesture(e, which, 'x')}
        onDoubleClick={retile}
        role="separator"
        aria-label={`拖动改变${which === 'video' ? '视频' : '讲义'}宽度,双击重排`}
        title="拖动改变宽度,双击重排"
        className="absolute bottom-3 right-0 z-20 flex w-3 cursor-ew-resize touch-none items-center justify-center"
        style={{ top: CHROME_H }}
      >
        <span className="h-8 w-1 rounded-full bg-white/40" />
      </div>
      <div
        onPointerDown={(e) => startGesture(e, which, 'corner')}
        onDoubleClick={retile}
        role="separator"
        aria-label={`斜向拖动改变${which === 'video' ? '视频' : '讲义'}大小,双击重排`}
        title="斜着拖也能改大小,双击重排"
        className="absolute bottom-0 right-0 z-30 flex h-5 w-5 cursor-nwse-resize touch-none
                   items-center justify-center"
      >
        <span className="h-2.5 w-2.5 rounded-sm border-b-2 border-r-2 border-white/50" />
      </div>
    </>
  );

  const paneCls = floating
    ? 'flex flex-col overflow-hidden rounded-xl bg-slate-900 shadow-2xl ring-1 ring-white/15'
    : '';

  return (
    <div
      ref={stageRef}
      className={viewing
        ? `min-h-0 flex-1 ${floating ? 'relative' : 'flex flex-col'}`
        // 全屏:舞台吃掉顶栏以下全部高度,视频框在里面居中(尺寸见 fit)
        : fillScreen ? 'flex min-h-0 flex-1 items-center justify-center overflow-hidden' : 'flex flex-col'}
    >
      {/* ===== 视频块。⚠️ 永远是舞台的第一个孩子;relative 给水印层做定位锚 ===== */}
      <div
        className={[
          'relative bg-black',
          viewing ? (floating ? paneCls : 'flex w-full shrink-0 flex-col')
            : fillScreen ? 'flex shrink-0 flex-col' : 'flex w-full flex-col',
        ].join(' ')}
        style={fit ? { width: fit.w, height: fit.h } : boxStyle(layout?.video)}
      >
        {floating && chrome('video', video.title)}
        <video
          ref={videoRef}
          key={video.id}
          src={src || undefined}
          controls
          autoPlay
          // playsInline: iPhone 不加就自动进系统全屏播放器,水印层根本画不上去。
          // nofullscreen: 关掉原生全屏按钮(Chromium),全屏走下面的面板级按钮(带水印)
          playsInline
          // noplaybackrate: 关掉 Chrome ⋮ 菜单里自带的倍速,只留画面上那个按钮(两处设置会对不上)
          controlsList="nodownload noremoteplayback nofullscreen noplaybackrate"
          disablePictureInPicture
          onContextMenu={block}
          onPlay={() => { wasPlaying.current = true; setEnded(false); setCountdown(null); }}
          onPause={() => { wasPlaying.current = false; }}
          onError={onVideoError}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onEnded={onEnded}
          onWaiting={onWaiting}
          onPlaying={clearSlow}
          onSeeked={clearSlow}
          className={viewing
            ? (floating ? 'w-full min-h-0 flex-1 object-contain' : 'aspect-video w-full object-contain')
            // flex-1 不写 h-full:出错时下面那行提示语要有地方放,不被定高的框裁掉
            : fillScreen ? 'min-h-0 w-full flex-1 object-contain' : 'max-h-[70vh] w-full'}
        >
          你的浏览器不支持视频播放,请换用 Chrome 或 Safari
        </video>
        {/* 水印:盖在画面上、不吃点击(pointer-events-none),录屏/转发留下名字。
            偏右上、半透明,不压播放控件(控件在底部);mix-blend 让深浅底都看得见 */}
        {viewerLabel && (
          <span
            className="pointer-events-none absolute right-3 top-2 z-10 select-none text-[11px]
                       font-medium tracking-wide text-white/45 mix-blend-difference"
            aria-hidden="true"
          >
            {viewerLabel}
          </span>
        )}
        {/* 单看视频时也要能全屏:原生全屏按钮已关(会丢水印),这里补一个面板级的。
            看讲义时讲义顶栏已有全屏按钮,不重复给 */}
        {!viewing && canFs && (
          <button
            type="button"
            onClick={toggleFs}
            aria-label={fs ? '退出全屏' : '全屏'}
            title={fs ? '退出全屏' : '全屏'}
            className={`absolute left-2 top-2 z-10 bg-black/40 ${BTN_SM}`}
          >
            {fs ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        )}
        {/* 续播提示:放在第二行(top-10),避开左上全屏按钮与右上水印 */}
        {resumedAt && resumedAt.vid === video.id && (
          <div
            role="status"
            className="absolute left-2 top-10 z-10 flex items-center gap-2 rounded-full bg-black/70
                       px-3 py-1 text-xs text-white shadow"
          >
            <span>接着上次 {fmtClock(resumedAt.t)} 继续放</span>
            <button
              type="button"
              onClick={restartFromBeginning}
              className="rounded-full bg-white/20 px-2 py-0.5 font-semibold hover:bg-white/30"
            >
              从头看
            </button>
          </div>
        )}
        {/* 倍速: 左上全屏按钮右边。原生控件的倍速藏在 ⋮ 里孩子找不到,微信/iPhone 上还不一定有 */}
        <div className={`absolute top-2 z-20 ${!viewing && canFs ? 'left-12' : 'left-2'}`}>
          <button
            type="button"
            onClick={() => setRateOpen((o) => !o)}
            aria-label={`播放速度 ${rate} 倍,点一下换`}
            aria-expanded={rateOpen}
            className="rounded-md bg-black/50 px-2 py-1 font-numeric text-xs font-semibold text-white hover:bg-black/70"
          >
            {rate === 1 ? '1.0x' : `${rate}x`}
          </button>
          {rateOpen && (
            <div role="menu" className="mt-1 flex flex-col overflow-hidden rounded-lg bg-black/85 py-1 shadow-lg">
              {RATES.map((r) => (
                <button
                  key={r} type="button" role="menuitemradio" aria-checked={r === rate}
                  onClick={() => pickRate(r)}
                  className={`px-4 py-1.5 text-left font-numeric text-xs ${
                    r === rate ? 'font-bold text-orange-300' : 'text-white hover:bg-white/10'}`}
                >
                  {r === 1 ? '1.0x 正常' : r < 1 ? `${r}x 慢速跟读` : `${r}x`}
                </button>
              ))}
            </div>
          )}
        </div>
        {slow && !ended && (
          <div role="status" className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center">
            <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">网络有点慢，正在缓冲…</span>
          </div>
        )}
        {/* 看完了: 下一节倒计时 / 下一节锁着 / 这是最后一节 */}
        {ended && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
            <div className="max-w-sm text-center text-white">
              {nextVideo ? (
                <>
                  <p className="text-xs text-white/70">{countdown !== null ? `${countdown} 秒后播放下一节` : '下一节'}</p>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold">{nextVideo.title}</p>
                  <div className="mt-3 flex justify-center gap-2">
                    {/* 取消 = 收起这一层(否则它盖着播放控件,孩子没法重看) */}
                    <button type="button" onClick={cancelAutoNext}
                            className="rounded-lg bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25">
                      {countdown !== null ? '取消' : '关闭'}
                    </button>
                    <button type="button" onClick={() => { setCountdown(null); onPlayNext?.(); }}
                            className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold hover:bg-orange-600">
                      {nextLocked ? '🔒 这一节需要开通' : '立即播放'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold">这一组都看完了 🎉</p>
                  <div className="mt-3 flex justify-center gap-2">
                    <button type="button" onClick={cancelAutoNext}
                            className="rounded-lg bg-white/15 px-3 py-1.5 text-xs hover:bg-white/25">
                      关闭
                    </button>
                    <button type="button" onClick={restartFromBeginning}
                            className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold hover:bg-orange-600">
                      再看一遍
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {srcError && <p className="px-3 py-2 text-center text-xs text-rose-300">{srcError}</p>}
        {floating && grips('video')}
      </div>

      {/* ===== 讲义块 ===== */}
      {viewing && (
        <div
          className={[
            'bg-slate-900',
            floating ? paneCls : 'flex min-h-0 flex-1 flex-col border-t border-white/10',
          ].join(' ')}
          style={boxStyle(layout?.material)}
        >
          {floating
            ? chrome('material', viewing.title)
            : null}

          {/* 顶栏:选哪份讲义 + 缩放 / 重排 / 全屏 / 收起。
              ⚠️ 浮窗窄到 300 出头时五个控件会挤成一团(截图里下拉框文字被压扁),
              所以浮窗模式下:标题只显页码、按钮不换行、下拉给最小宽度 */}
          <div className="flex shrink-0 items-center gap-1.5 overflow-hidden px-2 py-1.5">
            {materials.length > 1 ? (
              <select
                value={viewing.id}
                onChange={(e) => {
                  const m = materials.find((x) => x.id === Number(e.target.value));
                  if (m) onViewing(m);
                }}
                aria-label="切换讲义"
                className="min-w-0 flex-1 truncate rounded-lg bg-slate-800 px-2 py-1 text-xs text-white
                           outline-none focus:ring-2 focus:ring-orange-400"
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id} className="bg-slate-800 text-white">
                    {m.title}({m.page_count} 页)
                  </option>
                ))}
              </select>
            ) : (
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-white">
                {floating ? `${pages.page} / ${pages.total}` : viewing.title}
              </p>
            )}
            <button onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? '还原大小' : '放大看局部'}
                    title={zoomed ? '还原' : '放大看局部'} className={`${BTN} shrink-0`}>
              {zoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
            </button>
            {floating && (
              <button onClick={retile} aria-label="重排两个窗口" title="重排:回到默认位置和大小"
                      className={`${BTN} shrink-0`}>
                <LayoutTemplate className="h-4 w-4" />
              </button>
            )}
            {canFs && (
              <button onClick={toggleFs} aria-label={fs ? '退出全屏' : '全屏'} title={fs ? '退出全屏' : '全屏'}
                      className={`${BTN} shrink-0`}>
                {fs ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
              </button>
            )}
            <button onClick={() => onViewing(null)} aria-label="收起讲义" title="收起讲义"
                    className={`${BTN} shrink-0`}>
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* 页面区。放大时允许滚动看局部 */}
          <div
            className={`min-h-0 flex-1 select-none bg-black/40 ${
              zoomed ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden px-2'}`}
            style={NO_COPY}
            onContextMenu={block}
            onDragStart={block}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {pages.loading && (
              <div className="flex h-full items-center justify-center">
                <LoaderCircle className="h-7 w-7 animate-spin text-white/70" />
              </div>
            )}
            {!pages.loading && pages.error && (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-3 text-center">
                <p className="text-sm text-slate-300">{pages.error}</p>
                <button onClick={pages.retryLoad}
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20">
                  重试
                </button>
              </div>
            )}
            {!pages.loading && !pages.error && pages.url && (
              <img
                src={pages.url}
                alt={`${viewing.title} 第 ${pages.page} 页`}
                onClick={() => setZoomed((z) => !z)}
                // 横版幻灯片:铺满这块;竖屏按**宽度**铺(塞进屏高会让字小到看不清)
                className={zoomed
                  ? 'w-[200%] max-w-none cursor-zoom-out'
                  : 'max-h-full w-full cursor-zoom-in object-contain'}
                draggable={false}
                onContextMenu={block}
                onDragStart={block}
                style={NO_COPY}
              />
            )}
          </div>

          {/* 底栏翻页。竖屏贴着屏幕下缘,给刘海屏留安全区 */}
          <div className="relative flex shrink-0 items-center justify-center gap-5 px-3 py-2
                          pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button onClick={() => go(-1)} disabled={pages.page <= 1} aria-label="上一页" className={BTN}>
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="min-w-16 text-center text-sm text-slate-300">{pages.page} / {pages.total}</span>
            <button onClick={() => go(1)} disabled={pages.page >= pages.total} aria-label="下一页" className={BTN}>
              <ChevronRight className="h-5 w-5" />
            </button>
            {/* 竖屏提示:横过来两块能并排摆。横屏隐藏 */}
            {!floating && (
              <span className="absolute right-3 flex items-center gap-1 text-[11px] text-slate-400 landscape:hidden">
                <RotateCw className="h-3 w-3" /> 横屏更清楚
              </span>
            )}
          </div>

          {floating && grips('material')}
        </div>
      )}
    </div>
  );
}
