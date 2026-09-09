/**
 * 授课舞台:讲义大、视频小(可对调、可拖到任一角、可全屏)
 *
 * 为什么不并排各占一半(上一版):两个都是 16:9,并排时各占一半宽 → 1366 宽的屏上
 * 讲义只剩 480px,按 1920 设计的幻灯片缩到 1/4,24 号正文落到屏幕上不到 6px;
 * 而高度只用掉三分之一,上下大片空白。用户实报"看不清"。
 *
 * 一大一小:要看清字的是讲义,给它整个舞台;视频是听讲解看口型的,缩到角上足够,
 * 想看清老师时一键对调。视频永远不暂停、控件永远露着。
 *
 * ⚠️ <video> 在所有布局下都留在树里同一位置,只换 className/style ——
 * 写成分支各放一个 <video>,切布局那一下就重挂、进度归零。
 * 横屏时大小两块都用 absolute 铺在同一个 relative 舞台上,所以 DOM 顺序永远不变;
 * 小窗的 grip 条用 `{cond && chrome(...)}` 占位,false 也占一个子节点位,video 的下标不漂。
 *
 * 竖屏手机:上下堆叠(讲义已占满宽度,小窗没意义),底栏提示横屏。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useDragControls, useMotionValue, type MotionValue, type PanInfo } from 'framer-motion';
import {
  ArrowLeftRight, ChevronLeft, ChevronRight, Expand, GripHorizontal, LoaderCircle,
  Maximize2, Minimize2, RotateCw, Shrink, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { playableUrl, type PhoneticVideo, type StudentMaterial } from '../../api/phonetics';
import { useMaterialPages } from './useMaterialPages';

interface Props {
  video: PhoneticVideo;
  materials: StudentMaterial[];
  /** 正在看的讲义;null = 只看视频(舞台退化成普通播放器) */
  viewing: StudentMaterial | null;
  onViewing: (m: StudentMaterial | null) => void;
  /** 播放面板的 DOM,全屏就是把它整个送进 requestFullscreen */
  panelRef: React.RefObject<HTMLDivElement | null>;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNER_CLS: Record<Corner, string> = {
  tl: 'landscape:left-3 landscape:top-3',
  tr: 'landscape:right-3 landscape:top-3',
  bl: 'landscape:left-3 landscape:bottom-3',
  br: 'landscape:right-3 landscape:bottom-3',
};

/** 横屏/桌面为 true。竖屏手机走上下堆叠,不做小窗 */
function useLandscape(): boolean {
  const Q = '(orientation: landscape)';
  const [land, setLand] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(Q).matches,
  );
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

const BTN = 'rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20 disabled:opacity-30';
const BTN_SM = 'rounded-md p-1 text-slate-200 hover:bg-white/15';

export default function LessonStage({ video, materials, viewing, onViewing, panelRef }: Props) {
  const landscape = useLandscape();
  /** true = 视频占大屏、讲义缩到角上(看老师口型时用) */
  const [swapped, setSwapped] = useState(false);
  const [corner, setCorner] = useState<Corner>('br');
  /** 小窗再缩一档:只想听声音、给讲义腾地方 */
  const [mini, setMini] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [fs, setFs] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const pages = useMaterialPages(viewing);

  // 换讲义 / 关讲义:回到「讲义大」,不缩放
  const viewingId = viewing?.id ?? null;
  useEffect(() => { setZoomed(false); if (viewingId === null) setSwapped(false); }, [viewingId]);
  // 翻页回到适宽,否则新页停在上一页的放大位置
  useEffect(() => { setZoomed(false); }, [pages.page]);

  // ---- 全屏:拿走浏览器地址栏那截。iOS Safari 不支持非 video 元素全屏,按钮直接不给 ----
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const canFs = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void panelRef.current?.requestFullscreen?.();
  };

  // ---- 键盘翻页。e.repeat 挡住按住连翻;焦点在 <video>/输入控件上时不接管
  //      (那时左右箭头是视频快退/快进,两边都响应会一按既跳页又跳进度) ----
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
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = zoomed ? null : e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) < 50) return;      // 小位移当误触,不翻页
    go(dx < 0 ? 1 : -1);
  };

  // ---- 小窗拖动:只能抓 grip 条(抓视频本体会和播放控件打架),松手吸到最近的角 ----
  const vidDrag = useDragControls();
  const matDrag = useDragControls();
  const vx = useMotionValue(0), vy = useMotionValue(0);
  const mx = useMotionValue(0), my = useMotionValue(0);
  const snap = useCallback((info: PanInfo, x: MotionValue<number>, y: MotionValue<number>) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (r) {
      const px = info.point.x - window.scrollX;
      const py = info.point.y - window.scrollY;
      const left = px < r.left + r.width / 2;
      const top = py < r.top + r.height / 2;
      setCorner(top ? (left ? 'tl' : 'tr') : (left ? 'bl' : 'br'));
    }
    // 位置改由 corner 类决定,transform 归零。
    // ⚠️ 必须用 jump 不能用 set:framer 是在自己的"回弹到约束内"惯性动画**已经启动**
    // 之后才回调 onDragEnd 的,set 不会停掉那个动画,下一帧就被它改回拖动末尾的值 ——
    // 实测小窗因此飞到舞台外 800 多像素。jump 会先停动画再赋值。
    x.jump(0); y.jump(0);
  }, []);

  const videoSmall = !!viewing && landscape && !swapped;
  const materialSmall = !!viewing && landscape && swapped;

  const smallCls = [
    'landscape:absolute landscape:z-10 landscape:overflow-hidden landscape:rounded-xl',
    'landscape:bg-slate-900 landscape:shadow-2xl landscape:ring-1 landscape:ring-white/15',
    CORNER_CLS[corner],
    mini ? 'landscape:w-[180px]' : 'landscape:w-[34%] landscape:min-w-[240px] landscape:max-w-[480px]',
  ].join(' ');
  const bigCls = 'landscape:absolute landscape:inset-0';

  /** 小窗顶上的抓手条:拖动 + 对调 + 缩放。只在横屏、且这块是小窗时出现。
   *  写成普通函数而不是组件:定义在组件体内的组件每次渲染都是新类型,React 会把它
   *  卸了重挂;函数返回 JSX 就只是普通子节点,diff 正常 */
  const chrome = (ctl: ReturnType<typeof useDragControls>, title: string) => (
    <div
      onPointerDown={(e) => ctl.start(e)}
      className="hidden touch-none select-none items-center gap-1 bg-slate-800/95 px-2 py-1
                 landscape:flex cursor-grab active:cursor-grabbing"
    >
      <GripHorizontal className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{title}</span>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setSwapped((s) => !s)}
        aria-label="对调:把这个换到大屏"
        title="对调:把这个换到大屏"
        className={BTN_SM}
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </button>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setMini((m) => !m)}
        aria-label={mini ? '还原小窗' : '缩小小窗'}
        title={mini ? '还原小窗' : '缩小小窗'}
        className={BTN_SM}
      >
        {mini ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  return (
    <div
      ref={stageRef}
      className={viewing
        ? 'relative min-h-0 flex-1 portrait:flex portrait:flex-col'
        : 'flex flex-col'}
    >
      {/* ===== 视频块。⚠️ 永远是舞台的第一个孩子 ===== */}
      <motion.div
        drag={videoSmall}
        dragControls={vidDrag}
        dragListener={false}
        dragMomentum={false}
        dragConstraints={stageRef}
        onDragEnd={(_, info) => snap(info, vx, vy)}
        style={{ x: vx, y: vy }}
        className={[
          'flex flex-col bg-black',
          viewing ? 'portrait:w-full portrait:shrink-0' : 'w-full',
          viewing ? (videoSmall ? smallCls : bigCls) : '',
        ].join(' ')}
      >
        {videoSmall && chrome(vidDrag, video.title)}
        <video
          key={video.id}
          src={playableUrl(video)}
          controls
          autoPlay
          controlsList="nodownload"
          className={viewing
            ? (videoSmall ? 'aspect-video w-full object-contain' : 'h-full w-full object-contain portrait:aspect-video')
            : 'max-h-[70vh] w-full'}
        >
          你的浏览器不支持视频播放,请换用 Chrome 或 Safari
        </video>
      </motion.div>

      {/* ===== 讲义块 ===== */}
      {viewing && (
        <motion.div
          drag={materialSmall}
          dragControls={matDrag}
          dragListener={false}
          dragMomentum={false}
          dragConstraints={stageRef}
          onDragEnd={(_, info) => snap(info, mx, my)}
          style={{ x: mx, y: my }}
          className={[
            'flex flex-col bg-slate-900',
            'portrait:min-h-0 portrait:flex-1 portrait:border-t portrait:border-white/10',
            materialSmall ? smallCls : bigCls,
          ].join(' ')}
        >
          {materialSmall ? (
            <>
              {chrome(matDrag, viewing.title)}
              <div className="relative aspect-video w-full bg-black/40">
                {pages.url && !pages.loading && (
                  <img src={pages.url} alt={`${viewing.title} 第 ${pages.page} 页`}
                       className="h-full w-full object-contain" draggable={false} />
                )}
                {pages.loading && (
                  <div className="flex h-full items-center justify-center">
                    <LoaderCircle className="h-5 w-5 animate-spin text-white/70" />
                  </div>
                )}
                {/* 小窗里的翻页:压在图下缘,别再占一行 */}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2
                                bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                  <button onClick={() => go(-1)} disabled={pages.page <= 1} aria-label="上一页" className={BTN_SM}>
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-xs text-slate-200">{pages.page} / {pages.total}</span>
                  <button onClick={() => go(1)} disabled={pages.page >= pages.total} aria-label="下一页" className={BTN_SM}>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* 顶栏:哪份讲义 + 缩放 / 全屏 / 收起 */}
              <div className="flex shrink-0 items-center gap-2 px-3 py-2">
                {materials.length > 1 ? (
                  <select
                    value={viewing.id}
                    onChange={(e) => {
                      const m = materials.find((x) => x.id === Number(e.target.value));
                      if (m) onViewing(m);
                    }}
                    aria-label="切换讲义"
                    className="min-w-0 flex-1 rounded-lg bg-slate-800 px-2 py-1 text-sm text-white outline-none
                               focus:ring-2 focus:ring-orange-400"
                  >
                    {materials.map((m) => (
                      <option key={m.id} value={m.id} className="bg-slate-800 text-white">
                        {m.title}({m.page_count} 页)
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{viewing.title}</p>
                )}
                <button onClick={() => setZoomed((z) => !z)} aria-label={zoomed ? '还原大小' : '放大看局部'}
                        title={zoomed ? '还原' : '放大看局部'} className={BTN}>
                  {zoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
                </button>
                {/* 横屏才有「视频换到大屏」这回事 */}
                <button onClick={() => setSwapped(true)} aria-label="把视频换到大屏" title="把视频换到大屏"
                        className={`hidden landscape:inline-flex ${BTN}`}>
                  <ArrowLeftRight className="h-4 w-4" />
                </button>
                {canFs && (
                  <button onClick={toggleFs} aria-label={fs ? '退出全屏' : '全屏'} title={fs ? '退出全屏' : '全屏'} className={BTN}>
                    {fs ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
                  </button>
                )}
                <button onClick={() => onViewing(null)} aria-label="收起讲义" title="收起讲义" className={BTN}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 页面区。放大时允许滚动看局部 */}
              <div
                className={`min-h-0 flex-1 bg-black/40 ${
                  zoomed ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden px-2'}`}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
              >
                {pages.loading && (
                  <div className="flex h-full items-center justify-center">
                    <LoaderCircle className="h-7 w-7 animate-spin text-white/70" />
                  </div>
                )}
                {!pages.loading && pages.error && (
                  <div className="flex h-full flex-col items-center justify-center gap-3">
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
                    // 横版幻灯片:铺满舞台;竖屏手机按**宽度**铺(塞进屏高会让字小到看不清)
                    className={zoomed
                      ? 'w-[200%] max-w-none cursor-zoom-out'
                      : 'max-h-full w-full cursor-zoom-in object-contain'}
                    draggable={false}
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
                {/* 竖屏提示:横过来讲义能铺满整屏。横屏隐藏 */}
                <span className="absolute right-3 flex items-center gap-1 text-[11px] text-slate-400 landscape:hidden">
                  <RotateCw className="h-3 w-3" /> 横屏更清楚
                </span>
              </div>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}
