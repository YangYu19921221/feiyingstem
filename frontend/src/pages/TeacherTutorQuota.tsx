/**
 * 教师端「学习助手次数」(2026-10-26,用户「每个学生总共 20,需要多的需要教师给增加额度」)
 *
 * 每个学生一共送 free_total 次(管理端设),不按天清零;用完了孩子点「请老师加次数」,在这里排最前。
 * 老师可以单个加、勾选几个一起加。只列本班在读学生,后端也只放行本班(有一个不是本班整批 403)。
 * 加次数进操作记录(tutor.grant)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, LoaderCircle, MessageCircle, Plus, Search } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { getTutorStudents, grantTutor, TUTOR_GRANT_MAX, type TutorQuotaStudent } from '../api/tutor';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

type Filter = 'requested' | 'low' | 'all';
const PRESETS = [5, 10, 20];
const displayName = (s: TutorQuotaStudent) => s.full_name || s.username;

export default function TeacherTutorQuota() {
  const navigate = useNavigate();
  const [items, setItems] = useState<TutorQuotaStudent[]>([]);
  const [meta, setMeta] = useState({ free_total: 20, deep_cost: 2, enabled: true, requested: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [add, setAdd] = useState(10);
  const [busy, setBusy] = useState<number | 'batch' | null>(null);

  const load = useCallback(async (): Promise<number | null> => {
    try {
      const r = await getTutorStudents();
      setItems(r.items);
      setMeta({ free_total: r.free_total, deep_cost: r.deep_cost, enabled: r.enabled, requested: r.requested });
      // 有孩子在请求就先停在「请求加的」那一栏
      setFilter((f) => (f === 'all' && r.requested > 0 ? 'requested' : f));
      return r.requested;
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return items.filter((s) => {
      if (filter === 'requested' && !s.requested_at) return false;
      if (filter === 'low' && s.left > 3) return false;
      if (!kw) return true;
      return displayName(s).toLowerCase().includes(kw) || s.username.toLowerCase().includes(kw)
        || s.class_name.toLowerCase().includes(kw);
    });
  }, [items, filter, q]);
  const lowCount = items.filter((s) => s.left <= 3).length;
  const allShownPicked = shown.length > 0 && shown.every((s) => picked.has(s.id));

  const doGrant = async (ids: number[], who: number | 'batch') => {
    if (!ids.length || busy !== null) return;
    setBusy(who);
    try {
      await grantTutor(ids, add);
      toast.success(ids.length === 1 ? `已加 ${add} 次` : `已给 ${ids.length} 个学生各加 ${add} 次`);
      setPicked(new Set());
      // 请求加的都处理完了: 回到「全部」,让老师看到刚加完的结果,别停在一个空列表上
      if ((await load()) === 0) setFilter((f) => (f === 'requested' ? 'all' : f));
    } catch (e) {
      toast.error(getErrorMessage(e, '没加上'));
    } finally {
      setBusy(null);
    }
  };

  const togglePick = (id: number) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="学习助手次数" subtitle="学生问「小鹰老师」的次数用完了,在这里给他加" icon={MessageCircle} backTo="/teacher/dashboard" />

      <main className="teacher-workspace-main mx-auto max-w-5xl space-y-5">
        <section className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm leading-6 text-orange-900">
          <p>每个学生一共送 <b>{meta.free_total} 次</b>,不按天清零;「深度思考」一次算 {meta.deep_cost} 次。</p>
          <p>次数用完的孩子点了「请老师加次数」会排在最前面。加多少你来定,一次最多 {TUTOR_GRANT_MAX} 次;孩子问了什么在学生详情页「问小鹰老师」里看得到。</p>
          {!meta.enabled && <p className="mt-1 text-orange-700">你们学校的学习助手现在还没开放,加了次数孩子暂时也用不了。</p>}
        </section>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          {([
            ['requested', `请求加次数 ${meta.requested}`],
            ['low', `快用完的 ${lowCount}`],
            ['all', `全部 ${items.length}`],
          ] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={`min-h-9 rounded-lg px-3 text-sm ${filter === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜姓名 / 班级" aria-label="搜索学生"
              className="w-44 rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-orange-400" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">每次加</span>
          {PRESETS.map((n) => (
            <button key={n} type="button" onClick={() => setAdd(n)} aria-pressed={add === n}
              className={`min-h-9 rounded-lg px-3 text-sm ${add === n ? 'bg-[#FF6B35] font-semibold text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
              {n} 次
            </button>
          ))}
          <label className="inline-flex items-center gap-1 text-sm text-slate-600">
            或
            <input type="number" min={1} max={TUTOR_GRANT_MAX} value={add}
              onChange={(e) => setAdd(Math.max(1, Math.min(TUTOR_GRANT_MAX, Number(e.target.value) || 1)))}
              aria-label="加几次" className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-orange-400" />
            次
          </label>
          {picked.size > 0 && (
            <button type="button" onClick={() => { void doGrant([...picked], 'batch'); }} disabled={busy !== null}
              className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF6B35] px-4 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
              {busy === 'batch' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              给勾选的 {picked.size} 人各加 {add} 次
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" /></div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl bg-white py-14 text-center text-sm text-slate-500 shadow-sm">
            {items.length === 0 ? '你的班里还没有学生' : q ? '没找到这个学生' : filter === 'requested' ? '现在没有孩子在请求加次数' : '没有快用完的'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={allShownPicked}
                  onChange={() => setPicked((p) => {
                    const n = new Set(p);
                    shown.forEach((s) => (allShownPicked ? n.delete(s.id) : n.add(s.id)));
                    return n;
                  })}
                  className="h-4 w-4 accent-[#FF6B35]" aria-label="全选这一页" />
                全选
              </label>
              <span className="ml-auto">已用 / 一共 · 还剩</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {shown.map((s) => {
                const pct = s.total > 0 ? Math.min(100, Math.round((s.used / s.total) * 100)) : 100;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => togglePick(s.id)}
                      className="h-4 w-4 accent-[#FF6B35]" aria-label={`勾选 ${displayName(s)}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">
                        <button type="button" onClick={() => navigate(`/teacher/students/${s.id}`)} className="hover:underline">{displayName(s)}</button>
                        {s.class_name && <span className="ml-2 text-xs font-normal text-slate-400">{s.class_name}</span>}
                        {s.requested_at && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                            <BellRing className="h-3 w-3" aria-hidden /> 请求加次数
                          </span>
                        )}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${s.left <= 0 ? 'bg-rose-400' : s.left <= 3 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">
                          {s.used} / {s.total}{s.extra > 0 ? `(含老师加的 ${s.extra})` : ''} · 还剩
                          <b className={s.left <= 0 ? ' text-rose-600' : s.left <= 3 ? ' text-amber-600' : ' text-slate-700'}> {s.left}</b>
                          {s.questions > 0 && <span className="text-slate-400"> · 问过 {s.questions} 次</span>}
                        </span>
                      </div>
                    </div>
                    <button type="button" onClick={() => { void doGrant([s.id], s.id); }} disabled={busy !== null}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-white px-3 text-sm font-semibold text-[#c2410c] ring-1 ring-orange-200 hover:bg-orange-50 disabled:opacity-50">
                      {busy === s.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                      加 {add} 次
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
