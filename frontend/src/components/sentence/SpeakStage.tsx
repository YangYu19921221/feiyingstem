/**
 * 第 3 步 开口背: 看中文,凭记忆把英文说出来。
 *
 * 不用语音识别、不自评(用户 10-11 定): 只判「真的开口了、说够了长度」(useSpeechRecorder 的 VAD),
 * 说完播一遍原声给孩子对照,然后下一句。不打分、不上报掌握度 —— 记对错的是后面的默写和过关检测。
 * 对话行: 系统先说上一句(问句),孩子说这一句(答句)。
 * 录不了音(没麦克风/权限被拒/http 打开)时不卡人: 写明原因,改成「心里默念一遍」后继续。
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, Volume2 } from 'lucide-react';
import type { LearnSentence } from '../../api/sentences';
import { useAudio } from '../../hooks/useAudio';
import { getRecorderBlocker, useSpeechRecorder } from '../../hooks/useSpeechRecorder';
import useAccidentalTapGuard from '../../hooks/useAccidentalTapGuard';
import { minSpeechMs, stripDialogueDash } from '../../utils/sentenceCheck';
import { StageHeader, PrimaryButton, SecondaryButton } from './ui';

type Phase = 'ready' | 'recording' | 'tooShort' | 'heard';

export default function SpeakStage({ items, onDone }: { items: LearnSentence[]; onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const cur = items[idx];
  const { playAudio, stopAudio } = useAudio();
  const { markShown, isAccidentalTap } = useAccidentalTapGuard();
  // 上限按句长给(长句 5 秒不够),VAD 说完 600ms 静音自动停
  const rec = useSpeechRecorder(cur ? Math.max(5000, minSpeechMs(cur.english) * 3) : 5000);
  const [phase, setPhase] = useState<Phase>('ready');
  const blocker = useMemo(() => getRecorderBlocker(), []);
  const micBroken = !!blocker || !!rec.error;

  const prev = useMemo(() => {
    if (!cur?.is_dialogue) return null;
    return idx > 0 && items[idx - 1].is_dialogue ? items[idx - 1] : null;
  }, [cur, idx, items]);

  // 换句时回到「准备」: 在点「下一句」的同一个事件里改,不放进 effect(effect 里同步 setState 会多渲染一轮)
  useEffect(() => {
    if (!cur) return;
    markShown();
    // 对话: 先把问句说给孩子听
    if (prev) { const t = setTimeout(() => playAudio(prev.tts_text || stripDialogueDash(prev.english)), 300); return () => clearTimeout(t); }
  }, [cur, prev, playAudio, markShown]);

  // 只在离开这一步时停录音。⚠️ 依赖不能写 rec(整个对象每次渲染都是新的):那样一开录、
  // 音量条一刷新就触发清理 → 立刻 stop → 每次都判「没听清」(浏览器实测复现过)
  const stopRec = rec.stop;
  useEffect(() => () => { stopRec(); stopAudio(); }, [stopRec, stopAudio]);
  if (!cur) return null;

  const playOriginal = () => playAudio(cur.tts_text || stripDialogueDash(cur.english));

  const start = async () => {
    if (isAccidentalTap()) return;
    stopAudio();   // 先掐掉正在放的问句,不然麦克风把它收进去
    setPhase('recording');
    const r = await rec.record();
    if (!r) { setPhase('ready'); return; }               // 录音失败,rec.error 会显示原因
    if (r.hadSpeech && r.speechMs >= minSpeechMs(cur.english)) {
      setPhase('heard');
      setTimeout(playOriginal, 200);                     // 说完放原声对照
    } else {
      setPhase('tooShort');
    }
  };

  const next = () => {
    if (isAccidentalTap()) return;
    stopAudio();
    if (idx + 1 >= items.length) onDone(); else { setPhase('ready'); setIdx(idx + 1); }
  };

  return (
    <motion.div key={cur.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <StageHeader step={3} title="开口背" hint={prev ? '听老师问,你来回答' : '看中文,把英文大声说出来'} pos={idx} total={items.length} />
      <div className="rounded-2xl border border-black/[0.05] bg-white p-6">
        {prev && (
          <button type="button" onClick={() => playAudio(prev.tts_text || stripDialogueDash(prev.english))}
            className="mb-4 flex w-full items-center gap-2 rounded-lg bg-black/[0.03] px-3 py-2 text-left text-sm text-ink-soft">
            <Volume2 className="h-4 w-4 shrink-0 text-accent-warm" />
            <span>{stripDialogueDash(prev.english)}</span>
          </button>
        )}
        <p className="text-xl text-ink">{cur.chinese}</p>
        {phase === 'heard' ? (
          <div className="mt-4 rounded-xl bg-green-50 px-4 py-3">
            <p className="text-xs text-green-700">原句,听听和你说的一样吗</p>
            <p className="mt-1 font-display text-xl text-green-900">{stripDialogueDash(cur.english)}</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-mute">英文先藏起来了,凭记忆说</p>
        )}
        {phase === 'recording' && (
          <div className="mt-4 flex items-center gap-3 text-sm text-accent-warm">
            <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-warm opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-accent-warm" /></span>
            在听你说…
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.06]"><span className="block h-full bg-accent-warm transition-all" style={{ width: `${rec.level * 100}%` }} /></span>
          </div>
        )}
        {phase === 'tooShort' && <p className="mt-4 text-sm text-amber-700">没听清,声音大一点,把整句说完</p>}
        {micBroken && (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {blocker || rec.error}。这一步先在心里默念一遍,再往下。
          </p>
        )}
      </div>
      <div className="mt-5 grid gap-3">
        {phase === 'heard' || micBroken ? (
          <>
            {micBroken && phase !== 'heard' && <SecondaryButton onClick={playOriginal}>听原句</SecondaryButton>}
            <PrimaryButton onClick={next}>{idx + 1 >= items.length ? '这一步完成' : '下一句'}</PrimaryButton>
          </>
        ) : phase === 'recording' ? (
          <SecondaryButton onClick={() => rec.stop()}>说完了</SecondaryButton>
        ) : (
          <PrimaryButton onClick={start}>
            <span className="inline-flex items-center gap-2"><Mic className="h-5 w-5" />{phase === 'tooShort' ? '再说一次' : '按一下,开始说'}</span>
          </PrimaryButton>
        )}
      </div>
    </motion.div>
  );
}
