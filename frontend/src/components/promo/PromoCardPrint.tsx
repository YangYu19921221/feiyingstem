/**
 * 一版体验卡的印刷文件: 预览 + 下载正面 / 背面(94×64mm 含出血,300dpi)
 *
 * 背面的二维码是这版卡的固定地址(cardUrl),扫码后显示什么由销售在「我的二维码」里换 —— 卡印出去不用重印。
 * 同一版卡每张都一样(不需要可变数据印刷),所以一个销售印一版、交给印刷厂按张数印就行。
 */
import { useEffect, useState } from 'react';
import { Copy, Download, LoaderCircle, X } from 'lucide-react';
import { cardUrl } from '../../api/promo';
import {
  DEFAULT_SMALL_PRINT, downloadCanvas, drawCardBack, drawCardFront, trimmedDataUrl,
} from '../../utils/promoPrint';
import { copyText } from '../../utils/copyText';
import { toast } from '../Toast';

interface Props {
  code: string;
  name: string;
  onClose: () => void;
}

export default function PromoCardPrint({ code, name, onClose }: Props) {
  const url = cardUrl(code);
  const [smallPrint, setSmallPrint] = useState(DEFAULT_SMALL_PRINT);
  const [front, setFront] = useState<HTMLCanvasElement | null>(null);
  const [back, setBack] = useState<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    drawCardFront().then(setFront).catch((e) => setErr(String(e?.message || e)));
  }, []);

  useEffect(() => {
    let alive = true;
    // 小字改了要重画背面;输入时每个字都重画太频繁,停 300ms 再画
    const t = window.setTimeout(() => {
      drawCardBack({ url, code, smallPrint: smallPrint.trim() })
        .then((c) => { if (alive) setBack(c); })
        .catch((e) => { if (alive) setErr(String(e?.message || e)); });
    }, 300);
    return () => { alive = false; window.clearTimeout(t); };
  }, [url, code, smallPrint]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const safe = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 30);
  const dl = async (c: HTMLCanvasElement | null, side: string) => {
    if (!c) return;
    try {
      await downloadCanvas(c, `体验卡_${safe}_${code}_${side}.png`);
    } catch {
      toast('下载失败,请换个浏览器再试', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="打印体验卡"
        className="max-h-full w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">打印体验卡 · {name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">卡码 {code} · 扫码地址 {url}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[{ c: front, label: '正面', side: '正面' }, { c: back, label: '背面', side: '背面' }].map(({ c, label, side }) => (
            <figure key={side} className="space-y-2">
              <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-2xl bg-slate-100 shadow-inner">
                {c ? <img src={trimmedDataUrl(c)} alt={`体验卡${label}预览`} className="h-full w-full object-contain" />
                  : <LoaderCircle className="h-6 w-6 animate-spin text-slate-400" aria-label="生成中" />}
              </div>
              <figcaption className="flex items-center justify-between text-sm text-slate-600">
                <span>{label}(预览已裁掉出血)</span>
                <button type="button" disabled={!c} onClick={() => dl(c, side)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#FF6B35] px-3 text-sm font-bold text-white disabled:opacity-40">
                  <Download className="h-4 w-4" aria-hidden /> 下载{label}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-slate-700">背面小字(有效期、限领说明)</span>
          <input value={smallPrint} onChange={(e) => setSmallPrint(e.target.value)} maxLength={30}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#FF6B35]" />
        </label>

        <div className="mt-4 rounded-xl bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-900">
          <b>给印刷厂说:</b>成品 <b>90×60mm</b>(不是普通名片的 90×54),文件已含四边各 2mm 出血(94×64mm,300dpi),
          双面彩印,按成品线裁切。同一版卡每张都一样,不用可变数据。
          <br />印之前先用手机扫一下下载的背面图,能打开填手机号的页面再下单。
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => copyText(url, '扫码地址已复制')}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <Copy className="h-4 w-4" aria-hidden /> 复制扫码地址
          </button>
          <a href={url} target="_blank" rel="noreferrer"
            className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            打开看家长看到的页面
          </a>
        </div>
      </div>
    </div>
  );
}
