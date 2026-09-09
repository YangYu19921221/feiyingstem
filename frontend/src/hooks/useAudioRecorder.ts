import { useState, useRef, useCallback } from 'react';

interface AudioRecorderState {
  isRecording: boolean;
  audioBlob: Blob | null;
  error: string | null;
  duration: number;
}

/**
 * 容器格式按支持度依次探测。
 * ⚠️ 不能只认 webm:iOS Safari 直到 18.4 才支持录 webm,更早的版本只出 audio/mp4,
 * 硬编码 webm 会让那些设备**根本录不了音**。
 * 后端 ffmpeg/PyAV 按内容探测容器,不看后缀,所以前端换格式后端零改动。
 */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find(t => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** 录音是否可用。不可用时把真因说清楚,别让家长去翻权限设置 */
export function getRecorderBlocker(): string | null {
  // 明文源(http://IP:3000 这类)下 mediaDevices 直接是 undefined —— 这是浏览器安全策略,
  // 不是设备问题。生产上确实有这个入口,必须单独说清楚
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return '当前网址不是 https,浏览器不允许录音。请用 https 的网址打开。';
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return '这个浏览器不支持录音,建议换 Chrome 或升级系统后再试。';
  }
  if (!pickMimeType()) {
    return '这个浏览器的录音格式不被支持,建议升级系统或换 Chrome。';
  }
  return null;
}

export function useAudioRecorder(maxDuration = 5) {
  const [state, setState] = useState<AudioRecorderState>({
    isRecording: false,
    audioBlob: null,
    error: null,
    duration: 0,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current?.stream) {
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    mediaRecorderRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    // 先查环境:不支持就直接给出真因,不要走到 getUserMedia 抛异常再猜
    const blocked = getRecorderBlocker();
    if (blocked) {
      setState(s => ({ ...s, error: blocked, isRecording: false }));
      return;
    }
    try {
      setState(s => ({ ...s, error: null, audioBlob: null, duration: 0 }));
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType()!;
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // 用 recorder 实际采用的 mimeType,不要写死 —— iOS 上这里是 mp4
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        setState(s => ({ ...s, isRecording: false, audioBlob: blob }));
        cleanup();
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      startTimeRef.current = Date.now();
      setState(s => ({ ...s, isRecording: true }));

      // 计时器
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        setState(s => ({ ...s, duration: Math.floor(elapsed) }));
        if (elapsed >= maxDuration) {
          recorder.stop();
        }
      }, 200);
    } catch (err: unknown) {
      // NotAllowedError=用户拒绝;NotFoundError=没有麦克风;其余按设备问题
      const name = err instanceof DOMException ? err.name : '';
      const msg = name === 'NotAllowedError'
        ? '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风'
        : name === 'NotFoundError'
          ? '没有找到麦克风,请检查设备是否接好'
          : '无法访问麦克风，请检查设备';
      setState(s => ({ ...s, error: msg, isRecording: false }));
      cleanup();
    }
  }, [maxDuration, cleanup]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { ...state, startRecording, stopRecording };
}
