/**
 * 单词记忆图(2026-10-27,后端 services/word_picture)。
 *
 * 一个词全平台只画一张: 正在画时每 3 秒问一次,画好显示图;没画出来写明「没扣次数」。
 * 图在公开目录(只有单词的画面,没有孩子的信息),点一下放大看。
 * 图是 4:5: 上面是画,下面服务器印好了单词、音标、中文(画图模型拼不准单词,所以不让它写)。
 * 大图走 ImageLightbox(portal 到 body: 气泡的入场动画带 transform,遮罩放在气泡里只盖住那个气泡)。
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ImageOff, Maximize2, Paintbrush, Volume2 } from 'lucide-react';
import ImageLightbox from './ImageLightbox';
import { useAudio } from '../../hooks/useAudio';
import { getPicture, type PictureStatus } from '../../api/tutor';

const POLL_MS = 3000;
const MAX_POLL = 60; // 最多问 3 分钟(后端 5 分钟没画完算卡住)

function PictureCard({ picId, word, wordId, status: initStatus, url: initUrl }: {
  picId: number; word: string; wordId?: number; status: PictureStatus; url: string | null;
}) {
  const { playAudio } = useAudio();
  // 图下面印着单词: 点「听」读这个词(同一个 Edge TTS 英式女声;有 word_id 时按 id 读,区分一词多音)
  const [speaking, setSpeaking] = useState(false);
  const speakTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(speakTimer.current), []);
  const say = useCallback(() => {
    void playAudio(word, 1, wordId);
    setSpeaking(true);
    window.clearTimeout(speakTimer.current);
    speakTimer.current = window.setTimeout(() => setSpeaking(false), 1400);
  }, [playAudio, word, wordId]);
  const [status, setStatus] = useState<PictureStatus>(initStatus);
  const [url, setUrl] = useState<string | null>(initUrl);
  const [secs, setSecs] = useState(0);
  const [big, setBig] = useState(false);
  const close = useCallback(() => setBig(false), []);

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
      <div className="mt-3 w-48 sm:w-56">
        <button type="button" onClick={() => setBig(true)}
          className="group relative block w-full overflow-hidden rounded-2xl border border-orange-100 bg-white shadow-sm"
          aria-label={`放大看 ${word} 的记忆图`}>
          <img src={url} alt={`${word} 的记忆图`} className="tutor-in aspect-[4/5] w-full object-contain" loading="lazy" />
          <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white opacity-90 transition group-hover:bg-black/60"
            aria-hidden="true">
            <Maximize2 className="h-4 w-4" />
          </span>
        </button>
        <button type="button" onClick={say}
          className="mt-1.5 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-sky-50 px-3 text-sm font-semibold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100"
          aria-label={`听 ${word} 的发音`}>
          <Volume2 className={`h-4 w-4 shrink-0 ${speaking ? 'tutor-speaking' : ''}`} aria-hidden="true" />
          <span className="truncate">听 {word}</span>
        </button>
        {big && <ImageLightbox url={url} word={word} onClose={close} onSpeak={say} speaking={speaking} />}
      </div>
    );
  }
  if (status === 'pending') {
    // 和画好的图同样大小占位(画好时不跳);进度条按 30 秒估,到 95% 停住等真的画完
    const pct = Math.min(95, Math.round((secs / 30) * 100));
    return (
      <div className="tutor-sweep relative mt-3 flex aspect-[4/5] w-48 flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 via-amber-50 to-sky-50 text-sm text-orange-800 sm:w-56" role="status" aria-live="polite">
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/80 shadow-sm">
          <Paintbrush className="tutor-scribble h-7 w-7 text-orange-500" aria-hidden="true" />
        </span>
        <span className="relative font-medium">正在画 {word}</span>
        <span className="relative px-4 text-center text-xs text-orange-700/70">
          {secs >= 40 ? '这张画得久一点,马上好' : '大约 30 秒,先往下看也行'}
        </span>
        <span className="absolute inset-x-4 bottom-3 h-1.5 overflow-hidden rounded-full bg-white/70" aria-hidden="true">
          <span className="block h-full rounded-full bg-orange-400 transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
        </span>
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
