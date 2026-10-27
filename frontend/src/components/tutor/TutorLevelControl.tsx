/**
 * 「小鹰老师怎么给你讲」: 年级 + 讲简单一点 / 正常 / 讲深一点(2026-10-27,用户「小学是不是要讲的更简单举例…
 * 孩子理解能力也不一样」)。规则真源是后端 services/tutor_level.py。
 *
 * - 不给孩子贴「聪明 / 笨」的标签,只说「讲法」;默认「自动」= 小鹰老师看他最近的反应自己调
 * - 年级没设时显示按哪本书推断的,推不出就写「没设」,孩子点一下就能选
 * - 学生页抽屉底部(compact)和老师学生详情页(teacher)共用这一个组件;老师改的是这个学生的
 */
import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import {
  getMyLevel, PACE_OPTIONS, setMyLevel, setStudentLevel,
  type TutorLevel, type TutorLevelPatch, type TutorPace,
} from '../../api/tutorHistory';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

const SOURCE_TEXT: Record<TutorLevel['grade_source'], string> = {
  student: '你自己选的',
  teacher: '老师设的',
  book: '按你在学的书',
  none: '',
};

interface Props {
  /** 老师页: 传学生 id 和接口给的 prefs;学生页不传,自己去取 */
  studentId?: number;
  initial?: TutorLevel | null;
  /** 学生页: 一打开就展开 */
  defaultOpen?: boolean;
}

export default function TutorLevelControl({ studentId, initial, defaultOpen }: Props) {
  const teacher = studentId !== undefined;
  const [level, setLevel] = useState<TutorLevel | null>(initial ?? null);
  const [open, setOpen] = useState(teacher || !!defaultOpen);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (teacher) return;
    let alive = true;
    getMyLevel().then((r) => alive && setLevel(r)).catch(() => { /* 取不到就不显示 */ });
    return () => { alive = false; };
  }, [teacher]);

  if (!level) return null;

  const save = async (patch: TutorLevelPatch, key: string) => {
    setSaving(key);
    try {
      const r = teacher ? await setStudentLevel(studentId!, patch) : await setMyLevel(patch);
      setLevel(r);
      toast.success(teacher ? '改好了,这个孩子下次提问就按这个讲' : '改好了,下次提问就按这个讲');
    } catch (e) {
      toast.error(getErrorMessage(e, '没改成,再试一次'));
    } finally {
      setSaving(null);
    }
  };

  const auto = level.pace_mode === 'auto';
  const who = teacher ? '这个孩子' : '你';
  const gradeText = level.grade ?? '没设';
  const summary = `${gradeText} · ${auto ? `自动(现在${level.auto_label === '正常' ? '正常讲' : level.auto_label})` : level.pace_label}`;
  const paceBtn = (value: TutorPace | 'auto', label: string, hint: string) => {
    const on = value === 'auto' ? auto : !auto && level.pace === value;
    return (
      <button
        key={value}
        type="button"
        role="radio"
        aria-checked={on}
        disabled={saving !== null}
        onClick={() => !on && void save({ pace: value }, `pace-${value}`)}
        className={`flex min-h-11 flex-col items-start justify-center rounded-xl border px-3 py-1.5 text-left transition disabled:opacity-60 ${
          on ? 'border-orange-300 bg-orange-50 text-orange-800 shadow-sm' : 'border-slate-200 bg-white text-ink hover:border-slate-300'
        }`}
      >
        <span className="flex items-center gap-1 text-sm font-medium">
          {value === 'auto' && <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
          {label}
          {saving === `pace-${value}` && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        </span>
        <span className="text-[11px] leading-4 text-ink-mute">{hint}</span>
      </button>
    );
  };

  return (
    <div className={teacher ? 'rounded-lg bg-sky-50/60 px-3 py-2.5' : ''}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">小鹰老师怎么给{who}讲</span>
          <span className="block truncate text-xs text-ink-soft">{summary}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-mute transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-ink-soft">年级</span>
            <span className="relative mt-1 block">
              <select
                value={level.grade_source === 'student' || level.grade_source === 'teacher' ? level.grade ?? '' : ''}
                disabled={saving !== null}
                onChange={(e) => void save({ grade: e.target.value || null }, 'grade')}
                className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-3 pr-9 text-base text-ink focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:opacity-60 sm:text-sm"
              >
                <option value="">{level.grade_source === 'book' && level.grade ? `按在学的书: ${level.grade}` : '让小鹰老师自己判断'}</option>
                {level.grade_options.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              {saving === 'grade'
                ? <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-mute" aria-hidden="true" />
                : <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden="true" />}
            </span>
            <span className="mt-1 block text-[11px] leading-4 text-ink-mute">
              {level.grade && SOURCE_TEXT[level.grade_source]
                ? `现在按${level.grade}讲(${SOURCE_TEXT[level.grade_source]}${level.grade_source === 'book' && level.book ? `《${level.book}》` : ''})`
                : `现在按${level.band_label}的讲法`}
            </span>
          </label>

          <div>
            <span className="text-xs font-medium text-ink-soft">讲法</span>
            <div role="radiogroup" aria-label="讲法" className="mt-1 grid grid-cols-2 gap-2">
              {paceBtn('auto', '自动', '看反应自己调')}
              {PACE_OPTIONS.map((o) => paceBtn(o.value, o.label, o.hint))}
            </div>
            {teacher && auto && (
              <p className="mt-1.5 text-[11px] leading-4 text-ink-mute">
                {level.auto_reasons.length
                  ? `自动判断为「${level.auto_label}」: ${level.auto_reasons.join(';')}`
                  : '自动: 最近的练习和提问还看不出该讲浅还是讲深,按年级正常讲'}
              </p>
            )}
            {!teacher && (
              <p className="mt-1.5 text-[11px] leading-4 text-ink-mute">
                聊的时候说一句「讲简单点」或「我会了」,小鹰老师也会马上换讲法
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
