/**
 * 学生首页「小鹰老师今天给你排的」: 签到后自动班就派好了,这里列今天每一份 + 过关线 + 做完后「再来一份」。
 * 规则真源 backend/app/services/autopilot.py。这几份同时也是普通作业行,首页「老师布置的任务」
 * 那块要把它们去掉(onTasks 把 assignment_id 报上去),否则同一份列两遍。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Plus, Sparkles } from 'lucide-react';
import { autopilotApi, itemLabel, type StudentToday } from '../../api/autopilot';
import { startHomework } from '../../api/homework';
import { getDailyReview } from '../../api/dailyReview';
import { startReviewSession } from '../../utils/startReview';
import { toast } from '../Toast';

type Item = NonNullable<StudentToday['items']>[number];

function detailOf(e: unknown): string | null {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : null;
}

interface Props {
  /** 签到后加 1: 自动班是签到那一刻派的,要重新取 */
  refreshKey: number;
  onTasks?: (assignmentIds: number[]) => void;
}

export default function AutopilotTodayCard({ refreshKey, onTasks }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<StudentToday | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const onTasksRef = useRef(onTasks);
  onTasksRef.current = onTasks;

  const load = useCallback(() => {
    autopilotApi.today()
      .then((d) => {
        setData(d);
        const ids = [...(d.items || []), ...(d.extra_items || [])]
          .filter((x) => !x.is_content && x.assignment_id)
          .map((x) => x.assignment_id as number);
        onTasksRef.current?.(ids);
      })
      // 取不到就不显示这块: 作业照常在「老师布置的任务」里
      .catch(() => { setData(null); onTasksRef.current?.([]); });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (!data?.active) return null;

  const items = data.items || [];
  const extras = data.extra_items || [];
  const done = items.filter((x) => x.done).length;

  const go = async (it: Item) => {
    if (busy) return;
    const key = `${it.batch}-${it.kind}-${it.unit_id}-${it.groups.join(',')}`;
    setBusy(key);
    try {
      if (it.kind === 'review') {
        const dr = await getDailyReview(true);
        startReviewSession(dr.words || [], navigate);
        return;
      }
      if (!it.assignment_id) return;
      const r = await startHomework(it.assignment_id);
      navigate(`/student/units/${r.unit_id}/${r.learning_mode}`, {
        state: { fromHomework: true, assignmentId: it.assignment_id, groupIndex: r.group_index ?? null },
      });
    } catch (e) {
      toast.error(detailOf(e) || '打不开这一份,稍后再试');
    } finally {
      setBusy(null);
    }
  };

  const more = async () => {
    if (busy) return;
    setBusy('extra');
    try {
      await autopilotApi.extra();
      toast.success('小鹰老师又给你排了一份,这份不算今天的任务');
      load();
    } catch (e) {
      toast.error(detailOf(e) || '现在排不出来,稍后再试');
    } finally {
      setBusy(null);
    }
  };

  const row = (it: Item, i: number) => {
    const key = `${it.batch}-${it.kind}-${it.unit_id}-${it.groups.join(',')}`;
    return (
      <li key={`${key}-${i}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            it.done ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-accent-warm'}`}
          aria-hidden="true"
        >
          {it.done ? <Check className="h-4 w-4" /> : i + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${it.done ? 'text-ink-mute line-through' : 'text-ink'}`}>{itemLabel(it)}</p>
          <p className="text-xs text-ink-mute">
            {it.kind === 'review' ? '今天到期的旧词,先复习不容易忘'
              : it.kind === 'new' ? '第一次学,过关检测达到过关线算第 1 轮'
                : `隔了几天再练一遍,走满 3 轮且过关才算学会`}
          </p>
        </div>
        {it.done ? (
          <span className="shrink-0 text-xs font-semibold text-green-700">做完了</span>
        ) : (
          <button
            type="button"
            onClick={() => go(it)}
            disabled={busy !== null}
            className="btn-glow shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-60"
          >
            {busy === key ? '打开中…' : '去做 →'}
          </button>
        )}
      </li>
    );
  };

  return (
    <section data-dashboard-reveal className="mb-5 sm:mb-8" aria-labelledby="autopilot-today-heading">
      <div className="overflow-hidden rounded-2xl border-2 border-orange-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-orange-100 bg-orange-50/60 px-4 py-3 sm:px-5">
          <img src="/tutor-avatar.jpg" alt="" className="h-8 w-8 rounded-full object-cover" />
          <h2 id="autopilot-today-heading" className="text-base font-bold text-ink">小鹰老师今天给你排的</h2>
          <span className="text-xs text-ink-soft">
            {done}/{items.length} 份 · {data.location === 'home' ? '在家做' : '在电教室做'}
          </span>
          <span className="ml-auto rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-accent-warm ring-1 ring-orange-200">
            过关要 {data.pass_line} 分
          </span>
        </div>
        <ul className="divide-y divide-orange-100">{items.map(row)}</ul>
        {data.pass_line_reason && (
          <p className="border-t border-orange-100 px-4 py-2 text-xs text-ink-mute sm:px-5">{data.pass_line_reason}</p>
        )}

        {data.all_done && (
          <div className="border-t border-orange-100 bg-green-50/60 px-4 py-3 sm:px-5">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-green-800">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              今天的任务做完了
              {data.repeats_today ? `,还自己多练了 ${data.repeats_today} 组` : ''}
            </p>
            {extras.length > 0 && (
              <>
                <p className="mt-2 text-xs font-semibold text-ink-soft">加练(不算今天的任务,也不发金币)</p>
                <ul className="mt-1 divide-y divide-green-100 rounded-xl bg-white">{extras.map(row)}</ul>
              </>
            )}
            {data.extra_open && (data.extra_left ?? 0) > 0 && (
              <button
                type="button"
                onClick={more}
                disabled={busy !== null}
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl border-2 border-accent-warm px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-50 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {busy === 'extra' ? '在排…' : '还想学,再来一份'}
                <span className="text-xs font-normal text-ink-mute">(今天还能加 {data.extra_left} 份)</span>
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
