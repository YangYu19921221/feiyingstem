/**
 * 分类学习「学习报告」分享图 —— 给家长看,长按保存发家长微信/班级群
 *
 * 写什么由 utils/learningReport.ts 决定,这里只管画。
 *
 * 为什么 canvas 现画、不让 AI 出整张图: 生图模型画不准中文和单词表(会编字母),每张 15–60 秒还按张计费。
 * AI 只出了三张不带字的吉祥物插画(public/report-card/*.jpg,脚本 backend/scripts/gen_report_card_art.py),
 * 按成绩档位挑一张贴上去;字、分数、单词全部来自孩子这次的真实作答。出图套路与家长推荐海报
 * (components/referral/InviteShareDialog)相同。
 *
 * 长按保存: 学习页同时挂着 usePreventCopy、根节点 .no-select(touch-callout:none)、main.tsx 的学生端禁右键,
 * 三处都会吃掉安卓微信的长按菜单。所以图片带 data-allow-save(两处 JS 拦截认它)+ allow-select(CSS 认它)。
 * 弹层走 portal 挂到 body: 结算页外层有 framer-motion 的 transform,fixed 定位会被它困住。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, LoaderCircle, Share2, X } from 'lucide-react';
import { toast } from '../Toast';
import { reportText, type LearningReport, type ReportTier, type ReportWord, type WeakWord } from '../../utils/learningReport';

const W = 750;                 // 逻辑宽度,布局都按它算
const SCALE = 1.5;             // 输出 1125 像素宽: 发到群里点开放大,字不糊
/** 画布像素总量上限。iOS Safari 超过约 1678 万像素直接画不出(toDataURL 返回空图),留余量 */
const MAX_PIXELS = 12_000_000;
const PAD = 40;
const CONTENT_W = W - PAD * 2;
const FAMILY = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

const HEADER_H = 340;
const CARD_Y = 300;            // 成绩卡压在橙色头图下沿
const CARD_H = 300;
const SECTIONS_TOP = CARD_Y + CARD_H + 44;
const TITLE_H = 56;
const SECTION_GAP = 36;
const ROW_H = 80;
const ROW_GAP = 12;
const EMPTY_H = 84;
const MORE_H = 44;
const TIP_PAD = 24;
const TIP_INDENT = 44;
const TIP_SIZE = 26;
const TIP_LINE_H = 40;
const TIP_GAP = 14;
const CHIP_H = 52;
const CHIP_PAD = 18;
const CHIP_GAP = 12;
const FOOTER_H = 120;
/** 单元动辄 40 词: 列表封顶,图太长家长不会往下翻,手机生成超长 canvas 也容易失败 */
const MAX_WEAK_ROWS = 20;
const MAX_CHIPS = 40;

const TIER_COLOR: Record<ReportTier, { main: string; soft: string }> = {
  excellent: { main: '#FF6B35', soft: '#FFE8DD' },
  good: { main: '#F59E0B', soft: '#FEF3C7' },
  // 低分不用红色: 图要发到群里,红字分数等于当众难堪,蓝色是「还在路上」
  keep: { main: '#0EA5E9', soft: '#E0F2FE' },
};

/** canvas 的 roundRect 要 iOS 16+ / Chrome 99+,老 iPhone 的微信里没有,退成直角矩形 */
function fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/** 放不下就截断加省略号(按字符而非 UTF-16 码元截,不会切坏生僻字) */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && ctx.measureText(`${chars.join('')}…`).width > maxW) chars.pop();
  return `${chars.join('')}…`;
}

/** 折行。英文单词整体不拆(建议里常有「apple 写成了 aple」),中文逐字可断;超出行数末行加省略号 */
function breakLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const tokens = text.match(/[A-Za-z0-9'’-]+|[\s\S]/gu) ?? [];
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const test = line + tokens[i];
    if (line && ctx.measureText(test).width > maxW) {
      if (lines.length === maxLines - 1) {
        lines.push(fitText(ctx, line + tokens.slice(i).join(''), maxW));
        return lines;
      }
      lines.push(line.trimEnd());
      line = tokens[i].trimStart();
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

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

interface Plan {
  height: number;
  weakTop: number;
  weakRows: WeakWord[];
  weakMore: number;
  tipsTop: number;
  tipLines: string[][];
  tipsCardH: number;
  chipsTop: number | null;
  chips: Chip[];
  footerTop: number;
}

/** 先排版算出总高,再按总高建画布 —— canvas 改尺寸会清空内容,不能边画边长 */
function planReport(m: CanvasRenderingContext2D, r: LearningReport): Plan {
  let y = SECTIONS_TOP;

  const weakTop = y;
  y += TITLE_H;
  const weakRows = r.weak.slice(0, MAX_WEAK_ROWS);
  const weakMore = r.weak.length - weakRows.length;
  y += weakRows.length === 0 ? EMPTY_H : weakRows.length * (ROW_H + ROW_GAP) - ROW_GAP;
  if (weakMore > 0) y += MORE_H;
  y += SECTION_GAP;

  const tipsTop = y;
  y += TITLE_H;
  m.font = font(TIP_SIZE);
  const tipLines = r.suggestions.map(s => breakLines(m, s, CONTENT_W - TIP_PAD * 2 - TIP_INDENT, 3));
  const tipsBody = tipLines.reduce((sum, lines) => sum + lines.length * TIP_LINE_H, 0) + Math.max(0, tipLines.length - 1) * TIP_GAP;
  const tipsCardH = tipsBody + TIP_PAD * 2;
  y += tipsCardH + SECTION_GAP;

  let chipsTop: number | null = null;
  let chips: Chip[] = [];
  if (r.mastered.length > 0) {
    chipsTop = y;
    const laid = layoutChips(m, r.mastered, CONTENT_W);
    chips = laid.chips;
    y += TITLE_H + laid.height + SECTION_GAP;
  }

  return { height: y + FOOTER_H, weakTop, weakRows, weakMore, tipsTop, tipLines, tipsCardH, chipsTop, chips, footerTop: y };
}

function sectionTitle(ctx: CanvasRenderingContext2D, y: number, title: string, bar: string, extra?: string) {
  ctx.textAlign = 'left';
  ctx.fillStyle = bar;
  fillRoundRect(ctx, PAD, y + 8, 8, 30, 4);
  ctx.fillStyle = '#1F2937';
  ctx.font = font(32, 800);
  ctx.fillText(title, PAD + 20, y + 34);
  if (extra) {
    ctx.fillStyle = '#9CA3AF';
    ctx.font = font(24, 500);
    ctx.textAlign = 'right';
    ctx.fillText(extra, W - PAD, y + 34);
    ctx.textAlign = 'left';
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // 插画丢了照样出报告,只是少一只鹰
    img.src = src;
  });
}

async function drawReport(canvas: HTMLCanvasElement, r: LearningReport, orgName: string | null) {
  const measure = document.createElement('canvas').getContext('2d');
  const ctx = canvas.getContext('2d');
  if (!measure || !ctx) throw new Error('canvas unavailable');
  const plan = planReport(measure, r);
  const art = await loadImage(`${import.meta.env.BASE_URL}report-card/${r.tier}.jpg`);
  const tc = TIER_COLOR[r.tier];

  // 词特别多的单元图会很长: 超出像素上限就降清晰度,不让整张图画不出来
  const scale = Math.min(SCALE, Math.sqrt(MAX_PIXELS / (W * plan.height)));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(plan.height * scale);
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  // 底色 + 头图
  ctx.fillStyle = '#FFF8F0';
  ctx.fillRect(0, 0, W, plan.height);
  const g = ctx.createLinearGradient(0, 0, W, HEADER_H);
  g.addColorStop(0, '#FF6B35');
  g.addColorStop(1, '#FF9A5C');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HEADER_H);

  // 吉祥物徽章(右上)。插画是白底图,放进白色圆里就没有抠图毛边
  const cx = W - PAD - 120;
  const cy = 160;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx, cy, 124, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFD23F';
  ctx.lineWidth = 6;
  ctx.stroke();
  if (art) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 116, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(art, cx - 116, cy - 116, 232, 232);
    ctx.restore();
  }

  // 头图文字(左侧,让出徽章的位置)
  const textMax = cx - 124 - 20 - PAD;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = font(26, 600);
  ctx.fillText(fitText(ctx, orgName || '学习报告', textMax), PAD, 68);

  const title = r.childName ? `${r.childName}的学习报告` : '今日学习报告';
  let size = 50;
  ctx.font = font(size, 900);
  while (size > 36 && ctx.measureText(title).width > textMax) {
    size -= 2;
    ctx.font = font(size, 900);
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(fitText(ctx, title, textMax), PAD, 138);

  const lines = [r.bookName, r.unitName].filter((s): s is string => !!s);
  let ly = 188;
  ctx.font = font(26, 500);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (const ln of lines) {
    ctx.fillText(fitText(ctx, ln, textMax), PAD, ly);
    ly += 38;
  }
  ctx.font = font(22, 500);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(fitText(ctx, [r.progressText, r.dateText].filter(Boolean).join(' · '), textMax), PAD, ly);

  // 成绩卡
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.08)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#FFFFFF';
  fillRoundRect(ctx, PAD, CARD_Y, CONTENT_W, CARD_H, 28);
  ctx.restore();

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

  const stats: Array<[string, string, string]> = [
    [String(r.totalWords), ' 个', '这次学的词'],
    [`${r.firstTryCorrect}/${r.dictTotal}`, '', '一次拼对'],
    [String(r.minutes), ' 分钟', '专注学习'],
  ];
  const colW = CONTENT_W / 3;
  stats.forEach(([value, unit, caption], i) => {
    const center = PAD + colW * i + colW / 2;
    ctx.font = font(40, 800);
    const vw = ctx.measureText(value).width;
    ctx.font = font(22, 500);
    const uw = unit ? ctx.measureText(unit).width : 0;
    const left = center - (vw + uw) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1F2937';
    ctx.font = font(40, 800);
    ctx.fillText(value, left, CARD_Y + 250);
    if (unit) {
      ctx.fillStyle = '#6B7280';
      ctx.font = font(22, 500);
      ctx.fillText(unit, left + vw, CARD_Y + 250);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9CA3AF';
    ctx.font = font(22);
    ctx.fillText(caption, center, CARD_Y + 282);
  });
  ctx.textAlign = 'left';

  // 还要多练: 正确拼写 + 中文 + 孩子当时写成什么(划掉)
  sectionTitle(ctx, plan.weakTop, '还要多练', '#FF6B35', `${r.weak.length} 个`);
  let y = plan.weakTop + TITLE_H;
  if (plan.weakRows.length === 0) {
    ctx.fillStyle = '#ECFDF3';
    fillRoundRect(ctx, PAD, y, CONTENT_W, EMPTY_H, 18);
    ctx.fillStyle = '#15803D';
    ctx.font = font(26, 700);
    ctx.fillText('这次没有拼错的词,全部第一次就拼对了', PAD + 24, y + 52);
    y += EMPTY_H;
  } else {
    for (const w of plan.weakRows) {
      ctx.fillStyle = '#FFF4ED';
      fillRoundRect(ctx, PAD, y, CONTENT_W, ROW_H, 18);
      const base = y + 50;
      const right = W - PAD - 24;
      let rightW = 0;
      if (w.wrote) {
        ctx.font = font(26, 600);
        const wrote = fitText(ctx, w.wrote, 200);
        const ww = ctx.measureText(wrote).width;
        ctx.fillStyle = '#EF4444';
        ctx.textAlign = 'right';
        ctx.fillText(wrote, right, base);
        ctx.fillRect(right - ww, base - 9, ww, 2.5);   // 删除线
        ctx.fillStyle = '#9CA3AF';
        ctx.font = font(20, 500);
        ctx.fillText('写成', right - ww - 10, base);
        rightW = ww + 10 + ctx.measureText('写成').width + 24;
        ctx.textAlign = 'left';
      }
      const leftMax = CONTENT_W - 48 - rightW;
      ctx.fillStyle = '#1F2937';
      ctx.font = font(30, 800);
      const word = fitText(ctx, w.word, leftMax);
      ctx.fillText(word, PAD + 24, base);
      const wordW = ctx.measureText(word).width;
      if (w.meaning) {
        ctx.font = font(22);
        ctx.fillStyle = '#6B7280';
        const room = leftMax - wordW - 14;
        if (room > 40) ctx.fillText(fitText(ctx, w.meaning, room), PAD + 24 + wordW + 14, base);
      }
      y += ROW_H + ROW_GAP;
    }
    y -= ROW_GAP;
  }
  if (plan.weakMore > 0) {
    ctx.fillStyle = '#9CA3AF';
    ctx.font = font(22);
    ctx.fillText(`另有 ${plan.weakMore} 个词,都在孩子的「错题集」里`, PAD + 4, y + 32);
  }

  // 给家长的建议
  sectionTitle(ctx, plan.tipsTop, '给家长的建议', '#FFD23F');
  const cardTop = plan.tipsTop + TITLE_H;
  ctx.fillStyle = '#FFF7E0';
  fillRoundRect(ctx, PAD, cardTop, CONTENT_W, plan.tipsCardH, 20);
  let ty = cardTop + TIP_PAD;
  plan.tipLines.forEach((tipLines, i) => {
    const nx = PAD + TIP_PAD + 16;
    ctx.fillStyle = '#FF6B35';
    ctx.beginPath();
    ctx.arc(nx, ty + 18, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(20, 800);
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), nx, ty + 25);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#374151';
    ctx.font = font(TIP_SIZE);
    tipLines.forEach((ln, j) => ctx.fillText(ln, PAD + TIP_PAD + TIP_INDENT, ty + 28 + j * TIP_LINE_H));
    ty += tipLines.length * TIP_LINE_H + TIP_GAP;
  });

  // 第一次就拼对
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

  // 落款: 加盟机构的家长看到的是本机构的名字
  ctx.fillStyle = '#E5E7EB';
  ctx.fillRect(PAD, plan.footerTop, CONTENT_W, 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FF6B35';
  ctx.font = font(26, 800);
  ctx.fillText(fitText(ctx, orgName || '分类学习 · 学习报告', CONTENT_W), W / 2, plan.footerTop + 52);
  ctx.fillStyle = '#9CA3AF';
  ctx.font = font(20);
  ctx.fillText('成绩来自孩子这次的真实作答', W / 2, plan.footerTop + 86);
  ctx.textAlign = 'left';
}

interface Props {
  report: LearningReport;
  /** 落款用的机构名;取不到就写「分类学习 · 学习报告」 */
  orgName: string | null;
  /** 请传稳定引用(useCallback): Esc 监听依赖它 */
  onClose: () => void;
}

export default function LearningReportDialog({ report, orgName, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [drawing, setDrawing] = useState(true);
  const fileName = `${[report.childName, report.unitName, report.dateText.split(' ')[0]].filter(Boolean).join('-')}-学习报告.jpg`
    .replace(/[\\/:*?"<>|\s]+/g, '-');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        await drawReport(canvas, report, orgName);
        if (cancelled) return;
        setImgUrl(canvas.toDataURL('image/jpeg', 0.92));
        // 系统分享面板(iOS Safari / 安卓 Chrome 能直接发微信);微信内置浏览器没有,只能长按
        canvas.toBlob(blob => {
          if (cancelled || !blob) return;
          try {
            const file = new File([blob], fileName, { type: 'image/jpeg' });
            if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) setShareFile(file);
          } catch { /* 不支持就只留长按和下载 */ }
        }, 'image/jpeg', 0.92);
      } catch {
        if (!cancelled) toast('报告图没画出来,可以先点「复制文字版」发给家长', 'warning');
      } finally {
        if (!cancelled) setDrawing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [report, orgName, fileName]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = () => {
    if (!imgUrl) return;
    const a = document.createElement('a');
    a.href = imgUrl;
    a.download = fileName;
    a.click();
  };

  const share = async () => {
    if (!shareFile) return;
    try {
      await navigator.share({ files: [shareFile], title: '学习报告' });
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast('没有分享成功,可以长按图片保存后再发', 'warning');
    }
  };

  const copyText = async () => {
    const text = reportText(report, orgName);
    try {
      await navigator.clipboard.writeText(text);
      toast('文字版已复制,去微信粘贴发送', 'success');
    } catch {
      // 微信内置浏览器常不给剪贴板权限: 退回系统输入框,让家长长按全选复制
      window.prompt('长按下面的文字复制', text);
    }
  };

  const altText = `${report.childName || ''}学习报告:${report.unitName},听写一次拼对 ${report.firstTryCorrect}/${report.dictTotal}`
    + `${report.weak.length > 0 ? `,还要多练 ${report.weak.map(w => w.word).join('、')}` : ''}。长按可保存`;

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="learning-report-title"
        className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <h2 id="learning-report-title" className="text-base font-bold text-gray-800">学习报告</h2>
            {/* 电脑上没有长按,要告诉老师/家长点下面的按钮 */}
            <p className="text-xs text-gray-500">手机长按图片保存,电脑点下方「保存图片」</p>
          </div>
          <button
            ref={closeRef} type="button" onClick={onClose} aria-label="关闭"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF6B35]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#FFF8F0] p-3">
          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
          {drawing ? (
            <div className="flex aspect-[3/5] items-center justify-center" role="status">
              <LoaderCircle className="h-6 w-6 animate-spin text-[#FF6B35]" aria-hidden="true" />
              <span className="ml-2 text-sm text-gray-500">报告生成中…</span>
            </div>
          ) : imgUrl ? (
            <img data-allow-save src={imgUrl} alt={altText} className="allow-select w-full rounded-xl shadow-sm" />
          ) : (
            <p className="py-16 text-center text-sm text-gray-500">报告图没画出来,可以先点下面「复制文字版」发给家长。</p>
          )}
        </div>

        <div className="space-y-2 border-t border-gray-100 p-3">
          {shareFile && (
            <button type="button" onClick={share}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#FF6B35] text-sm font-bold text-white hover:opacity-90">
              <Share2 className="h-4 w-4" aria-hidden="true" /> 分享图片
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={download} disabled={!imgUrl}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <Download className="h-4 w-4" aria-hidden="true" /> 保存图片
            </button>
            <button type="button" onClick={copyText}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              <Copy className="h-4 w-4" aria-hidden="true" /> 复制文字版
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
