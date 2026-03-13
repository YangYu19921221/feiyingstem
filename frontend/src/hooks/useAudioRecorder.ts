import { useState, useRef, useCallback } from 'react';

interface AudioRecorderState {
  isRecording: boolean;
  audioBlob: Blob | null;
  error: string | null;
  duration: number;
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
    try {
      setState(s => ({ ...s, error: null, audioBlob: null, duration: 0 }));
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
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
      const msg = (err instanceof DOMException && err.name === 'NotAllowedError')
        ? '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风'
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
