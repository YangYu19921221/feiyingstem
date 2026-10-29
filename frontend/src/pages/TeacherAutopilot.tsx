/**
 * 老师端「小鹰老师 · 自动布置」(2026-10-29)
 *
 * 用户「我的目的就是需要解放老师 让 ai 全自动」「怎么用 我们的逻辑是什么 你需要在教师端写清楚,
 * 什么时候需要人工 什么时候不需要」。规则真源 backend/app/services/autopilot.py 文件头,
 * 页面顶上那段说明照它写 —— 改规则两处一起改。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, BookOpen, Bot, CheckCircle2, ChevronDown, ChevronUp, LoaderCircle, Pause, Play, RefreshCw,
  Settings2, Undo2, X,
} from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import {
  autopilotApi, itemLabel, WEEKDAYS, type BoardStudent, type ClassSettings, type Overview, type Place,
  type Suggestion, type TodoItem,
} from '../api/autopilot';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

const GUIDE_KEY = 'autopilot_guide_open_v1';

function Guide({ rules }: { rules: Overview['rules'] | null }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(GUIDE_KEY) !== '0'; } catch { return true; }
  });
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(GUIDE_KEY, o ? '0' : '1'); } catch { /* 隐私模式 */ }
      return !o;
    });
  };
  const tiers = (rules?.tiers ?? [20, 40, 60, 80, 100, 150, 200]).join(' / ');
  return (
    <section className="rounded-xl border border-orange-200 bg-white shadow-sm">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <Bot className="h-5 w-5 text-orange-500" aria-hidden />
        <span className="font-semibold text-slate-800">怎么用、小鹰老师怎么排、什么时候需要你</span>
        <span className="ml-auto text-sm text-slate-500">{open ? '收起' : '展开'}</span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && (
        <div className="grid gap-4 border-t border-orange-100 px-4 py-4 text-sm leading-6 text-slate-700 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">怎么用(三步)</h3>
              <ol className="list-decimal space-y-1 pl-5">
                <li>在下面选一个班,设好<b>每周哪几天来电教室</b>。那几天派的是电教室作业(照常发金币),别的日子派在家作业(不发金币)。</li>
                <li>选<b>手动</b>还是<b>自动</b>。手动: 小鹰老师每天给每个孩子出一份建议,你看一眼点「按建议布置」才发。自动: 孩子<b>签到那一刻</b>小鹰老师就派,你不用管。建议先用手动看几天,觉得派得对再切自动。</li>
                <li>每天看一眼顶上的<b>「需要你处理」</b>。没有就不用管。</li>
              </ol>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">不需要你的(小鹰老师自己做)</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>每个孩子今天派什么、派多少、过关要多少分</li>
                <li>哪组该复习第几轮、哪天到期</li>
                <li>孩子做完了还想背,再给一份</li>
                <li>每天给孩子写一句点评(孩子首页和家长端都看得到)</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">需要你的(会出现在「需要你处理」)</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li><b>需要关心</b>: 孩子跟小鹰老师说了让人担心的话,先看这个</li>
                <li><b>要请你当面讲</b>: 小鹰老师换着讲法讲过,还是错了 3 次的知识点</li>
                <li><b>走了 3 轮还没学会</b>: 一组背了 3 轮,当天第一次过关检测还没到过关线。小鹰老师会接着派,你最好当面看看是哪几个词</li>
                <li><b>今天学得吃力</b>: 可以把他每天的量调小</li>
                <li><b>连着几天没来</b>: 孩子不签到小鹰老师就派不了,要你联系家长</li>
                <li><b>没有书 / 书要兑换学习卡 / 书学完了</b>: 给他分配书(「分配单词本」)</li>
              </ul>
              <p className="mt-1 text-slate-500">想自己定: 某个孩子每天固定几个、固定过关线、从哪本书哪个单元开始、暂停他 —— 在下面孩子那一行点「设置」。</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">每天派多少</h3>
              <p>档位 {tiers} 个词(含复习轮次和复习词)。新来的孩子每天 {rules?.new_kid_words ?? 20} 个;用过的孩子按他最近两周自己平均每天学多少,往下降一档起步。</p>
              <p>刚用的前 3 天每天看一次,之后最多 3 天调一次: 都做完、过关检测第一次平均 85 分以上就加一档;没做完或低于 70 分就减一档。连着 3 天做完、还有 2 天自己要了加练,也加一档。</p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">三轮才算学会</h3>
              <p>每组第一次过关 = 第 1 轮,隔 1 天第 2 轮,再隔 3 天第 3 轮。第 3 轮(及以后)那天<b>第一次</b>过关检测就达到过关线,这组才算学会;没达到就每 3 天再来一轮,一直到学会。</p>
              <p>同一天重复背、没到日子提前背,算孩子自己多背,不算轮次(但会记着,升档时算进去)。</p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">每天的顺序</h3>
              <p>先派到期的老组(轮次高的最先)→ 到期的第 2 轮 → 今天的复习词 → 最后才是新词。新词接着他最近在学的那本书往下,那本学完了换下一本他能学的书。</p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">过关线(过关检测要多少分)</h3>
              <p>头一周 80 分。之后每周看一次最近两周「当天第一次」过关检测的平均分(做满 10 次才看): 不到 88 → 80;88–92 → 85;93–96 → 90;97 以上 → 95。一周最多动一档。孩子在过关页上看得到要多少分。</p>
            </div>
            <div>
              <h3 className="mb-1 font-semibold text-slate-900">其它</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>今天你自己给某个孩子布置了单词作业,小鹰老师今天就不给他派(以你的为准)</li>
                <li>做完了还想背: 孩子首页点「再来一份」,按每天量的一半再派,一天最多 {rules?.extra_batches ?? 5} 份。<b>不算今天的任务,不影响金币</b></li>
                <li>点评: 孩子做完今天的任务那一刻,或者晚上 {rules?.evening ?? '22:30'},落款「小鹰老师」。你当天自己写过的不会被盖掉</li>
                <li>小鹰老师派的作业在「作业管理」里也看得到,布置人写「小鹰老师(自动)」,和你布置的一样能关、能删;不想要今天的就点「撤回今天的」</li>
                <li>只派孩子自己能学的书,学习卡和专属内容的规矩照旧</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function TodoList({ items }: { items: TodoItem[] }) {
  if (items.length === 0) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <CheckCircle2 className="h-5 w-5" aria-hidden /> 现在没有需要你处理的事,小鹰老师在照常安排。
      </section>
    );
  }
  const link = (k: TodoItem['kind']) => (k === 'alert' || k === 'handoff' ? '/teacher/tutor-class'
    : k === 'no_book' || k === 'gated' || k === 'finished' ? '/teacher/assignments'
      : k === 'absent' ? '/teacher/coach' : null);
  const tone = (k: TodoItem['kind']) => (k === 'alert' ? 'bg-red-50 text-red-700'
    : k === 'handoff' || k === 'stuck' ? 'bg-amber-50 text-amber-800'
      : k === 'struggling' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600');
  return (
    <section className="rounded-xl border border-amber-200 bg-white shadow-sm">
      <h2 className="flex items-center gap-2 border-b border-amber-100 px-4 py-2.5 font-semibold text-slate-800">
        <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden /> 需要你处理 <span className="text-amber-600">{items.length}</span>
      </h2>
      <ul className="divide-y divide-slate-100">
        {items.slice(0, 40).map((t, i) => {
          const to = link(t.kind);
          return (
            <li key={`${t.kind}-${t.student_id}-${i}`} className="flex flex-wrap items-start gap-2 px-4 py-2.5 text-sm">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${tone(t.kind)}`}>{t.label}</span>
              <span className="shrink-0 font-semibold text-slate-800">{t.student_name}</span>
              {t.class_name && <span className="shrink-0 text-xs leading-6 text-slate-400">{t.class_name}</span>}
              <span className="min-w-[12rem] flex-1 text-slate-600">{t.text}</span>
              {to && <Link to={to} className="shrink-0 text-xs font-semibold text-orange-600 hover:underline">去处理</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ClassCard({ c, onSave, busy }: {
  c: ClassSettings; busy: boolean; onSave: (body: Parameters<typeof autopilotApi.saveClass>[1]) => void;
}) {
  const [cap, setCap] = useState(c.max_words ? String(c.max_words) : '');
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const overriddenToday = c.day_overrides[todayIso];
  const toggleDay = (d: number) => {
    const next = c.class_days.includes(d) ? c.class_days.filter((x) => x !== d) : [...c.class_days, d].sort();
    onSave({ class_days: next });
  };
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-slate-800">{c.name}</h2>
        <div className="flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="手动还是自动">
          {(['manual', 'auto'] as const).map((m) => (
            <button key={m} type="button" disabled={busy} onClick={() => c.mode !== m && onSave({ mode: m })}
              aria-pressed={c.mode === m}
              className={`min-h-9 rounded-md px-3 text-sm font-semibold ${c.mode === m ? (m === 'auto' ? 'bg-orange-500 text-white' : 'bg-slate-800 text-white') : 'text-slate-600 hover:bg-slate-50'}`}>
              {m === 'manual' ? '手动(你点了才发)' : '自动(签到就派)'}
            </button>
          ))}
        </div>
        <button type="button" disabled={busy} onClick={() => onSave({ paused: !c.paused })}
          className={`inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 text-sm ${c.paused ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          {c.paused ? <><Play className="h-4 w-4" aria-hidden /> 已暂停,点了恢复</> : <><Pause className="h-4 w-4" aria-hidden /> 暂停全班</>}
        </button>
        {c.updated_by_name && <span className="ml-auto text-xs text-slate-400">最近由 {c.updated_by_name} 修改</span>}
      </div>
      <p className="text-sm text-slate-500">
        {c.mode === 'auto'
          ? '孩子签到那一刻小鹰老师就派今天的任务。你今天自己给某个孩子布置过单词作业,就不给他派。'
          : '小鹰老师每天给每个孩子出一份建议(在下面),你看过点「按建议布置」才发。'}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-600">每周来电教室:</span>
          {WEEKDAYS.map((w, i) => (
            <button key={w} type="button" disabled={busy} onClick={() => toggleDay(i)} aria-pressed={c.class_days.includes(i)}
              className={`h-9 w-9 rounded-lg text-sm font-semibold ${c.class_days.includes(i) ? 'bg-teal-600 text-white' : 'border border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
              {w}
            </button>
          ))}
        </div>
        {c.class_days.length === 0 && (
          <label className="flex items-center gap-1.5 text-slate-600">
            没设上课日时按
            <select value={c.default_location} disabled={busy} onChange={(e) => onSave({ default_location: e.target.value as Place })}
              className="min-h-9 rounded-lg border border-slate-200 px-2">
              <option value="classroom">电教室(发金币)</option>
              <option value="home">在家(不发金币)</option>
            </select>
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="text-slate-600">
          今天: <b className={c.today_location === 'classroom' ? 'text-teal-700' : 'text-slate-800'}>
            {c.today_location === 'classroom' ? '电教室(发金币)' : '在家(不发金币)'}</b>
          <span className="text-slate-400"> · {c.today_location_reason}</span>
        </span>
        <button type="button" disabled={busy} className="text-sm font-semibold text-orange-600 hover:underline disabled:opacity-50"
          onClick={() => onSave({ day_override: { date: todayIso, location: overriddenToday ? '' : (c.today_location === 'classroom' ? 'home' : 'classroom') } })}>
          {overriddenToday ? '取消今天的临时调整' : `今天临时改成${c.today_location === 'classroom' ? '在家' : '电教室'}`}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
        <label className="flex items-center gap-1.5">
          全班每天最多
          <input value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric"
            placeholder="不限" aria-label="全班每天最多几个词"
            className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-center" />
          个词
          {cap !== (c.max_words ? String(c.max_words) : '') && (
            <button type="button" disabled={busy} onClick={() => onSave({ max_words: cap ? Number(cap) : null })}
              className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white">保存</button>
          )}
        </label>
        <label className="flex items-center gap-1.5">
          全班过关线
          <select value={c.pass_line ?? ''} disabled={busy}
            onChange={(e) => onSave({ pass_line: e.target.value ? Number(e.target.value) : null })}
            className="min-h-9 rounded-lg border border-slate-200 px-2">
            <option value="">按每个孩子的能力(推荐)</option>
            {[80, 85, 90, 95].map((v) => <option key={v} value={v}>固定 {v} 分</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}

function StudentSettings({ s, onClose, onSaved }: { s: BoardStudent; onClose: () => void; onSaved: () => void }) {
  const [words, setWords] = useState(s.fixed_words ? String(s.fixed_words) : '');
  const [line, setLine] = useState(s.fixed_pass_line ? String(s.fixed_pass_line) : '');
  const [paused, setPaused] = useState(s.paused);
  const [books, setBooks] = useState<{ id: number; name: string; units: { id: number; name: string }[] }[] | null>(null);
  const [book, setBook] = useState(s.book_id ? String(s.book_id) : '');
  const [unit, setUnit] = useState(s.start_unit_id ? String(s.start_unit_id) : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    autopilotApi.books(s.id).then(setBooks).catch(() => setBooks([]));
  }, [s.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const units = books?.find((b) => String(b.id) === book)?.units ?? [];
  const save = async () => {
    setBusy(true);
    try {
      await autopilotApi.saveStudent(s.id, {
        fixed_words: words ? Number(words) : null,
        fixed_pass_line: line ? Number(line) : null,
        paused,
        book_id: book ? Number(book) : null,
        start_unit_id: unit ? Number(unit) : null,
      });
      toast.success('保存好了,明天起按这个派');
      onSaved();
    } catch (e) {
      toast.error(getErrorMessage(e, '保存失败'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${s.name} 的设置`} onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center">
          <h2 className="font-semibold text-slate-900">{s.name} · 单独设置</h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="mb-1 block font-semibold text-slate-700">每天派多少</span>
            <select value={words} onChange={(e) => setWords(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 px-2">
              <option value="">交给小鹰老师(现在 {s.tier ?? 20} 个)</option>
              {[10, 20, 40, 60, 80, 100, 150, 200].map((v) => <option key={v} value={v}>固定每天 {v} 个</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold text-slate-700">过关线</span>
            <select value={line} onChange={(e) => setLine(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 px-2">
              <option value="">交给小鹰老师(现在 {s.pass_line} 分)</option>
              {[80, 85, 90, 95].map((v) => <option key={v} value={v}>固定 {v} 分</option>)}
            </select>
          </label>
          <div>
            <span className="mb-1 block font-semibold text-slate-700">学哪本书</span>
            {books === null ? <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" aria-label="加载中" /> : books.length === 0 ? (
              <p className="text-slate-500">他现在没有能学的书。先在「分配单词本」给他分一本。</p>
            ) : (
              <div className="space-y-2">
                <select value={book} onChange={(e) => { setBook(e.target.value); setUnit(''); }}
                  className="min-h-10 w-full rounded-lg border border-slate-200 px-2" aria-label="书">
                  <option value="">交给小鹰老师(接着最近在学的那本)</option>
                  {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                {book && (
                  <select value={unit} onChange={(e) => setUnit(e.target.value)}
                    className="min-h-10 w-full rounded-lg border border-slate-200 px-2" aria-label="从哪个单元开始">
                    <option value="">从第一个没学过的单元开始</option>
                    {units.map((u) => <option key={u.id} value={u.id}>从「{u.name}」开始</option>)}
                  </select>
                )}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} className="h-4 w-4" />
            <span>暂停他(小鹰老师不给他派,你自己布置)</span>
          </label>
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="min-h-10 flex-1 rounded-lg border border-slate-200 text-sm">取消</button>
          <button type="button" onClick={save} disabled={busy}
            className="min-h-10 flex-1 rounded-lg bg-orange-500 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TodayCell({ s }: { s: BoardStudent }) {
  const t = s.today;
  if (!t) return <span className="text-slate-400">今天还没派(没签到)</span>;
  if (t.status !== 'dispatched') return <span className="text-slate-500">{t.reason || '今天没派'}</span>;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${t.done === t.total ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
          做了 {t.done}/{t.total} 份
        </span>
        <span className="text-xs text-slate-400">{t.location === 'home' ? '在家' : '电教室'} · {t.source === 'auto' ? '签到自动派' : t.actor_name}</span>
        {t.extra_batches > 0 && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-700">加练 {t.extra_batches} 份</span>}
        {t.comment_flag === 'struggling' && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-700">今天吃力</span>}
      </div>
      <ul className="space-y-0.5 text-xs text-slate-600">
        {t.items.map((i, k) => (
          <li key={k} className={i.done ? 'text-slate-400 line-through decoration-slate-300' : ''}>
            {i.batch ? '加练 · ' : ''}{itemLabel(i)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuggestionCell({ sug }: { sug: Suggestion }) {
  if (sug.status !== 'ok') return <span className="text-amber-700">{sug.reason}</span>;
  return (
    <div className="space-y-0.5 text-xs text-slate-600">
      <p className="text-slate-500">建议今天({sug.location === 'home' ? '在家' : '电教室'}):</p>
      <ul className="space-y-0.5">{sug.items.map((i, k) => <li key={k}>{itemLabel(i)}</li>)}</ul>
    </div>
  );
}

export default function TeacherAutopilot() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [classId, setClassId] = useState<number | null>(null);
  const [board, setBoard] = useState<{ class: ClassSettings; students: BoardStudent[] } | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [loading, setLoading] = useState(true);
  const [boardLoading, setBoardLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<BoardStudent | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const o = await autopilotApi.overview();
      setOverview(o);
      setClassId((cur) => cur ?? o.classes[0]?.class_id ?? null);
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  const loadBoard = useCallback(async (id: number) => {
    setBoardLoading(true);
    try {
      const b = await autopilotApi.board(id);
      setBoard(b);
      if (b.class.mode === 'manual' && !b.class.paused) {
        const sug = await autopilotApi.suggestions(id);
        setSuggestions(sug);
        setPicked(new Set(Object.entries(sug).filter(([, v]) => v.status === 'ok').map(([k]) => Number(k))));
      } else {
        setSuggestions({});
        setPicked(new Set());
      }
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    } finally {
      setBoardLoading(false);
    }
  }, []);
  useEffect(() => { if (classId) loadBoard(classId); }, [classId, loadBoard]);

  const saveClass = async (body: Parameters<typeof autopilotApi.saveClass>[1]) => {
    if (!classId) return;
    if (body.mode === 'auto' && !window.confirm('切成自动后,孩子签到那一刻小鹰老师就派今天的任务,不再等你点。确定吗?')) return;
    setBusy('class');
    try {
      const c = await autopilotApi.saveClass(classId, body);
      setOverview((o) => (o ? { ...o, classes: o.classes.map((x) => (x.class_id === c.class_id ? c : x)) } : o));
      if ('mode' in body || 'paused' in body) await loadBoard(classId);
      else setBoard((b) => (b ? { ...b, class: c } : b));
    } catch (e) {
      toast.error(getErrorMessage(e, '保存失败'));
    } finally {
      setBusy(null);
    }
  };

  const dispatch = async (ids: number[]) => {
    if (!classId || ids.length === 0) return;
    setBusy('dispatch');
    try {
      const r = await autopilotApi.dispatch(classId, ids);
      const bad = r.results.filter((x) => x.status !== 'dispatched');
      toast.success(`已给 ${r.dispatched} 个孩子布置今天的任务${bad.length ? `,${bad.length} 个没派(看那一行写的原因)` : ''}`);
      await Promise.all([loadBoard(classId), loadOverview()]);
    } catch (e) {
      toast.error(getErrorMessage(e, '布置失败'));
    } finally {
      setBusy(null);
    }
  };

  const undo = async (s: BoardStudent) => {
    if (!window.confirm(`撤回小鹰老师今天给「${s.name}」派的任务?他已经开始做的那几份会留着。`)) return;
    setBusy(`undo-${s.id}`);
    try {
      const r = await autopilotApi.undo(s.id);
      toast.success(r.removed ? `撤回了 ${r.removed} 份` : '都已经开始做了,没有能撤回的');
      if (classId) await loadBoard(classId);
    } catch (e) {
      toast.error(getErrorMessage(e, '撤回失败'));
    } finally {
      setBusy(null);
    }
  };

  const cls = board?.class ?? overview?.classes.find((c) => c.class_id === classId) ?? null;
  const pending = useMemo(() => (board?.students ?? []).filter((s) => suggestions[String(s.id)]?.status === 'ok'), [board, suggestions]);
  const pickedOk = pending.filter((s) => picked.has(s.id));

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="小鹰老师 · 自动布置" subtitle="每天给每个孩子排任务、复习、点评;你只处理它解决不了的"
        icon={Bot} backTo="/teacher/dashboard" />
      <main className="teacher-workspace-main mx-auto max-w-5xl space-y-4">
        {overview && !overview.enabled && (
          <section className="rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-700">
            平台暂时关掉了小鹰老师自动布置,现在不会派任务。需要的话联系平台管理员。
          </section>
        )}
        <Guide rules={overview?.rules ?? null} />
        {loading && !overview ? (
          <div className="flex justify-center py-16"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" /></div>
        ) : !overview || overview.classes.length === 0 ? (
          <div className="rounded-xl bg-white py-14 text-center text-sm text-slate-500 shadow-sm">你还没有班级。先在「班级」里建一个班、把学生加进来。</div>
        ) : (
          <>
            <TodoList items={overview.todo} />
            {overview.classes.length > 1 && (
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="班级">
                {overview.classes.map((c) => (
                  <button key={c.class_id} type="button" role="tab" aria-selected={c.class_id === classId} onClick={() => setClassId(c.class_id)}
                    className={`min-h-9 rounded-lg px-3 text-sm ${c.class_id === classId ? 'bg-slate-800 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    {c.name} <span className={c.class_id === classId ? 'text-orange-300' : 'text-slate-400'}>{c.mode === 'auto' ? '自动' : '手动'}</span>
                  </button>
                ))}
              </div>
            )}
            {cls && <ClassCard key={`${cls.class_id}-${cls.max_words ?? ''}`} c={cls} busy={busy !== null} onSave={saveClass} />}

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                <h2 className="font-semibold text-slate-800">孩子们今天</h2>
                {cls?.mode === 'manual' && pending.length > 0 && (
                  <button type="button" disabled={busy !== null || pickedOk.length === 0} onClick={() => dispatch(pickedOk.map((s) => s.id))}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
                    {busy === 'dispatch' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                    按建议布置勾选的 {pickedOk.length} 个
                  </button>
                )}
                <button type="button" onClick={() => classId && loadBoard(classId)} disabled={boardLoading} aria-label="刷新"
                  className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                  <RefreshCw className={`h-4 w-4 ${boardLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              {boardLoading && !board ? (
                <div className="flex justify-center py-12"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" /></div>
              ) : !board || board.students.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500">这个班还没有学生</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {board.students.map((s) => {
                    const sug = suggestions[String(s.id)];
                    const dispatched = s.today?.status === 'dispatched';
                    return (
                      <li key={s.id} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(10rem,14rem)_1fr_auto]">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {cls?.mode === 'manual' && sug?.status === 'ok' && (
                              <input type="checkbox" className="h-4 w-4" aria-label={`布置给 ${s.name}`} checked={picked.has(s.id)}
                                onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })} />
                            )}
                            <span className="font-semibold text-slate-800">{s.name}</span>
                            {s.paused && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">暂停</span>}
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            每天 {s.tier ?? sug?.tier ?? 20} 个{s.fixed_words ? '(你定的)' : ''} · 过关 {s.pass_line} 分{s.fixed_pass_line ? '(你定的)' : ''}
                          </p>
                          <p className="text-xs text-slate-400">
                            学会 {s.groups.graduated} 组 · 在学 {s.groups.learning} 组{s.groups.stuck ? ` · ${s.groups.stuck} 组 3 轮没学会` : ''}
                          </p>
                          {(s.tier_reason || sug?.tier_reason) && (
                            <p className="mt-0.5 text-xs text-slate-400" title="小鹰老师为什么派这么多">{s.tier_reason || sug?.tier_reason}</p>
                          )}
                        </div>
                        <div className="min-w-0 text-sm">
                          {dispatched || !sug ? <TodayCell s={s} /> : <SuggestionCell sug={sug} />}
                        </div>
                        <div className="flex flex-wrap items-start gap-1.5 md:justify-end">
                          {cls?.mode === 'manual' && sug?.status === 'ok' && !dispatched && (
                            <button type="button" disabled={busy !== null} onClick={() => dispatch([s.id])}
                              className="min-h-9 rounded-lg border border-orange-300 px-2.5 text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50">
                              按建议布置
                            </button>
                          )}
                          {dispatched && (
                            <button type="button" disabled={busy !== null} onClick={() => undo(s)}
                              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                              <Undo2 className="h-3.5 w-3.5" aria-hidden /> 撤回今天的
                            </button>
                          )}
                          <button type="button" onClick={() => setEditing(s)}
                            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs text-slate-600 hover:bg-slate-50">
                            <Settings2 className="h-3.5 w-3.5" aria-hidden /> 设置
                          </button>
                          {s.book_name && (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-400"><BookOpen className="h-3.5 w-3.5" aria-hidden />{s.book_name}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
      {editing && (
        <StudentSettings s={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); if (classId) loadBoard(classId); }} />
      )}
    </div>
  );
}
