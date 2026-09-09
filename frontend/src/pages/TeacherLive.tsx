/**
 * 教师端 - 线上授课控制台
 *
 * ## 一键开播怎么做到的
 * 走 WHIP(RFC 9725):浏览器 getUserMedia 拿摄像头/屏幕 → 一个 HTTP POST 把 SDP
 * 发给源站 → 直接开播。**老师不用装 OBS** —— 这是选 SRS 的决定性理由。
 * 想用 OBS 的老师照旧,页面上给 RTMP 地址。
 *
 * ## 推流地址的处理
 * whip/rtmp 地址只在开播那一刻从后端拿,**不进 localStorage、不进全局 store**。
 * 泄漏出去等于让人劫持直播。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { liveApi, type TeacherLiveSession, type PushCredentials } from '../api/live';
import TeacherDanmakuPanel from '../components/TeacherDanmakuPanel';

type SourceKind = 'camera' | 'screen';

/**
 * 采集一路视频源。屏幕共享故意压到 15fps 并标 contentHint='detail':
 * 课件/文字不需要高帧率,把码率预算让给"把每帧刷清楚刷满",否则画面大变时
 * 编码器只能分帧补宏块 → 老师看到的"一层一层从上往下刷"。摄像头按 720p/25fps。
 *
 * **屏幕共享的声音一律用麦克风**(不是系统/标签页声音):这是讲课直播,老师讲解声必须传出去。
 * getDisplayMedia 默认给的是系统音,老师的话反而收不到 —— 而 WHIP 只协商一次 SDP,
 * 开播时没有音轨后面就补不进来,所以开播这一刻就得把麦克风音轨带上(同 Zoom/Meet 的共享)。
 * 麦克风拿不到时降级为无声屏幕流(不阻断开播)。
 */
async function captureSource(source: SourceKind): Promise<MediaStream> {
  if (source === 'camera') {
    return navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 25 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  }
  // 屏幕:只取屏幕视频(丢弃系统音),再单独抓麦克风音,合成一路推
  const disp = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 15 } }, audio: false });
  const videoTrack = disp.getVideoTracks()[0];
  // contentHint 必须在轨道加入 PeerConnection 之前设,协商后再改不生效
  try { videoTrack.contentHint = 'detail'; } catch { /* 老浏览器无此属性 */ }
  const out = new MediaStream([videoTrack]);
  try {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    mic.getAudioTracks().forEach((t) => out.addTrack(t));
  } catch { /* 麦克风被拒/无设备:无声共享,总比整场开播失败强 */ }
  return out;
}

/**
 * 读屏幕轨的画面类型:'monitor'(整屏)/ 'browser'(标签页)/ 'window'(应用窗口)/ ''(拿不到)。
 * 整屏和标签页会把直播预览也照进去 → 套娃,靠这个判断要不要藏预览。
 */
function getDisplaySurface(track: MediaStreamTrack | undefined): string {
  if (!track) return '';
  try {
    return (track.getSettings() as any).displaySurface || '';
  } catch { return ''; }
}

/**
 * 在 video sender 上按源类型设编码参数:码率上限 + 降级策略。
 * 屏幕优先保分辨率(掉帧也别糊文字)、码率 3Mbps;摄像头 balanced、1.5Mbps。
 * maxBitrate 太高反而在弱网下加重"分帧刷新",故贴着上行带宽给。不支持就退回默认,不影响推流。
 */
async function applyVideoSenderParams(pc: RTCPeerConnection, source: SourceKind) {
  try {
    const vsender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (!vsender) return;
    const p = vsender.getParameters();
    if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
    p.encodings[0].maxBitrate = source === 'screen' ? 3_000_000 : 1_500_000;
    (p as any).degradationPreference = source === 'screen' ? 'maintain-resolution' : 'balanced';
    await vsender.setParameters(p);
  } catch { /* setParameters 不支持/被拒:退回默认编码 */ }
}

export default function TeacherLive() {
  const navigate = useNavigate();
  const previewRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [enabled, setEnabled] = useState<boolean | null>(null);
  // 取配置失败的原因。**不能把失败一律当成"没配源站"** ——
  // 被顶下线(401)时那么说是错的,老师会去找管理员而管理员根本没问题要解决
  const [configErr, setConfigErr] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TeacherLiveSession[]>([]);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [publishing, setPublishing] = useState<number | null>(null);
  // 当前推的是摄像头还是屏幕。开播后可中途切换(replaceTrack,不重开推流),
  // 用来决定按钮显示「共享屏幕」还是「退出共享屏幕」。
  const [liveSource, setLiveSource] = useState<SourceKind | null>(null);
  // 共享屏幕时的画面类型:'monitor'=整屏 / 'browser'=标签页 / 'window'=应用窗口 / ''=未知。
  // 整屏和标签页会把直播预览也照进去 → 无限套娃,所以那两种藏预览;窗口共享安全,显示预览让老师看到学生看到啥。
  const [screenSurface, setScreenSurface] = useState<string>('');
  const [cred, setCred] = useState<PushCredentials | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // 推流健康状态。**必须显式监控** —— WebRTC 断线时页面不会自己变,
  // 老师会对着黑屏继续讲(这是网页推流相对 OBS 最容易翻车的地方)
  const [connState, setConnState] = useState<RTCPeerConnectionState | null>(null);
  const [liveStats, setLiveStats] = useState<{ kbps: number; fps: number } | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const lastBytesRef = useRef<{ bytes: number; ts: number } | null>(null);

  const reload = () => liveApi.listSessions().then(setSessions).catch(() => {});

  useEffect(() => {
    liveApi
      .getConfig()
      .then((c) => { setEnabled(c.enabled); setConfigErr(null); })
      .catch((e: any) => {
        const code = e?.response?.status;
        if (code === 401) {
          // 登录态失效(含被顶下线):这跟直播有没有配置无关,别误导老师
          setConfigErr('登录已过期,请重新登录后再进入');
        } else if (code === 403) {
          setConfigErr('当前账号没有开课权限');
        } else {
          setConfigErr('连接服务器失败,请检查网络后重试');
        }
        setEnabled(null);
      });
    reload();
  }, []);

  // 离开页面务必停掉摄像头 —— 不停的话摄像头灯一直亮,老师会以为还在直播
  useEffect(() => () => stopPublish(true), []);

  // 预览框绑本地流。**必须在 publishing 变化后做** ——
  // <video> 挂在「正在直播」块里,开播那一刻它还没渲染出来
  useEffect(() => {
    const v = previewRef.current;
    if (!v || !streamRef.current) return;
    if (v.srcObject !== streamRef.current) {
      v.srcObject = streamRef.current;
    }
    v.play().catch(() => {/* 自动播放被拦不影响推流,只是预览不动 */});
  }, [publishing, connState]);

  // 直播中关标签页/刷新要拦一下。**网页推流最容易出的事故就是手滑关页面全班断流**
  // (OBS 是独立进程,浏览器关了照样推,网页推流没这个保险)
  useEffect(() => {
    if (publishing === null) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '正在直播中,关闭页面会立刻断流。确定要离开吗?';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [publishing]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await liveApi.createSession({ title: title.trim() });
      setTitle('');
      setCreating(false);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  /** WHIP 推流:一次 HTTP POST 换回 answer,不需要信令服务器 */
  const startPublish = async (session: TeacherLiveSession, source: SourceKind) => {
    setErr('');
    setBusy(true);
    try {
      const c = await liveApi.startSession(session.id);
      setCred(c);

      const stream = await captureSource(source);
      streamRef.current = stream;
      // 这里**不能直接绑 previewRef** —— 那个 <video> 在 {liveOne && ...} 块内,
      // 而 liveOne 要等下面 setPublishing 之后才成立,此刻元素还没进 DOM,
      // ref 是 null,赋值会被 if 静默跳过 → 本地预览全黑(推流其实是好的)。
      // 改由下面的 useEffect 在元素挂载后绑定。

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 断线检测:disconnected/failed 时页面必须变红告警,不能继续显示"直播中"
      pc.onconnectionstatechange = () => {
        setConnState(pc.connectionState);
        if (pc.connectionState === 'failed') {
          setErr('推流已中断(网络断开)。点「停止」后重新开播。');
        }
      };

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await applyVideoSenderParams(pc, source);
      // 老师从浏览器自带的「停止共享」小条退出屏幕共享时,轨道会 ended —— 此时不能傻站着推死画面,
      // 自动切回摄像头保持直播不断(见 switchSource)。摄像头轨道被系统停不挂此逻辑。
      if (source === 'screen') attachScreenEndedGuard(stream.getVideoTracks()[0]);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const res = await fetch(c.whip_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp || '',
      });
      if (!res.ok) throw new Error(`源站拒绝推流(${res.status})`);
      const answer = await res.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      setPublishing(session.id);
      setLiveSource(source);
      setScreenSurface(source === 'screen' ? getDisplaySurface(stream.getVideoTracks()[0]) : '');
      setConnState(pc.connectionState);

      // 码率/帧率轮询:让老师看得见自己推出去的画质。
      // 码率靠 bytesSent 增量算 —— outbound-rtp 里没有现成的瞬时码率
      statsTimerRef.current = window.setInterval(async () => {
        if (!pcRef.current) return;
        try {
          const report = await pcRef.current.getStats();
          report.forEach((s: any) => {
            if (s.type === 'outbound-rtp' && s.kind === 'video') {
              const now = Date.now();
              const prev = lastBytesRef.current;
              let kbps = 0;
              if (prev && now > prev.ts) {
                kbps = Math.round(((s.bytesSent - prev.bytes) * 8) / (now - prev.ts));
              }
              lastBytesRef.current = { bytes: s.bytesSent, ts: now };
              setLiveStats({ kbps, fps: Math.round(s.framesPerSecond || 0) });
            }
          });
        } catch { /* 取不到统计不影响直播 */ }
      }, 3000);

      await reload();
    } catch (e: any) {
      setErr(e?.message || '开播失败,请检查摄像头权限和网络');
      stopPublish(true);
    } finally {
      setBusy(false);
    }
  };

  /** silent=true 时只收拾本地资源,不调后端(用于卸载清理) */
  const stopPublish = (silent = false) => {
    if (statsTimerRef.current) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    lastBytesRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    if (!silent) { setPublishing(null); setLiveSource(null); }
    setCred(null);
    setConnState(null);
    setLiveStats(null);
  };

  /**
   * 直播中切换视频源(摄像头↔屏幕),**不重开推流**。
   * WHIP 是一次性 SDP 协商,不能重新协商,所以走 replaceTrack:在既有 sender 上
   * 换掉视频轨,音频轨和连接都不动 → 学生端画面无缝切、不掉线、弹幕不断。
   * 「退出共享屏幕」= 切回摄像头(source='camera')。
   */
  const switchSource = async (source: SourceKind) => {
    const pc = pcRef.current;
    const old = streamRef.current;
    if (!pc || !old || busy) return;
    setBusy(true);
    setErr('');
    let next: MediaStream | null = null;
    try {
      next = await captureSource(source);
      const newVideo = next.getVideoTracks()[0];
      if (!newVideo) throw new Error('没拿到视频轨');

      const vsender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (!vsender) throw new Error('推流通道异常,请下课后重新开播');
      await vsender.replaceTrack(newVideo);
      await applyVideoSenderParams(pc, source);
      if (source === 'screen') attachScreenEndedGuard(newVideo);

      // 只替换视频轨:旧视频轨停掉,音频轨继续用旧的(切屏不该打断麦克风)。
      // 预览流也换成新视频轨 + 旧音频轨,保证本地预览跟着变。
      old.getVideoTracks().forEach((t) => { t.stop(); old.removeTrack(t); });
      old.addTrack(newVideo);
      // 屏幕采集带的系统音轨用不上(避免和麦克风串音),丢弃
      next.getAudioTracks().forEach((t) => t.stop());

      if (previewRef.current) {
        previewRef.current.srcObject = old;
        previewRef.current.play().catch(() => {});
      }
      setLiveSource(source);
      setScreenSurface(source === 'screen' ? getDisplaySurface(newVideo) : '');
    } catch (e: any) {
      // 切换失败:清理新抓的流,保持原来的推流不动(不能因为切失败把直播也搞断)
      next?.getTracks().forEach((t) => t.stop());
      const msg = e?.name === 'NotAllowedError' ? '已取消,继续用当前画面' : (e?.message || '切换失败,继续用当前画面');
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 监听屏幕轨道 ended:老师点浏览器自带「停止共享」小条时触发。
   * 不处理的话会推死画面(冻帧)还显示「直播中」—— 自动切回摄像头保持直播不断。
   * 判据用「这条轨道是否还是 sender 当前在推的那条」:切走/下课后 sender 已换轨,
   * 旧轨的 ended 就不该再触发切回(否则会把新画面又抢回摄像头)。
   */
  const attachScreenEndedGuard = (track: MediaStreamTrack | undefined) => {
    if (!track) return;
    track.addEventListener('ended', () => {
      const pc = pcRef.current;
      if (!pc) return;  // 已下课
      const vsender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      // 仍在推、且推的正是这条刚结束的屏幕轨 → 切回摄像头
      if (vsender && vsender.track === track) {
        void switchSource('camera');
      }
    }, { once: true });
  };

  const endClass = async (session: TeacherLiveSession) => {
    stopPublish();
    await liveApi.endSession(session.id);
    await reload();
  };

  // 取配置出错(登录过期/无权限/网络):照实说,别混成"未配置"
  if (configErr) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] p-6">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl p-8 text-center shadow">
          <div className="text-5xl mb-3">🔑</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">暂时进不来</h1>
          <p className="text-gray-600 text-sm">{configErr}</p>
          <div className="flex flex-wrap gap-2 justify-center mt-5">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold"
            >
              重试
            </button>
            <button
              onClick={() => navigate('/login')}
              className="px-5 py-2.5 rounded-xl bg-gray-100 text-gray-700 font-bold"
            >
              重新登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (enabled === false) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] p-6">
        <div className="max-w-2xl mx-auto bg-white rounded-2xl p-8 text-center shadow">
          <div className="text-5xl mb-3">📡</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">直播还没开通</h1>
          <p className="text-gray-600 text-sm">
            需要管理员先配置直播源站。课件资料上传和作业布置不受影响,照常可用。
          </p>
          <button
            onClick={() => navigate('/teacher/materials')}
            className="mt-5 px-5 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold"
          >
            去管理课件资料
          </button>
        </div>
      </div>
    );
  }

  const liveOne = sessions.find((s) => s.id === publishing);

  return (
    <div className="min-h-screen bg-[#FFF8F0] pb-16">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">📡 线上授课</h1>
            <p className="text-sm text-gray-500 mt-1">网页直接开播,不用装推流软件</p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2.5 rounded-xl bg-[#FF6B35] text-white font-bold shadow"
          >
            ➕ 新建课堂
          </button>
        </div>

        {err && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {err}
          </div>
        )}

        {creating && (
          <div className="mb-5 bg-white rounded-2xl p-5 shadow">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) create(); }}
              placeholder="课堂标题,例如「Unit 3 单词精讲」"
              className="w-full px-4 py-3 rounded-xl border border-orange-200 focus:outline-none focus:border-[#FF6B35]"
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={create}
                disabled={busy || !title.trim()}
                className="px-4 py-2 rounded-xl bg-[#FF6B35] text-white font-bold disabled:opacity-40"
              >
                创建
              </button>
              <button
                onClick={() => { setCreating(false); setTitle(''); }}
                className="px-4 py-2 rounded-xl bg-gray-100 text-gray-600 font-bold"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 正在直播 */}
        {liveOne && (
          <div className="mb-5 bg-white rounded-2xl p-5 shadow border-2 border-red-300">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {/* 连接状态如实反映,断了不能还显示"直播中" */}
              {connState === 'connected' ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="font-bold text-gray-800">直播中 · {liveOne.title}</span>
                </>
              ) : connState === 'failed' || connState === 'disconnected' ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
                  <span className="font-bold text-red-600">
                    连接已断开 · 学生看不到画面
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="font-bold text-gray-700">连接中…</span>
                </>
              )}
              {liveStats && connState === 'connected' && (
                <span className="ml-auto text-xs text-gray-500 tabular-nums">
                  {liveStats.kbps} kbps · {liveStats.fps} fps
                  {liveStats.kbps > 0 && liveStats.kbps < 250 && (
                    <span className="text-amber-600 font-bold"> · 网络偏弱</span>
                  )}
                </span>
              )}
            </div>
            {/* 预览显示策略(治"隧道套娃"又不让老师瞎):
                - 摄像头:正常显示预览。
                - 共享「应用窗口」(window):安全,显示预览 —— 老师能确认学生看到哪块。
                - 共享「整屏 / 标签页」(monitor/browser/未知):预览会照到自己 → 无限套娃,
                  藏预览、提示改成"共享某个窗口",避免隧道效果又让老师有据可依。 */}
            {(() => {
              const risky = liveSource === 'screen' && screenSurface !== 'window';
              return (
                <div className="relative">
                  <video
                    ref={previewRef}
                    autoPlay
                    muted
                    playsInline
                    className={`w-full aspect-video bg-black rounded-xl ${risky ? 'hidden' : ''}`}
                  />
                  {liveSource === 'screen' && screenSurface === 'window' && (
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/60 text-white text-xs">
                      👁 这就是学生看到的画面
                    </span>
                  )}
                  {risky && (
                    <div className="w-full aspect-video bg-gray-900 rounded-xl flex flex-col items-center justify-center text-center px-4">
                      <div className="text-4xl mb-2">🖥</div>
                      <div className="text-white font-bold">正在共享{screenSurface === 'browser' ? '浏览器标签页' : '整个屏幕'}</div>
                      <div className="text-gray-400 text-sm mt-1 max-w-xs">
                        这里不显示预览,否则会照到本页画面无限套娃。
                        <br />想看到学生看的画面?点「重选共享」改成<b className="text-amber-300">共享某个应用窗口</b>。
                      </div>
                      <button
                        onClick={() => switchSource('screen')}
                        disabled={busy || connState !== 'connected'}
                        className="mt-3 px-4 py-1.5 rounded-lg bg-[#FFD23F] text-gray-800 text-sm font-bold disabled:opacity-40"
                      >
                        🔄 重选共享
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                onClick={() => endClass(liveOne)}
                className="px-4 py-2 rounded-xl bg-red-500 text-white font-bold"
              >
                ⏹ 下课
              </button>
              {/* 直播中切换画面源:不重开推流(replaceTrack),学生端无缝切、不掉线。
                  连接中/切换中禁用,防重复点。 */}
              {liveSource === 'screen' ? (
                <button
                  onClick={() => switchSource('camera')}
                  disabled={busy || connState !== 'connected'}
                  className="px-4 py-2 rounded-xl bg-gray-700 text-white font-bold disabled:opacity-40"
                >
                  📷 退出共享屏幕
                </button>
              ) : (
                <button
                  onClick={() => switchSource('screen')}
                  disabled={busy || connState !== 'connected'}
                  className="px-4 py-2 rounded-xl bg-[#FFD23F] text-gray-800 font-bold disabled:opacity-40"
                >
                  🖥 共享屏幕
                </button>
              )}
              <button
                onClick={() => navigate(`/teacher/livestream/${liveOne.id}/materials`)}
                className="px-4 py-2 rounded-xl bg-orange-100 text-[#FF6B35] font-bold"
              >
                📄 本课课件
              </button>
              <button
                onClick={() => navigate(`/teacher/homework?live=${liveOne.id}`)}
                className="px-4 py-2 rounded-xl bg-[#00D9FF]/15 text-[#0090aa] font-bold"
              >
                📝 布置课后作业
              </button>
            </div>
            {cred && (
              <details className="mt-3">
                <summary className="text-xs text-gray-500 cursor-pointer">
                  用 OBS 推流(高级)
                </summary>
                <p className="mt-2 text-xs text-gray-600 break-all">
                  服务器:<code>{cred.rtmp_url.replace(/\/[^/]+$/, '/')}</code>
                  <br />
                  串流密钥:<code>{cred.stream_key}</code>
                  <br />
                  <span className="text-red-500">此密钥不要转发给任何人</span>
                </p>
              </details>
            )}

            {/* 弹幕互动面板:开播即连、下课卸载即断 */}
            <TeacherDanmakuPanel sessionId={liveOne.id} />
          </div>
        )}

        {/* 课堂列表 */}
        <div className="space-y-3">
          {sessions.length === 0 && (
            <div className="bg-white rounded-2xl p-8 text-center shadow">
              <div className="text-4xl mb-2">🎬</div>
              <p className="text-gray-600">还没有课堂,点右上角新建一个</p>
            </div>
          )}
          {sessions.filter((s) => s.id !== publishing).map((s) => (
            <div key={s.id} className="bg-white rounded-2xl p-4 shadow flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-bold text-gray-800 truncate">{s.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {s.status === 'live' && '🔴 直播中'}
                  {s.status === 'created' && '⏰ 未开始'}
                  {s.status === 'ended' && '✅ 已结束'}
                  {s.status === 'canceled' && '⛔ 已取消'}
                  {' · '}课件 {s.material_count} 份 · 看过 {s.viewer_count} 人
                </div>
              </div>
              {s.status !== 'ended' && s.status !== 'canceled' && (
                <>
                  <button
                    onClick={() => startPublish(s, 'camera')}
                    disabled={busy || publishing !== null}
                    className="px-3 py-2 rounded-xl bg-[#FF6B35] text-white text-sm font-bold disabled:opacity-40"
                  >
                    📷 摄像头开播
                  </button>
                  <button
                    onClick={() => startPublish(s, 'screen')}
                    disabled={busy || publishing !== null}
                    className="px-3 py-2 rounded-xl bg-[#FFD23F] text-gray-800 text-sm font-bold disabled:opacity-40"
                  >
                    🖥 共享屏幕
                  </button>
                </>
              )}
              <button
                onClick={() => navigate(`/teacher/livestream/${s.id}/materials`)}
                className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold"
              >
                课件
              </button>
              {s.status === 'ended' && (
                <button
                  onClick={() => navigate(`/teacher/livestream/${s.id}/attendance`)}
                  className="px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold"
                >
                  考勤
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
