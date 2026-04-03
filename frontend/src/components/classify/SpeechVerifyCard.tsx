/**
 * 语音校验卡片 - 使用 Whisper 本地语音识别
 * 显示英文单词 → 自动录音3秒 → 发送后端 Whisper 识别 → 对了立马过，错了播放正确发音后自动重录
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordData } from '../../api/progress';
import { verifyWordPronunciation } from '../../api/pronunciation';
import ColoredWord from '../ColoredWord';
import ColoredPhonetic from '../ColoredPhonetic';

interface SpeechVerifyCardProps {
  word: WordData;
  onNext: () => void;
  onSkip?: () => void;
  playAudio: (word: string) => void;
}

type VerifyPhase = 'recording' | 'evaluating' | 'success' | 'error' | 'mic-error';

const RECORD_MAX_DURATION = 3000; // 最长录音 3 秒
const VAD_SILENCE_THRESHOLD = 0.01; // 静音能量阈值
const VAD_SILENCE_DURATION = 600; // 静音持续 600ms 则自动停止

export default function SpeechVerifyCard({
  word,
  onNext,
  onSkip,
  playAudio,
}: SpeechVerifyCardProps) {
  const [phase, setPhase] = useState<VerifyPhase>('recording');
  const [transcript, setTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const mountedRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startRecordingRef = useRef<() => void>(() => {});
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (vadTimerRef.current) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (recorderRef.current?.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    recorderRef.current = null;
  }, []);

  // 开始录音 → 自动停止 → 送 Whisper 识别
  const startRecording = useCallback(async () => {
    if (!mountedRef.current) return;
    cleanup();
    chunksRef.current = [];
    setPhase('recording');
    setErrorMsg('');
    setTranscript('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      // VAD: 用 AnalyserNode 实时检测音量，说完自动停录
      let hadSpeech = false;
      let silenceStart = 0;
      try {
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        analyserRef.current = analyser;
        const dataArr = new Float32Array(analyser.fftSize);

        vadTimerRef.current = setInterval(() => {
          if (!analyserRef.current || recorderRef.current?.state !== 'recording') return;
          analyserRef.current.getFloatTimeDomainData(dataArr);
          // RMS 能量
          let sum = 0;
          for (let i = 0; i < dataArr.length; i++) sum += dataArr[i] * dataArr[i];
          const rms = Math.sqrt(sum / dataArr.length);

          if (rms > VAD_SILENCE_THRESHOLD) {
            hadSpeech = true;
            silenceStart = 0;
          } else if (hadSpeech) {
            if (silenceStart === 0) {
              silenceStart = Date.now();
            } else if (Date.now() - silenceStart >= VAD_SILENCE_DURATION) {
              // 说完了，自动停录
              if (recorderRef.current?.state === 'recording') {
                recorderRef.current.stop();
              }
            }
          }
        }, 50);
      } catch {
        // AudioContext 不可用时忽略 VAD，靠超时兜底
      }

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (!mountedRef.current || chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        // 前端噪音检测：录音文件太小说明没有有效语音
        if (blob.size < 3000) {
          if (!mountedRef.current) return;
          setTranscript('');
          setErrorMsg('未检测到语音，请靠近麦克风重新朗读');
          setPhase('error');
          timerRef.current = setTimeout(() => {
            if (mountedRef.current) startRecordingRef.current();
          }, 1500);
          return;
        }

        // 送 Whisper 识别
        setPhase('evaluating');
        try {
          const result = await verifyWordPronunciation(blob, word.word);
          if (!mountedRef.current) return;

          setTranscript(result.transcript);

          if (result.matched) {
            // 对了 → 立马过
            setPhase('success');
            onNext();
          } else {
            // 错了 → 播放正确发音 → 自动重录
            setPhase('error');
            playAudio(word.word);
            timerRef.current = setTimeout(() => {
              if (mountedRef.current) startRecordingRef.current();
            }, 1500);
          }
        } catch (err) {
          if (!mountedRef.current) return;
          setErrorMsg(err instanceof Error ? err.message : '识别失败');
          setPhase('error');
          timerRef.current = setTimeout(() => {
            if (mountedRef.current) startRecordingRef.current();
          }, 1500);
        }
      };

      recorderRef.current = recorder;
      recorder.start(100);

      // 最长 3 秒兜底停止（VAD 会更早停）
      timerRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
        }
      }, RECORD_MAX_DURATION);
    } catch (err) {
      if (!mountedRef.current) return;
      setPhase('mic-error');
      setErrorMsg(
        (err instanceof DOMException && err.name === 'NotAllowedError')
          ? '请允许麦克风权限'
          : '无法访问麦克风',
      );
    }
  }, [word.word, onNext, playAudio, cleanup]);

  // 保持 ref 最新
  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  // 切换单词时自动开始
  useEffect(() => {
    mountedRef.current = true;
    const t = setTimeout(() => startRecordingRef.current(), 400);
    return () => {
      mountedRef.current = false;
      clearTimeout(t);
      cleanup();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word.id]);

  // 麦克风不可用
  if (phase === 'mic-error') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
      >
        <div className="mb-3">
          <ColoredWord word={word.word} syllables={word.syllables} className="text-5xl font-bold" />
        </div>
        {word.phonetic && (
          <div className="mb-4 flex justify-center">
            <ColoredPhonetic phonetic={word.phonetic} size="sm" />
          </div>
        )}
        <p className="text-red-400 text-sm mb-4">{errorMsg}</p>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onNext}
          className="px-8 py-3 rounded-2xl bg-primary text-white font-medium cursor-pointer"
        >
          跳过 →
        </motion.button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
    >
      {/* 单词（彩色音节） */}
      <div className="mb-3">
        <ColoredWord word={word.word} syllables={word.syllables} className="text-5xl font-bold" />
      </div>

      {/* 音标（彩色） */}
      {word.phonetic && (
        <div className="mb-3 flex justify-center">
          <ColoredPhonetic phonetic={word.phonetic} size="sm" />
        </div>
      )}

      {/* 释义 */}
      {word.meaning && (
        <p className="text-gray-500 mb-6">
          {word.part_of_speech && (
            <span className="text-sm text-gray-400 mr-1">{word.part_of_speech}</span>
          )}
          {word.meaning}
        </p>
      )}

      <AnimatePresence mode="wait">
        {/* 正在录音 */}
        {phase === 'recording' && (
          <motion.div
            key="recording"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mb-6"
          >
            {/* 麦克风 + 脉冲波纹 + 倒计时环 */}
            <div className="relative w-28 h-28 mx-auto mb-4">
              {/* 扩散脉冲波纹 */}
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="absolute inset-0 rounded-full border-2 border-red-400"
                  initial={{ scale: 0.6, opacity: 0.6 }}
                  animate={{ scale: 1.6, opacity: 0 }}
                  transition={{
                    repeat: Infinity,
                    duration: 2,
                    delay: i * 0.6,
                    ease: 'easeOut',
                  }}
                />
              ))}

              {/* 倒计时环 */}
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" fill="none" stroke="#FEE2E2" strokeWidth="4" />
                <motion.circle
                  cx="50" cy="50" r="44"
                  fill="none" stroke="#EF4444" strokeWidth="4" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 44}
                  initial={{ strokeDashoffset: 0 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 44 }}
                  transition={{ duration: RECORD_MAX_DURATION / 1000, ease: 'linear' }}
                />
              </svg>

              {/* 中心麦克风 */}
              <motion.div
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ repeat: Infinity, duration: 0.8, ease: 'easeInOut' }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-300">
                  <span className="text-3xl">🎙️</span>
                </div>
              </motion.div>
            </div>

            {/* 双侧声波柱 */}
            <div className="flex items-center justify-center gap-[3px] mb-4 h-8">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
                const heights = i < 4
                  ? [6, 12 + i * 5, 6]              // 左侧渐高
                  : i === 4
                  ? [10, 28, 10]                      // 中间最高
                  : [6, 12 + (8 - i) * 5, 6];        // 右侧对称
                return (
                  <motion.div
                    key={i}
                    animate={{ height: heights }}
                    transition={{
                      repeat: Infinity,
                      duration: 0.6 + Math.random() * 0.4,
                      delay: i * 0.06,
                      ease: 'easeInOut',
                    }}
                    className="w-1.5 rounded-full bg-gradient-to-t from-red-500 to-orange-400"
                  />
                );
              })}
            </div>

            <p className="text-gray-700 font-semibold">请朗读这个单词</p>
            <p className="text-xs text-gray-400 mt-1">录音将自动完成</p>
          </motion.div>
        )}

        {/* 识别中 - 声波分析动画 */}
        {phase === 'evaluating' && (
          <motion.div
            key="evaluating"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mb-6"
          >
            <div className="flex items-center justify-center gap-1.5 mb-4 h-12">
              {[0, 1, 2, 3, 4, 5, 6].map(i => (
                <motion.div
                  key={i}
                  animate={{
                    height: [6, 28, 14, 32, 8],
                    backgroundColor: ['#FF6B35', '#FFD23F', '#00D9FF', '#FFD23F', '#FF6B35'],
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 1.2,
                    delay: i * 0.1,
                    ease: 'easeInOut',
                  }}
                  className="w-2 rounded-full"
                />
              ))}
            </div>
            <p className="text-gray-600 font-medium">正在分析发音...</p>
            <motion.div
              className="mt-2 flex justify-center gap-1"
              initial={{ opacity: 0.5 }}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
            >
              {['🔍', '🧠', '✨'].map((emoji, i) => (
                <motion.span
                  key={i}
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.2 }}
                  className="text-lg"
                >
                  {emoji}
                </motion.span>
              ))}
            </motion.div>
          </motion.div>
        )}

        {/* 通过 */}
        {phase === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mb-6"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.3, 1] }}
              transition={{ duration: 0.4 }}
              className="text-6xl mb-3"
            >
              ✅
            </motion.div>
            <p className="text-green-600 font-bold text-lg">发音正确！</p>
          </motion.div>
        )}

        {/* 未通过 - 播放正确发音后自动重录 */}
        {phase === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mb-6"
          >
            {transcript ? (
              <p className="text-orange-500 text-sm mb-2">
                听到: "<span className="font-medium">{transcript}</span>"
              </p>
            ) : (
              <p className="text-gray-400 text-sm mb-2">未识别到语音</p>
            )}
            <p className="text-red-500 font-bold text-xl mb-2">❌ 再读一遍！</p>
            {errorMsg && (
              <p className="text-gray-400 text-xs mb-2">{errorMsg}</p>
            )}
            <p className="text-gray-500 text-sm">🔊 听正确发音，马上重新录音...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 跳过按钮 - 录音/识别/错误阶段都显示 */}
      {onSkip && phase !== 'success' && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => { cleanup(); onSkip(); }}
          className="mt-4 px-6 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 text-sm font-medium transition"
        >
          跳过（标记为未掌握）
        </motion.button>
      )}
    </motion.div>
  );
}
