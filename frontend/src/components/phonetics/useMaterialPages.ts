/**
 * 讲义分页数据:取页 / 缓存 / 预取 / 释放
 *
 * 只管数据,不管长相 —— 舞台布局(一大一小 / 上下堆叠)由 LessonStage 决定,
 * 这里保证不管怎么排,翻页逻辑只有一份。
 *
 * 1. **blob URL 必须 revoke**:几十页不释放会吃掉几百 MB,这是内存泄漏不是"优化"。
 *    卸载时全清;运行中超过 CACHE_MAX 张就淘汰最早的(Map 保持插入序)。
 * 2. **预取下一页**:课件是连着看的,不预取每翻一页都要干等一次网络。
 * 3. 缓存键带 material.id:同一个视频挂多份讲义,来回切不重下。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPhoneticMaterialPage, type StudentMaterial } from '../../api/phonetics';

const CACHE_MAX = 40;

export function useMaterialPages(material: StudentMaterial | null) {
  const [page, setPage] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 重试计数:同一页重取时 page 没变,effect 不会重跑,靠它触发
  const [retry, setRetry] = useState(0);

  const total = material?.page_count ?? 0;
  const materialId = material?.id ?? null;

  /** `${id}:${n}` → blob URL。用 ref 而不是 state:它是缓存不是渲染依据 */
  const cacheRef = useRef<Map<string, string>>(new Map());

  // 换讲义回到第 1 页
  useEffect(() => { setPage(1); }, [materialId]);

  const getPage = useCallback(async (id: number, n: number): Promise<string> => {
    const key = `${id}:${n}`;
    const hit = cacheRef.current.get(key);
    if (hit) return hit;
    const u = await fetchPhoneticMaterialPage(id, n);
    const cache = cacheRef.current;
    cache.set(key, u);
    // 淘汰最早的,别让一份 200 页的讲义把内存吃满
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      const old = cache.get(oldest);
      if (old) URL.revokeObjectURL(old);
      cache.delete(oldest);
    }
    return u;
  }, []);

  useEffect(() => {
    if (materialId === null) { setUrl(null); setLoading(false); setError(''); return; }
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const u = await getPage(materialId, page);
        if (!alive) return;
        setUrl(u);
        setLoading(false);
        if (page < total) void getPage(materialId, page + 1).catch(() => {});   // 预取失败不报错
      } catch {
        if (!alive) return;
        setLoading(false);
        setError('这一页加载失败,请重试或告诉老师');
      }
    })();
    return () => { alive = false; };
  }, [materialId, page, total, getPage, retry]);

  // 卸载时释放所有 blob URL —— 漏掉这一步就是内存泄漏
  useEffect(() => {
    const cache = cacheRef.current;
    return () => { cache.forEach((u) => URL.revokeObjectURL(u)); cache.clear(); };
  }, []);

  const go = useCallback((delta: number) => {
    setPage((p) => {
      const next = p + delta;
      return next < 1 || next > total ? p : next;
    });
  }, [total]);

  return {
    page, total, url, loading, error, go,
    retryLoad: () => setRetry((n) => n + 1),
  };
}
