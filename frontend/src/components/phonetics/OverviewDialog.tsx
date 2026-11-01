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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Download, Loader2, Radio, Search, TriangleAlert, X } from 'lucide-react';
import {
  phoneticsApi, CATEGORY_LABELS, NO_LECTURER,
  type PhoneticOverview, type LecturerStat, type OverviewStudentRow,
} from '../../api/phonetics';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';
import { exportWatchRecords, humanDuration, shortDay } from '../../utils/phoneticWatch';
import StudentVideoWatchList from './StudentVideoWatchList';

interface Props {
  lecturers: LecturerStat[];
  onClose: () => void;
  /** 从「查学生」按钮进来: 一打开就把光标放在搜索框里 */
  focusSearch?: boolean;
}

export default function OverviewDialog({ lecturers, onClose, focusSearch }: Props) {
  const [data, setData] = useState<PhoneticOverview | null>(null);
  const [loading, setLoading] = useState(true);
  /** '' = 全部讲师;NO_LECTURER = 只看未指定讲师的 */
  const [lecturer, setLecturer] = useState('');
  const [tab, setTab] = useState<'videos' | 'students'>('videos');
  /** 点了某个学生 → 看他每节课的情况 */
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  /** 搜学生名字。从学生详情返回时保留,方便接着看下一个 */
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

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
    // Esc 一层一层退: 学生详情 → 清掉搜索 → 关掉弹层
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else if (query) setQuery('');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, selected, query]);

  // 数据到了、且不在看某个学生时才聚焦(加载中搜索框还没渲染)
  useEffect(() => {
    if (focusSearch && data && !selected) searchRef.current?.focus();
  }, [focusSearch, data, selected]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? (data?.students || []).filter((st) => st.name.toLowerCase().includes(q)) : []),
    [data, q],
  );

  const openStudent = (st: OverviewStudentRow) => setSelected({ id: st.student_id, name: st.name });

  const lecturerLabel = lecturer === ''
    ? '全部讲师'
    : lecturer === NO_LECTURER ? '未指定讲师' : lecturer;

  const doExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const rec = await phoneticsApi.watchRecords({ lecturer: lecturer || undefined });
      if (rec.videos.length === 0) {
        toast.error('没有视频可以导出');
        return;
      }
      if (rec.students.length === 0) {
        toast.error(rec.scope === 'all' ? '还没有人看过音标视频' : '班上还没有学生');
        return;
      }
      await exportWatchRecords(rec, lecturerLabel);
      toast.success(`已导出 ${rec.students.length} 个学生 × ${rec.videos.length} 节课`);
    } catch (e) {
      toast.error(getErrorMessage(e, '导出失败'));
    } finally {
      setExporting(false);
    }
  };

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

  /** 学生一行: 搜索结果和「按学生」列表共用 */
  const studentRow = (st: OverviewStudentRow) => (
    <li key={st.student_id}>
      <button
        onClick={() => openStudent(st)}
        className="flex w-full items-center gap-2.5 rounded-lg py-2 text-left transition hover:bg-gray-50"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{st.name}</span>
        {st.videos_started === 0 ? (
          <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
            一节都没看
          </span>
        ) : (
          <>
            <span className="shrink-0 font-numeric text-xs text-ink-mute">
              看完 {st.videos_completed} / 看过 {st.videos_started}
            </span>
            <span className="shrink-0 font-numeric text-xs text-ink-soft">
              {humanDuration(st.total_watch_seconds)}
            </span>
            <span className="w-10 shrink-0 text-right font-numeric text-xs text-ink-mute">
              {shortDay(st.last_viewed_at)}
            </span>
          </>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-mute" aria-hidden="true" />
      </button>
    </li>
  );

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
          {selected ? (
            <div className="min-w-0">
              <button
                onClick={() => setSelected(null)}
                className="-ml-1 flex items-center gap-0.5 rounded-lg px-1 py-0.5 text-xs text-[#2f8791] transition hover:bg-[#e8f3f4]"
              >
                <ChevronLeft className="h-4 w-4" />返回学情总览
              </button>
              <h2 className="mt-0.5 truncate font-display text-lg font-bold text-ink">
                {selected.name} 的音标课
              </h2>
              <p className="mt-0.5 text-xs text-ink-mute">{lecturerLabel}</p>
            </div>
          ) : (
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
          )}
          <div className="flex shrink-0 items-center gap-1">
            {!selected && (
              <button
                onClick={doExport}
                disabled={exporting || loading}
                title="每个学生 × 每节课的观看明细,按当前讲师筛选"
                className="flex items-center gap-1 rounded-lg bg-[#e8f3f4] px-2.5 py-1.5 text-xs font-semibold
                           text-[#276f78] transition hover:bg-[#d7ebed] disabled:opacity-50"
              >
                {exporting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Download className="h-3.5 w-3.5" />}
                导出 Excel
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="关闭"
              className="rounded-lg p-1.5 text-ink-mute transition hover:bg-gray-100 hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!selected && loading && (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </p>
          )}

          {selected && (
            <StudentVideoWatchList studentId={selected.id} lecturer={lecturer || undefined} />
          )}

          {!selected && !loading && data && sum && (
            <>
              {/* 搜学生: 输名字 → 点他 → 看他每节课。放在最上面,这是老师最常用的一步 */}
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // 回车直接打开第一个(输入法组字时的回车不算)
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && matches.length > 0) {
                      openStudent(matches[0]);
                    }
                  }}
                  placeholder={isAdmin ? '搜学生名字,看他看了哪些视频' : '搜班上的学生,看他看了哪些视频'}
                  aria-label="搜学生名字"
                  className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-9 text-base text-ink
                             placeholder:text-ink-mute focus:border-[#2f8791] focus:outline-none sm:text-sm
                             [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                    aria-label="清掉搜索"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-mute hover:bg-gray-100 hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {q ? (
                matches.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 px-3 py-3 text-sm text-ink-mute">
                    没找到「{query.trim()}」。
                    {isAdmin
                      ? '这里只列看过音标视频的学生。'
                      : '只能搜你班上的学生;要是学生不在你的班上,先把他加进班级。'}
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-ink-mute">
                      找到 {matches.length} 个,点名字看他每节课{matches.length > 1 ? '(回车打开第一个)' : ''}
                    </p>
                    <ul className="mt-1 divide-y divide-gray-100">
                      {matches.map((st) => studentRow(st))}
                    </ul>
                  </>
                )
              ) : (
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
                          {/* null = 还没人看 → 「—」,显示 0% 会被读成"学生看不进去";
                              视频时长未知时后端判不了看完(恒为 0 人),同样写「—」 */}
                          <span>
                            看完率 {v.completion_rate === null || !v.duration_seconds
                              ? '—'
                              : `${Math.round(v.completion_rate * 100)}%`}
                            {v.duration_seconds ? ` · ${v.completed} 人` : ' · 不知道视频多长,判不了'}
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
                      看得最少的排在前面{isAdmin ? '' : ',一节没看的学生也在表里'}。点名字看他每节课的情况
                    </p>
                    <ul className="mt-1 divide-y divide-gray-100">
                      {data.students.map((st) => studentRow(st))}
                    </ul>
                  </>
                )
              )}
              </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
