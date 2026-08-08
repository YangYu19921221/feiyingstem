/**
 * 未开放任务的开放日文案 —— 学生端首页任务卡与「我的作业」共用一份,
 * 免得两处各写一遍、文案对不上("明天"vs"8月9日")。
 *
 * 入参是后端给的北京墙上时间字符串(available_from),按本地解析。
 */
export function formatOpenDay(availableFrom?: string | null): string {
  if (!availableFrom) return '';
  const open = new Date(availableFrom);
  if (Number.isNaN(open.getTime())) return '';

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startOfDay(open).getTime() - startOfDay(new Date()).getTime()) / 86400000
  );

  if (dayDiff <= 0) return '今天';
  if (dayDiff === 1) return '明天';
  const week = ['日', '一', '二', '三', '四', '五', '六'][open.getDay()];
  return `${open.getMonth() + 1}月${open.getDate()}日(周${week})`;
}
