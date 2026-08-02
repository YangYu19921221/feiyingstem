import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useGoBack from '../hooks/useGoBack';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { generateUnitCloze, type UnitClozeResponse } from '../api/cloze';
import { startLearning } from '../api/progress';
import { createLearningRecords } from '../api/learningRecords';
import type { CompletionNavState } from '../hooks/usePracticeState';
import ClozeBank from '../components/practice/ClozeBank';
import SentenceCard from '../components/practice/SentenceCard';
import PracticeLoadError from '../components/practice/PracticeLoadError';

const EASE = [0.16, 1, 0.3, 1] as const;
const BLANK_COUNT = 6;

type Phase = 'loading' | 'filling' | 'checked';

const FillBlankPractice = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');

  const [data, setData] = useState<UnitClozeResponse | null>(null);
  const [unitName, setUnitName] = useState<string | undefined>();
  const [totalUnitWords, setTotalUnitWords] = useState<number | undefined>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [startTs, setStartTs] = useState(0);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  // 每个句子(item index) → 填入的 word_id；activeIndex 是当前选中的空格
  const [fills, setFills] = useState<Record<number, number>>({});
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!unitId) {
      setError('没有找到这个单元，请返回单元列表重新进入。');
      return;
    }
    const id = Number.parseInt(unitId, 10);
    if (!Number.isFinite(id)) {
      setError('这个单元地址不正确，请返回单元列表重新进入。');
      return;
    }
    let cancelled = false;
    setPhase('loading');
    setError('');
    (async () => {
      try {
        const [cloze, unitData] = await Promise.all([
          generateUnitCloze(id, BLANK_COUNT),
          startLearning({ unit_id: id, learning_mode: 'fillblank' }).catch(() => null),
        ]);
        if (cancelled) return;
        setData(cloze);
        if (unitData) {
          setUnitName(unitData.unit_info?.name);
          setTotalUnitWords(unitData.words?.length);
        }
        setStartTs(Date.now());
        setPhase('filling');
      } catch (e) {
        console.error('加载选词填空失败:', e);
        if (!cancelled) setError('题目暂时没有生成出来，请检查网络后重试。');
      }
    })();
    return () => { cancelled = true; };
  }, [unitId, retryCount]);

  const usedIds = useMemo(() => new Set(Object.values(fills)), [fills]);
  const filledCount = Object.keys(fills).length;
  const allFilled = data ? filledCount === data.items.length : false;

  // 点词库里的词 → 填入当前空格，并自动跳到下一个未填的空
  const handlePick = useCallback((wordId: number) => {
    if (!data || phase !== 'filling') return;
    setFills(prev => {
      const next = { ...prev, [activeIndex]: wordId };
      const nextEmpty = data.items.findIndex((_, i) => next[i] === undefined);
      if (nextEmpty !== -1) setActiveIndex(nextEmpty);
      return next;
    });
  }, [data, activeIndex, phase]);

  // 点已填的空 → 取回那个词；点空的空 → 选中它
  const handleBlankClick = useCallback((index: number) => {
    if (phase !== 'filling') return;
    setFills(prev => {
      if (prev[index] !== undefined) {
        const next = { ...prev };
        delete next[index];
        return next;
      }
      return prev;
    });
    setActiveIndex(index);
  }, [phase]);

  const wordOf = useCallback((wordId?: number) =>
    data?.bank.find(b => b.word_id === wordId)?.word ?? '', [data]);

  const isItemCorrect = useCallback((i: number) =>
    !!data && fills[i] === data.items[i].word_id, [data, fills]);

  const correctCount = useMemo(() =>
    data ? data.items.reduce((n, _, i) => n + (isItemCorrect(i) ? 1 : 0), 0) : 0,
    [data, isItemCorrect]);

  // 全部填完 → 判分、写学习记录(错的进错题集)、停留展示，再去完成页
  const handleCheck = async () => {
    if (!data || !unitId) return;
    setPhase('checked');
    const timeSpent = Math.round((Date.now() - startTs) / 1000);
    createLearningRecords({
      unit_id: parseInt(unitId),
      learning_mode: 'fillblank',
      records: data.items.map((it, i) => ({
        word_id: it.word_id,
        is_correct: isItemCorrect(i),
        time_spent: Math.round((timeSpent * 1000) / data.items.length),
        learning_mode: 'fillblank',
      })),
    }).catch(() => {});

    const weakWords = data.items
      .map((it, i) => ({ it, i }))
      .filter(({ i }) => !isItemCorrect(i))
      .map(({ it }) => ({ word: it.answer, meaning: it.meaning || '', attempts: 1 }));

    const navState: CompletionNavState = {
      mode: 'fillblank',
      modeName: '选词填空',
      score: data.items.reduce((n, _, i) => n + (isItemCorrect(i) ? 1 : 0), 0),
      total: data.items.length,
      timeSpent,
      weakWords,
      unitId: parseInt(unitId),
      unitName,
      totalUnitWords,
    };
    setTimeout(() => navigate('/student/completion', { state: navState }), 2200);
  };

  if (error) {
    return (
      <PracticeLoadError
        title="选词填空暂时没准备好"
        message={error}
        onRetry={() => setRetryCount((count) => count + 1)}
      />
    );
  }

  if (phase === 'loading' || !data) {
    return (
      <main className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-4" aria-busy="true">
        <div className="text-center" role="status">
          <LoaderCircle className="mx-auto mb-4 h-9 w-9 animate-spin text-accent-warm" aria-hidden="true" />
          <p className="text-sm font-medium text-ink-soft">正在准备选词填空…</p>
        </div>
      </main>
    );
  }

  return (
    <div className="page-warm-glow min-h-screen bg-paper">
      <nav className="border-b border-slate-200/80 bg-white/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center gap-3">
          <button type="button" onClick={() => goBack()}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-orange-50 hover:text-accent-warm"
            aria-label="返回上一页">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="font-display text-base font-semibold text-ink flex-1 truncate">
            选词填空{unitName ? ` · ${unitName}` : ''}
          </h1>
          <span className="font-numeric text-sm text-ink-mute">
            {phase === 'checked'
              ? <span className="text-accent-warm font-semibold">{correctCount}/{data.items.length} 对</span>
              : `${filledCount}/${data.items.length}`}
          </span>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-5 pb-24 pt-7 sm:pb-28">
        <p className="text-ink-soft text-sm mb-5">
          从下面的词库里挑词，填进每个句子的空格。每个词只用一次。
        </p>

        <ClozeBank bank={data.bank} usedIds={usedIds} onPick={handlePick}
          disabled={phase !== 'filling'} />

        <div className="space-y-3 mt-6">
          {data.items.map((item, i) => (
            <SentenceCard
              key={i}
              index={i}
              item={item}
              fillWord={wordOf(fills[i])}
              isActive={activeIndex === i && phase === 'filling'}
              phase={phase}
              correct={isItemCorrect(i)}
              onClick={() => handleBlankClick(i)}
            />
          ))}
        </div>
      </div>

      {/* 底部操作条 */}
      <div className="sticky bottom-0 z-10 border-t border-black/[0.06] bg-paper/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <AnimatePresence mode="wait">
            {phase === 'checked' ? (
              <motion.p key="result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="text-center text-sm font-semibold text-ink" role="status" aria-live="polite">
                {correctCount === data.items.length
                  ? '全对，太棒了！正在结算…'
                  : `答对 ${correctCount}/${data.items.length}，错的已进错题本，马上结算…`}
              </motion.p>
            ) : (
              <motion.button key="check" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                onClick={handleCheck} disabled={!allFilled}
                className={`min-h-12 w-full rounded-xl px-5 font-semibold transition ${
                  allFilled ? 'btn-glow text-white' : 'bg-black/[0.05] text-ink-mute cursor-not-allowed'}`}>
                {allFilled ? '提交答案' : `还差 ${data.items.length - filledCount} 个空`}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default FillBlankPractice;
