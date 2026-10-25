/**
 * 作业管理页里的「句子 / 音标视频作业」一栏(2026-10-21)
 *
 * 为什么单独一栏、不塞进「创建新作业」弹窗: 单词作业的弹窗已经有单元/分组/模式/目标分数/尝试次数/
 * 在哪做/进入方式/比赛模式一整套,句子和视频一个都用不上。塞进去要么一堆选项对它们无效还显示着,
 * 要么到处 if —— 老师更容易布置错。这里只问四件事: 布置什么、给谁、哪天开放、是不是只能当天做。
 *
 * 完成不用学生交卷: 后端按真实学习数据判(句子: 开放后全部组过关;视频: 看完),这里只展示。
 */
import { useEffect, useMemo, useState } from 'react';
import { BookText, Brain, Clapperboard, Mic, Plus, X } from 'lucide-react';
import {
  createContentHomework, deleteContentHomework, getContentHomeworkStudents, getContentTargets,
  listTeacherContentHomework, toggleContentHomework,
  type ContentHomeworkStudentStatus, type ContentKind, type ContentTargetGroup, type TeacherContentHomework,
} from '../../api/contentHomework';
import type { StudentInfo } from '../../api/teacher';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

const KIND_META: Record<ContentKind, { label: string; icon: typeof BookText; hint: string }> = {
  sentence: { label: '句子背诵', icon: BookText, hint: '学生把这个单元的每一组都过关就算完成' },
  phonetic_video: { label: '音标视频', icon: Clapperboard, hint: '学生把这节视频看完就算完成' },
  daily_review: { label: '每日复习', icon: Brain, hint: '每天 20 个该复习的词，做完当天那份就算完成' },
  read_aloud: { label: '例句跟读', icon: Mic, hint: '学生把这个单词单元的例句读满一轮（8 句）就算完成' },
};

const STATUS_LABEL: Record<ContentHomeworkStudentStatus['status'], string> = {
  completed: '已完成', pending: '未完成', locked: '未开放', overdue: '已过期',
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ContentHomeworkPanel({ students }: { students: StudentInfo[] }) {
  const [list, setList] = useState<TeacherContentHomework[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<{ hw: TeacherContentHomework; rows: ContentHomeworkStudentStatus[] } | null>(null);

  const reload = async () => {
    try {
      setList(await listTeacherContentHomework());
    } catch (e) {
      toast.error(getErrorMessage(e, '句子/音标作业没加载出来'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void reload(); }, []);

  const showDetail = async (hw: TeacherContentHomework) => {
    try {
      setDetail({ hw, rows: await getContentHomeworkStudents(hw.id) });
    } catch (e) {
      toast.error(getErrorMessage(e, '完成情况没加载出来'));
    }
  };

  const toggle = async (hw: TeacherContentHomework) => {
    try {
      await toggleContentHomework(hw.id);
      await reload();
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    }
  };

  const remove = async (hw: TeacherContentHomework) => {
    if (!window.confirm(`删除「${hw.title}」?学生端会立刻看不到这份作业。学生的学习记录不会删。`)) return;
    try {
      await deleteContentHomework(hw.id);
      toast.success('已删除');
      await reload();
    } catch (e) {
      toast.error(getErrorMessage(e, '删除失败'));
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="content-hw-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="content-hw-title" className="text-base font-semibold text-slate-800">句子 / 音标视频 / 每日复习作业</h2>
          <p className="mt-0.5 text-xs text-slate-500">学生学完自动算完成，不用交作业；不发金币，不计入单词数</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="teacher-primary teacher-focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />布置句子 / 音标 / 复习 / 跟读作业
        </button>
      </div>

      {loading ? (
        <p className="py-4 text-center text-sm text-slate-400">加载中…</p>
      ) : list.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">还没有布置过。句子背诵和音标视频适合布置成在家做的作业。</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {list.map((hw) => {
            const Icon = KIND_META[hw.kind]?.icon ?? BookText;
            const pct = hw.total ? Math.round((hw.completed / hw.total) * 100) : 0;
            return (
              <li key={hw.id} className={`flex flex-wrap items-center gap-3 py-2.5 ${hw.is_closed ? 'opacity-50' : ''}`}>
                <Icon className="h-4 w-4 shrink-0 text-orange-500" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{hw.title}</p>
                  <p className="truncate text-xs text-slate-500">
                    {hw.kind_label} · {hw.available_date} 开放{hw.same_day_only ? ' · 只能当天做' : ''}
                    {hw.is_closed ? ' · 已关闭' : ''}
                    {hw.assigned_by_name ? ` · ${hw.assigned_by_name}布置` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void showDetail(hw)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  aria-label={`查看「${hw.title}」完成情况`}
                >
                  <span className="font-numeric">{hw.completed}/{hw.total}</span> 完成 · {pct}%
                </button>
                {hw.can_manage && (
                  <span className="flex gap-1">
                    <button type="button" onClick={() => void toggle(hw)}
                            className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
                      {hw.is_closed ? '重新开放' : '关闭'}
                    </button>
                    <button type="button" onClick={() => void remove(hw)}
                            className="rounded-lg px-2 py-1 text-xs text-rose-500 hover:bg-rose-50">
                      删除
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <CreateDialog
          students={students}
          onClose={() => setOpen(false)}
          onCreated={() => { setOpen(false); void reload(); }}
        />
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div role="dialog" aria-modal="true" aria-label="完成情况"
               className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl"
               onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="truncate text-sm font-semibold text-slate-800">{detail.hw.title}</p>
              <button type="button" onClick={() => setDetail(null)} aria-label="关闭"
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <ul className="max-h-[60vh] divide-y divide-slate-50 overflow-y-auto px-4 py-2">
              {detail.rows.map((r) => (
                <li key={r.student_id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">{r.name}</span>
                  <span className={r.status === 'completed' ? 'text-emerald-600' : r.status === 'overdue' ? 'text-rose-500' : 'text-slate-400'}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function CreateDialog({ students, onClose, onCreated }: {
  students: StudentInfo[]; onClose: () => void; onCreated: () => void;
}) {
  const [kind, setKind] = useState<ContentKind>('sentence');
  const [groups, setGroups] = useState<ContentTargetGroup[]>([]);
  const [groupId, setGroupId] = useState<string>('');
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [studentIds, setStudentIds] = useState<number[]>([]);
  const [studentQuery, setStudentQuery] = useState('');
  const [date, setDate] = useState(todayStr());
  const [dailySequence, setDailySequence] = useState(false);
  const [sameDayOnly, setSameDayOnly] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState(7);
  const isReview = kind === 'daily_review';

  useEffect(() => {
    setGroups([]); setGroupId(''); setTargetIds([]);
    if (kind === 'daily_review') return;  // 每日复习不用选内容
    getContentTargets(kind)
      .then((g) => { setGroups(g); if (g[0]) setGroupId(String(g[0].id)); })
      .catch((e) => toast.error(getErrorMessage(e, '可布置的内容没加载出来')));
  }, [kind]);

  const group = groups.find((g) => String(g.id) === groupId);
  const filteredStudents = useMemo(() => {
    const kw = studentQuery.trim().toLowerCase();
    return kw ? students.filter((s) => (s.full_name || '').toLowerCase().includes(kw)
      || (s.username || '').toLowerCase().includes(kw)) : students;
  }, [students, studentQuery]);
  const allShownSelected = filteredStudents.length > 0 && filteredStudents.every((s) => studentIds.includes(s.id));

  const toggleTarget = (id: number) =>
    setTargetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleStudent = (id: number) =>
    setStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    if (!isReview && targetIds.length === 0) { toast.info(`先选要布置的${KIND_META[kind].label}`); return; }
    if (studentIds.length === 0) { toast.info('先选学生'); return; }
    setSaving(true);
    try {
      const r = await createContentHomework({
        kind, target_ids: targetIds, student_ids: studentIds, available_date: date,
        daily_sequence: dailySequence && targetIds.length > 1, same_day_only: sameDayOnly,
        title: title.trim() || undefined,
        ...(isReview ? { days } : {}),
      });
      toast.success(`已布置 ${r.homework_ids.length} 份，共 ${r.assigned} 人次`);
      onCreated();
    } catch (e) {
      toast.error(getErrorMessage(e, '布置失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="content-hw-create"
           className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 id="content-hw-create" className="text-base font-semibold text-slate-800">布置句子 / 音标 / 复习 / 跟读作业</h3>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-slate-700">布置什么</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(Object.keys(KIND_META) as ContentKind[]).map((k) => {
                const M = KIND_META[k];
                return (
                  <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                          className={`flex items-center gap-2 rounded-xl border-2 p-3 text-left text-sm ${
                            kind === k ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <M.icon className="h-4 w-4 text-orange-500" aria-hidden="true" />
                    <span>
                      <span className="block font-semibold text-slate-800">{M.label}</span>
                      <span className="block text-xs text-slate-500">{M.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {isReview ? (
            <div className="rounded-xl bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-900">
              <p>每个孩子每天一份 20 个词：先挑最近学过、快要忘的，再捡回几个以前错过的。孩子在「今日复习」做完这 20 个，当天的作业就自动完成。</p>
              <p className="mt-1 text-orange-700">当天的 20 个第二天就换一批，所以每份作业只能当天做。</p>
              <label className="mt-2 flex items-center gap-2 font-semibold">
                连续
                <input type="number" min={1} max={31} value={days}
                       onChange={(e) => setDays(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                       className="w-16 rounded-lg border border-orange-300 bg-white px-2 py-1 text-center" aria-label="连续几天" />
                天，每天一份
              </label>
            </div>
          ) : (
          <div>
            <label htmlFor="content-hw-group" className="mb-2 block text-sm font-semibold text-slate-700">
              {kind === 'sentence' ? '句子集' : kind === 'read_aloud' ? '单词书' : '讲师'}
              <span className="ml-1 text-xs font-normal text-slate-500">(可多选，每个单元/每节各一份作业)</span>
            </label>
            <select id="content-hw-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}
                    className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm">
              {groups.map((g) => <option key={g.id} value={String(g.id)}>{g.name}（{g.units.length}）</option>)}
            </select>
            <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {!group ? <p className="py-3 text-center text-xs text-slate-400">加载中…</p> : group.units.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={targetIds.includes(u.id)} onChange={() => toggleTarget(u.id)} />
                  <span className="truncate">{u.name}</span>
                </label>
              ))}
            </div>
            {targetIds.length > 0 && <p className="mt-1 text-xs text-slate-500">已选 {targetIds.length} 个</p>}
          </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="content-hw-date" className="mb-2 block text-sm font-semibold text-slate-700">{isReview ? '从哪天开始' : '哪天开放'}</label>
              <input id="content-hw-date" type="date" value={date} min={todayStr()} onChange={(e) => setDate(e.target.value)}
                     className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="content-hw-title-input" className="mb-2 block text-sm font-semibold text-slate-700">
                标题 <span className="text-xs font-normal text-slate-500">(可不填)</span>
              </label>
              <input id="content-hw-title-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100}
                     placeholder="不填就用内容名" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            </div>
          </div>
          {!isReview && <div className="space-y-2 text-sm text-slate-700">
            {targetIds.length > 1 && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={dailySequence} onChange={(e) => setDailySequence(e.target.checked)} />
                每份往后顺延一天（一次布置未来几天的）
              </label>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sameDayOnly} onChange={(e) => setSameDayOnly(e.target.checked)} />
              只能开放当天做（不勾 = 开放后一直能做）
            </label>
          </div>}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">给谁（已选 {studentIds.length} / {students.length}）</span>
              <button type="button" className="text-xs font-medium text-orange-600"
                      onClick={() => {
                        const ids = filteredStudents.map((s) => s.id);
                        setStudentIds((prev) => (allShownSelected
                          ? prev.filter((id) => !ids.includes(id))
                          : Array.from(new Set([...prev, ...ids]))));
                      }}>
                {allShownSelected ? '取消全选' : studentQuery.trim() ? '全选搜索结果' : '全选'}
              </button>
            </div>
            <input value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} placeholder="搜索学生姓名 / 用户名"
                   aria-label="搜索学生" className="mb-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-2 sm:grid-cols-3">
              {filteredStudents.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={studentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} />
                  <span className="truncate">{s.full_name || s.username}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
          <button type="button" onClick={() => void submit()} disabled={saving}
                  className="teacher-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {saving ? '布置中…' : '布置'}
          </button>
        </div>
      </div>
    </div>
  );
}
