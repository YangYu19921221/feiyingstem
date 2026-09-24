/**
 * 音标视频学情总览 — 教师端弹层(跨视频)
 *
 * 单个视频的 ViewerStatsDialog 回答「这节课谁没看」,这一页回答另外两个问题:
 * **哪几节课一个人都没看**(白讲了 / 没推给学生),以及**哪几个学生一节都没看**。
 * 所以两张表都是「少的排前面」:打开这页是为了找该补的课和该催的人,
 * 把看得最多的排在最上面等于把答案埋在滚动条下面。
 *
 * 三处「算不出 ≠ 是 0」(与 ViewerStatsDialog 同口径):
 * 1. `completion_rate === null` = 还没人看 → 「—」,不是 0%
 * 2. `roster_size === null` = 平台 admin 没有班级名册 → 文案换成「全平台」,
 *    并且学生表里只有有记录的人(名册补 0 行这件事 admin 做不到)
 * 3. 时长为空的视频不显示看完率相关的百分比
 */
import { useCallback, useEffect, useState } from 'react';
import { BarChart3, Loader2, Radio, TriangleAlert, X } from 'lucide-react';
import {
  phoneticsApi, CATEGORY_LABELS, NO_LECTURER,
  type PhoneticOverview, type LecturerStat,
} from '../../api/phonetics';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

interface Props {
  lecturers: LecturerStat[];
  onClose: () => void;
}

/** 秒 → 「3 分 20 秒」。老师读的是"看了多久"不是时间码 */
function humanDuration(sec: number): string {
  if (!sec || sec <= 0) return '0 秒';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  const s = Math.round(sec % 60);
  if (m <= 0) return `${s} 秒`;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`;
}

/** ISO → 「9-24」。最后观看日期只需要精确到天 */
function shortDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

export default function OverviewDialog({ lecturers, onClose }: Props) {
  const [data, setData] = useState<PhoneticOverview | null>(null);
  const [loading, setLoading] = useState(true);
  /** '' = 全部讲师;NO_LECTURER = 只看未指定讲师的 */
  const [lecturer, setLecturer] = useState('');
  const [tab, setTab] = useState<'videos' | 'students'>('videos');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await phoneticsApi.overview({ lecturer: lecturer || undefined }));
    } catch (e) {
      toast.error(getErrorMessage(e, '学情总览加载失败'));
    } finally {
      setLoading(false);
    }
  }, [lecturer]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isAdmin = data?.scope === 'all';
  const sum = data?.summary;
  // 一节都没看的学生 —— 这个数是「该催的人」,单独数出来放在提示条里
  const zeroStudents = (data?.students || []).filter((s) => s.videos_started === 0).length;

  const copyZeroStudents = async () => {
    const names = (data?.students || [])
      .filter((s) => s.videos_started === 0)
      .map((s) => s.name)
      .join('、');
    if (!names) return;
    try {
      await navigator.clipboard.writeText(names);
      toast.success('已复制名单');
    } catch {
      // 非 HTTPS / 旧 webview 里剪贴板不可用,别让老师以为复制成功了
      toast.error('复制失败,请手动选中名单');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog" aria-modal="true" aria-label="音标学情总览"
      onClick={onClose}
    >
      {/* 三段式:限高 + 内层滚动 + 头脚 shrink-0。表可能几十行,
          整块自由长高会把关闭键顶出视口 */}
      <div
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
              <BarChart3 className="h-5 w-5 text-[#2f8791]" />音标学情总览
            </h2>
            <p className="mt-0.5 text-xs text-ink-mute">
              {isAdmin
                ? '统计范围:全平台'
                : `统计范围:我的班级${data?.roster_size != null ? ` · ${data.roster_size} 人` : ''}`}
            </p>
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

          {!loading && data && sum && (
            <>
              {/* 讲师筛选:一个机构几位老师各讲一套,看自己那套才有意义 */}
              {lecturers.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setLecturer('')}
                    className={`rounded-lg px-2.5 py-1 text-xs transition ${
                      lecturer === ''
                        ? 'bg-[#2f8791] font-semibold text-white'
                        : 'bg-gray-100 text-ink-soft hover:bg-gray-200'}`}
                  >
                    全部讲师
                  </button>
                  {lecturers.map((l) => (
                    <button
                      key={l.name}
                      onClick={() => setLecturer(l.name)}
                      className={`rounded-lg px-2.5 py-1 text-xs transition ${
                        lecturer === l.name
                          ? 'bg-[#2f8791] font-semibold text-white'
                          : 'bg-gray-100 text-ink-soft hover:bg-gray-200'}`}
                    >
                      {l.name}
                    </button>
                  ))}
                  <button
                    onClick={() => setLecturer(NO_LECTURER)}
                    className={`rounded-lg px-2.5 py-1 text-xs transition ${
                      lecturer === NO_LECTURER
                        ? 'bg-amber-500 font-semibold text-white'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                  >
                    未指定讲师
                  </button>
                </div>
              )}

              {/* 统计卡。「没人看的课」放第一位 —— 它是这一页存在的理由 */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-2xl bg-amber-50 p-3">
                  <p className="font-numeric text-2xl font-bold text-amber-600">
                    {sum.zero_watch_videos}
                    <span className="text-sm font-normal text-ink-mute"> / {sum.videos}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">没人看的课</p>
                </div>
                <div className="rounded-2xl bg-orange-50 p-3">
                  <p className="font-numeric text-2xl font-bold text-accent-warm">{sum.active_students}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">看过的学生</p>
                </div>
                <div className="rounded-2xl bg-purple-50 p-3">
                  <p className="font-numeric text-2xl font-bold text-purple-600">
                    {humanDuration(sum.total_watch_seconds)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">累计观看</p>
                </div>
                <div className="rounded-2xl bg-sky-50 p-3">
                  <p className="font-numeric text-2xl font-bold text-sky-600">{sum.watching_now}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">正在看</p>
                </div>
              </div>

              {sum.watching_now > 0 && (
                <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-red-500">
                  <Radio className="h-3.5 w-3.5 animate-pulse" />
                  现在有 {sum.watching_now} 人在看音标视频
                </p>
              )}

              {/* 一节都没看的学生:提示条 + 可复制名单。admin 没有名册,补不出这些人,
                  所以那种情况下这条不出现(而不是显示 0 —— 那会被读成"人人都学了") */}
              {!isAdmin && zeroStudents > 0 && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-sm text-amber-800">
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    有 {zeroStudents} 个学生一节音标课都没看
                  </p>
                  <button
                    onClick={copyZeroStudents}
                    className="rounded-lg bg-white/70 px-2.5 py-1 text-xs text-amber-800 transition hover:bg-white"
                  >
                    复制名单
                  </button>
                </div>
              )}

              {/* 两张表切换。默认按课看 —— 老师先关心内容有没有被消费 */}
              <div className="mt-4 flex gap-1.5 border-b border-gray-100">
                {([['videos', '按课'], ['students', '按学生']] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k)}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                      tab === k
                        ? 'border-[#2f8791] font-semibold text-[#173047]'
                        : 'border-transparent text-ink-mute hover:text-ink'}`}
                  >
                    {label}
                    <span className="ml-1 text-xs text-ink-mute">
                      {k === 'videos' ? data.videos.length : data.students.length}
                    </span>
                  </button>
                ))}
              </div>

              {tab === 'videos' && (
                data.videos.length === 0 ? (
                  <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-ink-mute">
                    {lecturer ? '这位讲师名下还没有视频' : '还没有音标视频'}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-gray-100">
                    {data.videos.map((v) => (
                      <li key={v.id} className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={v.title}>
                            {v.title}
                          </span>
                          {/* 没人看的课标出来:这是要采取行动的那些行 */}
                          {v.viewers === 0 && (
                            <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                              没人看
                            </span>
                          )}
                          {!v.is_active && (
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-ink-mute">
                              已下架
                            </span>
                          )}
                          {v.watching_now > 0 && (
                            <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-500">
                              {v.watching_now} 人在看
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-numeric text-xs text-ink-mute">
                          <span>{CATEGORY_LABELS[v.category] || v.category}</span>
                          {v.lecturer && <span>{v.lecturer}</span>}
                          <span>{v.viewers} 人看过</span>
                          <span>{v.plays} 次播放</span>
                          {/* null = 还没人看 → 「—」,显示 0% 会被读成"学生看不进去" */}
                          <span>
                            看完率 {v.completion_rate === null
                              ? '—'
                              : `${Math.round(v.completion_rate * 100)}%`}
                            {` · ${v.completed} 人`}
                          </span>
                          <span>人均 {humanDuration(v.avg_watch_seconds)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}

              {tab === 'students' && (
                data.students.length === 0 ? (
                  <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-ink-mute">
                    {isAdmin ? '还没有人看过音标视频' : '班上还没有学生'}
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-[11px] text-ink-mute">
                      看得最少的排在前面{isAdmin ? '' : ',一节没看的学生也在表里'}
                    </p>
                    <ul className="mt-1 divide-y divide-gray-100">
                      {data.students.map((s) => (
                        <li key={s.student_id} className="flex items-center gap-2.5 py-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.name}</span>
                          {s.videos_started === 0 ? (
                            <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                              一节都没看
                            </span>
                          ) : (
                            <>
                              <span className="shrink-0 font-numeric text-xs text-ink-mute">
                                看完 {s.videos_completed} / 看过 {s.videos_started}
                              </span>
                              <span className="shrink-0 font-numeric text-xs text-ink-soft">
                                {humanDuration(s.total_watch_seconds)}
                              </span>
                              <span className="w-8 shrink-0 text-right font-numeric text-xs text-ink-mute">
                                {shortDate(s.last_viewed_at)}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
