/**
 * 音标课件阅览器 — 学生端
 *
 * 看完视频回看老师的讲义。**只拿到逐页渲染的图,拿不到原文件**
 * (走 blob 取图:既能带 Authorization 头,又不产生可分享的直链)。
 *
 * 不复用 StudentMaterialViewer:那一套是给防泄露的付费直播课件做的 ——
 * 按人烧水印、@media print 遮黑、禁右键、no-store 禁缓存。音标讲义是教学辅助,
 * 不烧水印,所以图能被浏览器缓存,来回翻页不重复走网络。
 *
 * 三个必须处理的点:
 * 1. **blob URL 必须 revoke**。几十页不释放会吃掉几百 MB(这是内存泄漏,不是"优化")。
 * 2. **预取下一页**。课件是连着看的,不预取每翻一页都要干等一次网络。
 * 3. **横版幻灯片 + 竖屏手机**。默认按宽度铺满(而不是塞进屏幕高度 —— 那样字小到看不清),
 *    点一下放大到 2 倍并可拖动,给需要看细节的孩子用。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { fetchPhoneticMaterialPage, type StudentMaterial } from '../../api/phonetics';

interface Props {
  material: StudentMaterial;
  onClose: () => void;
}

export default function MaterialViewer({ material, onClose }: Props) {
  const [page, setPage] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoomed, setZoomed] = useState(false);

  const total = material.page_count;

  /**
   * 已取到的页 → blob URL。**组件卸载时必须全部 revoke**。
   * 用 ref 而不是 state:它是缓存不是渲染依据,放 state 会每次取页都重渲染整棵树。
   */
  const cacheRef = useRef<Map<number, string>>(new Map());

  const getPage = useCallback(async (n: number): Promise<string> => {
    const hit = cacheRef.current.get(n);
    if (hit) return hit;
    const u = await fetchPhoneticMaterialPage(material.id, n);
    cacheRef.current.set(n, u);
    return u;
  }, [material.id]);

  // 取当前页 + 预取下一页(课件是连着看的,不预取每翻一页都要干等)
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const u = await getPage(page);
        if (!alive) return;
        setUrl(u);
        setLoading(false);
        if (page < total) void getPage(page + 1).catch(() => {});   // 预取失败不报错
      } catch {
        if (!alive) return;
        setLoading(false);
        setError('这一页加载失败,请重试或告诉老师');
      }
    })();
    return () => { alive = false; };
  }, [page, total, getPage]);

  // 卸载时释放所有 blob URL —— 漏掉这一步就是内存泄漏
  useEffect(() => {
    const cache = cacheRef.current;
    return () => { cache.forEach((u) => URL.revokeObjectURL(u)); cache.clear(); };
  }, []);

  const go = useCallback((delta: number) => {
    setPage((p) => {
      const next = p + delta;
      if (next < 1 || next > total) return p;
      setZoomed(false);          // 翻页回到适宽,否则新页停在上一页的放大位置
      return next;
    });
  }, [total]);

  // 键盘翻页(桌面):左右箭头 + Esc 关闭。
  // e.repeat 挡住按住不放连翻 —— 与卡片写音标那边同一个口径
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // 手机滑动翻页。放大状态下不接管滑动(那时滑动是拖动看局部)
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

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900">
      {/* 顶栏:标题 + 页码 + 关闭 */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
        <p className="min-w-0 truncate text-sm font-semibold text-white">{material.title}</p>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-slate-300">{page} / {total}</span>
          <button
            onClick={() => setZoomed((z) => !z)}
            aria-label={zoomed ? '还原大小' : '放大'}
            className="rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20"
          >
            {zoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
          </button>
          <button
            onClick={onClose}
            aria-label="关闭课件"
            className="rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 页面区。放大时允许滚动看局部 */}
      <div
        className={`flex-1 ${zoomed ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden'} px-2`}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {loading && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-white/70" />
          </div>
        )}
        {!loading && error && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-slate-300">{error}</p>
            <button
              onClick={() => setPage((p) => p)}      /* 触发重取 */
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
            >
              重试
            </button>
          </div>
        )}
        {!loading && !error && url && (
          <img
            src={url}
            alt={`${material.title} 第 ${page} 页`}
            onClick={() => setZoomed((z) => !z)}
            // 横版幻灯片 + 竖屏手机:默认按**宽度**铺满而不是塞进屏高
            // (塞进高度会让 16:9 的幻灯片字小到看不清)
            className={zoomed
              ? 'w-[200%] max-w-none cursor-zoom-out'
              : 'max-h-full w-full cursor-zoom-in object-contain'}
            draggable={false}
          />
        )}
      </div>

      {/* 底栏翻页:手固定在屏幕下缘,不用去够页面中间 */}
      <div className="flex shrink-0 items-center justify-center gap-6 px-4 py-3">
        <button
          onClick={() => go(-1)}
          disabled={page <= 1}
          aria-label="上一页"
          className="rounded-xl bg-white/10 p-2.5 text-white hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-16 text-center text-sm text-slate-300">{page} / {total}</span>
        <button
          onClick={() => go(1)}
          disabled={page >= total}
          aria-label="下一页"
          className="rounded-xl bg-white/10 p-2.5 text-white hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
