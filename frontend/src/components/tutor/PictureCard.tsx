/**
 * 单词记忆图(2026-10-27,后端 services/word_picture)。
 *
 * 一个词全平台只画一张: 正在画时每 3 秒问一次,画好显示图;没画出来写明「没扣次数」。
 * 图在公开目录(只有单词的画面,没有孩子的信息),点一下放大看。
 */
import { memo, useEffect, useState } from 'react';
import { ImageOff, Loader2, X } from 'lucide-react';
import { getPicture, type PictureStatus } from '../../api/tutor';

const POLL_MS = 3000;
const MAX_POLL = 60; // 最多问 3 分钟(后端 5 分钟没画完算卡住)

function PictureCard({ picId, word, status: initStatus, url: initUrl }: {
  picId: number; word: string; status: PictureStatus; url: string | null;
}) {
  const [status, setStatus] = useState<PictureStatus>(initStatus);
  const [url, setUrl] = useState<string | null>(initUrl);
  const [secs, setSecs] = useState(0);
  const [big, setBig] = useState(false);

  useEffect(() => {
    if (status !== 'pending') return;
    let alive = true;
    let n = 0;
    const tick = window.setInterval(() => setSecs((s) => s + 1), 1000);
    const poll = window.setInterval(() => {
      n += 1;
      getPicture(picId).then((p) => {
        if (!alive) return;
        if (p.status !== 'pending') {
          setStatus(p.status);
          setUrl(p.url);
        }
      }).catch(() => { /* 网断了下次再问 */ });
      if (n >= MAX_POLL) setStatus('failed');
    }, POLL_MS);
    return () => { alive = false; window.clearInterval(tick); window.clearInterval(poll); };
  }, [picId, status]);

  if (status === 'ready' && url) {
    return (
      <>
        <button type="button" onClick={() => setBig(true)}
          className="mt-3 block overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm"
          aria-label={`放大看 ${word} 的记忆图`}>
          <img src={url} alt={`${word} 的记忆图`} className="h-48 w-48 object-contain sm:h-56 sm:w-56" loading="lazy" />
          <span className="block border-t border-orange-50 px-3 py-1.5 text-left text-xs text-orange-700">{word} 的记忆图 · 点一下放大</span>
        </button>
        {big && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setBig(false)} role="dialog" aria-label={`${word} 的记忆图`}>
            <button type="button" onClick={() => setBig(false)} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-ink" aria-label="关闭">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <img src={url} alt={`${word} 的记忆图`} className="max-h-[85vh] max-w-full rounded-2xl bg-white" />
          </div>
        )}
      </>
    );
  }
  if (status === 'pending') {
    return (
      <div className="mt-3 flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-orange-200 bg-orange-50/50 text-sm text-orange-800 sm:h-56 sm:w-56" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
        <span>正在画 {word}…{secs ? ` ${secs} 秒` : ''}</span>
        <span className="px-3 text-center text-xs text-orange-700/70">大约要 20–30 秒,先往下看也行</span>
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-ink-soft">
      <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      {status === 'removed' ? '这张图被老师撤下了' : '这张图没画出来,没扣次数,过一会儿再让小鹰老师画一次'}
    </div>
  );
}

export default memo(PictureCard);
