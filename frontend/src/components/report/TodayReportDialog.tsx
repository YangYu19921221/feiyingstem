/**
 * 「今日学习报告」分享图 —— 孩子做完当天全部任务后,一天一张发给家长
 *
 * 写什么由 utils/todayReport.ts 决定,这里只管画;画法与分类学习「学习报告」共用 components/report/canvasKit。
 */
import { useCallback, useMemo } from 'react';
import ShareImageDialog from './ShareImageDialog';
import {
  CARD_Y, CONTENT_W, FOOTER_H, PAD, SECTION_GAP, TIER_COLOR, TITLE_H, W,
  drawCard, drawFooter, drawHeader, drawStats, drawTips, drawWeakRows, fillRoundRect, fitText, font,
  layoutTips, measureContext, prepareCanvas, sectionTitle, tierArt, weakBlockHeight,
} from './canvasKit';
import type { TodayReportData } from '../../api/todayReport';
import { reportChildName } from '../../utils/learningReport';
import { buildTodayReport, hasScore, todayReportText, type TodayReport } from '../../utils/todayReport';

const CARD_H = 270;
const SECTIONS_TOP = CARD_Y + CARD_H + 44;
const TASK_H = 92;
const TASK_GAP = 12;
/** 一天十几份任务的少见,封顶防图太长 */
const MAX_TASKS = 12;
const MAX_WEAK_ROWS = 20;

function planReport(m: CanvasRenderingContext2D, r: TodayReport) {
  let y = SECTIONS_TOP;

  const tasksTop = y;
  const tasks = r.tasks.slice(0, MAX_TASKS);
  const tasksMore = r.tasks.length - tasks.length;
  y += TITLE_H + tasks.length * (TASK_H + TASK_GAP) - TASK_GAP + (tasksMore > 0 ? 44 : 0) + SECTION_GAP;

  // 今天一道计分题都没做(只做了分类自评)时不画「还要多练」,写「一次都没错」是瞎说
  let weakTop: number | null = null;
  const weakRows = r.weak.slice(0, MAX_WEAK_ROWS);
  const weakMore = r.weakTotal - weakRows.length;
  if (r.scoredWords > 0) {
    weakTop = y;
    y += TITLE_H + weakBlockHeight(weakRows.length, weakMore) + SECTION_GAP;
  }

  const tipsTop = y;
  const tips = layoutTips(m, r.suggestions);
  y += TITLE_H + tips.cardH + SECTION_GAP;

  return { height: y + FOOTER_H, tasksTop, tasks, tasksMore, weakTop, weakRows, weakMore, tipsTop, tips, footerTop: y };
}

async function drawTodayReport(canvas: HTMLCanvasElement, r: TodayReport, orgName: string | null) {
  const plan = planReport(measureContext(), r);
  const art = await tierArt(r.tier);
  const tc = TIER_COLOR[r.tier];
  const ctx = prepareCanvas(canvas, plan.height);

  drawHeader(ctx, {
    orgName,
    title: r.childName ? `${r.childName}的今日学习报告` : '今日学习报告',
    lines: ['今天的任务全部完成'],
    meta: r.dateText,
    art,
  });

  // 成绩卡: 完成几份任务 + 三栏小数字
  drawCard(ctx, CARD_Y, CARD_H);
  const sx = PAD + 36;
  ctx.fillStyle = '#6B7280';
  ctx.font = font(24, 600);
  ctx.fillText('老师布置的任务', sx, CARD_Y + 50);
  ctx.fillStyle = tc.main;
  ctx.font = font(96, 900);
  const big = `${r.todayDone}/${r.todayTotal}`;
  ctx.fillText(big, sx, CARD_Y + 140);
  const bigW = ctx.measureText(big).width;
  ctx.font = font(26, 800);
  const pill = '全部完成';
  const pillW = ctx.measureText(pill).width + 40;
  const px = sx + bigW + 24;
  ctx.fillStyle = tc.soft;
  fillRoundRect(ctx, px, CARD_Y + 88, pillW, 48, 24);
  ctx.fillStyle = tc.main;
  ctx.fillText(pill, px + 20, CARD_Y + 121);

  ctx.fillStyle = '#F3F4F6';
  ctx.fillRect(PAD + 30, CARD_Y + 168, CONTENT_W - 60, 2);
  drawStats(ctx, CARD_Y + 220, [
    [String(r.wordsLearned), ' 个', '今天学的词'],
    [r.scoredWords > 0 ? `${r.neverWrong}/${r.scoredWords}` : '—', '', '一次都没错'],
    [String(r.minutes), ' 分钟', '学习时长'],
  ]);

  // 今天完成的任务
  sectionTitle(ctx, plan.tasksTop, '今天完成的任务', '#5FD35F', `${r.tasks.length} 份`);
  let y = plan.tasksTop + TITLE_H;
  for (const t of plan.tasks) {
    ctx.fillStyle = '#F0FDF4';
    fillRoundRect(ctx, PAD, y, CONTENT_W, TASK_H, 18);
    const right = W - PAD - 24;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#15803D';
    let scoreW: number;
    if (hasScore(t)) {
      ctx.font = font(30, 800);
      const score = `${t.best_score}`;
      ctx.fillText(score, right - 30, y + 56);
      scoreW = ctx.measureText(score).width;
      ctx.font = font(22, 600);
      ctx.fillText('分', right, y + 56);
    } else {
      // 句子/音标/复习作业没有分数,只写做完了
      ctx.font = font(24, 700);
      const mark = t.status === 'completed' ? '✓ 完成' : '未完成';
      ctx.fillText(mark, right, y + 56);
      scoreW = ctx.measureText(mark).width - 30;
    }
    ctx.textAlign = 'left';
    const leftMax = CONTENT_W - 48 - scoreW - 60;
    ctx.fillStyle = '#1F2937';
    ctx.font = font(28, 800);
    ctx.fillText(fitText(ctx, t.line, leftMax), PAD + 24, y + 40);
    ctx.fillStyle = '#6B7280';
    ctx.font = font(20);
    ctx.fillText(fitText(ctx, t.sub, leftMax), PAD + 24, y + 72);
    y += TASK_H + TASK_GAP;
  }
  if (plan.tasksMore > 0) {
    ctx.fillStyle = '#9CA3AF';
    ctx.font = font(22);
    ctx.fillText(`另有 ${plan.tasksMore} 份任务`, PAD + 4, y + 20);
  }

  if (plan.weakTop != null) {
    sectionTitle(ctx, plan.weakTop, '还要多练', '#FF6B35', `${r.weakTotal} 个`);
    drawWeakRows(ctx, plan.weakTop + TITLE_H, plan.weakRows, plan.weakMore, {
      empty: `今天做过的 ${r.scoredWords} 个词,一次都没错`,
      more: `另有 ${plan.weakMore} 个词,都在孩子的「错题集」里`,
    });
  }

  sectionTitle(ctx, plan.tipsTop, '给家长的建议', '#FFD23F');
  drawTips(ctx, plan.tipsTop + TITLE_H, plan.tips);

  drawFooter(ctx, plan.footerTop, orgName || '今日学习报告', '数据来自孩子今天的真实作答');
}

interface Props {
  data: TodayReportData;
  /** 请传稳定引用(useCallback): Esc 监听依赖它 */
  onClose: () => void;
}

export default function TodayReportDialog({ data, onClose }: Props) {
  const report = useMemo(() => {
    let name = '';
    try {
      // 姓名优先,没填用用户名,带数字的用户名(常是手机号)不用 —— 图会发到群里
      name = reportChildName(JSON.parse(localStorage.getItem('user') || 'null'));
    } catch { /* 取不到就不写名字 */ }
    return buildTodayReport(data, name);
  }, [data]);
  const orgName = data.org_name;
  const draw = useCallback((canvas: HTMLCanvasElement) => drawTodayReport(canvas, report, orgName), [report, orgName]);
  const fileName = `${[report.childName, report.dateText.split(' ')[0]].filter(Boolean).join('-')}-今日学习报告.jpg`;
  const altText = `${report.childName || ''}今日学习报告:${report.todayTotal} 份任务全部完成,学了 ${report.wordsLearned} 个词`
    + `${report.weakTotal > 0 ? `,还要多练 ${report.weak.map(w => w.word).join('、')}` : ''}。长按可保存`;
  return (
    <ShareImageDialog
      title="今日学习报告"
      draw={draw}
      text={todayReportText(report, orgName)}
      fileName={fileName}
      altText={altText}
      onClose={onClose}
    />
  );
}
