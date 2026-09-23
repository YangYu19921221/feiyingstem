/**
 * 音标视频观看心跳 —— 把「真的看了多久 / 停在哪」报给后端。
 *
 * ## 为什么按 timeupdate 的**差值**累计,不用 setInterval 数墙上时间
 *
 * 墙上时间数的是"页面开着多久",不是"视频播了多久":暂停、缓冲、切到后台
 * (浏览器会把后台标签的 timer 压到一分钟一次)、拖进度条,四件事都会让这两个数
 * 分道扬镳。而这个时长会进老师的学情页 —— 报「看了 40 分钟」而孩子其实开着页面
 * 去吃饭了,比不报更糟。
 *
 * timeupdate 的差值天然只在播放时增长;再把差值按 `MAX_STEP` 夹一下,
 * 拖动进度条产生的大跳跃(前进 10 分钟)就不会被算成"看了 10 分钟"。
 *
 * ## 三个必须报的时机
 *
 * 播放中定时报只解决"看着的时候";真正容易丢的是**最后一段**:
 * 孩子看完直接关标签页 / 按返回,那段没报的时长和最终位置就没了,
 * 而「看到哪了」正是下次续播要用的。所以另外两个时机:
 * - `pause`(含看完触发的 ended):立刻把攒着的报掉
 * - `pagehide` / 组件卸载:同上。**用 pagehide 不用 beforeunload** ——
 *   iOS Safari 基本不发 beforeunload,而手机是孩子看视频的主力设备。
 *   这一枪走 `fetch(keepalive)` 而不是 axios(会被掐掉)也不是 sendBeacon
 *   (带不上 Authorization 头,理由见 flush 里的注释)。
 */
import { useCallback, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../../config/env';
import { phoneticsApi, WATCH_HEARTBEAT_SEC } from '../../api/phonetics';

/** 单次 timeupdate 差值的上限(秒)。超过就是拖进度条,不是真看了那么久 */
const MAX_STEP = 3;

export function useWatchHeartbeat(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  videoId: number,
  /** 看完的回调(用于就地把卡片标成「已看完」,不必重拉列表) */
  onCompleted?: () => void,
) {
  // 攒着还没报的秒数。用 ref 不用 state:它每秒都在变,进 state 会把播放器重渲染几十次
  const pending = useRef(0);
  const lastT = useRef(0);
  const position = useRef(0);
  const duration = useRef<number | null>(null);
  const completedRef = useRef(false);
  // 回调走 ref: 调用方常传内联箭头函数,直接列进依赖会让整套监听每渲染重挂一遍
  // (监听重挂就丢掉 lastT 基准 → 时长少算)。**写入放在 effect 里而不是渲染期**,
  // 渲染期改 ref 会被 react-hooks/refs 拦下,而且 StrictMode 双调用下语义不明确
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => { onCompletedRef.current = onCompleted; }, [onCompleted]);

  /** 报一次。`beacon` 用于页面正在关闭的那一枪 */
  const flush = useCallback((beacon = false) => {
    const secs = Math.round(pending.current);
    // 位置要报(续播用),所以 secs 为 0 也可能值得报 —— 但只在真有东西时报,
    // 免得暂停着的页面每 30 秒打一发空请求
    if (secs <= 0 && position.current <= 0) return;
    pending.current = 0;
    const body = {
      seconds: secs,
      position: Math.round(position.current),
      duration: duration.current,
    };

    if (beacon) {
      // 页面关闭中:axios/普通 fetch 会被浏览器掐掉,要 keepalive 才发得出去。
      //
      // ⚠️ **刻意不用 navigator.sendBeacon**: 它带不上 Authorization 头,
      // 唯一的替代是把 token 塞进 URL —— 而那正是本项目 2026-09-09 刚堵掉的洞
      // (视频地址里放整站会话 token,抄走地址栏 = 拿走账号)。为了一条统计数字
      // 把它重新打开,还会让 token 落进服务器访问日志和浏览器历史,不值当。
      // `fetch(keepalive)` 能带头,是这一刻唯一既发得出去又不漏凭证的做法。
      try {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        void fetch(`${API_BASE_URL}/phonetics/videos/${videoId}/progress`, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }).catch(() => {});
      } catch { /* 关页面路上的失败没人看得到,也没法补救 */ }
      return;
    }

    phoneticsApi.reportProgress(videoId, body).then((r) => {
      // 看完只通知一次(后端 completed 只置不清,这里也别重复弹)
      if (r?.completed && !completedRef.current) {
        completedRef.current = true;
        onCompletedRef.current?.();
      }
    }).catch(() => { /* 统计不重要到可以打断孩子看视频,失败静默 */ });
  }, [videoId]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // 换视频:计数全部归零(否则上一个视频攒着的秒数会记到下一个头上)
    pending.current = 0;
    lastT.current = 0;
    position.current = 0;
    duration.current = null;
    completedRef.current = false;

    const onTime = () => {
      const t = v.currentTime;
      const step = t - lastT.current;
      lastT.current = t;
      position.current = t;
      // 只认小步前进:负数是往回拖,大步是往前拖,都不是"看了这么久"
      if (step > 0 && step <= MAX_STEP) pending.current += step;
    };
    // 拖进度条落地后重置基准,免得把跳跃算进下一次差值
    const onSeeked = () => { lastT.current = v.currentTime; position.current = v.currentTime; };
    const onMeta = () => {
      if (v.duration && Number.isFinite(v.duration)) duration.current = Math.round(v.duration);
      lastT.current = v.currentTime;
    };
    const onPause = () => flush();
    const onHide = () => flush(true);

    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    window.addEventListener('pagehide', onHide);

    const timer = window.setInterval(() => {
      // 没在播就不报:暂停时 pause 已经报过一次了
      if (!v.paused) flush();
    }, WATCH_HEARTBEAT_SEC * 1000);

    return () => {
      window.clearInterval(timer);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      window.removeEventListener('pagehide', onHide);
      // 关播放器那一下也要把最后一段报掉(这是最常见的退出方式:
      // 孩子看完点 X,不 flush 就丢掉最后不到 30 秒 + 最终位置)
      flush();
    };
  }, [videoRef, videoId, flush]);
}
