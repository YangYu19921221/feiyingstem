/**
 * 错题本每个词下面的「看记忆图 / 画一张记忆图」(2026-10-27,后端 services/word_picture)。
 *
 * 一个词全平台只画一张: 先问有没有(不扣次数);有就直接展开,没有才写「画一张(用 1 次)」,
 * 孩子点了才扣次数开画。按钮文字必须把「要不要用次数」说清楚 —— 次数是家长花钱买的。
 */
import { memo, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { getWordPicture, requestWordPicture, type WordPictureOut } from '../../api/tutor';
import { getErrorMessage } from '../../utils/errorMessage';
import { toast } from '../Toast';
import PictureCard from './PictureCard';

function WordPictureButton({ wordId, word }: { wordId: number; word: string }) {
  const [pic, setPic] = useState<WordPictureOut | null>(null);
  const [asked, setAsked] = useState<null | { exists: boolean; cost: number; enabled: boolean }>(null);
  const [busy, setBusy] = useState(false);

  const look = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await getWordPicture(wordId);
      setAsked({ exists: r.exists, cost: r.cost, enabled: r.enabled });
      if (r.exists && r.picture) setPic(r.picture);
    } catch (e) {
      toast.error(getErrorMessage(e, '没查到,再点一次'));
    } finally {
      setBusy(false);
    }
  };

  const draw = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await requestWordPicture(wordId);
      setPic(r);
      if (r.charged) toast.success(`开始画了,用掉 ${r.charged} 次`);
    } catch (e) {
      toast.error(getErrorMessage(e, '没画成,再点一次'));
    } finally {
      setBusy(false);
    }
  };

  if (pic) return <PictureCard picId={pic.pic_id} word={word} wordId={wordId} status={pic.status} url={pic.url} />;
  if (asked && !asked.exists) {
    if (!asked.enabled) return <p className="mt-2 text-xs text-gray-400">这个词还没有记忆图</p>;
    return (
      <button type="button" onClick={() => { void draw(); }} disabled={busy}
        className="mt-2 mr-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-orange-700 ring-1 ring-orange-200 hover:bg-orange-50 disabled:opacity-50">
        <ImageIcon className="h-4 w-4" aria-hidden="true" />
        画一张记忆图(用 {asked.cost} 次)
      </button>
    );
  }
  return (
    <button type="button" onClick={() => { void look(); }} disabled={busy}
      className="mt-2 mr-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-medium text-orange-700 ring-1 ring-orange-200 hover:bg-orange-50 disabled:opacity-50">
      <ImageIcon className="h-4 w-4" aria-hidden="true" />
      看记忆图
    </button>
  );
}

export default memo(WordPictureButton);
