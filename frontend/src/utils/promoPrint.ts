/**
 * 体验卡印刷文件(浏览器里现画,不经服务器)
 *
 * 成品 90×60mm,四边各 2mm 出血 → 94×64mm。排版按 300dpi 的像素算(1110×756,下面叫「印刷单位」),
 * 真正画的时候可以放大: 预览按 1 倍画(快),下载的图片按 HI_RES(600dpi)画,PDF 里字也是 600dpi。
 * 50 套模板(data/promoTemplates.ts): 正面/背面底图都是 AI 出的 1536×1024,铺满卡面相当于约 400dpi,
 * 这是底图清晰度的上限(印刷要求 300dpi,够);字、价格、二维码是程序画的,画多细由这里定。
 * 程序往上画三样「每版卡不一样」的东西 —— 生图模型画不准二维码,也写不准每个老师的名字和电话:
 * ① 背面白框里: 二维码 + 老师名字电话 + 网址  ② 正面底部一条: 老师名字电话(一眼分得清是谁的卡)
 *   + 校区地址(10-29 起,机构「设置」里填,全机构的卡一样;换了地址重新下载就是新地址)
 * ③ 正面徽章里的价格: 按机构「设置」里的体验价现画(底图已去掉原来的 ¥99),排版与缩略图共用 utils/promoPrice。
 *
 * 11-04 用户「下载的有点糊」: 以前只出 300dpi 的 PNG,而且底图从 1536 缩到 1134 时用的是浏览器默认的低质量缩放。
 * 现在: 图片 600dpi + 高质量缩放;另出 PDF(正反面两页,印刷厂最常要的): 底图直接放原图不重新压缩,
 * 二维码是矢量的,字是 600dpi 透明图叠在上面。
 *
 * 白框位置是对每张底图逐像素扫出来的(模板的 box),**换底图要重扫**;画之前检查框里是不是白的,
 * 不是就报错不出图 —— 宁可报错,也别印出一批二维码压到花纹上的卡。
 */
import QRCode from 'qrcode';
import { templateImg, templateOf, type PromoTemplate } from '../data/promoTemplates';
import { PRICE_FONT, priceLayout } from './promoPrice';

const DPI = 300;
const MM = DPI / 25.4;
export const PRINT_W = Math.round(94 * MM);   // 1110
export const PRINT_H = Math.round(64 * MM);   // 756
export const BLEED_PX = Math.round(2 * MM);
/** 下载用的倍数: 按 300dpi 排版、画成 600dpi */
export const HI_RES = 2;
/** 安全区: 裁切误差约 1mm,字和二维码离成品边至少 3mm */
const SAFE_PX = BLEED_PX + Math.round(3 * MM);
/** 印刷单位 → 毫米(PDF 用) */
const toMm = (px: number) => px / MM;

const SRC_W = 1536;
const SRC_H = 1024;
const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Noto Sans SC",sans-serif';
const QR_INK = '#3D2B1F';

export interface CardPrintOptions {
  templateId: string;
  url: string;            // 二维码内容(卡上印的固定网址)
  code: string;           // 卡码,印在二维码下面,电话里能念给家长
  name: string;           // 卡上印的老师名字(空 = 不印)
  phone: string;          // 卡上印的电话(空 = 不印)
  price: number;          // 正面徽章里的体验价(机构「设置」里的,元)
  address: string;        // 正面底部名字电话下面印的地址(机构「设置」里的,空 = 不印)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}

/** 画布按 scale 倍的像素建,坐标系仍是印刷单位(ctx 自带缩放) */
function newCanvas(scale = 1) {
  const c = document.createElement('canvas');
  c.width = Math.round(PRINT_W * scale);
  c.height = Math.round(PRINT_H * scale);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持画图');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
}

/** 底图按出血尺寸铺满(cover)居中裁: 放大倍数 s、往左上挪多少 */
function coverOf(img: HTMLImageElement) {
  if (img.naturalWidth !== SRC_W || img.naturalHeight !== SRC_H) {
    throw new Error('模板底图尺寸不对,需要重新标定二维码位置');
  }
  const s = Math.max(PRINT_W / SRC_W, PRINT_H / SRC_H);
  return { s, ox: (SRC_W * s - PRINT_W) / 2, oy: (SRC_H * s - PRINT_H) / 2 };
}

type Mapper = (x: number, y: number) => readonly [number, number];
const mapperOf = ({ s, ox, oy }: ReturnType<typeof coverOf>): Mapper => (x, y) => [x * s - ox, y * s - oy] as const;

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement): Mapper {
  const cv = coverOf(img);
  ctx.drawImage(img, -cv.ox, -cv.oy, SRC_W * cv.s, SRC_H * cv.s);
  return mapperOf(cv);
}

/** 把文字缩到放得下(长名字、带区号的电话) */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, width: number) {
  let size = max;
  for (; size > min; size -= 1) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= width) break;
  }
  ctx.font = `${weight} ${size}px ${FONT}`;
  return size;
}

/** 正面价格: 先描边(有的模板原来的字带描边)再填色。字体先等加载完,否则 canvas 会用兜底字体画 */
async function drawPrice(ctx: CanvasRenderingContext2D, tpl: PromoTemplate, price: number, map: Mapper) {
  const p = tpl.price;
  const L = priceLayout(p, price);
  const k = map(1, 0)[0] - map(0, 0)[0];
  try {
    await document.fonts?.load(`800 ${Math.round(L.size * k)}px "PromoPrice"`, '¥0123456789.');
  } catch { /* 字体没加载上就用兜底的圆体,照样能印 */ }
  const [yenX, base] = map(L.yenLeft, L.baseline);
  const [digX] = map(L.digitsLeft, 0);
  const parts: Array<[string, number, number]> = [['¥', yenX, L.yenSize * k], [L.digits, digX, L.size * k]];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (p.stroke && p.sw) {
    ctx.strokeStyle = p.stroke;
    ctx.lineJoin = 'round';
    ctx.lineWidth = p.sw * 2 * k;
    for (const [t, x, sz] of parts) { ctx.font = `800 ${sz}px ${PRICE_FONT}`; ctx.strokeText(t, x, base); }
  }
  ctx.fillStyle = p.fill;
  for (const [t, x, sz] of parts) { ctx.font = `800 ${sz}px ${PRICE_FONT}`; ctx.fillText(t, x, base); }
}

function contactLine(name: string, phone: string) {
  return [name.trim(), phone.trim()].filter(Boolean).join('  ');
}

/** 地址前面的定位小图标(画的,不用 emoji —— 印刷机那边字体里不一定有,会印成方框) */
function drawPin(ctx: CanvasRenderingContext2D, left: number, midY: number, size: number) {
  const r = size * 0.28;
  const cx = left + r;
  const cy = midY - size * 0.12;
  ctx.beginPath();
  ctx.moveTo(cx, midY + size * 0.42);
  ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/** 正面底部那条的大小和位置(drawCardFront 用;单独导出是为了能拿 OCR 核对它压不压模板自己的字)。
 * 只有名字电话 = 原来那一条(一行,最宽 60% 卡宽);加了地址 = 两行,最宽 TWO_LINE_TEXT_W ——
 * 两行高了一截,50 套里有 10 套居中会压到底部的「扫码进群 预约体验」,这些换到 strip2 那边;
 * 宽度再大第 50 套哪边都放不下(10-29 按 OCR 文字框逐套量过,最宽 504 = 460 + 两边留白)。
 * 地址最多 22 个字(后端 CARD_ADDRESS_MAX),最小 20px(印出来约 1.7mm 高,再小家长看不清)正好放得下;
 * 名字电话特别长时缩到最小字号还放不下,就横向压一点(fillText 的 maxWidth),不让白条变宽压到模板的字 */
const TWO_LINE_TEXT_W = 460;
export function frontStripLayout(ctx: CanvasRenderingContext2D, o: Pick<CardPrintOptions, 'templateId' | 'name' | 'phone' | 'address'>) {
  const top = contactLine(o.name, o.phone);
  const addr = o.address.trim();
  if (!top && !addr) return null;
  // 印了地址就按两行那套宽度和位置算(只有地址没有名字电话时也是: 一行地址放宽了照样压第 37 套的字)
  const two = !!(top && addr);
  const maxText = addr ? TWO_LINE_TEXT_W : PRINT_W * 0.6;
  const padX = 22;
  const padY = 9;
  const lineGap = two ? 5 : 0;
  const pinGap = 6;
  let s1 = 0;
  let w1 = 0;
  if (top) {
    s1 = fitFont(ctx, top, 600, 30, two ? 18 : 20, maxText);
    w1 = Math.min(ctx.measureText(top).width, maxText);
  }
  let s2 = 0;
  let w2 = 0;
  if (addr) {
    // 地址比名字电话小一号: 主角是「谁的卡」,地址给想上门看看的家长。图标宽度按最大字号预留
    s2 = fitFont(ctx, addr, 500, 24, 20, maxText - 24 * 0.56 - pinGap);
    w2 = Math.min(s2 * 0.56 + pinGap + ctx.measureText(addr).width, maxText);
  }
  const w = Math.max(w1, w2) + padX * 2;
  const h = padY * 2 + s1 + s2 + lineGap;
  const tpl = templateOf(o.templateId);
  const side = addr ? (tpl.strip2 ?? tpl.strip) : tpl.strip;
  const x = side === 'l' ? SAFE_PX : side === 'r' ? PRINT_W - SAFE_PX - w : (PRINT_W - w) / 2;
  const y = PRINT_H - SAFE_PX - h + 6;
  return { x, y, w, h, top, addr, s1, s2, padY, padX, lineGap, pinGap };
}

function drawFrontStrip(ctx: CanvasRenderingContext2D, o: CardPrintOptions) {
  const L = frontStripLayout(ctx, o);
  if (!L) return;
  // 底部一条半透明白底: 不管模板什么配色都看得清。默认居中;个别模板居中会压到它自己底部的字
  // (strip 字段,OCR 测出来的),挪到左 / 右下角。两行(名字电话 + 地址)时圆角收小,不然两头的字贴着弧线
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.beginPath();
  ctx.roundRect(L.x, L.y, L.w, L.h, L.lineGap ? 20 : L.h / 2);
  ctx.fill();
  const cx = L.x + L.w / 2;
  let y = L.y + L.padY;
  ctx.textBaseline = 'middle';
  if (L.top) {
    ctx.fillStyle = '#3D2B1F';
    ctx.font = `600 ${L.s1}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(L.top, cx, y + L.s1 / 2 + 1, L.w - L.padX * 2);
    y += L.s1 + L.lineGap;
  }
  if (L.addr) {
    ctx.font = `500 ${L.s2}px ${FONT}`;
    const pinW = L.s2 * 0.56;
    const room = L.w - L.padX * 2 - pinW - L.pinGap;
    const tw = Math.min(ctx.measureText(L.addr).width, room);
    const left = cx - (pinW + L.pinGap + tw) / 2;
    const mid = y + L.s2 / 2;
    ctx.fillStyle = '#FF6B35';
    drawPin(ctx, left, mid, L.s2);
    ctx.fillStyle = '#6B5444';
    ctx.textAlign = 'left';
    ctx.fillText(L.addr, left + pinW + L.pinGap, mid + 1, room);
  }
}

/** 正面。background=false 只画叠在底图上的东西(价格、底部那条),给 PDF 用 */
async function paintFront(o: CardPrintOptions, scale: number, background: boolean) {
  const { c, ctx } = newCanvas(scale);
  const tpl = templateOf(o.templateId);
  const img = await loadImage(templateImg(tpl.id, 'front'));
  const map = background ? drawCover(ctx, img) : mapperOf(coverOf(img));
  await drawPrice(ctx, tpl, o.price, map);
  drawFrontStrip(ctx, o);
  return { c, img };
}

export async function drawCardFront(o: CardPrintOptions, scale = 1): Promise<HTMLCanvasElement> {
  return (await paintFront(o, scale, true)).c;
}

/** 背面白框里二维码和两行字的位置(印刷单位);顺便确认框里是白的(换了底图没重扫框的位置,这里会拦住) */
async function backLayout(o: CardPrintOptions) {
  const tpl = templateOf(o.templateId);
  const img = await loadImage(templateImg(tpl.id, 'back'));
  const probeCanvas = newCanvas(1);
  const map = drawCover(probeCanvas.ctx, img);
  const [l, t] = map(tpl.box.l, tpl.box.t);
  const [r, b] = map(tpl.box.r, tpl.box.b);
  const probe = probeCanvas.ctx.getImageData(Math.round(l + 12), Math.round(t + 12), Math.round(r - l - 24), Math.round(b - t - 24)).data;
  let dark = 0;
  for (let i = 0; i < probe.length; i += 4 * 97) {
    if (Math.min(probe[i], probe[i + 1], probe[i + 2]) < 225) dark++;
  }
  if (dark > 3) throw new Error('二维码框里不是空白的,模板需要重新标定');

  const inner = 14;
  const line = contactLine(o.name, o.phone);
  const lineH = line ? 26 : 0;
  const noH = 24;   // 网址那一行(20px ≈ 1.7mm,家长要照着输入,不能再小)
  const gap = 6;
  const side = Math.floor(Math.min(r - l - 2 * inner, b - t - 2 * inner - noH - lineH - gap * 2));
  return { img, l, r, inner, line, lineH, gap, side, cx: (l + r) / 2, qy: t + inner };
}

/** 背面。background=false 不画底图,qr=false 不画二维码(PDF 里二维码画成矢量的) */
async function paintBack(o: CardPrintOptions, scale: number, background: boolean, qr: boolean) {
  const L = await backLayout(o);
  const { c, ctx } = newCanvas(scale);
  if (background) drawCover(ctx, L.img);
  if (qr) {
    // 纠错等级 M: 卡片会被揉、被茶水溅,比 L 稳;码再密就要更大的印刷尺寸
    const img = await loadImage(await QRCode.toDataURL(o.url, {
      errorCorrectionLevel: 'M', margin: 0, width: Math.round(L.side * scale * 2), color: { dark: QR_INK, light: '#FFFFFF' },
    }));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, L.cx - L.side / 2, L.qy, L.side, L.side);
    ctx.imageSmoothingEnabled = true;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let y = L.qy + L.side + L.gap;
  if (L.line) {
    ctx.fillStyle = '#3D2B1F';
    fitFont(ctx, L.line, 600, 22, 15, L.r - L.l - 2 * L.inner);
    ctx.fillText(L.line, L.cx, y);
    y += L.lineH;
  }
  // 二维码下面印网址(不印「NO. 卡号」): 家长扫不了码时照着输入也能打开留电话页,线索照样归这张卡的销售;
  // 卡号就在网址末尾,电话里也念得出来。不写 https:// —— 印出来太长,浏览器输入 http 会被 301 到 https
  const host = o.url.replace(/^https?:\/\//, '');
  ctx.fillStyle = '#6B5444';
  fitFont(ctx, host, 600, 20, 14, L.r - L.l - 2 * L.inner);
  ctx.fillText(host, L.cx, y);
  return { c, L };
}

export async function drawCardBack(o: CardPrintOptions, scale = 1): Promise<HTMLCanvasElement> {
  return (await paintBack(o, scale, true, true)).c;
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), 'image/png'));
}

function saveBlob(blob: Blob, fileName: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function downloadCanvas(c: HTMLCanvasElement, fileName: string): Promise<void> {
  saveBlob(await toBlob(c), fileName);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`图片加载失败: ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * PDF(正面一页 + 背面一页,94×64mm 含出血): 底图把原图 JPEG 直接放进去(不重新压缩,约 400dpi),
 * 价格、名字电话、地址、网址是 600dpi 的透明图叠在上面,二维码是矢量方块(放多大都是直边)。
 * jspdf 只在点下载 PDF 时才加载
 */
export async function downloadCardPdf(o: CardPrintOptions, fileName: string): Promise<void> {
  const tpl = templateOf(o.templateId);
  const [{ jsPDF }, frontJpg, backJpg, front, back] = await Promise.all([
    import('jspdf'),
    fetchBytes(templateImg(tpl.id, 'front')),
    fetchBytes(templateImg(tpl.id, 'back')),
    paintFront(o, HI_RES, false),
    paintBack(o, HI_RES, false, false),
  ]);
  const W = toMm(PRINT_W);
  const H = toMm(PRINT_H);
  const pdf = new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape', compress: true });
  pdf.setProperties({ title: fileName.replace(/\.pdf$/i, ''), creator: '飞鹰AI英语' });

  const placeCover = (img: HTMLImageElement, bytes: Uint8Array) => {
    const cv = coverOf(img);
    pdf.addImage(bytes, 'JPEG', toMm(-cv.ox), toMm(-cv.oy), toMm(SRC_W * cv.s), toMm(SRC_H * cv.s));
  };

  // 第 1 页: 正面
  placeCover(front.img, frontJpg);
  pdf.addImage(front.c, 'PNG', 0, 0, W, H, undefined, 'FAST');

  // 第 2 页: 背面
  pdf.addPage([W, H], 'landscape');
  placeCover(back.L.img, backJpg);
  pdf.addImage(back.c, 'PNG', 0, 0, W, H, undefined, 'FAST');
  // 二维码: 每一行连着的黑格并成一个长方形,整码一条路径一次填色(分开填,看 PDF 时格子之间会有细白缝)
  const qr = QRCode.create(o.url, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = toMm(back.L.side) / n;
  const x0 = toMm(back.L.cx - back.L.side / 2);
  const y0 = toMm(back.L.qy);
  pdf.setFillColor(QR_INK);
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!qr.modules.get(row, col)) { col++; continue; }
      const start = col;
      while (col < n && qr.modules.get(row, col)) col++;
      pdf.rect(x0 + start * cell, y0 + row * cell, (col - start) * cell, cell, null);
    }
  }
  pdf.fill();

  saveBlob(pdf.output('blob'), fileName);
}

/** 预览用: 裁掉出血,只看成品范围(不管画布画成几倍) */
export function trimmedDataUrl(c: HTMLCanvasElement): string {
  const k = c.width / PRINT_W;
  const out = document.createElement('canvas');
  out.width = Math.round((PRINT_W - 2 * BLEED_PX) * k);
  out.height = Math.round((PRINT_H - 2 * BLEED_PX) * k);
  out.getContext('2d')?.drawImage(c, -BLEED_PX * k, -BLEED_PX * k);
  return out.toDataURL('image/jpeg', 0.9);
}
