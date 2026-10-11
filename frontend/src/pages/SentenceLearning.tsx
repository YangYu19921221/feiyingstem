/**
 * 句子背诵(2026-10-11 重做,取代「英翻中选择 / 听句子默写」二选一的单遍版)。
 *
 * 单元按服务端切好的组走,每组: 听读 → 连词成句 → 开口背 → 默写 → 过关检测(80 分);
 * 最后一组过关后「跟读整篇」(整单元连着播,不打分)→ 总结。
 * - 错的句子放到本轮最后再来,一轮全对才进下一步(与分类学习同口径);每句只记首答
 * - 开口背不用语音识别、不自评,只判真的开口说够了长度
 * - 断点: 服务端记已过关几组,刷新/明天再来从下一组开始;组内进度不存(一组 6-8 分钟)
 * - 首答在每一步做完时上报(走可靠队列),过关检测通过再上报一次 group-pass
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import useNetActiveTime from '../hooks/useNetActiveTime';
import useIdleDetector from '../hooks/useIdleDetector';
import usePresence from '../hooks/usePresence';
import { usePreventCopy } from '../hooks/usePreventCopy';
import FocusReminder from '../components/FocusReminder';
import { parseError } from '../utils/errorMessage';
import { earnFood } from '../api/pet';
import { dispatchPetEvent } from '../utils/petEventBus';
import {
  getLearnUnit, submitSentenceGroupPass, submitSentenceRecords,
  type LearnSentence, type LearnUnit, type SentenceStage,
} from '../api/sentences';
import ListenStage from '../components/sentence/ListenStage';
import ArrangeStage from '../components/sentence/ArrangeStage';
import SpeakStage from '../components/sentence/SpeakStage';
import DictationStage from '../components/sentence/DictationStage';
import ExamStage from '../components/sentence/ExamStage';
import ReadAlongStage from '../components/sentence/ReadAlongStage';
import type { FirstResult } from '../components/sentence/useRoundQueue';
import { PrimaryButton, SecondaryButton, StepIntro } from '../components/sentence/ui';
import { PASS_SCORE, STEP_NAMES } from '../components/sentence/constants';
import MarkedText from '../components/sentence/MarkedText';

type Phase =
  | { kind: 'intro'; step: number }
  | { kind: 'listen' } | { kind: 'arrange' } | { kind: 'speak' } | { kind: 'dictation' } | { kind: 'exam' }
  | { kind: 'examResult'; score: number; wrong: FirstResult[] }
  | { kind: 'readAlong' }
  | { kind: 'summary' };

const STEP_DESC = [
  '句子会循环播放,跟着读。会读了点「会读了」,没把握就「再听听」。',
  '看中文、听录音,把打乱的词块按顺序点出来。',
  '只看中文,凭记忆把英文大声说出来,说完会放原句给你对照。',
  '看中文,把英文整句写出来。大小写和标点不用管,写错的词会标出来。',
  `每句一道题,题型不一样,每题只答一次。${PASS_SCORE} 分过关。`,
];

export default function SentenceLearning() {
  usePreventCopy();
  const goBack = useGoBack('/student/dashboard');
  const { unitId } = useParams<{ bookId: string; unitId: string }>();
  const uid = parseInt(unitId || '0', 10);

  const [data, setData] = useState<LearnUnit | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupIdx, setGroupIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'intro', step: 1 });
  // 每进一次过关检测 +1: 重测换一套题序,但同一次检测里重渲染不能重新出题
  const [examRun, setExamRun] = useState(0);
  const totals = useRef({ correct: 0, total: 0 });
  const [summaryStats, setSummaryStats] = useState({ correct: 0, total: 0 });

  const { idle, takeDelta } = useNetActiveTime();
  const isNudge = useIdleDetector(30_000);
  usePresence({
    unitName: data ? `句子·${data.book_name} ${data.unit_name}` : undefined,
    idle,
    enabled: !!data,
  });

  useEffect(() => {
    if (!uid) return;
    getLearnUnit(uid)
      .then(d => {
        setData(d);
        // 断点: 已全过的单元从第 1 组重来;否则从下一组开始
        setGroupIdx(d.groups_passed >= d.groups.length ? 0 : d.groups_passed);
      })
      .catch(e => setLoadError(parseError(e, '加载失败').message));
  }, [uid]);

  // 退出页面把没报的时长补上
  const takeRef = useRef(takeDelta);
  useEffect(() => { takeRef.current = takeDelta; }, [takeDelta]);
  useEffect(() => () => {
    const sec = takeRef.current();
    if (sec > 0 && uid) submitSentenceRecords({ unit_id: uid, answers: [], session_seconds: sec }).catch(() => {});
  }, [uid]);

  /** 返回上报的 Promise: 过关要等首答落库后再报(两条写同时到 SQLite 会撞写锁,实测 500 一次靠重试队列补上) */
  const report = useCallback((stage: SentenceStage, first: FirstResult[]): Promise<unknown> => {
    totals.current.correct += first.filter(r => r.isCorrect).length;
    totals.current.total += first.length;
    const sent = submitSentenceRecords({
      unit_id: uid,
      session_seconds: takeDelta(),
      answers: first.map(r => ({
        sentence_id: r.sentence.id, stage, is_correct: r.isCorrect,
        answer: r.isCorrect ? undefined : r.answer,
      })),
    }).catch(() => { /* 已进可靠队列,稍后自动补交 */ });
    const right = first.filter(r => r.isCorrect).length;
    if (right > 0) dispatchPetEvent('correct', { combo: right });
    return sent;
  }, [uid, takeDelta]);

  if (loadError) return <Shell title="句子背诵" onBack={goBack}><p className="py-20 text-center text-sm text-ink-mute">{loadError}</p></Shell>;
  if (!data) return <div className="flex min-h-screen items-center justify-center text-sm text-ink-mute">加载中…</div>;
  if (data.groups.length === 0) return <Shell title="句子背诵" onBack={goBack}><p className="py-20 text-center text-sm text-ink-mute">这个单元还没有句子</p></Shell>;

  const group: LearnSentence[] = data.groups[groupIdx] ?? [];
  const isLastGroup = groupIdx + 1 >= data.groups.length;
  const title = `${data.unit_name} · 第 ${groupIdx + 1}/${data.groups.length} 组`;

  const startStep = (step: number) => {
    const kinds = ['listen', 'arrange', 'speak', 'dictation', 'exam'] as const;
    if (step === 5) setExamRun(n => n + 1);
    setPhase({ kind: kinds[step - 1] });
  };

  const onExamDone = (score: number, first: FirstResult[]) => {
    const sent = report('exam', first);
    if (score >= PASS_SCORE) {
      void sent.finally(() => submitSentenceGroupPass(uid, groupIdx, score).catch(() => {}));
    }
    setPhase({ kind: 'examResult', score, wrong: first.filter(r => !r.isCorrect) });
  };

  const finishUnit = () => {
    const { correct, total } = totals.current;
    setSummaryStats({ correct, total });
    if (total > 0) {
      earnFood({ score: correct, total, mode: 'spelling' })
        .then(() => dispatchPetEvent('complete')).catch(() => {});
    }
    setPhase({ kind: 'summary' });
  };

  const body = (() => {
    switch (phase.kind) {
      case 'intro':
        return <StepIntro step={phase.step} title={STEP_NAMES[phase.step - 1]} desc={STEP_DESC[phase.step - 1]} onStart={() => startStep(phase.step)} />;
      case 'listen':
        return <ListenStage key={`l${groupIdx}`} items={group} onDone={() => setPhase({ kind: 'intro', step: 2 })} />;
      case 'arrange':
        return <ArrangeStage key={`a${groupIdx}`} items={group} onDone={first => { report('arrange', first); setPhase({ kind: 'intro', step: 3 }); }} />;
      case 'speak':
        return <SpeakStage key={`s${groupIdx}`} items={group} onDone={() => setPhase({ kind: 'intro', step: 4 })} />;
      case 'dictation':
        return <DictationStage key={`d${groupIdx}`} items={group} onDone={first => { report('dictation', first); setPhase({ kind: 'intro', step: 5 }); }} />;
      case 'exam':
        return <ExamStage key={`e${groupIdx}-${examRun}`} items={group} onDone={onExamDone} />;
      case 'examResult':
        return (
          <ExamResult
            score={phase.score}
            wrong={phase.wrong}
            isLastGroup={isLastGroup}
            onNext={() => {
              if (isLastGroup) setPhase({ kind: 'readAlong' });
              else { setGroupIdx(groupIdx + 1); setPhase({ kind: 'intro', step: 1 }); }
            }}
            onRetry={() => { setExamRun(n => n + 1); setPhase({ kind: 'exam' }); }}
            onRelearn={() => setPhase({ kind: 'intro', step: 1 })}
          />
        );
      case 'readAlong':
        return <ReadAlongStage sentences={data.groups.flat()} onDone={finishUnit} />;
      case 'summary': {
        const { correct, total } = summaryStats;
        return (
          <div className="py-12 text-center">
            <div className="text-5xl">🎉</div>
            <h2 className="mt-3 font-display text-2xl font-semibold text-ink">这个单元背完了</h2>
            <p className="mt-2 text-sm text-ink-soft">
              {data.groups.flat().length} 句 · 第一次就做对 {total > 0 ? Math.round((correct / total) * 100) : 0}%
            </p>
            <div className="mx-auto mt-8 grid max-w-xs gap-3">
              <PrimaryButton onClick={goBack}>换一个单元</PrimaryButton>
              <SecondaryButton onClick={() => { totals.current = { correct: 0, total: 0 }; setGroupIdx(0); setPhase({ kind: 'intro', step: 1 }); }}>
                <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-4 w-4" />从头再背一遍</span>
              </SecondaryButton>
            </div>
          </div>
        );
      }
    }
  })();

  return (
    <Shell title={phase.kind === 'readAlong' ? `${data.unit_name} · 跟读整篇` : phase.kind === 'summary' ? data.unit_name : title} onBack={goBack}>
      {!['readAlong', 'summary', 'examResult'].includes(phase.kind) && <StepDots phase={phase} />}
      {body}
      {phase.kind !== 'summary' && <FocusReminder nudge={isNudge} block={idle} />}
    </Shell>
  );
}

function StepDots({ phase }: { phase: Phase }) {
  const order = ['listen', 'arrange', 'speak', 'dictation', 'exam'];
  const cur = phase.kind === 'intro' ? phase.step - 1 : order.indexOf(phase.kind);
  return (
    <ol className="mb-6 flex items-center gap-1.5" aria-label="学习步骤">
      {STEP_NAMES.map((name, i) => (
        <li key={name} className="flex flex-1 flex-col items-center gap-1">
          <span className={`h-1.5 w-full rounded-full ${i < cur ? 'bg-accent-warm' : i === cur ? 'bg-accent-warm/60' : 'bg-black/[0.08]'}`} />
          <span className={`text-[11px] ${i === cur ? 'font-medium text-ink' : 'text-ink-mute'}`}>{name}</span>
        </li>
      ))}
    </ol>
  );
}

function ExamResult({ score, wrong, isLastGroup, onNext, onRetry, onRelearn }: {
  score: number; wrong: FirstResult[]; isLastGroup: boolean;
  onNext: () => void; onRetry: () => void; onRelearn: () => void;
}) {
  const passed = score >= PASS_SCORE;
  return (
    <div className="py-8 text-center">
      <div className="text-5xl">{passed ? (score === 100 ? '🏆' : '🎉') : '💪'}</div>
      <p className={`mt-3 font-display text-4xl font-bold ${passed ? 'text-accent-warm' : 'text-ink'}`}>{score} 分</p>
      <p className="mt-1 text-sm text-ink-soft">{passed ? '过关了' : `还差一点,${PASS_SCORE} 分过关`}</p>
      {wrong.length > 0 && (
        <div className="mx-auto mt-6 max-w-md rounded-xl bg-black/[0.03] p-4 text-left">
          <p className="text-xs text-ink-mute">这几句再记一记</p>
          <ul className="mt-2 space-y-2">
            {wrong.map(r => (
              <li key={r.sentence.id} className="text-sm">
                <span className="text-ink"><MarkedText text={r.sentence.english} marked={r.sentence.marked} /></span>
                <span className="ml-2 text-ink-mute">{r.sentence.chinese}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mx-auto mt-8 grid max-w-xs gap-3">
        {passed ? (
          <PrimaryButton onClick={onNext}>{isLastGroup ? '最后一步:跟读整篇' : '下一组'}</PrimaryButton>
        ) : (
          <>
            <PrimaryButton onClick={onRetry}>再测一次</PrimaryButton>
            <SecondaryButton onClick={onRelearn}>这一组从头学</SecondaryButton>
          </>
        )}
      </div>
    </div>
  );
}

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <nav className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3.5">
          <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-2 text-sm text-ink-soft hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> 返回
          </button>
          <h1 className="truncate px-2 font-display text-base font-semibold text-ink">{title}</h1>
          <div className="w-12" />
        </div>
      </nav>
      <div className="mx-auto max-w-2xl px-5 py-6">{children}</div>
    </div>
  );
}
