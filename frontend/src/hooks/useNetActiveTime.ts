/**
 * 净活动时长计时(全站唯一口径)
 *
 * 只统计孩子真正在操作的时间:答题、翻卡、听写、背句子时点鼠标/动键盘/摸屏幕才算在学。
 *
 * ## 与旧写法的关键差别:发呆前的 60 秒不再被算成学习时间
 *
 * 旧写法是「等 useIdleDetector 判定挂机(无操作满 60 秒)那一刻,才开始扣时间」,
 * 于是判定前的这 60 秒每次都被计入学习时长。生产实测(2026-08-29)近 7 天全站
 * 463 小时里有 25.7 小时(5.5%)是这种宽限期,个别学生占比极高——有学生当天
 * 69.9 分钟里 24 分钟都是它(发呆 24 次 × 60 秒)。而给老师看的规则说明写的是
 * 「超过 1 分钟没操作就暂停计时」,口径对不上。
 *
 * 本 hook 按「活动间隔」记账:
 * - 相邻两次活动间隔 < timeoutMs → 整段算在学(孩子盯着屏幕想题的几十秒是真在学)
 * - 间隔 >= timeoutMs → 整段算挂机,**一秒都不计**(含判定前那 60 秒)
 * - 切后台/锁屏 → 立即封账,回来才重新开始
 *
 * ## 读取不落账(这是本 hook 唯一容易改错的地方)
 *
 * 「封账」(把一段时间确认为学习时间)**只允许发生在真实活动事件、挂机判定、
 * 切屏三处**。netSeconds()/takeDelta() 这类读取必须是纯的:
 * 只返回「已封账 + 当前待定段」,不改 ref。
 *
 * 否则会绕回原来的 bug —— 假设读取也封账并重置锚点,那么一次 5 分钟的发呆里若
 * 每 100ms 渲染一次并读一次,这 5 分钟就被切成 3000 个 100ms 的「间隔」,
 * 每个都小于门槛、每个都被算成在学,发呆反而全额计时。
 *
 * 代价是待定段乐观计入:读取时若距上次活动不足门槛,这段先算在学;之后真的挂机了,
 * 该段不会被封账,读数会**回退**。所以 takeDelta() 用 max(0, …) 兜住,
 * 宁可少报也不多报(与对老师承诺的口径一致)。
 *
 * ## 用法
 *
 * ```ts
 * const { idle, netSeconds, takeDelta } = useNetActiveTime();
 * // 提交时上报增量:各次增量之和 = 整场真实活动时长
 * createLearningRecords({ ..., session_seconds: takeDelta() });
 * ```
 *
 * `takeDelta()` 返回「距上次调用新增的净活动秒数」,后端 study_calendar.duration
 * 按增量累加(见 backend update_study_calendar 的 docstring)。返回 0 是正常情况,
 * 不是缺数——上一次提交刚把增量取走。
 *
 * 纯 UI 用途(发呆提醒/在线状态)仍可用 useIdleDetector,它不参与计时。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_TIMEOUT = 60_000; // 与 useIdleDetector 同一门槛
// 高频事件(mousemove 每秒几十次)节流:封账只是 ref 加法,但定时器重置要省
const THROTTLE_MS = 800;
// keydown/mousedown/touchstart: 明确操作;mousemove/touchmove/wheel: 思考时的小动作也算"人在"
const ACTIVITY_EVENTS = [
  'keydown', 'mousedown', 'touchstart', 'scroll',
  'mousemove', 'touchmove', 'wheel', 'pointerdown',
];

export default function useNetActiveTime(timeoutMs = DEFAULT_TIMEOUT) {
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  // 已封账的净活动毫秒(只增不减)
  const committedMsRef = useRef(0);
  // 上次封账时刻(= 上次确认"人还在"的时刻)
  const anchorRef = useRef(Date.now());
  const hiddenRef = useRef(false);
  // 已通过 takeDelta 上报的秒数,用于算增量
  const reportedSecRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastThrottleRef = useRef(0);

  /** 待定段:距上次封账的时长,不足门槛才乐观计入。纯读,不改 ref。 */
  const pendingMs = useCallback(() => {
    if (hiddenRef.current || idleRef.current) return 0;
    const gap = Date.now() - anchorRef.current;
    return gap > 0 && gap < timeoutMs ? gap : 0;
  }, [timeoutMs]);

  /** 封账:把待定段确认为学习时间,并把锚点移到现在。只在活动/挂机/切屏时调。 */
  const commit = useCallback(() => {
    committedMsRef.current += pendingMs();
    anchorRef.current = Date.now();
  }, [pendingMs]);

  /** 当前净活动秒数(已封账 + 待定段)。纯读。 */
  const netSeconds = useCallback(
    () => Math.round((committedMsRef.current + pendingMs()) / 1000),
    [pendingMs],
  );

  /** 取距上次调用的增量净活动秒数(上报用)。 */
  const takeDelta = useCallback(() => {
    const net = netSeconds();
    // 待定段可能因随后的挂机而不被封账,读数会回退 → max 兜住,只少报不多报
    const delta = Math.max(0, net - reportedSecRef.current);
    reportedSecRef.current = Math.max(reportedSecRef.current, net);
    return delta;
  }, [netSeconds]);

  useEffect(() => {
    hiddenRef.current = document.hidden;
    anchorRef.current = Date.now();

    const goIdle = () => {
      // 判定挂机:此刻待定段恰好 = timeoutMs,按规则整段不计(pendingMs 返回 0)
      commit();
      idleRef.current = true;
      setIdle(true);
    };

    const onActivity = () => {
      const now = Date.now();
      if (!idleRef.current && now - lastThrottleRef.current < THROTTLE_MS) return;
      lastThrottleRef.current = now;
      // 先按挂机前的状态封账,再解除挂机 —— 顺序反了会把挂机那段算进来
      commit();
      if (idleRef.current) {
        idleRef.current = false;
        setIdle(false);
        anchorRef.current = now; // 挂机结束,从这一刻重新起算
      }
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(goIdle, timeoutMs);
    };

    const onVisibility = () => {
      if (document.hidden) {
        commit(); // 切走前把在学的这段封进账,再停表
        hiddenRef.current = true;
        clearTimeout(idleTimerRef.current);
        idleRef.current = true;
        setIdle(true);
      } else {
        hiddenRef.current = false;
        anchorRef.current = Date.now();
        onActivity();
      }
    };

    idleTimerRef.current = setTimeout(goIdle, timeoutMs);
    ACTIVITY_EVENTS.forEach(e =>
      document.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(idleTimerRef.current);
      ACTIVITY_EVENTS.forEach(e => document.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [timeoutMs, commit]);

  return { idle, netSeconds, takeDelta };
}
