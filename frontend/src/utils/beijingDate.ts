/**
 * 北京日历日工具
 *
 * 坑:new Date().toISOString() 是 UTC 日期,北京比 UTC 快 8 小时——
 * 北京 0点~8点 之间用它算"今天/昨天"会慢一天(实测把 07-18 的单词王
 * 标成"昨日"、结算日期也算错)。全站学习数据按北京日统计,前端凡涉及
 * "今天是哪天"一律走这里。
 */

/** 北京时区的日历日 YYYY-MM-DD。offsetDays=-1 即北京的昨天。 */
export const beijingDate = (offsetDays = 0): string =>
  new Date(Date.now() + 8 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);

/** 给带日期的文案(如 "2026-07-18 单词王")生成 今日/昨日/MM-DD 前缀;无日期返回空串 */
export const beijingDayPrefix = (text: string | null | undefined): string => {
  const m = text?.match(/\d{4}-\d{2}-\d{2}/);
  if (!m) return '';
  const d = m[0];
  if (d === beijingDate(0)) return '今日';
  if (d === beijingDate(-1)) return '昨日';
  return d.slice(5);
};
