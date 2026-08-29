/**
 * 把本页的净活动时长计入学习日历(一行接入)。
 *
 * 用于「有学习行为但没有逐题落库」的页面 —— 它们此前一秒都不进 study_calendar,
 * 孩子在这些页面上学多久,教师端/家长端都显示 0:
 * 单元考试、阅读理解、错题闯关、独立听写页、音标闯关、竞赛、PK 对战。
 *
 * 已经在提交学习记录时带 `session_seconds` 的页面**不要**再用这个 hook
 * (分类/卡片/拼写/选择/填空),否则同一段时间会被计两遍。
 *
 * 上报时机:
 * - `done` 变 true 时结一次(完成一轮就入账,不必等退出)
 * - 组件卸载时补尾巴(中途返回也不丢)
 * 走 submitReliably 队列 + 幂等键,断网/关页下次打开自动补交,不会重复计时。
 *
 * ```ts
 * useStudyTimeReporter(phase === 'result');   // 完成即结算
 * useStudyTimeReporter();                     // 只在退出时结算
 * ```
 */
import { useCallback, useEffect, useRef } from 'react';
import { reportStudyTime } from '../api/learningRecords';
import useNetActiveTime from './useNetActiveTime';

export default function useStudyTimeReporter(done: boolean = false) {
  const { takeDelta } = useNetActiveTime();

  const flush = useCallback(() => {
    const delta = takeDelta();
    if (delta > 0) reportStudyTime(delta).catch(() => {});
  }, [takeDelta]);

  useEffect(() => {
    if (done) flush();
  }, [done, flush]);

  // 卸载时补尾巴:用 ref 拿最新的 flush,避免把它列进依赖导致每次重渲染都结算
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);
}
