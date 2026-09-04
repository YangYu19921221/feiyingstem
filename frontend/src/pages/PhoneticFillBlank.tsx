/**
 * 看单词写音标 — 整页版
 *
 * 版面照纸质教材:一页 20 个词并排,学生看着一整页填,填完一次交卷。
 * 同韵的词(bad/babe/bade)排在一起,拼读规律自己就浮出来 —— 这正是拼读节教的东西。
 *
 * 两遍机制:第一遍全空;交卷后错的词第二遍只挖元音格(辅音由服务端回填),
 * 因为元音是拼读的教学点,辅音是送分的。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, Check, RotateCcw } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import useStudyTimeReporter from '../hooks/useStudyTimeReporter';
import IpaKeyboard from '../components/phonetics/IpaKeyboard';
import WordRow from '../components/phonetics/WordRow';
import {
  fetchPhoneticLesson, checkPhoneticPage,
  type PhoneticLesson, type PageItemResult,
} from '../api/phoneticPractice';

type Phase = 'loading' | 'error' | 'filling' | 'checked' | 'done';

/** 每行的作答状态 */
interface RowState {
  slots: (string | null)[];
  editable: number[];
  result?: PageItemResult;
}

export default function PhoneticFillBlank() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const goBack = useGoBack('/student/phonetics/textbook');

  const [lesson, setLesson] = useState<PhoneticLesson | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [pass, setPass] = useState(1);
  const [rows, setRows] = useState<RowState[]>([]);
  const [activeRow, setActiveRow] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [checking, setChecking] = useState(false);
  const [rightCount, setRightCount] = useState(0);
  const startTsRef = useRef(0);
  // 幂等键:同一次交卷重复提交不重复记账;换遍才换 key
  const attemptIdRef = useRef('');
  // 音标闯关此前一秒都不进学习日历
  useStudyTimeReporter(phase === 'done');

  useEffect(() => {
    if (!lessonId) {
      setError('没有找到这一节,请返回重新进入。');
      setPhase('error');
      return;
    }
    let alive = true;
    fetchPhoneticLesson(lessonId)
      .then(d => {
        if (!alive) return;
        if (!d.items?.length) {
          setError('这一节还没有题目。');
          setPhase('error');
          return;
        }
        setLesson(d);
        setRows(d.items.map(it => ({
          slots: Array(it.slot_count).fill(null),
          editable: Array.from({ length: it.slot_count }, (_, i) => i),
        })));
        setPhase('filling');
        startTsRef.current = Date.now();
        attemptIdRef.current = `${d.id}-p1-${Date.now()}`;
      })
      .catch(() => {
        if (!alive) return;
        setError('题目加载失败,请检查网络后重试。');
        setPhase('error');
      });
    return () => { alive = false; };
  }, [lessonId]);

  /** 下一个空格:先在本行找,本行满了就跳下一行的第一个空格 */
  const advance = useCallback((rs: RowState[], row: number, from: number) => {
    const inRow = rs[row]?.editable.find(i => i > from && rs[row].slots[i] == null);
    if (inRow != null) return { row, cur: inRow };
    for (let r = row + 1; r < rs.length; r++) {
      const c = rs[r].editable.find(i => rs[r].slots[i] == null);
      if (c != null) return { row: r, cur: c };
    }
    return { row, cur: -1 };
  }, []);

  const handleKey = (p: string) => {
    if (phase !== 'filling' || cursor < 0) return;
    setRows(prev => {
      const next = prev.map((r, i) =>
        i === activeRow ? { ...r, slots: r.slots.map((v, j) => (j === cursor ? p : v)) } : r);
      const { row, cur } = advance(next, activeRow, cursor);
      setActiveRow(row);
      setCursor(cur);
      return next;
    });
  };

  const handleBackspace = () => {
    if (phase !== 'filling') return;
    setRows(prev => {
      const r = prev[activeRow];
      if (!r) return prev;
      // 光标在空格上时,退格删本行前一个已填的格
      const target = cursor >= 0 && r.slots[cursor] != null
        ? cursor
        : [...r.editable].reverse().find(i => r.slots[i] != null);
      if (target == null) return prev;
      setCursor(target);
      return prev.map((x, i) =>
        i === activeRow ? { ...x, slots: x.slots.map((v, j) => (j === target ? null : v)) } : x);
    });
  };

  const handleClearRow = () => {
    if (phase !== 'filling') return;
    setRows(prev => prev.map((r, i) => {
      if (i !== activeRow) return r;
      const slots = [...r.slots];
      r.editable.forEach(j => { slots[j] = null; });
      return { ...r, slots };
    }));
    setCursor(rows[activeRow]?.editable[0] ?? 0);
  };

  const focusRow = (i: number) => {
    if (phase !== 'filling') return;
    setActiveRow(i);
    const r = rows[i];
    setCursor(r.editable.find(j => r.slots[j] == null) ?? r.editable[0] ?? -1);
  };

  /** 待填格数:0 才能交卷 */
  const remaining = useMemo(
    () => rows.reduce((n, r) => n + r.editable.filter(i => r.slots[i] == null).length, 0),
    [rows],
  );

  const handleSubmit = async () => {
    if (!lesson || checking || remaining > 0) return;
    setChecking(true);
    try {
      const res = await checkPhoneticPage({
        lesson_id: lesson.id,
        pass_number: pass,
        attempt_id: attemptIdRef.current,
        duration_ms: Date.now() - startTsRef.current,
        answers: lesson.items.map((it, i) => ({
          item_id: it.id, submitted: rows[i].slots,
        })),
      });
      const byId = new Map(res.results.map(r => [r.item_id, r]));
      setRows(prev => prev.map((r, i) => ({ ...r, result: byId.get(lesson.items[i].id) })));
      setRightCount(res.right_count);
      setPhase('checked');
    } catch {
      setError('交卷失败,请检查网络后重试。');
      setPhase('error');
    } finally {
      setChecking(false);
    }
  };

  /** 第二遍:只重做错的词,辅音已由服务端回填 */
  const handleSecondPass = () => {
    if (!lesson) return;
    const next: RowState[] = rows.map(r => {
      if (!r.result || r.result.all_correct) {
        return { ...r, editable: [] };      // 做对的行锁住,保留绿色
      }
      const slots = r.result.prefill ? [...r.result.prefill] : [...r.slots];
      return { slots, editable: r.result.next_blanks };
    });
    setRows(next);
    setPass(2);
    setPhase('filling');
    startTsRef.current = Date.now();
    attemptIdRef.current = `${lesson.id}-p2-${Date.now()}`;
    const first = next.findIndex(r => r.editable.length > 0);
    setActiveRow(first < 0 ? 0 : first);
    setCursor(first < 0 ? -1 : next[first].editable[0]);
  };

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-orange-400" />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-center text-slate-600">{error}</p>
        <button onClick={goBack} className="rounded-lg bg-orange-500 px-5 py-2 text-white">
          返回
        </button>
      </div>
    );
  }

  const total = lesson?.items.length ?? 0;
  const wrongLeft = rows.filter(r => r.result && !r.result.all_correct).length;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-orange-50/40 to-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-100
                         bg-white/90 px-4 py-3 backdrop-blur">
        <button onClick={goBack} aria-label="返回" className="rounded-lg p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-700">{lesson?.title} · 看单词写音标</p>
          <p className="text-xs text-slate-400">
            {phase === 'checked'
              ? `${total} 题做对 ${rightCount} 题`
              : pass === 2
                ? `第二遍 · 只填元音,还剩 ${remaining} 格`
                : `共 ${total} 题,还剩 ${remaining} 格`}
          </p>
        </div>
      </header>

      {/* 左右布局:词表独立滚动,键盘固定右侧不遮挡 —— 键盘压在底部会吃掉半屏词表 */}
      <div className="flex min-h-0 flex-1 lg:flex-row flex-col">
        {/* 左:词表 */}
        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <div className="mx-auto max-w-2xl divide-y divide-slate-50 rounded-2xl bg-white
                          p-2 shadow-sm ring-1 ring-slate-100">
            {lesson?.items.map((it, i) => (
              <WordRow
                key={it.id}
                index={i}
                word={it.word}
                meaning={it.meaning}
                slots={rows[i]?.slots ?? []}
                editable={rows[i]?.editable ?? []}
                active={phase === 'filling' && i === activeRow}
                cursor={cursor}
                correct={rows[i]?.result?.per_slot}
                answerDisplay={rows[i]?.result?.answer_display}
                onFocusRow={() => focusRow(i)}
                onSlotClick={c => { setActiveRow(i); setCursor(c); }}
              />
            ))}
          </div>
        </main>

        {/* 右:键盘 + 交卷。窄屏回落到底部横排 */}
        <aside className="shrink-0 border-t border-slate-200 bg-white/95 p-3 backdrop-blur
                          lg:w-[26rem] lg:overflow-y-auto lg:border-l lg:border-t-0">
          {phase === 'filling' ? (
            <>
              <IpaKeyboard
                onKey={handleKey}
                onBackspace={handleBackspace}
                onClear={handleClearRow}
                full={cursor < 0}
                highlight={lesson?.highlight}
              />
              <button
                onClick={handleSubmit}
                disabled={remaining > 0 || checking}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl
                           bg-orange-500 py-3 text-white transition active:scale-[0.99]
                           disabled:bg-slate-200 disabled:text-slate-400"
              >
                {checking
                  ? <LoaderCircle className="h-4 w-4 animate-spin" />
                  : <Check className="h-4 w-4" />}
                {remaining > 0 ? `还有 ${remaining} 格没填` : '交卷'}
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-center text-sm text-slate-600">
                {wrongLeft === 0
                  ? '这一页全对了'
                  : pass === 1
                    ? `${wrongLeft} 个词不对,再填一遍 —— 这次只填元音`
                    : `${wrongLeft} 个词仍不对,正确答案已标在右边`}
              </p>
              {wrongLeft > 0 && pass === 1 && (
                <button
                  onClick={handleSecondPass}
                  className="flex items-center justify-center gap-2 rounded-xl
                             bg-orange-500 py-3 text-white transition active:scale-[0.99]"
                >
                  <RotateCcw className="h-4 w-4" /> 再填一遍
                </button>
              )}
              <button
                onClick={goBack}
                className="rounded-xl bg-slate-800 py-3 text-white transition active:scale-[0.99]"
              >
                完成
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
