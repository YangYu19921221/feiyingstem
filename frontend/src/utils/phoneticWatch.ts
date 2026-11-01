/**
 * 音标视频观看明细: 格式化 + 判状态 + 导出 Excel(2026-11-01)
 *
 * 「看完」用后端存的 completed(services/video_watch.is_completed 的口径),这里不重算;
 * 「看到百分之几」= 看到过的最远处 ÷ 视频时长,只用来显示,不参与判看完。
 */
import {
  CATEGORY_LABELS,
  type WatchRecord, type WatchRecords, type WatchRecordVideo,
} from '../api/phonetics';

/** 秒 → 「3 分 20 秒」。老师读的是"看了多久"不是时间码 */
export function humanDuration(sec: number): string {
  if (!sec || sec <= 0) return '0 秒';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  const s = Math.round(sec % 60);
  if (m <= 0) return `${s} 秒`;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`;
}

/**
 * 后端时间是 UTC 且不带时区后缀(如 2026-10-28T11:42:00)。
 * 直接 new Date 会被当成本地时间,北京 0–8 点看的会显示成前一天
 */
export function parseServerTime(iso?: string | null): Date | null {
  if (!iso) return null;
  let s = iso.includes('T') ? iso : iso.replace(' ', 'T');
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 「10-28」 */
export function shortDay(iso?: string | null): string {
  const d = parseServerTime(iso);
  return d ? `${d.getMonth() + 1}-${d.getDate()}` : '';
}

/** 「10-28 19:42」 */
export function shortDateTime(iso?: string | null): string {
  const d = parseServerTime(iso);
  return d ? `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
}

/** 「2026-10-28 19:42」(导出用,带年份才好排序) */
function fullDateTime(iso?: string | null): string {
  const d = parseServerTime(iso);
  return d
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : '';
}

export type WatchKind = 'none' | 'done' | 'partial';

export interface WatchStatus {
  kind: WatchKind;
  /** 看到过的最远处占全片的百分比;视频时长未知时为 null */
  pct: number | null;
}

export function watchStatus(rec: WatchRecord | undefined, duration?: number | null): WatchStatus {
  if (!rec) return { kind: 'none', pct: null };
  const pct = duration && duration > 0
    ? Math.min(100, Math.round((rec.max_position_seconds / duration) * 100))
    : null;
  return { kind: rec.completed ? 'done' : 'partial', pct };
}

/** 按「学生id:视频id」索引记录 */
export function indexRecords(records: WatchRecord[]): Map<string, WatchRecord> {
  const m = new Map<string, WatchRecord>();
  for (const r of records) m.set(`${r.student_id}:${r.video_id}`, r);
  return m;
}

const minutes = (sec: number) => Math.round((sec / 60) * 10) / 10;

function videoLabel(v: WatchRecordVideo): string {
  return v.is_active ? v.title : `${v.title}(已下架)`;
}

/**
 * 导出三张表:
 * 1. 每人每节: 一行 = 一个学生 × 一节课,**没看的也有一行**(做数据透视时才数得对)
 * 2. 学生×视频: 一眼看谁哪节没看(✓ 看完 / 60% / 空 = 没看)
 * 3. 视频汇总: 每节几个人看过、几个人看完
 */
export async function exportWatchRecords(data: WatchRecords, scopeLabel: string): Promise<void> {
  const XLSX = await import('xlsx');
  const idx = indexRecords(data.records);
  const hasClasses = data.students.some((s) => s.classes.length > 0);

  // ① 每人每节
  const head1 = [
    ...(hasClasses ? ['班级'] : []),
    '学生', '序号', '分类', '视频', '讲师', '视频时长(分)',
    '状态', '看到(%)', '观看时长(分)', '打开次数', '第一次看', '最后一次看',
  ];
  const rows1: (string | number)[][] = [head1];
  for (const s of data.students) {
    data.videos.forEach((v, i) => {
      const r = idx.get(`${s.student_id}:${v.id}`);
      const st = watchStatus(r, v.duration_seconds);
      rows1.push([
        ...(hasClasses ? [s.classes.join('、')] : []),
        s.name,
        i + 1,
        CATEGORY_LABELS[v.category] || v.category,
        videoLabel(v),
        v.lecturer || '',
        v.duration_seconds ? minutes(v.duration_seconds) : '',
        st.kind === 'done' ? '看完' : st.kind === 'partial' ? '没看完' : '没看',
        st.pct ?? '',
        r ? minutes(r.watch_seconds) : 0,
        r ? r.play_count : 0,
        fullDateTime(r?.first_viewed_at),
        fullDateTime(r?.last_viewed_at),
      ]);
    });
  }

  // ② 学生×视频
  const head2 = [
    ...(hasClasses ? ['班级'] : []),
    '学生', '看完几节', '看过几节', '累计观看(分)',
    ...data.videos.map((v, i) => `${i + 1}. ${videoLabel(v)}`),
  ];
  const rows2: (string | number)[][] = [head2];
  for (const s of data.students) {
    let done = 0;
    let started = 0;
    let secs = 0;
    const cells = data.videos.map((v) => {
      const r = idx.get(`${s.student_id}:${v.id}`);
      if (!r) return '';
      started += 1;
      secs += r.watch_seconds;
      if (r.completed) { done += 1; return '✓'; }
      const st = watchStatus(r, v.duration_seconds);
      return st.pct != null ? `${st.pct}%` : '看过';
    });
    rows2.push([
      ...(hasClasses ? [s.classes.join('、')] : []),
      s.name, done, started, minutes(secs), ...cells,
    ]);
  }

  // ③ 视频汇总
  const rosterKnown = data.scope === 'my_classes';
  const head3 = [
    '序号', '分类', '视频', '讲师', '状态', '视频时长(分)',
    // 看完率 = 看完 ÷ 看过的人,与页面上「看完率」同一个算法;没人看过时留空(不是 0)
    '看过人数', '看完人数', '看完率(%)', ...(rosterKnown ? ['没看人数'] : []),
    '播放次数', '人均观看(分)',
  ];
  const rows3: (string | number)[][] = [head3];
  data.videos.forEach((v, i) => {
    const rs = data.records.filter((r) => r.video_id === v.id);
    const viewers = rs.length;
    const done = rs.filter((r) => r.completed).length;
    const plays = rs.reduce((a, r) => a + r.play_count, 0);
    const secs = rs.reduce((a, r) => a + r.watch_seconds, 0);
    const n = data.students.length;
    rows3.push([
      i + 1,
      CATEGORY_LABELS[v.category] || v.category,
      v.title,
      v.lecturer || '',
      v.is_active ? '在架' : '已下架',
      v.duration_seconds ? minutes(v.duration_seconds) : '',
      viewers,
      done,
      // 视频时长未知时判不了看完(恒为 0 人),写空不写 0
      viewers > 0 && v.duration_seconds ? Math.round((done / viewers) * 100) : '',
      ...(rosterKnown ? [n - viewers] : []),
      plays,
      viewers > 0 ? minutes(secs / viewers) : 0,
    ]);
  });

  const wb = XLSX.utils.book_new();
  const sheet = (rows: (string | number)[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map((wch) => ({ wch }));
    return ws;
  };
  XLSX.utils.book_append_sheet(
    wb,
    sheet(rows1, [...(hasClasses ? [12] : []), 10, 5, 8, 28, 10, 8, 7, 7, 8, 7, 16, 16]),
    '每人每节',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(rows2, [...(hasClasses ? [12] : []), 10, 8, 8, 10, ...data.videos.map(() => 12)]),
    '学生×视频',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(rows3, [5, 8, 28, 10, 7, 8, 8, 8, 9, ...(rosterKnown ? [8] : []), 8, 10]),
    '视频汇总',
  );

  const d = new Date();
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  XLSX.writeFile(wb, `音标视频观看明细_${scopeLabel}_${day}.xlsx`);
}
