/**
 * 学习助手「说一句」(2026-10-27,后端 services/tutor_voice)
 *
 * 点一下开始说,再点一下说完(不用一直按着: 电脑上按住不方便,读屏用户也按不住);最长 MAX_MS 自动停。
 * 说完上传 → 服务器转成文字 → **填进输入框**,孩子看一眼、能改,再自己点发送(中文里夹的英文常听错,不自动发)。
 * 不扣次数。录音不留: 服务器转完就删。
 *
 * ⚠️ getUserMedia 必须显式开回声消除(feedback_getusermedia_echo_cancellation): 回答在朗读时开录,
 * 扬声器的声音会被收进去;开录前还要停掉正在放的发音。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { getTutorVoice, uploadTutorVoice } from '../../api/tutor';
import { getRecorderBlocker } from '../../hooks/useAudioRecorder';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

const MAX_MS = 30000;
const MIN_MS = 600;
const POLL_MS = 1000;
const POLL_MAX = 45;
const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4'];

type Phase = 'idle' | 'rec' | 'wait';

export default function VoiceInputButton({ onText, disabled, beforeRecord, upload = uploadTutorVoice, poll = getTutorVoice }: {
  onText: (text: string) => void;
  disabled?: boolean;
  /** 开录前调: 停掉正在放的发音 */
  beforeRecord?: () => void;
  /** 教师端换成 /teacher/tutor/me/voice 那一对 */
  upload?: typeof uploadTutorVoice;
  poll?: typeof getTutorVoice;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [secs, setSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const stopTimer = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  useEffect(() => {
    // 开发环境 StrictMode 会先卸载再挂载一次: 挂载时要设回 true,否则轮询一次都不发
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearInterval(timer.current);
      window.clearTimeout(stopTimer.current);
      recRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const finish = useCallback(async (blob: Blob, ms: number) => {
    if (ms < MIN_MS || blob.size < 1000) {
      setPhase('idle');
      toast.info('太短了,点一下麦克风,说完再点一下');
      return;
    }
    setPhase('wait');
    try {
      const { id } = await upload(blob);
      for (let i = 0; i < POLL_MAX && alive.current; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const r = await poll(id);
        if (r.status === 'done') {
          if (r.text.trim()) onText(r.text.trim());
          else toast.info('没听清,再说一次或者打字吧');
          return;
        }
        if (r.status === 'failed') {
          toast.error('没听清,再说一次或者打字吧');
          return;
        }
      }
      if (alive.current) toast.error('听写得太久了,打字问吧');
    } catch (e) {
      toast.error(getErrorMessage(e, '没传上去,再说一次'));
    } finally {
      if (alive.current) setPhase('idle');
    }
  }, [onText, upload, poll]);

  const start = async () => {
    const blocked = getRecorderBlocker();
    if (blocked) { toast.error(blocked); return; }
    beforeRecord?.();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mime = MIME.find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      rec.onstop = () => {
        window.clearInterval(timer.current);
        window.clearTimeout(stopTimer.current);
        stream.getTracks().forEach((t) => t.stop());
        recRef.current = null;
        const ms = Date.now() - startAt.current;
        void finish(new Blob(chunks.current, { type: rec.mimeType || mime || 'audio/webm' }), ms);
      };
      recRef.current = rec;
      rec.start(200);
      startAt.current = Date.now();
      setSecs(0);
      setPhase('rec');
      timer.current = window.setInterval(() => setSecs(Math.floor((Date.now() - startAt.current) / 1000)), 250);
      stopTimer.current = window.setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, MAX_MS);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      toast.error(name === 'NotAllowedError' ? '麦克风没有打开,在浏览器设置里允许用麦克风'
        : name === 'NotFoundError' ? '没找到麦克风' : '麦克风用不了,打字问吧');
    }
  };

  const stop = () => {
    if (recRef.current?.state === 'recording') recRef.current.stop();
  };

  if (phase === 'rec') {
    return (
      <button type="button" onClick={stop}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-rose-500 px-3 text-sm font-semibold text-white hover:bg-rose-600"
        aria-label={`正在听,说完点这里(${secs} 秒)`}>
        <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
        <span className="tabular-nums">说完了 {secs}s</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={() => void start()} disabled={disabled || phase === 'wait'}
      className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-orange-600 hover:bg-orange-100 disabled:opacity-40"
      aria-label={phase === 'wait' ? '正在把你说的话变成字' : '说一句(说完再点一下)'}
      title={phase === 'wait' ? '正在把你说的话变成字…' : '说一句(说完再点一下)'}>
      {phase === 'wait' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}
