/**
 * 独立句子填空练习页面
 * 加载单元全部单词，使用 SentenceFillPhase 组件
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import useGoBack from '../hooks/useGoBack';
import { ArrowLeft, CheckCircle2, FilePenLine, RefreshCw } from 'lucide-react';
import { startLearning, updateProgress } from '../api/progress';
import type { StartLearningResponse } from '../api/progress';
import { reportStudyTime } from '../api/learningRecords';
import useIdleDetector from '../hooks/useIdleDetector';
import { usePreventCopy } from '../hooks/usePreventCopy';
import SentenceFillPhase, { type FillBlankResult } from '../components/classify/SentenceFillPhase';
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

  // ── 学习时长上报:独立句子填空页此前不计时,按净活动时长计入学习日历 ──
  const isIdle = useIdleDetector();
  const startTimeRef = useRef(Date.now());
  const idleStartRef = useRef(0);
  useEffect(() => {
    if (isIdle) {
      idleStartRef.current = Date.now();
    } else if (idleStartRef.current > 0) {
      startTimeRef.current += Date.now() - idleStartRef.current; // 挂机时段不计入
      idleStartRef.current = 0;
    }
  }, [isIdle]);
  const lastReportedSecRef = useRef(0);
  const reportDelta = useCallback(() => {
    let start = startTimeRef.current;
    if (idleStartRef.current > 0) start += Date.now() - idleStartRef.current;
    const net = Math.round((Date.now() - start) / 1000);
    const delta = net - lastReportedSecRef.current;
    lastReportedSecRef.current = net;
    if (delta > 0) reportStudyTime(delta).catch(() => {});
  }, []);
  useEffect(() => { if (completed) reportDelta(); }, [completed, reportDelta]);
  useEffect(() => () => reportDelta(), [reportDelta]);

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

  const handleComplete = async (fillResults: FillBlankResult[]) => {
    setResults(fillResults);
    setCompleted(true);

    if (unitId) {
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
            words={learningData.words}
            onComplete={handleComplete}
            playAudio={(text) => playAudio(text)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center sm:p-8">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
              </div>
              <h3 className="font-display text-2xl font-semibold text-ink">句子填空完成</h3>
              <div className={`mb-2 mt-3 font-numeric text-4xl font-bold ${accuracy >= 80 ? 'text-green-600' : 'text-accent-warm'}`}>
                {accuracy}%
              </div>
              <p className="text-gray-500 mb-6">答对 {correctCount}/{totalCount} 个单词</p>

              {(() => {
                const wrongResults = results.filter(r => !r.isCorrect);
                return wrongResults.length > 0 && (
                <div className="text-left mb-6 max-h-48 overflow-y-auto">
                  <p className="text-sm font-medium text-gray-600 mb-2">错词回顾：</p>
                  {wrongResults.map(r => (
                    <div key={r.wordId} className="flex items-center gap-2 py-1.5 border-b border-gray-100 text-sm">
                      <span className="text-red-400">✗</span>
                      <span className="font-medium">{r.word}</span>
                    </div>
                  ))}
                </div>
                );
              })()}

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => {
                    setCompleted(false);
                    setResults([]);
                    void loadLearningData();
                  }}
                  className="min-h-12 w-full rounded-xl bg-accent-warm font-bold text-white transition hover:opacity-90"
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
