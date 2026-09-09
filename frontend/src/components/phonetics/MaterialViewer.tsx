/**
 * 讲义面板 — 嵌在视频播放弹层里,与视频**同屏**
 *
 * 老师视频里讲到哪一页,学生手边就该翻到哪一页 —— 视频和讲义是一起看的,不是二选一。
 * 所以这个组件不是全屏弹层,它只填满父容器分给它的那一块:横屏/桌面在视频右侧,
 * 竖屏手机在视频下方(视频钉在顶部继续播)。上一版做成全屏盖住视频、还把视频暂停,
 * 等于把两样东西做成了互斥,是错的。
 *
 * 几个必须处理的点:
 * 1. **blob URL 必须 revoke**。几十页不释放会吃掉几百 MB(内存泄漏,不是"优化")。
 * 2. **预取下一页**。课件是连着看的,不预取每翻一页都要干等一次网络。
 * 3. **横版幻灯片 + 竖屏手机**:按宽度铺满(塞进高度会让字小到看不清),点一下放大 2 倍可拖动。
 * 4. **键盘箭头翻页,但焦点在 <video> 上时不接管** —— 那时左右箭头是视频快退/快进,
 *    两边都响应的话学生按一下既跳了页又跳了视频进度。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { fetchPhoneticMaterialPage, type StudentMaterial } from '../../api/phonetics';

interface Props {
  material: StudentMaterial;
  /** 同一个视频的全部讲义,多于一份时给切换器 */
  materials?: StudentMaterial[];
  onSwitch?: (m: StudentMaterial) => void;
  /** 横屏/桌面:让讲义占大半、视频让位(看小字时用)。不传则不显示该按钮 */
  enlarged?: boolean;
  onToggleEnlarge?: () => void;
  /** 收起讲义,回到只看视频。视频不受影响 */
  onClose: () => void;
}

export default function MaterialViewer({
  material, materials, onSwitch, enlarged = false, onToggleEnlarge, onClose,
}: Props) {
  const [page, setPage] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoomed, setZoomed] = useState(false);
  // 重试计数:同一页重取时 page 没变,effect 不会重跑,靠它触发
  const [retry, setRetry] = useState(0);

  const total = material.page_count;

  /**
   * 已取到的页 → blob URL。**卸载时必须全部 revoke**。
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

  // 取当前页 + 预取下一页
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
  }, [page, total, getPage, retry]);

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

  // 键盘翻页。e.repeat 挡住按住不放连翻(与卡片写音标同口径)。
  // ⚠️ 焦点在 <video> 上时不接管:那时箭头是视频快退/快进;在下拉/输入框里同理
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'VIDEO' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // 手机滑动翻页。放大状态下不接管(那时滑动是拖着看局部)
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

  const iconBtn = 'rounded-lg bg-white/10 p-1.5 text-white hover:bg-white/20 disabled:opacity-30';

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-900">
      {/* 顶栏:哪份讲义 + 缩放/放大/收起 */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        {materials && materials.length > 1 && onSwitch ? (
          <select
            value={material.id}
            onChange={(e) => {
              const m = materials.find((x) => x.id === Number(e.target.value));
              if (m) onSwitch(m);
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
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{material.title}</p>
        )}
        <button
          onClick={() => setZoomed((z) => !z)}
          aria-label={zoomed ? '还原大小' : '放大看局部'}
          title={zoomed ? '还原' : '放大看局部'}
          className={iconBtn}
        >
          {zoomed ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
        </button>
        {/* 只在横屏/桌面才有"讲义放大、视频让位"这回事;竖屏上下排没得让 */}
        {onToggleEnlarge && (
          <button
            onClick={onToggleEnlarge}
            aria-label={enlarged ? '还原视频大小' : '放大讲义'}
            title={enlarged ? '还原' : '放大讲义(视频缩小)'}
            className={`hidden landscape:inline-flex ${iconBtn}`}
          >
            {enlarged ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
        <button onClick={onClose} aria-label="收起讲义" title="收起讲义" className={iconBtn}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 页面区。放大时允许滚动看局部 */}
      <div
        className={`min-h-0 flex-1 bg-black/40 px-2 ${
          zoomed ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden'}`}
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
              onClick={() => setRetry((n) => n + 1)}
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
            // 横版幻灯片 + 竖屏手机:按**宽度**铺满而不是塞进屏高
            // (塞进高度会让 16:9 的幻灯片字小到看不清)
            className={zoomed
              ? 'w-[200%] max-w-none cursor-zoom-out'
              : 'max-h-full w-full cursor-zoom-in object-contain'}
            draggable={false}
          />
        )}
      </div>

      {/* 底栏翻页。竖屏手机贴着屏幕下缘,要给刘海屏留安全区 */}
      <div className="flex shrink-0 items-center justify-center gap-5 px-3 py-2
                      pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button onClick={() => go(-1)} disabled={page <= 1} aria-label="上一页" className={iconBtn}>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-16 text-center text-sm text-slate-300">{page} / {total}</span>
        <button onClick={() => go(1)} disabled={page >= total} aria-label="下一页" className={iconBtn}>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}