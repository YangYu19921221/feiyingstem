/**
 * 摄像头看孩子在不在(家长同意后才挂载,见 FocusReminder / hooks/useCameraAllowed)
 *
 * 规则真源 backend services/focus_watch.py 文件头第 2 条:
 * - 画面只在这台设备上看: 每 2 秒用 BlazeFace 判断一次「画面里有没有人脸」,**不上传、不保存、不认人**
 * - 连续 NO_FACE_MS(10 秒)看不到人 → 顶上提醒「看不到你啦」;人回来时把这次离开了多久报给服务器
 * - 切出页面时不看(那段归切屏记录),切走前正在算的离开在切走那一刻结束
 * - 左下角一直显示小画面 +「摄像头开着」,孩子知道它开着
 * - 开不起来(孩子没允许 / 没有摄像头 / 检测库加载失败)只报一次原因给家长,不挡学习
 * 模型文件放在 public/models/blazeface(tfhub 在国内打不开,不能用默认地址)。
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { focusWatchApi, type CameraStatus } from '../api/focusWatch';
import { cameraPresenceStore } from '../utils/cameraPresenceStore';
import { reportFocusEvent } from '../utils/focusEvents';

const CHECK_EVERY_MS = 2000;
export const NO_FACE_MS = 10_000;
const MODEL_URL = '/models/blazeface/model.json';

type Detector = { estimateFaces: (v: HTMLVideoElement, returnTensors?: boolean) => Promise<unknown[]> };

async function loadDetector(): Promise<Detector> {
  const tf = await import('@tensorflow/tfjs-core');
  await import('@tensorflow/tfjs-converter');
  await import('@tensorflow/tfjs-backend-cpu');
  try {
    await import('@tensorflow/tfjs-backend-webgl');
    if (!(await tf.setBackend('webgl'))) throw new Error('no webgl');
  } catch {
    await tf.setBackend('cpu');
  }
  await tf.ready();
  const blazeface = await import('@tensorflow-models/blazeface');
  return blazeface.load({ modelUrl: MODEL_URL, maxFaces: 1 });
}

function statusOf(err: unknown): CameraStatus {
  const name = (err as { name?: string })?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') return 'unavailable';
  return 'error';
}

export default function CameraPresence() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'on' | 'off'>('starting');
  const [noFace, setNoFace] = useState(false);

  useEffect(() => {
    let alive = true;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let busy = false;
    // 这次「看不到人」从什么时候开始(null = 现在看得到人 / 没在看)
    let missingSince: number | null = null;
    let reported = false;

    const report = (st: CameraStatus) => {
      if (reported) return;
      reported = true;
      focusWatchApi.reportCameraStatus(st).catch(() => {});
    };
    /** 结束这次离开: 满 10 秒才报 */
    const closeEpisode = (endAt: number) => {
      if (missingSince !== null && endAt - missingSince >= NO_FACE_MS) {
        reportFocusEvent('no_face', endAt - missingSince);
      }
      missingSince = null;
      cameraPresenceStore.set({ noFace: false });
      if (alive) setNoFace(false);
    };

    const onVisibility = () => {
      if (document.hidden) closeEpisode(Date.now());
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 5 } },
          audio: false,
        });
      } catch (e) {
        report(statusOf(e));
        if (alive) setState('off');
        return;
      }
      if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream;
      try { await video.play(); } catch { /* muted + playsInline 一般放得了;放不了下面检测会一直判没人,不至于出错 */ }

      let detector: Detector;
      try {
        detector = await loadDetector();
      } catch {
        report('error');
        stream.getTracks().forEach(t => t.stop());
        if (alive) setState('off');
        return;
      }
      if (!alive) return;
      report('on');
      cameraPresenceStore.set({ active: true, noFace: false });
      setState('on');
      document.addEventListener('visibilitychange', onVisibility);

      timer = setInterval(async () => {
        if (busy || document.hidden || !alive || video.readyState < 2) return;
        busy = true;
        try {
          const faces = await detector.estimateFaces(video, false);
          const now = Date.now();
          if (faces.length > 0) {
            closeEpisode(now);
          } else {
            if (missingSince === null) missingSince = now;
            if (now - missingSince >= NO_FACE_MS) {
              cameraPresenceStore.set({ noFace: true });
              setNoFace(true);
            }
          }
        } catch { /* 偶尔一帧算不出来跳过 */ }
        busy = false;
      }, CHECK_EVERY_MS);
    })();

    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      closeEpisode(Date.now());
      cameraPresenceStore.set({ active: false, noFace: false });
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  if (state === 'off') return null;

  return (
    <>
      {/* 左下角: 小画面 + 摄像头开着(孩子一直看得到它开着) */}
      <div
        className="fixed left-3 bottom-3 z-[60] flex items-center gap-2 rounded-full bg-white/95 py-1 pl-1 pr-1 sm:pr-3 shadow-md border border-gray-200"
        title="家长同意了用摄像头看你在不在。画面只在这台设备上,不上传、不保存"
      >
        <span className="relative block h-10 w-10 overflow-hidden rounded-full bg-gray-200">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-hidden
            className="h-full w-full object-cover -scale-x-100"
          />
          <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-red-500" />
        </span>
        <span className="hidden sm:block text-xs leading-tight text-gray-600">
          摄像头开着
          <span className="block text-[11px] text-gray-400">只看你在不在,画面不上传</span>
        </span>
      </div>

      {/* 居中靠外层 flex: motion 的 y 动画会写 transform,把 -translate-x-1/2 盖掉 */}
      <div className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex justify-center px-4">
        <AnimatePresence>
          {noFace && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              role="status"
              className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 shadow-lg"
            >
              📷 看不到你啦,回到屏幕前接着学
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
