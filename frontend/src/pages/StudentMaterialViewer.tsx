/**
 * 学生端 - 课件阅览器(能看不能下)
 *
 * ## 防护分层(先说实话:截屏和手机拍照防不住,任何方案都防不住)
 * 1. 服务端保证原文件没有任何可访问 URL,拿到的每张图都烧了本人姓名+ID+时间;
 * 2. 图走 blob 加载 —— **不给 <img src> 直链**,否则复制链接就能分享给校外;
 * 3. 禁右键/禁拖拽/禁选中/禁长按菜单,`@media print` 整页遮黑;
 * 4. 离开页面立刻 revokeObjectURL,不在设备上留缓存。
 *
 * 真正的抓手是第 1 条:传出去一眼看得出是谁传的。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { studentLiveApi, fetchMaterialPage, type StudentMaterial } from '../api/live';

export default function StudentMaterialViewer() {
  const { materialId } = useParams<{ materialId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const mid = Number(materialId);

  const [material, setMaterial] = useState<StudentMaterial | null>(null);
  const [page, setPage] = useState(1);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 已创建的 objectURL 全部记下来,卸载时统一释放。
  // 不释放的话翻几十页能吃掉几百 MB —— 每页都是解码后的位图
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    const sessionId = searchParams.get('session');
    studentLiveApi
      .listMaterials(sessionId ? Number(sessionId) : undefined)
      .then((list) => {
        const found = list.find((m) => m.id === mid);
        if (!found) {
          setError('课件不存在或还没开放');
          return;
        }
        setMaterial(found);
      })
      .catch(() => setError('加载课件信息失败'));
  }, [mid, searchParams]);

  const loadPage = useCallback(async (n: number) => {
    setLoading(true);
    setError(null);
    try {
      const url = await fetchMaterialPage(mid, n);
      urlsRef.current.push(url);
      setImgUrl(url);
    } catch {
      setError('这一页加载失败,请重试');
    } finally {
      setLoading(false);
    }
  }, [mid]);

  useEffect(() => {
    if (material) loadPage(page);
  }, [material, page, loadPage]);

  // 卸载时释放全部 blob
  useEffect(() => {
    return () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
    };
  }, []);

  // 键盘翻页(PC 大屏)。输入框内不劫持
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const total = material?.page_count || 1;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setPage((p) => Math.min(total, p + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setPage((p) => Math.max(1, p - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [material?.page_count]);

  const total = material?.page_count || 1;
  const block = (e: React.SyntheticEvent) => e.preventDefault();

  return (
    <div className="min-h-screen bg-[#FFF8F0] pb-24">
      {/* 打印时整页遮黑 —— Ctrl+P 存 PDF 这条路堵掉 */}
      <style>{`
        @media print {
          body { display: none !important; }
        }
        .no-copy {
          -webkit-user-select: none; user-select: none;
          -webkit-touch-callout: none;
        }
      `}</style>

      {/* 顶栏 */}
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-orange-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-2xl hover:scale-110 transition"
            aria-label="返回"
          >
            ⬅️
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-gray-800 truncate">
              {material?.title || '课件'}
            </h1>
            <p className="text-xs text-gray-500">
              第 {page} / {total} 页 · 仅供本人在线查看
            </p>
          </div>
        </div>
      </div>

      {/* 画面 */}
      <div className="max-w-5xl mx-auto px-3 md:px-4 pt-4">
        <div
          className="no-copy relative bg-white rounded-2xl shadow-lg overflow-hidden"
          onContextMenu={block}
          onDragStart={block}
        >
          {loading && (
            <div className="aspect-[1/1.414] flex items-center justify-center text-gray-400">
              <div className="text-center">
                <div className="text-4xl mb-2 animate-bounce">📖</div>
                <p className="text-sm">加载中…</p>
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="aspect-[1/1.414] flex items-center justify-center">
              <div className="text-center px-6">
                <div className="text-4xl mb-2">😕</div>
                <p className="text-gray-600 mb-3">{error}</p>
                <button
                  onClick={() => loadPage(page)}
                  className="px-4 py-2 rounded-xl bg-[#FF6B35] text-white font-bold"
                >
                  重试
                </button>
              </div>
            </div>
          )}

          {!loading && !error && imgUrl && (
            <motion.img
              key={`${mid}-${page}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              src={imgUrl}
              alt={`${material?.title || '课件'} 第 ${page} 页`}
              className="w-full h-auto block pointer-events-none"
              draggable={false}
              onContextMenu={block}
            />
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-3">
          页面已标记你的身份信息,请勿外传
        </p>
      </div>

      {/* 底部翻页条 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-orange-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-5 py-2.5 rounded-xl bg-orange-100 text-[#FF6B35] font-bold disabled:opacity-40"
          >
            上一页
          </button>
          <div className="flex-1 text-center text-sm text-gray-600 font-medium">
            {page} / {total}
          </div>
          <button
            disabled={page >= total}
            onClick={() => setPage((p) => Math.min(total, p + 1))}
            className="px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
