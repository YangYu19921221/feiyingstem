/**
 * 独立句子填空练习页面
 * 加载单元全部单词，使用 SentenceFillPhase 组件
 *
 * 2026-10-23 起每个词第一轮的第一次作答记学习记录(learning_mode='sentencefill',此前一条都不记):
 * 错的进错题本和记忆曲线,老师学情/陪跑看板/今日学习报告都看得到。重试、后面的轮次、
 * 结束页「错的再练一遍」都不记 —— 看过答案再写对不算会了。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import useGoBack from '../hooks/useGoBack';
import { ArrowLeft, CheckCircle2, FilePenLine, RefreshCw } from 'lucide-react';
import { startLearning, updateProgress } from '../api/progress';
import type { StartLearningResponse } from '../api/progress';
import { createLearningRecords, reportStudyTime } from '../api/learningRecords';
import useNetActiveTime from '../hooks/useNetActiveTime';
import { usePreventCopy } from '../hooks/usePreventCopy';
import SentenceFillPhase, { type FillBlankResult, type FirstAnswer } from '../components/classify/SentenceFillPhase';
import type { WordData } from '../api/progress';
import { useAudio } from '../hooks/useAudio';
import { getErrorMessage } from '../utils/errorMessage';

export default function SentenceFillPractice() {
  usePreventCopy();  // 防划走答案:禁右键/复制/选中(输入框内放行)
  const { unitId } = useParams<{ unitId: string }>();
  const goBack = useGoBack('/student/dashboard');
  const { playAudio } = useAudio();

  const [learningData, setLearningData] = useState<StartLearningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const [results, setResults] = useState<FillBlankResult[]>([]);
  // 结束页「错的再练一遍」: 只练这几个词,不记学习记录、不改单元进度
  const [redoWords, setRedoWords] = useState<WordData[] | null>(null);
  const [runKey, setRunKey] = useState(0);

  // ── 学习时长上报:独立句子填空页按净活动时长计入学习日历 ──
  // 计时口径统一在 useNetActiveTime(发呆/切屏整段不计,含判定前的 60 秒)
  const { takeDelta } = useNetActiveTime();
  const reportDelta = useCallback(() => {
    const delta = takeDelta();
    if (delta > 0) reportStudyTime(delta).catch(() => {});
  }, [takeDelta]);
  useEffect(() => { if (completed) reportDelta(); }, [completed, reportDelta]);
  const reportRef = useRef(reportDelta);
  reportRef.current = reportDelta;
  useEffect(() => () => reportRef.current(), []);

  const loadLearningData = useCallback(async () => {
    if (!unitId) return;
    try {
      setLoading(true);
      setError('');
      const data = await startLearning({ unit_id: parseInt(unitId), learning_mode: 'sentencefill' });
      setLearningData(data);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, '句子填空暂时没有加载出来'));
    } finally {
      setLoading(false);
    }
  }, [unitId]);

  useEffect(() => {
    void loadLearningData();
  }, [loadLearningData]);

  // 首答即记(与拼写/选择同口径): 时长按净活动增量走 session_seconds,结束时剩下的那段由 reportDelta 补
  const handleFirstAnswer = useCallback((a: FirstAnswer) => {
    if (!unitId) return;
    const delta = takeDelta();
    createLearningRecords({
      unit_id: parseInt(unitId),
      learning_mode: 'sentencefill',
      records: [{
        word_id: a.wordId,
        is_correct: a.isCorrect,
        time_spent: delta * 1000,
        learning_mode: 'sentencefill',
        user_answer: !a.isCorrect && a.userAnswer ? a.userAnswer : undefined,
      }],
      session_seconds: delta,
    }).catch(() => {});
  }, [unitId, takeDelta]);

  const handleComplete = async (fillResults: FillBlankResult[]) => {
    setResults(fillResults);
    setCompleted(true);

    // 一道题都没出(单元里没有能挖空的例句): 不记完成 —— 以前直接记「已完成」,
    // 孩子以为做完了、单元进度被顶到 100%,线上 261 条填句进度里 168 条是这么来的
    if (fillResults.length === 0) return;

    if (unitId && !redoWords) {
      try {
        await updateProgress({
          unit_id: parseInt(unitId),
          learning_mode: 'sentencefill',
          current_word_index: (learningData?.words.length || 1) - 1,
          is_completed: true,
        });
      } catch (updateError) {
        console.error('句子填空进度保存失败:', updateError);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper p-4 no-select" aria-busy="true" aria-label="正在加载句子填空">
        <div className="mx-auto mt-20 max-w-lg rounded-2xl bg-white p-6 sm:p-8">
          <div className="mx-auto mb-6 h-5 w-32 animate-pulse rounded bg-slate-100" />
          <div className="mb-7 h-1.5 animate-pulse rounded-full bg-slate-100" />
          <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error || !learningData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4 no-select">
        <div className="card-soft w-full max-w-md rounded-2xl p-7 text-center sm:p-9" role="alert">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
            <RefreshCw className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">这组句子暂时没打开</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{error || '请稍后重试'}</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => goBack()}
              className="min-h-11 rounded-xl border border-black/10 px-5 text-sm font-semibold text-ink transition hover:bg-black/[0.04]"
            >
              返回单元
            </button>
            <button
              type="button"
              onClick={() => void loadLearningData()}
              className="min-h-11 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 单元里没有能挖空的例句: 说清楚原因,引导去别的练法
  if (completed && results.length === 0 && !redoWords) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4 no-select">
        <div className="card-soft w-full max-w-md rounded-2xl p-7 text-center sm:p-9" role="status">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
            <FilePenLine className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">这个单元还没有例句</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            句子填空要用单词的例句来出题，这个单元的单词还没有例句。先去练听写或测试吧。
          </p>
          <button
            type="button"
            onClick={() => goBack()}
            className="mt-6 min-h-11 w-full rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            返回单元
          </button>
        </div>
      </div>
    );
  }

  const correctCount = results.filter(r => r.isCorrect).length;
  const totalCount = results.length;
  const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-paper no-select">
      <nav className="bg-white/95 border-b border-slate-200/80 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            type="button"
            onClick={() => goBack()}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-orange-50 hover:text-accent-warm"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
              <FilePenLine className="h-4 w-4 text-accent-warm" aria-hidden="true" />
              句子填空
            </h1>
            <p className="text-xs text-gray-500">{learningData.unit_info.name} · {learningData.words.length} 个单词</p>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto">
        {!completed ? (
          <SentenceFillPhase
            key={runKey}
            words={redoWords ?? learningData.words}
            onComplete={handleComplete}
            onFirstAnswer={redoWords ? undefined : handleFirstAnswer}
            playAudio={(text, rate, wordId) => playAudio(text, rate, wordId)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center sm:p-8">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
              </div>
              <h3 className="font-display text-2xl font-semibold text-ink">{redoWords ? '错词再练完成' : '句子填空完成'}</h3>
              <div className={`mb-2 mt-3 font-numeric text-4xl font-bold ${accuracy >= 80 ? 'text-green-600' : 'text-accent-warm'}`}>
                {accuracy}%
              </div>
              <p className="text-gray-500 mb-6">第一次就写对 {correctCount}/{totalCount} 个</p>

              {(() => {
                const wrongResults = results.filter(r => !r.isCorrect);
                return wrongResults.length > 0 && (
                <div className="text-left mb-6 max-h-64 overflow-y-auto">
                  <p className="text-sm font-medium text-gray-600 mb-2">要再练的 {wrongResults.length} 个：</p>
                  {wrongResults.map(r => (
                    <div key={r.wordId} className="border-b border-gray-100 py-2 text-sm">
                      <p className="leading-6 text-gray-700">
                        {r.sentence && r.expected && r.sentence.includes(r.expected) ? (
                          <>
                            {r.sentence.slice(0, r.sentence.indexOf(r.expected))}
                            <strong className="text-green-700">{r.expected}</strong>
                            {r.sentence.slice(r.sentence.indexOf(r.expected) + r.expected.length)}
                          </>
                        ) : <strong>{r.word}</strong>}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {r.userInput ? <>你写的 <span className="font-mono text-red-400 line-through">{r.userInput}</span></> : '当时点了看答案'}
                      </p>
                    </div>
                  ))}
                </div>
                );
              })()}

              <div className="flex flex-col gap-3">
                {results.some(r => !r.isCorrect) && (
                  <button
                    onClick={() => {
                      const wrongIds = new Set(results.filter(r => !r.isCorrect).map(r => r.wordId));
                      setRedoWords(learningData.words.filter(w => wrongIds.has(w.id)));
                      setResults([]);
                      setCompleted(false);
                      setRunKey(k => k + 1);
                    }}
                    className="min-h-12 w-full rounded-xl bg-accent-warm font-bold text-white transition hover:opacity-90"
                  >
                    错的再练一遍
                  </button>
                )}
                <button
                  onClick={() => {
                    setCompleted(false);
                    setResults([]);
                    setRedoWords(null);
                    setRunKey(k => k + 1);
                    void loadLearningData();
                  }}
                  className={results.some(r => !r.isCorrect)
                    ? 'min-h-12 w-full rounded-xl border border-accent-warm/40 bg-white font-bold text-accent-warm transition hover:bg-orange-50'
                    : 'min-h-12 w-full rounded-xl bg-accent-warm font-bold text-white transition hover:opacity-90'}
                >
                  再来一次
                </button>
                <button
                  onClick={() => goBack()}
                  className="min-h-12 w-full rounded-xl bg-gray-100 font-medium text-gray-600 transition hover:bg-gray-200"
                >
                  返回
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
