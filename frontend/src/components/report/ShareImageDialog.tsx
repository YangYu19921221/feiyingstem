/**
 * 家长分享图弹层(学习报告 / 今日学习报告共用): 画图 → 长按保存 / 保存图片 / 分享图片 / 复制文字版
 *
 * 长按保存: 学习页同时挂着 usePreventCopy、根节点 .no-select(touch-callout:none)、main.tsx 的学生端禁右键,
 * 三处都会吃掉安卓微信的长按菜单。所以图片带 data-allow-save(两处 JS 拦截认它)+ allow-select(CSS 认它)。
 * 弹层走 portal 挂到 body: 结算页外层有 framer-motion 的 transform,fixed 定位会被它困住。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, LoaderCircle, Share2, X } from 'lucide-react';
import { toast } from '../Toast';

interface Props {
  /** 弹层标题(「学习报告」「今日学习报告」) */
  title: string;
  /** 往画布上画图。请传稳定引用(useCallback),它变了会重画 */
  draw: (canvas: HTMLCanvasElement) => Promise<void>;
  /** 文字版(图画不出来、或家长那边看图不方便时复制发送) */
  text: string;
  fileName: string;
  altText: string;
  /** 请传稳定引用(useCallback): Esc 监听依赖它 */
  onClose: () => void;
}

export default function ShareImageDialog({ title, draw, text, fileName, altText, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [drawing, setDrawing] = useState(true);
  const safeName = fileName.replace(/[\\/:*?"<>|\s]+/g, '-');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        await draw(canvas);
        if (cancelled) return;
        setImgUrl(canvas.toDataURL('image/jpeg', 0.92));
        // 系统分享面板(iOS Safari / 安卓 Chrome 能直接发微信);微信内置浏览器没有,只能长按
        canvas.toBlob(blob => {
          if (cancelled || !blob) return;
          try {
            const file = new File([blob], safeName, { type: 'image/jpeg' });
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
  }, [draw, safeName]);

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
    a.download = safeName;
    a.click();
  };

  const share = async () => {
    if (!shareFile) return;
    try {
      await navigator.share({ files: [shareFile], title });
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast('没有分享成功,可以长按图片保存后再发', 'warning');
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('文字版已复制,去微信粘贴发送', 'success');
    } catch {
      // 微信内置浏览器常不给剪贴板权限: 退回系统输入框,让家长长按全选复制
      window.prompt('长按下面的文字复制', text);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="share-image-title"
        className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="min-w-0">
            <h2 id="share-image-title" className="text-base font-bold text-gray-800">{title}</h2>
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
