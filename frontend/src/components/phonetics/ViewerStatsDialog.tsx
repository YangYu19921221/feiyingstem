/**
 * 音标视频观看数据 — 教师端弹层
 *
 * 这个弹层存在的理由是**「谁还没看」**,不是那几个聚合数字。
 * 「8 个人看过」只让老师知道情况,而他接下来要做的动作是把没看的那几个点出来催 ——
 * 只给总数他还得自己拿花名册对一遍。所以未观看名单放在显眼位置、可一键复制。
 *
 * 三处「算不出 ≠ 是 0」必须分开说(界面上最容易骗人的正是这三个):
 * 1. `completion_rate === null` = 还没有人看 → 显示「—」而不是 0%
 *    (0% 会被读成"学生没看进去",而真相是这节还没推给学生)
 * 2. `not_watched === null` = 没有班级范围算不出(平台 admin)→ 不显示这块,
 *    而不是显示一个空名单(空名单看起来像"所有人都看了")
 * 3. `duration_seconds` 为空 = 没人看过所以还没回填 → 进度百分比整列不显示
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2, Radio, X } from 'lucide-react';
import { phoneticsApi, type VideoViewerReport } from '../../api/phonetics';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

interface Props {
  videoId: number;
  videoTitle: string;
  onClose: () => void;
}

/** 秒 → 「3 分 20 秒」。老师读的是"看了多久",不是时间码,所以不用 3:20 */
function humanDuration(sec: number): string {
  if (!sec || sec <= 0) return '0 秒';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m <= 0) return `${s} 秒`;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`;
}

export default function ViewerStatsDialog({ videoId, videoTitle, onClose }: Props) {
  const [data, setData] = useState<VideoViewerReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await phoneticsApi.viewers(videoId));
    } catch (e) {
      toast.error(getErrorMessage(e, '观看数据加载失败'));
      onClose();
    } finally {
      setLoading(false);
    }
  }, [videoId, onClose]);

  useEffect(() => { void load(); }, [load]);

  // Esc 关闭(与 MaterialManagerDialog 同口径:弹层里手在键盘上)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const st = data?.stats;
  const dur = data?.duration_seconds || 0;

  const copyNotWatched = async () => {
    const names = (data?.not_watched || []).map((s) => s.name).join('、');
    if (!names) return;
    try {
      await navigator.clipboard.writeText(names);
      toast.success('已复制未观看名单');
    } catch {
      // 剪贴板在非 HTTPS / 旧 webview 里不可用,别让老师以为复制成功了
      toast.error('复制失败,请手动选中名单');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog" aria-modal="true" aria-label="观看数据"
      onClick={onClose}
    >
      {/* 三段式:限高 + 内层滚动 + 头脚 shrink-0。名单可能几十人,
          整块自由长高会把关闭键顶出视口(同 MaterialManagerDialog 的教训) */}
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold text-ink">观看数据</h2>
            <p className="mt-0.5 truncate text-xs text-ink-mute" title={videoTitle}>{videoTitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-lg p-1.5 text-ink-mute transition hover:bg-gray-100 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </p>
          )}

          {!loading && st && (
            <>
              {/* 统计卡。「多少人看过」放第一位 —— 它是老师最先想知道的 */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-2xl bg-orange-50 p-3">
                  <p className="font-numeric text-2xl font-bold text-accent-warm">{st.viewers}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">人看过</p>
                </div>
                <div className="rounded-2xl bg-sky-50 p-3">
                  <p className="font-numeric text-2xl font-bold text-sky-600">{st.plays}</p>
                  {/* 明确写「次」: 与「人」并排放才看得出差别,
                      否则老师会把两个数当成同一件事的两种说法 */}
                  <p className="mt-0.5 text-xs text-ink-soft">播放次数</p>
                </div>
                <div className="rounded-2xl bg-green-50 p-3">
                  <p className="font-numeric text-2xl font-bold text-success">
                    {/* null = 还没人看 → 「—」。显示 0% 会让老师以为学生没看进去 */}
                    {st.completion_rate === null ? '—' : `${Math.round(st.completion_rate * 100)}%`}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">看完率 · {st.completed} 人</p>
                </div>
                <div className="rounded-2xl bg-purple-50 p-3">
                  <p className="font-numeric text-2xl font-bold text-purple-600">
                    {humanDuration(st.avg_watch_seconds)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">人均观看</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-mute">
                {st.watching_now > 0 && (
                  <span className="inline-flex items-center gap-1 font-semibold text-red-500">
                    <Radio className="h-3.5 w-3.5 animate-pulse" />
                    {st.watching_now} 人正在看
                  </span>
                )}
                <span>今天 {st.viewers_today} 人看过</span>
                {dur > 0 && <span>视频时长 {humanDuration(dur)}</span>}
                {data.scope === 'all'
                  ? <span className="text-ink-mute">统计范围:全平台</span>
                  : <span className="text-ink-mute">统计范围:我的班级{data.roster_size != null ? ` · ${data.roster_size} 人` : ''}</span>}
              </div>

              {/* ===== 还没看的 ===== 放在已看名单**之前**:
                  这是老师要采取行动的那一半,埋在下面就等于没做 */}
              {data.not_watched && (
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-ink">
                      还没看 · {data.not_watched.length} 人
                    </h3>
                    {data.not_watched.length > 0 && (
                      <button
                        onClick={copyNotWatched}
                        className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs text-ink-soft transition hover:bg-orange-100"
                      >
                        复制名单
                      </button>
                    )}
                  </div>
                  {data.not_watched.length === 0 ? (
                    <p className="mt-2 rounded-xl bg-green-50 px-3 py-2.5 text-sm text-success">
                      🎉 班上所有学生都看过了
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {data.not_watched.map((s) => (
                        <span
                          key={s.student_id}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
                        >
                          <Circle className="h-3 w-3" />{s.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ===== 看过的 ===== */}
              <div className="mt-5">
                <h3 className="text-sm font-bold text-ink">看过 · {data.watched.length} 人</h3>
                {data.watched.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-ink-mute">
                    还没有人看过这个视频
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-gray-100">
                    {data.watched.map((w) => (
                      <li key={w.student_id} className="flex items-center gap-2.5 py-2">
                        {w.completed
                          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                          : <Circle className="h-4 w-4 shrink-0 text-gray-300" />}
                        <span className="min-w-0 flex-1 truncate text-sm text-ink">{w.name}</span>
                        {w.watching_now && (
                          <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-500">
                            在看
                          </span>
                        )}
                        {/* 进度百分比只在有时长时给 —— 没有分母就别编一个数出来 */}
                        {dur > 0 && (
                          <span className="shrink-0 font-numeric text-xs text-ink-mute">
                            看到 {Math.min(100, Math.round((w.max_position_seconds / dur) * 100))}%
                          </span>
                        )}
                        <span className="shrink-0 font-numeric text-xs text-ink-soft">
                          {humanDuration(w.watch_seconds)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
