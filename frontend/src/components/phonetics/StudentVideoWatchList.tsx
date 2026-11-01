/**
 * 一个学生每节音标课的观看情况(2026-11-01)
 *
 * 用在两处: 音标「学情总览 → 按学生」点一个名字;学生详情页「音标视频」。
 * 按学生端的顺序列全部视频,没看的也列(老师要找的正是那几节)。
 * 「看完」用后端存的口径(看到过结尾附近且真看了六成时长),进度条只表示看到过多远。
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  phoneticsApi, CATEGORY_LABELS,
  type WatchRecords,
} from '../../api/phonetics';
import { getErrorMessage } from '../../utils/errorMessage';
import {
  humanDuration, indexRecords, shortDateTime, shortDay, watchStatus,
  type WatchKind,
} from '../../utils/phoneticWatch';

interface Props {
  studentId: number;
  /** 只看这位讲师的课(与总览当前的讲师筛选一致) */
  lecturer?: string;
  /** 拿到数据后回调(学生详情页据此决定整块显不显示) */
  onLoaded?: (data: WatchRecords) => void;
  /** 列表限高内部滚动(学生详情页用,不然 40 多节课把页面拉得很长) */
  scrollList?: boolean;
}

type Filter = 'all' | WatchKind;

const FILTERS: Array<[Filter, string]> = [
  ['all', '全部'], ['none', '没看'], ['partial', '没看完'], ['done', '看完'],
];

export default function StudentVideoWatchList({ studentId, lecturer, onLoaded, scrollList }: Props) {
  const [data, setData] = useState<WatchRecords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    phoneticsApi.watchRecords({ student_id: studentId, lecturer: lecturer || undefined })
      .then((r) => {
        if (!alive) return;
        setData(r);
        onLoaded?.(r);
      })
      .catch((e) => alive && setError(getErrorMessage(e, '观看记录加载失败')));
    return () => { alive = false; };
    // onLoaded 不进依赖: 父组件常传内联函数,放进来会每次渲染都重新请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, lecturer]);

  const rows = useMemo(() => {
    if (!data) return [];
    const idx = indexRecords(data.records);
    return data.videos.map((v) => {
      const rec = idx.get(`${studentId}:${v.id}`);
      return { v, rec, st: watchStatus(rec, v.duration_seconds) };
    });
  }, [data, studentId]);

  if (error) return <p className="py-3 text-sm text-red-600">{error}</p>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-ink-mute">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-ink-mute">
        {lecturer ? '这位讲师名下还没有视频' : '还没有音标视频'}
      </p>
    );
  }

  const count = (k: Filter) => (k === 'all' ? rows.length : rows.filter((r) => r.st.kind === k).length);
  const started = rows.filter((r) => r.rec);
  const totalSecs = started.reduce((a, r) => a + (r.rec?.watch_seconds || 0), 0);
  const last = started
    .map((r) => r.rec?.last_viewed_at || '')
    .sort()
    .pop();
  const shown = filter === 'all' ? rows : rows.filter((r) => r.st.kind === filter);

  let lastCategory = '';

  return (
    <div>
      <p className="text-sm text-ink-soft">
        {started.length === 0
          ? <>共 {rows.length} 节,<span className="font-semibold text-amber-700">一节都没看</span></>
          : <>
              看完 <b className="font-numeric text-ink">{count('done')}</b> 节 · 看过{' '}
              <b className="font-numeric text-ink">{started.length}</b> 节 · 共 {rows.length} 节 · 累计{' '}
              {humanDuration(totalSecs)}
              {last ? ` · 最后一次 ${shortDateTime(last)}` : ''}
            </>}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="按观看情况筛选">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
            className={`rounded-lg px-2.5 py-1 text-xs transition ${
              filter === k
                ? 'bg-[#2f8791] font-semibold text-white'
                : 'bg-gray-100 text-ink-soft hover:bg-gray-200'}`}
          >
            {label} <span className="font-numeric">{count(k)}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-ink-mute">这一类没有视频</p>
      ) : (
        <ul className={`mt-2 ${scrollList ? 'max-h-[30rem] overflow-y-auto pr-1' : ''}`}>
          {shown.map(({ v, rec, st }) => {
            const showCat = v.category !== lastCategory;
            lastCategory = v.category;
            return (
              <li key={v.id}>
                {showCat && (
                  <p className="mt-3 mb-1 text-[11px] font-semibold text-ink-mute">
                    {CATEGORY_LABELS[v.category] || v.category}
                  </p>
                )}
                <div className="border-b border-gray-100 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink" title={v.title}>
                      {v.title}
                    </span>
                    {!v.is_active && (
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-ink-mute">已下架</span>
                    )}
                    {st.kind === 'done' && (
                      <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">看完</span>
                    )}
                    {st.kind === 'partial' && (
                      <span className="shrink-0 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700">
                        {st.pct != null ? `看到 ${st.pct}%` : '看过'}
                      </span>
                    )}
                    {st.kind === 'none' && (
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">没看</span>
                    )}
                  </div>
                  {rec && (
                    <>
                      {st.pct != null && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                          <div
                            className={`h-full rounded-full ${st.kind === 'done' ? 'bg-emerald-400' : 'bg-sky-400'}`}
                            style={{ width: `${st.pct}%` }}
                          />
                        </div>
                      )}
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-numeric text-xs text-ink-mute">
                        <span>看了 {humanDuration(rec.watch_seconds)}</span>
                        {v.duration_seconds ? <span>视频 {humanDuration(v.duration_seconds)}</span> : null}
                        <span>打开 {rec.play_count} 次</span>
                        <span>最后 {shortDateTime(rec.last_viewed_at)}</span>
                        {rec.first_viewed_at && <span>第一次 {shortDay(rec.first_viewed_at)}</span>}
                      </p>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
