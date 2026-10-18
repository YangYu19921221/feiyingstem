/**
 * 分类学习「学习报告」分享图 —— 给家长看,长按保存发家长微信/班级群
 *
 * 写什么由 utils/learningReport.ts 决定,这里只管画。共用画法在 components/report/canvasKit
 * (与首页「今日学习报告」同一套),弹层与保存/分享/复制在 components/report/ShareImageDialog。
 */
import { useCallback } from 'react';
import ShareImageDialog from '../report/ShareImageDialog';
import {
  CARD_Y, CONTENT_W, FOOTER_H, PAD, SECTION_GAP, TIER_COLOR, TITLE_H,
  drawCard, drawFooter, drawHeader, drawStats, drawTips, drawWeakRows, fillRoundRect, fitText, font,
  layoutTips, measureContext, prepareCanvas, sectionTitle, tierArt, weakBlockHeight,
} from '../report/canvasKit';
import { reportText, type LearningReport, type ReportWord } from '../../utils/learningReport';

const CARD_H = 300;
const SECTIONS_TOP = CARD_Y + CARD_H + 44;
const CHIP_H = 52;
const CHIP_PAD = 18;
const CHIP_GAP = 12;
/** 单元动辄 40 词: 列表封顶,图太长家长不会往下翻,手机生成超长 canvas 也容易失败 */
const MAX_WEAK_ROWS = 20;
const MAX_CHIPS = 40;

interface Chip {
  x: number;
  y: number;
  w: number;
  word: string;
  wordW: number;
  meaning: string | null;
  more?: boolean;
}

/** 「第一次就拼对」的词: 胶囊流式排版,一行放不下就换行 */
function layoutChips(m: CanvasRenderingContext2D, words: ReportWord[], maxW: number): { chips: Chip[]; height: number } {
  const shown = words.length > MAX_CHIPS ? words.slice(0, MAX_CHIPS - 1) : words;
  const items: Array<{ word: string; meaning: string | null; more?: boolean }> = shown.map(w => ({ word: w.word, meaning: w.meaning }));
  if (shown.length < words.length) items.push({ word: `…等共 ${words.length} 个`, meaning: null, more: true });

  const chips: Chip[] = [];
  let x = 0;
  let y = 0;
  for (const it of items) {
    m.font = font(26, 700);
    const word = fitText(m, it.word, maxW - CHIP_PAD * 2);
    const wordW = m.measureText(word).width;
    let meaning = it.meaning;
    let w = CHIP_PAD * 2 + wordW;
    if (meaning) {
      m.font = font(22);
      const room = maxW - w - 8;
      meaning = room > 40 ? fitText(m, meaning, room) : null;
      if (meaning) w += 8 + m.measureText(meaning).width;
    }
    if (x > 0 && x + w > maxW) {
      x = 0;
      y += CHIP_H + CHIP_GAP;
    }
    chips.push({ x, y, w, word, wordW, meaning, more: it.more });
    x += w + CHIP_GAP;
  }
  return { chips, height: chips.length > 0 ? y + CHIP_H : 0 };
}

/** 先排版算出总高,再按总高建画布 —— canvas 改尺寸会清空内容,不能边画边长 */
function planReport(m: CanvasRenderingContext2D, r: LearningReport) {
  let y = SECTIONS_TOP;

  const weakTop = y;
  const weakRows = r.weak.slice(0, MAX_WEAK_ROWS);
  const weakMore = r.weak.length - weakRows.length;
  y += TITLE_H + weakBlockHeight(weakRows.length, weakMore) + SECTION_GAP;

  const tipsTop = y;
  const tips = layoutTips(m, r.suggestions);
  y += TITLE_H + tips.cardH + SECTION_GAP;

  let chipsTop: number | null = null;
  let chips: Chip[] = [];
  if (r.mastered.length > 0) {
    chipsTop = y;
    const laid = layoutChips(m, r.mastered, CONTENT_W);
    chips = laid.chips;
    y += TITLE_H + laid.height + SECTION_GAP;
  }

  return { height: y + FOOTER_H, weakTop, weakRows, weakMore, tipsTop, tips, chipsTop, chips, footerTop: y };
}

async function drawReport(canvas: HTMLCanvasElement, r: LearningReport, orgName: string | null) {
  const plan = planReport(measureContext(), r);
  const art = await tierArt(r.tier);
  const tc = TIER_COLOR[r.tier];
  const ctx = prepareCanvas(canvas, plan.height);

  drawHeader(ctx, {
    orgName,
    title: r.childName ? `${r.childName}的学习报告` : '今日学习报告',
    lines: [r.bookName, r.unitName].filter((s): s is string => !!s),
    meta: [r.progressText, r.dateText].filter(Boolean).join(' · '),
    art,
  });

  // 成绩卡
  drawCard(ctx, CARD_Y, CARD_H);
  const sx = PAD + 36;
  ctx.fillStyle = tc.main;
  ctx.font = font(112, 900);
  const scoreText = String(r.rate);
  ctx.fillText(scoreText, sx, CARD_Y + 128);
  const scoreW = ctx.measureText(scoreText).width;
  ctx.font = font(34, 700);
  ctx.fillText('分', sx + scoreW + 8, CARD_Y + 128);
  const fenW = ctx.measureText('分').width;

  ctx.font = font(26, 800);
  const pillW = ctx.measureText(r.rankText).width + 40;
  const px = sx + scoreW + 8 + fenW + 20;
  ctx.fillStyle = tc.soft;
  fillRoundRect(ctx, px, CARD_Y + 68, pillW, 48, 24);
  ctx.fillStyle = tc.main;
  ctx.fillText(r.rankText, px + 20, CARD_Y + 101);

  ctx.fillStyle = '#6B7280';
  ctx.font = font(22);
  ctx.fillText('听写第一次就拼对的比例', sx, CARD_Y + 170);

  ctx.fillStyle = '#F3F4F6';
  ctx.fillRect(PAD + 30, CARD_Y + 198, CONTENT_W - 60, 2);

  drawStats(ctx, CARD_Y + 250, [
    [String(r.totalWords), ' 个', '这次学的词'],
    [`${r.firstTryCorrect}/${r.dictTotal}`, '', '一次拼对'],
    [String(r.minutes), ' 分钟', '专注学习'],
  ]);

  sectionTitle(ctx, plan.weakTop, '还要多练', '#FF6B35', `${r.weak.length} 个`);
  drawWeakRows(ctx, plan.weakTop + TITLE_H, plan.weakRows, plan.weakMore, {
    empty: '这次没有拼错的词,全部第一次就拼对了',
    more: `另有 ${plan.weakMore} 个词,都在孩子的「错题集」里`,
  });

  sectionTitle(ctx, plan.tipsTop, '给家长的建议', '#FFD23F');
  drawTips(ctx, plan.tipsTop + TITLE_H, plan.tips);

  if (plan.chipsTop != null) {
    sectionTitle(ctx, plan.chipsTop, '第一次就拼对', '#5FD35F', `${r.mastered.length} 个`);
    const top = plan.chipsTop + TITLE_H;
    for (const c of plan.chips) {
      const x = PAD + c.x;
      const cy2 = top + c.y;
      ctx.fillStyle = c.more ? '#F3F4F6' : '#ECFDF3';
      fillRoundRect(ctx, x, cy2, c.w, CHIP_H, CHIP_H / 2);
      ctx.fillStyle = c.more ? '#6B7280' : '#15803D';
      ctx.font = font(26, 700);
      ctx.fillText(c.word, x + CHIP_PAD, cy2 + 35);
      if (c.meaning) {
        ctx.fillStyle = '#4B5563';
        ctx.font = font(22);
        ctx.fillText(c.meaning, x + CHIP_PAD + c.wordW + 8, cy2 + 35);
      }
    }
  }

  drawFooter(ctx, plan.footerTop, orgName || '分类学习 · 学习报告', '成绩来自孩子这次的真实作答');
}

interface Props {
  report: LearningReport;
  /** 落款用的机构名;取不到就写「分类学习 · 学习报告」 */
  orgName: string | null;
  /** 请传稳定引用(useCallback): Esc 监听依赖它 */
  onClose: () => void;
}

export default function LearningReportDialog({ report, orgName, onClose }: Props) {
  const draw = useCallback((canvas: HTMLCanvasElement) => drawReport(canvas, report, orgName), [report, orgName]);
  const fileName = `${[report.childName, report.unitName, report.dateText.split(' ')[0]].filter(Boolean).join('-')}-学习报告.jpg`;
  const altText = `${report.childName || ''}学习报告:${report.unitName},听写一次拼对 ${report.firstTryCorrect}/${report.dictTotal}`
    + `${report.weak.length > 0 ? `,还要多练 ${report.weak.map(w => w.word).join('、')}` : ''}。长按可保存`;
  return (
    <ShareImageDialog
      title="学习报告"
      draw={draw}
      text={reportText(report, orgName)}
      fileName={fileName}
      altText={altText}
      onClose={onClose}
    />
  );
}
