/**
 * 学生首页「小鹰老师今天给你排的」: 签到后自动班就派好了,这里列今天每一份 + 过关线 + 做完后「再来一份」。
 * 规则真源 backend/app/services/autopilot.py。这几份同时也是普通作业行,首页「老师布置的任务」
 * 那块要把它们去掉(onTasks 把 assignment_id 报上去),否则同一份列两遍。
 * 签到才能做(2026-10-31): 自动班没签到时这里写「签到后小鹰老师就给你排」;老师先派了、孩子还没签到时,
 * 每一份的按钮是「签到并开始」,再来一份也一样(后端 require_checkin 兜底)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, MapPin, Plus, Sparkles } from 'lucide-react';
import { autopilotApi, itemLabel, type StudentToday } from '../../api/autopilot';
import { startHomework } from '../../api/homework';
import { getDailyReview } from '../../api/dailyReview';
import { startReviewSession } from '../../utils/startReview';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';
import { checkInToday, isNeedCheckin, NEED_CHECKIN_TIP } from '../../utils/checkin';

type Item = NonNullable<StudentToday['items']>[number];

interface Props {
  /** 签到后加 1: 自动班是签到那一刻派的,要重新取 */
  refreshKey: number;
  onTasks?: (assignmentIds: number[]) => void;
  /** 首页的签到(签完它会把 refreshKey 加 1);不传就自己签 */
  onCheckin?: () => Promise<boolean>;
}

export default function AutopilotTodayCard({ refreshKey, onTasks, onCheckin }: Props) {
  const navigate = useNavigate();
  const [data, setData] = useState<StudentToday | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
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

  const doCheckin = async (): Promise<boolean> => {
    if (checkinBusy) return false;
    setCheckinBusy(true);
    try {
      if (onCheckin) {
        return await onCheckin();   // 首页签完会把 refreshKey 加 1,这张卡跟着重取
      }
      await checkInToday();
      load();
      return true;
    } catch {
      toast.error('签到没成功,稍后再试');
      return false;
    } finally {
      setCheckinBusy(false);
    }
  };

  if (!data) return null;
  // 旧后端没有这个字段: 当成签过了(不挡孩子)
  const checkedIn = data.checked_in !== false;

  if (!data.active) {
    // 自动班、没暂停、还没签到: 签到那一刻才派,先告诉孩子
    if (!data.waiting_checkin || checkedIn) return null;
    return (
      <section data-dashboard-reveal className="mb-5 sm:mb-8" aria-labelledby="autopilot-today-heading">
        <div className="flex flex-col gap-3 rounded-2xl border-2 border-orange-200 bg-white p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <img src="/tutor-avatar.jpg" alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            <div className="min-w-0">
              <h2 id="autopilot-today-heading" className="text-base font-bold text-ink">小鹰老师今天给你排的</h2>
              <p className="mt-0.5 text-sm text-ink-soft">先签到,签到后小鹰老师马上给你排好今天要学的</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void doCheckin(); }}
            disabled={checkinBusy}
            className="btn-glow inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-60"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {checkinBusy ? '签到中…' : '签到,看今天的任务'}
          </button>
        </div>
      </section>
    );
  }

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
      if (isNeedCheckin(e)) {
        toast.info(NEED_CHECKIN_TIP);
        load();   // 多半是过了半夜,重取一下签到状态
      } else {
        toast.error(getErrorMessage(e, '打不开这一份,稍后再试'));
      }
    } finally {
      setBusy(null);
    }
  };

  // 小鹰老师排的每一步都要先签到: 没签就先签,签上了接着做
  const afterCheckin = async (then: () => Promise<void>) => {
    if (busy || checkinBusy) return;
    if (!checkedIn && !(await doCheckin())) return;
    await then();
  };

  const more = async () => {
    if (busy) return;
    setBusy('extra');
    try {
      await autopilotApi.extra();
      toast.success('小鹰老师又给你排了一份,这份不算今天的任务');
      load();
    } catch (e) {
      if (isNeedCheckin(e)) {
        toast.info(NEED_CHECKIN_TIP);
        load();
      } else {
        toast.error(getErrorMessage(e, '现在排不出来,稍后再试'));
      }
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
            onClick={() => { void afterCheckin(() => go(it)); }}
            disabled={busy !== null || checkinBusy}
            className="btn-glow shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-60"
          >
            {busy === key ? '打开中…' : checkedIn ? '去做 →' : '签到并开始 →'}
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
        {!checkedIn && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-orange-100 bg-amber-50 px-4 py-2.5 sm:px-5">
            <p className="min-w-0 flex-1 text-sm font-medium text-amber-900">今天还没签到,签到后才能开始做</p>
            <button
              type="button"
              onClick={() => { void doCheckin(); }}
              disabled={checkinBusy}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold text-accent-warm ring-1 ring-orange-200 transition hover:bg-orange-50 disabled:opacity-60"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {checkinBusy ? '签到中…' : '立即签到'}
            </button>
          </div>
        )}
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
                onClick={() => { void afterCheckin(more); }}
                disabled={busy !== null || checkinBusy}
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
