/**
 * 带 VAD 的录音 hook —— 说完自动停,并回报「到底有没有在说话」
 *
 * 逻辑与阈值抄自 components/classify/SpeechVerifyCard.tsx(生产跑过 2289 次录音,
 * 98.9% 成功),这里抽出来共用,不重新发明。
 *
 * `hadSpeech` 是这个 hook 的关键产出:它让「读完了」成为一个**准确**的判定 ——
 * 有足够音量、够长时间就是真的读了。这比用 ASR 判「读对没读对」可靠得多:
 * 实测 whisper 把标准音 fee 听成 See、cab 听成 Cap,拿它变色会误判读对的孩子。
 */
import { useCallback, useRef, useState } from 'react';

const VAD_SILENCE_THRESHOLD = 0.01;   // 静音能量阈值(RMS)
const VAD_SILENCE_DURATION = 600;     // 静音持续多久算说完
const MIN_SPEECH_MS = 250;            // 短于这个当噪音,不算说话

/**
 * 容器格式按支持度依次探测。
 * ⚠️ 不能只认 webm:iOS Safari 直到 18.4 才支持,更早只出 audio/mp4。
 * 生产日志证实:录音成功的 iOS 全部 ≥18.7,而今日仍有 iOS 13 用户在访问 ——
 * 那批人在只认 webm 的代码下**根本录不了音**。
 */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus', 'audio/webm',
  'audio/mp4;codecs=mp4a.40.2', 'audio/mp4',
];

const pickMime = (): string | null =>
  typeof MediaRecorder === 'undefined'
    ? null
    : MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) ?? null;

/** 录音是否可用。不可用时把真因说清楚,别让家长去翻权限设置 */
export function getRecorderBlocker(): string | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    // 生产有个 http://IP:3000 入口,那里 mediaDevices 是 undefined —— 浏览器安全策略
    return '这个网址不是 https,浏览器不允许录音,请用 https 打开';
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return '这个浏览器不支持录音,建议换 Chrome 或升级系统';
  }
  if (!pickMime()) return '这个浏览器的录音格式不被支持,建议升级系统或换 Chrome';
  return null;
}

export interface SpeechResult {
  blob: Blob;
  /** 真的检测到人声(而不是一段静音) */
  hadSpeech: boolean;
  /** 有人声的累计时长,毫秒 */
  speechMs: number;
}

export function useSpeechRecorder(maxMs = 5000) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);          // 0~1,给波形/音量条用

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const vadRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef<((r: SpeechResult) => void) | null>(null);
  const speechMsRef = useRef(0);

  const cleanup = useCallback(() => {
    if (vadRef.current) { clearInterval(vadRef.current); vadRef.current = null; }
    if (maxRef.current) { clearTimeout(maxRef.current); maxRef.current = null; }
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    recRef.current?.stream.getTracks().forEach(t => t.stop());
    recRef.current = null;
    setLevel(0);
  }, []);

  /** 开始录音,返回一个 Promise —— 说完(VAD)或到上限时 resolve */
  const record = useCallback((): Promise<SpeechResult | null> => {
    const blocked = getRecorderBlocker();
    if (blocked) { setError(blocked); return Promise.resolve(null); }

    return new Promise(async resolve => {
      try {
        setError(null);
        chunksRef.current = [];
        speechMsRef.current = 0;

        // ⚠️ 必须开回声消除:孩子的用法是「先听标准音、紧接着跟读」,
        // 不开的话扬声器放出的标准音会被麦克风收回去,录到的是
        // 「标准音 + 自己的声音」两遍叠在一起。2026-09-03 实测 19 条真实
        // 跟读录音**全部**是双份的(whisper 听成 "beta beta"、"Baydah! Baydah!",
        // 音素层是 pei5tə1pei5tə1),判定拿这种音去比单个词必然对不上 ——
        // 这是「读对了也判不出」的直接原因之一。
        // 手机外放时尤其明显;戴耳机的孩子不受影响,所以问题一直没被发现。
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        const mime = pickMime()!;
        const rec = new MediaRecorder(stream, { mimeType: mime });
        recRef.current = rec;
        doneRef.current = resolve as (r: SpeechResult) => void;

        let hadSpeech = false;
        let silenceStart = 0;

        try {
          const ctx = new AudioContext();
          ctxRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          ctx.createMediaStreamSource(stream).connect(analyser);
          const buf = new Float32Array(analyser.fftSize);

          vadRef.current = setInterval(() => {
            if (recRef.current?.state !== 'recording') return;
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            const rms = Math.sqrt(sum / buf.length);
            setLevel(Math.min(1, rms * 12));

            if (rms > VAD_SILENCE_THRESHOLD) {
              hadSpeech = true;
              speechMsRef.current += 50;
              silenceStart = 0;
            } else if (hadSpeech) {
              if (!silenceStart) silenceStart = Date.now();
              else if (Date.now() - silenceStart >= VAD_SILENCE_DURATION) {
                rec.state === 'recording' && rec.stop();
              }
            }
          }, 50);
        } catch {
          // AudioContext 不可用就没有 VAD,靠 maxMs 兜底;hadSpeech 保守按 true
          hadSpeech = true;
        }

        rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        rec.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime });
          setIsRecording(false);
          const speechMs = speechMsRef.current;
          cleanup();
          doneRef.current?.({
            blob,
            hadSpeech: hadSpeech && speechMs >= MIN_SPEECH_MS,
            speechMs,
          });
          doneRef.current = null;
        };

        rec.start(100);
        setIsRecording(true);
        maxRef.current = setTimeout(() => {
          recRef.current?.state === 'recording' && recRef.current.stop();
        }, maxMs);
      } catch (err: unknown) {
        const name = err instanceof DOMException ? err.name : '';
        setError(
          name === 'NotAllowedError' ? '麦克风权限被拒绝,请在浏览器设置里允许'
            : name === 'NotFoundError' ? '没有找到麦克风,请检查设备'
              : '无法访问麦克风,请检查设备',
        );
        setIsRecording(false);
        cleanup();
        resolve(null);
      }
    });
  }, [maxMs, cleanup]);

  const stop = useCallback(() => {
    recRef.current?.state === 'recording' && recRef.current.stop();
  }, []);

  return { isRecording, error, level, record, stop };
}
