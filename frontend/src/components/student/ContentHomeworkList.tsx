/**
 * 「我的作业」页里的句子 / 音标视频作业(2026-10-21)
 *
 * 单独一块放在单词作业上面: 这类作业学完自动算完成,没有分数/尝试次数,和单词作业卡片的字段对不上。
 * 「去完成」直接跳到学习页: 句子进那个单元;视频进音标页并直接打开那一节(navigate state 的 openVideoId,
 * PhoneticsHub 兑换单节码跳回来用的也是这条路)。
 * 签到才能做作业(2026-10-31): 没签到时按钮写「签到并开始」,先签到再跳。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookText, Brain, CheckCircle2, Clapperboard, Lock, Mic } from 'lucide-react';
import { getMyContentHomework, type StudentContentHomework } from '../../api/contentHomework';

function dayText(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((that.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

interface Props {
  needCheckin?: boolean;
  onCheckin?: () => Promise<boolean>;
}

export default function ContentHomeworkList({ needCheckin = false, onCheckin }: Props) {
  const navigate = useNavigate();
  const [items, setItems] = useState<StudentContentHomework[] | null>(null);

  useEffect(() => {
    // 加载失败就不显示这一块: 单词作业照常能看,别因为这里挂了让整页报错
    getMyContentHomework().then(setItems).catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;
  // 没做完的排前面,做完的放后面
  const sorted = [...items].sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'));
  const todo = items.filter((x) => x.status === 'pending').length;

  const go = async (h: StudentContentHomework) => {
    if (needCheckin && onCheckin && !(await onCheckin())) return;
    if (h.kind === 'phonetic_video') {
      navigate(h.route, { state: { openVideoId: h.target_id } });
    } else {
      navigate(h.route, { state: { fromContentHomework: h.homework_id } });
    }
  };

  return (
    <section className="card-soft mb-6 rounded-2xl p-4 sm:p-5" aria-labelledby="content-hw-heading">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="content-hw-heading" className="font-display text-lg font-semibold text-ink">句子 / 音标 / 复习 / 跟读作业</h2>
        <span className="text-xs text-ink-mute">{todo > 0 ? `还有 ${todo} 项没做完` : '都做完啦'} · 学完自动算完成</span>
      </div>
      <ul className="space-y-2">
        {sorted.map((h) => {
          const Icon = h.kind === 'sentence' ? BookText : h.kind === 'daily_review' ? Brain : h.kind === 'read_aloud' ? Mic : Clapperboard;
          const done = h.status === 'completed';
          const locked = h.status === 'locked';
          const overdue = h.status === 'overdue';
          return (
            <li key={h.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-black/[0.05]">
              <Icon className={`h-5 w-5 shrink-0 ${done ? 'text-emerald-500' : 'text-accent-warm'}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{h.title}</p>
                <p className="truncate text-xs text-ink-mute">
                  {h.kind_label}
                  {h.teacher_name ? ` · ${h.teacher_name}布置` : ''}
                  {locked ? ` · ${dayText(h.available_from)}才开放` : ''}
                  {h.deadline && !done && !locked ? ` · ${dayText(h.available_from)}内完成` : ''}
                </p>
              </div>
              {done ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />已完成
                </span>
              ) : locked ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />未开放
                </span>
              ) : overdue ? (
                <span className="text-xs font-semibold text-rose-500">已过期</span>
              ) : (
                <button
                  type="button"
                  onClick={() => { void go(h); }}
                  className="min-h-9 shrink-0 rounded-lg bg-accent-warm px-3 text-xs font-semibold text-white hover:opacity-90"
                  aria-label={`去完成「${h.title}」`}
                >
                  {needCheckin ? '签到并开始' : '去完成'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
