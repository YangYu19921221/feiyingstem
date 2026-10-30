/**
 * 网页里直接开摄像头拍一张(电脑摄像头、平板)。手机上「拍照」按钮走系统相机(input capture),不用这个。
 *
 * - 先要后置摄像头(environment),电脑没有后置会自动给前置;能切换时右上角有「换摄像头」
 * - 拍的时候按视频原始分辨率截一帧,压缩交给调用方
 * - 关掉、拍完、出错都要停掉摄像头(不停浏览器标签上的红点会一直亮)
 * - 浮层 portal 到 body: 页面里有 transform 的祖先会把 fixed 困住(小鹰老师聊天页踩过)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, RefreshCw, X } from 'lucide-react';

interface Props {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '没有拿到摄像头权限。点地址栏左边的小锁,把「摄像头」改成允许,再点一次「打开摄像头」';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '这台设备没有找到摄像头,用「选一张照片」吧';
  if (name === 'NotReadableError') return '摄像头被别的程序占着(比如视频会议),关掉它再试';
  return '摄像头打不开,用「选一张照片」吧';
}

// 浏览器根本不支持网页开摄像头: 一打开就说清楚(不用等 effect 里再报)
function unsupported(): string {
  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) return '';
  return typeof window !== 'undefined' && window.isSecureContext
    ? '这个浏览器不能在网页里开摄像头,用「选一张照片」吧'
    : '要用 https 打开网站才能开摄像头,用「选一张照片」吧';
}

export default function CameraCapture({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [canSwitch, setCanSwitch] = useState(false);
  const [error, setError] = useState(unsupported);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let alive = true;
    if (unsupported()) return;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then(async (stream) => {
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      stop();
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try { await v.play(); } catch { /* 静音视频一般能自动播,播不了也能看到画面 */ }
      }
      setReady(true);
      try {
        const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (alive) setCanSwitch(cams.length > 1);
      } catch { /* 拿不到设备列表就不显示切换 */ }
    }).catch((e) => { if (alive) setError(cameraError(e)); });
    return () => { alive = false; stop(); };
  }, [facing, stop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !ready || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    setFlash(true);
    c.toBlob((blob) => {
      stop();
      if (blob) onCapture(blob);
      else setError('没拍下来,再试一次');
    }, 'image/jpeg', 0.92);
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="拍作业">
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-white">
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10"
          aria-label="关闭摄像头"
          autoFocus
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-sm text-white/80">整页放进框里,摆正、离近一点</p>
        {canSwitch ? (
          <button
            type="button"
            onClick={() => {
              setReady(false);
              setError('');
              setFacing((f) => (f === 'environment' ? 'user' : 'environment'));
            }}
            className="flex h-11 items-center gap-1.5 rounded-full px-3 text-sm hover:bg-white/10"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            换摄像头
          </button>
        ) : <span className="w-11" />}
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`max-h-full max-w-full object-contain ${facing === 'user' ? '-scale-x-100' : ''}`}
        />
        {/* 取景框: 只是提示整页放进来,截图还是整帧 */}
        {ready && (
          <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-dashed border-white/60 sm:inset-10" aria-hidden="true" />
        )}
        {flash && <div className="pointer-events-none absolute inset-0 bg-white/80" aria-hidden="true" />}
        {!ready && !error && <p className="absolute text-sm text-white/80">正在打开摄像头…</p>}
        {error && (
          <div className="absolute inset-x-6 rounded-2xl bg-white p-5 text-center text-sm leading-6 text-ink shadow-lg sm:mx-auto sm:max-w-md">
            <p>{error}</p>
            <button type="button" onClick={onClose} className="btn-glow mt-4 inline-flex min-h-11 items-center rounded-xl px-5 font-semibold text-white">
              知道了
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <button
          type="button"
          onClick={shoot}
          disabled={!ready}
          className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white bg-white/20 text-white transition active:scale-95 disabled:opacity-40"
          aria-label="拍下这一页"
        >
          <Camera className="h-8 w-8" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
