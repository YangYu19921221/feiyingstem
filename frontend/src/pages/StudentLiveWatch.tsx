/**
 * 学生端 - 看直播
 *
 * ## 协议选择
 * - Chrome/Android:HTTP-FLV(mpegts.js),延迟 2~4 秒
 * - iOS Safari:必须走 HLS。Safari 不支持 MSE 播 FLV,原生 <video> 直接吃 m3u8
 * mpegts.js 走**动态 import** —— 它有几十 KB,不该进首屏包(参考 downloadPdf.ts 的做法)。
 *
 * ## 播放地址是按人签的短时票据
 * expires_at 到点前重新 join 续签。**续签只换下次重连用的地址,不重建播放器** ——
 * 以前一续签就销毁重建,每 4 分半钟画面黑一下重新缓冲(2026-10-26 排查直播卡顿)。
 * 已经连上的 FLV 长连接不受票据过期影响。
 *
 * ## 缓冲
 * 留 2~4 秒缓冲,落后了用 1.1 倍速慢慢追(liveSync),不跳帧。以前缓冲全关 + 落后就跳,
 * 网络一抖就卡、画面往前蹦。代价是延迟多 1~2 秒,单向讲课够用。
 *
 * ## 断了自己恢复
 * 播放器报错 / 服务器把流关了(老师断网重推)/ 画面 10 秒不动 → 自动重连,间隔 1→2→4→8→15 秒封顶,
 * 画面动起来就清零。老师还没开播时每 5 秒自动再试;下课了就停下。
 *
 * ## 水印
 * 播放器上叠一层 DOM 水印(含本人身份)。DOM 水印能被 DevTools 删,所以录制回放那份
 * 是服务端 FFmpeg **烧进画面**的 —— 两条路各有各的兜底。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { studentLiveApi, type StudentJoinResponse } from '../api/live';
import { useLiveSocket, type LiveWsEvent } from '../hooks/useLiveSocket';
import DanmakuOverlay, { type DanmakuItem } from '../components/DanmakuOverlay';

const HEARTBEAT_SEC = 30;
const MAX_DANMAKU_KEPT = 200;   // 内存里最多留这么多条,防长课堆爆
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];
const STALL_MS = 10000;         // 在播(没暂停)但画面 10 秒没往前走 = 卡死了
const WAIT_RETRY_MS = 5000;     // 老师还没开播: 每 5 秒自动再试

type Status = 'loading' | 'waiting' | 'ended' | 'playing' | 'error';
type ApiError = { response?: { status?: number; data?: { detail?: unknown } } };

export default function StudentLiveWatch() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const sid = Number(sessionId);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<{ destroy: () => void } | null>(null);
  const blurredRef = useRef(false);
  // 最新一次 join 拿到的地址。播放器(重)建时读它;续签只改它,不动正在放的播放器
  const credRef = useRef<StudentJoinResponse | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  const [cred, setCred] = useState<StudentJoinResponse | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  // 加 1 = (重)建一次播放器。和 cred 分开: cred 每次续签都会变
  const [playKey, setPlayKey] = useState(0);
  // 正在第几次自动重连;0 = 正常在放
  const [reconnecting, setReconnecting] = useState(0);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /**
   * 换一次播放地址。三种场合失败时的处理不一样:
   * - enter(进来 / 点按钮 / 等开播): 照实显示原因
   * - renew(票据续签,画面正在放): 只有「下课了」才停,其它失败一律不管 —— 续签失败不能把正在放的画面关掉
   * - reconnect(断线重连): 网络错继续重连,不跳成「失败」;下课了 / 没权限照实显示
   */
  const join = useCallback(async (mode: 'enter' | 'renew' | 'reconnect' = 'enter') => {
    try {
      const c = await studentLiveApi.join(sid);
      credRef.current = c;
      setCred(c);
      if (mode !== 'renew') setStatus('playing');
      return c;
    } catch (err: unknown) {
      const res = (err as ApiError)?.response;
      const ended = res?.status === 409 && String(res.data?.detail || '').includes('下课');
      if (ended) {
        setStatus('ended');
        setMessage('这节课已经下课了');
      } else if (mode === 'renew') {
        /* 续签失败: 已经连上的流不受影响,下次重连时再换 */
      } else if (mode === 'reconnect' && (!res?.status || res.status >= 500)) {
        /* 网络 / 服务器临时出错: 调用方接着排下一次重连 */
      } else if (res?.status === 409) {
        setStatus('waiting');
        setMessage('老师还没开始上课,开播后会自动进来');
      } else if (res?.status === 403) {
        setStatus('error');
        setMessage('这节课不是你的班级');
      } else {
        setStatus('error');
        setMessage('进入直播间失败,请重试');
      }
      return null;
    }
  }, [sid]);

  // scheduleReconnect 和 startPlayback 互相调用,经 ref 断开依赖环
  const scheduleRef = useRef<() => void>(() => {});

  /** join 成功就(重)建播放器;重连时网络还没好就接着排下一次 */
  const startPlayback = useCallback(async (mode: 'enter' | 'reconnect' = 'enter') => {
    const c = await join(mode);
    if (c) setPlayKey((k) => k + 1);
    else if (mode === 'reconnect' && attemptRef.current > 0) scheduleRef.current();
  }, [join]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  /** 排一次自动重连。已经排着就不重复排 */
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;
    const n = attemptRef.current;
    attemptRef.current = n + 1;
    setReconnecting(n + 1);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      void startPlayback('reconnect');
    }, RECONNECT_DELAYS[Math.min(n, RECONNECT_DELAYS.length - 1)]);
  }, [startPlayback]);
  scheduleRef.current = scheduleReconnect;

  const reconnectNow = () => {
    clearReconnectTimer();
    void startPlayback('reconnect');
  };

  useEffect(() => {
    void startPlayback();
    return () => clearReconnectTimer();
  }, [startPlayback]);

  const showPlayer = status === 'playing';

  // 挂播放器。只在 playKey 变时(进来 / 重连)重建,续签不碰它
  useEffect(() => {
    const c = credRef.current;
    const video = videoRef.current;
    if (!showPlayer || !playKey || !c || !video) return;
    let cancelled = false;
    const onFail = () => { if (!cancelled) scheduleReconnect(); };
    let usedNative = false;

    const playNative = (url: string) => {
      usedNative = true;
      video.addEventListener('error', onFail);
      video.src = url;
      video.play().catch(() => {/* 自动播放被拦是正常的,用户点一下就好 */});
    };

    (async () => {
      if (isIOS) {
        // Safari 原生吃 HLS,不要引 mpegts
        playNative(c.hls_url);
        return;
      }
      const mod = await import('mpegts.js');
      if (cancelled) return;
      // 打包后有时直接是模块本身(没有 default),运行时两种都兜住;类型按 default 走
      const mpegts = (mod.default ?? mod) as typeof mod.default;
      if (!mpegts.isSupported()) {
        playNative(c.hls_url);
        return;
      }
      const player = mpegts.createPlayer(
        { type: 'flv', isLive: true, url: c.flv_url },
        {
          enableStashBuffer: true,
          stashInitialSize: 128 * 1024,
          liveBufferLatencyChasing: false,
          liveSync: true,
          liveSyncMaxLatency: 4,
          liveSyncTargetLatency: 2,
          liveSyncPlaybackRate: 1.1,
          autoCleanupSourceBuffer: true,
          lazyLoad: false,
        },
      );
      player.on(mpegts.Events.ERROR, onFail);
      // 服务器把流关了(老师断网 / 重新开播)也算断,重连
      player.on(mpegts.Events.LOADING_COMPLETE, onFail);
      player.attachMediaElement(video);
      player.load();
      Promise.resolve(player.play()).catch(() => {});
      playerRef.current = player;
    })();

    return () => {
      cancelled = true;
      video.removeEventListener('error', onFail);
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {/* 已销毁 */}
        playerRef.current = null;
      }
      if (usedNative) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [playKey, isIOS, showPlayer, scheduleReconnect]);

  // 卡死检测 + 恢复后清零。暂停(自己点的 / 自动播放被拦)和切到后台都不算卡
  useEffect(() => {
    const video = videoRef.current;
    if (!showPlayer || !playKey || !video) return;
    let lastT = video.currentTime;
    let lastAt = Date.now();
    const t = window.setInterval(() => {
      const now = Date.now();
      if (document.hidden || video.paused) {
        lastT = video.currentTime;
        lastAt = now;
        return;
      }
      if (video.currentTime > lastT + 0.1) {
        lastT = video.currentTime;
        lastAt = now;
        if (attemptRef.current) {
          attemptRef.current = 0;
          setReconnecting(0);
        }
        return;
      }
      if (now - lastAt > STALL_MS) {
        lastAt = now;
        scheduleReconnect();
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [playKey, showPlayer, scheduleReconnect]);

  // 老师还没开播: 每 5 秒自动再试,开播后自己进来
  useEffect(() => {
    if (status !== 'waiting') return;
    const t = window.setInterval(() => { void startPlayback(); }, WAIT_RETRY_MS);
    return () => window.clearInterval(t);
  }, [status, startPlayback]);

  // 不在放了(下课 / 出错)就别再排重连
  useEffect(() => {
    if (status !== 'playing') {
      clearReconnectTimer();
      attemptRef.current = 0;
      setReconnecting(0);
    }
  }, [status]);

  // 票据快过期时续签: 只换地址(下次重连用),顺带确认这节课还在上
  useEffect(() => {
    if (!cred) return;
    const msLeft = cred.expires_at * 1000 - Date.now() - 30000;
    const t = setTimeout(() => { void join('renew'); }, Math.max(10000, msLeft));
    return () => clearTimeout(t);
  }, [cred, join]);

  // 观看心跳 + 切屏计数(沿用现有防划水口径)
  useEffect(() => {
    if (status !== 'playing') return;
    const onVis = () => { if (document.hidden) blurredRef.current = true; };
    document.addEventListener('visibilitychange', onVis);
    const timer = setInterval(() => {
      if (attemptRef.current > 0) return;   // 正在重连、画面没在动,这段不算观看时长
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

  // ---- 弹幕 ----
  const token = localStorage.getItem('access_token') || '';
  const [danmakuList, setDanmakuList] = useState<DanmakuItem[]>([]);
  const [danmakuOn, setDanmakuOn] = useState(true);
  const [muted, setMuted] = useState(false);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');

  const appendDanmaku = useCallback((items: DanmakuItem[]) => {
    setDanmakuList((prev) => {
      const merged = [...prev, ...items];
      return merged.length > MAX_DANMAKU_KEPT ? merged.slice(-MAX_DANMAKU_KEPT) : merged;
    });
  }, []);

  const onWsEvent = useCallback((e: LiveWsEvent) => {
    switch (e.type) {
      case 'history':
        setDanmakuList((e.items || []) as DanmakuItem[]);
        break;
      case 'danmaku_batch':
        appendDanmaku((e.items || []) as DanmakuItem[]);
        break;
      case 'deleted':
        setDanmakuList((prev) => prev.filter((d) => d.id !== e.id));
        break;
      case 'cleared':
        setDanmakuList([]);
        break;
      case 'you_are_muted':
        setMuted(true);
        break;
      case 'you_are_unmuted':
        setMuted(false);
        break;
      case 'error':
        if (e.code === 'muted') setMuted(true);
        setSendError(e.message || '发送失败');
        window.setTimeout(() => setSendError(''), 2500);
        break;
    }
  }, [appendDanmaku]);

  // 只在真正进入直播间(拿到播放凭据)后才连弹幕 WS
  const { send, connected, failed, retry } = useLiveSocket({
    sessionId: sid,
    token,
    onEvent: onWsEvent,
    enabled: status === 'playing' && !!token,
  });

  const sendDanmaku = useCallback(() => {
    const text = draft.trim();
    if (!text || muted) return;
    send({ type: 'danmaku', content: text });
    setDraft('');
  }, [draft, muted, send]);

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

          {/* 弹幕层 */}
          {status === 'playing' && danmakuOn && (
            <DanmakuOverlay items={danmakuList} scroll />
          )}

          {/* 自动重连提示: 不挡画面,弹幕和心跳照常 */}
          {status === 'playing' && reconnecting > 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 text-white text-sm" role="status">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              {reconnecting <= 2 ? '画面断了,正在重新连接…' : `还没连上,继续重试中(第 ${reconnecting} 次)`}
              {reconnecting > 2 && (
                <button onClick={reconnectNow} className="ml-1 underline">立即重连</button>
              )}
            </div>
          )}

          {status !== 'playing' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70">
              <div className="text-center px-6">
                <div className="text-5xl mb-3">
                  {status === 'waiting' ? '⏰' : status === 'ended' ? '👋' : status === 'error' ? '😕' : '📺'}
                </div>
                <p className="text-white mb-4">{message || '正在连接…'}</p>
                {status === 'ended' ? (
                  <button
                    onClick={() => navigate(-1)}
                    className="px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold"
                  >
                    返回
                  </button>
                ) : status !== 'loading' && (
                  <button
                    onClick={() => { setStatus('loading'); void startPlayback(); }}
                    className="px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold"
                  >
                    {status === 'waiting' ? '现在再试一次' : '重新连接'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 弹幕发送区 —— 只在直播中显示 */}
        {status === 'playing' && (
          <div className="px-4 py-3 border-t border-gray-800">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDanmakuOn((v) => !v)}
                className={`shrink-0 px-3 py-2 rounded-lg text-sm font-bold ${
                  danmakuOn ? 'bg-[#00D9FF]/20 text-[#00D9FF]' : 'bg-gray-800 text-gray-400'
                }`}
                aria-label={danmakuOn ? '关闭弹幕' : '打开弹幕'}
              >
                {danmakuOn ? '💬 弹幕开' : '💬 弹幕关'}
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendDanmaku(); }}
                maxLength={200}
                disabled={muted}
                placeholder={muted ? '老师已暂停你发言' : '说点什么…（回车发送）'}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-800 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-[#FF6B35] disabled:opacity-50"
              />
              <button
                onClick={sendDanmaku}
                disabled={muted || !draft.trim()}
                className="shrink-0 px-4 py-2 rounded-lg bg-[#FF6B35] text-white font-bold disabled:opacity-40"
              >
                发送
              </button>
            </div>
            {sendError && <p className="mt-1.5 text-xs text-red-400">{sendError}</p>}
            {failed && (
              <p className="mt-1.5 text-xs text-amber-400">
                弹幕连接断开
                <button onClick={retry} className="ml-2 underline">重试</button>
              </p>
            )}
            {!connected && !failed && (
              <p className="mt-1.5 text-xs text-gray-500">弹幕连接中…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
