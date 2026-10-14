/**
 * 邀请海报 + 链接分享弹层(家长端、老师端共用一份)
 *
 * 为什么画在 canvas 上而不是 html2canvas 截图: 海报要的是一张能长按保存/发朋友圈的 PNG,
 * canvas 直接出图,不用处理 oklch 降级、移动端宽度这些截图坑(见 utils/downloadPdf.ts)。
 *
 * 文案红线(与落地页同一套,改之前先看):
 * - 不写「转发有奖」「分享领红包」—— 微信判利益诱导分享会封域名(学生端也在这个域名下)。
 *   推荐奖励只在后台、只对老生家庭说,海报上只写新朋友能得到什么
 * - 海报只出「孩子的姓 + 同学」与学了多少词,不出全名、学校、照片
 * - 不承诺分数和升学(广告法第二十四条)
 */
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, LoaderCircle, X } from 'lucide-react';
import { inviteUrl, type InviteInfo } from '../../api/referral';
import { toast } from '../Toast';

const W = 750;
const H = 1200;

const surname = (name: string) => (name || '').trim().slice(0, 1) || '';

/** 自动换行画字,返回画完后的 y */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 3) {
  let line = '';
  let lines = 0;
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      lines += 1;
      line = ch;
      if (lines >= maxLines - 1) {
        // 最后一行放不下就截断加省略号
        const rest = text.slice(text.indexOf(line));
        let cut = rest;
        while (cut && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1);
        ctx.fillText(cut.length < rest.length ? `${cut}…` : rest, x, y);
        return y + lineH;
      }
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineH;
  }
  return y;
}

/** 圆角矩形。canvas 的 roundRect 要 iOS 16+ / Chrome 99+,老 iPhone 的微信里没有,退成直角矩形 */
function fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

async function drawPoster(canvas: HTMLCanvasElement, info: InviteInfo, words: number | null) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  canvas.width = W;
  canvas.height = H;
  const font = (size: number, weight = 400) => `${weight} ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;

  // 背景
  const g = ctx.createLinearGradient(0, 0, 0, 520);
  g.addColorStop(0, '#FF6B35');
  g.addColorStop(1, '#FF8F5E');
  ctx.fillStyle = '#FFF8F0';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 520);

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.font = font(34, 700);
  ctx.fillText(info.org_name, 60, 110);

  ctx.font = font(60, 900);
  const sn = surname(info.child_name);
  ctx.fillText(`${sn ? `${sn}同学` : '我家孩子'}的家长`, 60, 240);
  ctx.fillText('邀请您免费体验', 60, 320);

  if (words && words > 0) {
    ctx.font = font(30, 500);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText('孩子在这里已经学会了', 60, 410);
    ctx.font = font(64, 900);
    ctx.fillStyle = '#FFD23F';
    ctx.fillText(String(words), 60, 485);
    const wNum = ctx.measureText(String(words)).width;
    ctx.font = font(30, 500);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText('个单词', 72 + wNum, 485);
  }

  // 白卡: 新朋友能得到什么
  ctx.fillStyle = '#FFFFFF';
  fillRoundRect(ctx, 40, 560, W - 80, 260, 28);
  ctx.fillStyle = '#1F2937';
  ctx.font = font(32, 700);
  ctx.fillText('您能得到', 80, 625);
  ctx.fillStyle = '#4B5563';
  ctx.font = font(28, 400);
  wrapText(ctx, info.friend_offer || '一次免费的英语水平测评,老师当面讲解孩子现在的情况和适合的学习方法。', 80, 680, W - 160, 44, 3);

  // 二维码
  const url = inviteUrl(info.path);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 260, errorCorrectionLevel: 'M' });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('qr'));
    img.src = qr;
  });
  ctx.fillStyle = '#FFFFFF';
  fillRoundRect(ctx, W / 2 - 150, 860, 300, 300, 24);
  ctx.drawImage(img, W / 2 - 130, 880, 260, 260);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#6B7280';
  ctx.font = font(26, 500);
  ctx.fillText('长按识别二维码,预约免费体验', W / 2, 1190 - 8);
}

interface Props {
  info: InviteInfo;
  /** 推荐的孩子学会了多少词。不传就用接口带回来的 info.words(两边同一口径) */
  words?: number | null;
  /** 给谁看的: parent 自己转发;teacher 发给这个孩子的家长 */
  audience: 'parent' | 'teacher';
  onClose: () => void;
}

export default function InviteShareDialog({ info, words: wordsProp = null, audience, onClose }: Props) {
  const words = wordsProp ?? info.words ?? null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(true);
  const url = inviteUrl(info.path);
  const sn = surname(info.child_name);

  const shareText = `我家孩子在${info.org_name}学英语,每天背单词、做作业,学了什么我手机上都看得见。`
    + `${info.friend_offer ? `现在新朋友可以${info.friend_offer},` : '现在可以免费测评一次,'}`
    + `感兴趣的话点这里预约:${url}`;
  const teacherText = `${sn}同学家长您好,孩子最近学得很认真!如果身边有朋友家的孩子也想把英语单词学扎实,`
    + `可以把下面这条转给他们,新朋友能预约免费体验${info.reward_text ? `;朋友报名后,您家也会收到我们的感谢(${info.reward_text})` : ''}。\n\n${shareText}`;

  useEffect(() => {
    let cancelled = false;
    setDrawing(true);
    (async () => {
      try {
        if (!canvasRef.current) return;
        await drawPoster(canvasRef.current, info, words);
        if (!cancelled) setPosterUrl(canvasRef.current.toDataURL('image/png'));
      } catch {
        if (!cancelled) toast('海报生成失败,可以先复制链接发送', 'warning');
      } finally {
        if (!cancelled) setDrawing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [info, words]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what}已复制,去微信粘贴发送`, 'success');
    } catch {
      // 微信内置浏览器有时不给剪贴板权限: 退回到选中文本让用户长按复制
      window.prompt('长按下面的文字复制', text);
    }
  };

  const download = () => {
    if (!posterUrl) return;
    const a = document.createElement('a');
    a.href = posterUrl;
    a.download = `${info.org_name}-邀请海报.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="邀请朋友"
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">
            {audience === 'parent' ? '邀请朋友来体验' : `${info.child_name} 的邀请链接`}
          </h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!info.enabled && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            机构暂时关闭了推荐,链接现在打不开。请联系机构管理员在「推荐线索 → 推荐设置」里打开。
          </p>
        )}

        <div className="mt-4 overflow-hidden rounded-xl border border-gray-100 bg-[#FFF8F0]">
          <canvas ref={canvasRef} className="hidden" />
          {drawing
            ? <div className="flex aspect-[5/8] items-center justify-center"><LoaderCircle className="h-6 w-6 animate-spin text-[#FF6B35]" aria-label="海报生成中" /></div>
            : posterUrl && <img src={posterUrl} alt="邀请海报,长按可保存" className="w-full" />}
        </div>
        <p className="mt-2 text-center text-xs text-gray-500">手机上长按海报即可保存或发送给朋友</p>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={download} disabled={!posterUrl}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            <Download className="h-4 w-4" /> 保存海报
          </button>
          <button type="button" onClick={() => copy(audience === 'teacher' ? teacherText : shareText, audience === 'teacher' ? '给家长的话' : '邀请文字')}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#FF6B35] text-sm font-bold text-white hover:opacity-90">
            <Copy className="h-4 w-4" /> {audience === 'teacher' ? '复制给家长的话' : '复制邀请文字'}
          </button>
        </div>
        <button type="button" onClick={() => copy(url, '链接')}
          className="mt-2 w-full truncate rounded-xl bg-gray-50 px-3 py-2.5 text-left text-xs text-gray-500 hover:bg-gray-100" title="点击复制链接">
          {url}
        </button>

        <div className="mt-4 rounded-xl bg-gray-50 p-3 text-[13px] leading-6 text-gray-600">
          <p>
            已有 <b className="text-gray-800">{info.leads}</b> 位朋友留了电话,
            <b className="text-[#5FD35F]">{info.enrolled}</b> 位已报名。
          </p>
          {(info.reward_coins > 0 || info.reward_text) && (
            <p className="mt-1">
              朋友到店报名、老师确认后,{audience === 'parent' ? '孩子' : '这个孩子'}可得
              {info.reward_coins > 0 && <b> {info.reward_coins} 金币</b>}
              {info.reward_coins > 0 && info.reward_text && ' 和'}
              {info.reward_text && <b> {info.reward_text}</b>}。只留电话不算。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
