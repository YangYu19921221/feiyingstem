/**
 * 学生端 - 看直播
 *
 * ## 协议选择
 * - Chrome/Android:HTTP-FLV(mpegts.js),延迟 1~3 秒,首屏快
 * - iOS Safari:必须走 HLS。Safari 不支持 MSE 播 FLV,原生 <video> 直接吃 m3u8
 * mpegts.js 走**动态 import** —— 它有几十 KB,不该进首屏包(参考 downloadPdf.ts 的做法)。
 *
 * ## 播放地址是按人签的短时票据
 * expires_at 到点前要重新 join 续签,否则 CDN 防盗链会把流掐掉。
 * 这里在过期前 30 秒自动续签。
 *
 * ## 水印
 * 播放器上叠一层 DOM 水印(含本人身份)。DOM 水印能被 DevTools 删,所以录制回放那份
 * 是服务端 FFmpeg **烧进画面**的 —— 两条路各有各的兜底。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { studentLiveApi, type StudentJoinResponse } from '../api/live';

const HEARTBEAT_SEC = 30;

export default function StudentLiveWatch() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const sid = Number(sessionId);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const blurredRef = useRef(false);

  const [cred, setCred] = useState<StudentJoinResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'playing' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const join = useCallback(async () => {
    try {
      const c = await studentLiveApi.join(sid);
      setCred(c);
      setStatus('playing');
      return c;
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setStatus('waiting');
        setMessage('老师还没开始上课,稍等一下');
      } else if (err?.response?.status === 403) {
        setStatus('error');
        setMessage('这节课不是你的班级');
      } else {
        setStatus('error');
        setMessage('进入直播间失败,请重试');
      }
      return null;
    }
  }, [sid]);

  useEffect(() => {
    join();
  }, [join]);

  // 挂播放器
  useEffect(() => {
    if (!cred || !videoRef.current) return;
    const video = videoRef.current;
    let cancelled = false;

    (async () => {
      if (isIOS) {
        // Safari 原生吃 HLS,不要引 mpegts
        video.src = cred.hls_url;
        video.play().catch(() => {/* 自动播放被拦是正常的,用户点一下就好 */});
        return;
      }
      const mod = await import('mpegts.js');
      if (cancelled) return;
      const mpegts = mod.default ?? mod;
      if (!mpegts.isSupported()) {
        video.src = cred.hls_url;
        return;
      }
      const player = mpegts.createPlayer(
        { type: 'flv', isLive: true, url: cred.flv_url },
        // 直播要贴边播,缓冲越小延迟越低;卡了宁可跳帧也别落后
        { enableStashBuffer: false, liveBufferLatencyChasing: true, lazyLoad: false }
      );
      player.attachMediaElement(video);
      player.load();
      player.play().catch(() => {});
      playerRef.current = player;
    })();

    return () => {
      cancelled = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {/* 已销毁 */}
        playerRef.current = null;
      }
    };
  }, [cred, isIOS]);

  // 票据快过期时续签 —— 不续 CDN 会掐流
  useEffect(() => {
    if (!cred) return;
    const msLeft = cred.expires_at * 1000 - Date.now() - 30000;
    const t = setTimeout(() => { join(); }, Math.max(10000, msLeft));
    return () => clearTimeout(t);
  }, [cred, join]);

  // 观看心跳 + 切屏计数(沿用现有防划水口径)
  useEffect(() => {
    if (status !== 'playing') return;
    const onVis = () => { if (document.hidden) blurredRef.current = true; };
    document.addEventListener('visibilitychange', onVis);
    const timer = setInterval(() => {
      studentLiveApi
        .heartbeat(sid, { seconds: HEARTBEAT_SEC, blurred: blurredRef.current })
        .catch(() => {/* 心跳丢一次无所谓,下次补 */});
      blurredRef.current = false;
    }, HEARTBEAT_SEC * 1000);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [status, sid]);

  return (
    <div className="min-h-screen bg-gray-900">
      <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-2xl" aria-label="返回">
            ⬅️
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-white truncate">{cred?.title || '线上课堂'}</h1>
            {status === 'playing' && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                直播中
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto">
        <div className="relative bg-black aspect-video">
          <video
            ref={videoRef}
            className="w-full h-full"
            controls
            playsInline
            // 禁下载按钮和画中画。挡不住抓包,但去掉最省事的那条路
            controlsList="nodownload noplaybackrate"
            disablePictureInPicture
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* 身份水印。DOM 层能被删,所以录播那份是服务端烧进画面的 */}
          {cred?.watermark && (
            <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/40 text-white/80 text-[11px] pointer-events-none select-none">
              {cred.watermark}
            </div>
          )}

          {status !== 'playing' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <div className="text-center px-6">
                <div className="text-5xl mb-3">
                  {status === 'waiting' ? '⏰' : status === 'error' ? '😕' : '📺'}
                </div>
                <p className="text-white mb-4">{message || '正在连接…'}</p>
                {status !== 'loading' && (
                  <button
                    onClick={() => { setStatus('loading'); join(); }}
                    className="px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold"
                  >
                    重新连接
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
