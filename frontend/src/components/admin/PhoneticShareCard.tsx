/**
 * 管理端首页「直营音标视频共享给所有机构」(2026-11-02)。规则真源 backend/app/services/phonetic_share.py。
 * 一个总开关(用户「这个开关设置在管理端 总的管理端音标视频是否共享给别的机构」): 打开 = 直营的音标视频
 * 所有机构都看得到(以后直营新传的也是),别的机构只能看;关掉 = 别的机构马上看不到。
 */
import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { phoneticsApi, type PhoneticShareStatus } from '../../api/phonetics';
import { getErrorMessage } from '../../utils/errorMessage';

export default function PhoneticShareCard() {
  const [state, setState] = useState<PhoneticShareStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    phoneticsApi.shareStatus().then(setState).catch((e) => setError(getErrorMessage(e, '读不到音标视频共享的状态')));
  }, []);

  const toggle = async () => {
    if (!state || busy) return;
    const next = !state.enabled;
    const msg = next
      ? `把直营的 ${state.videos} 节音标视频共享给所有机构?\n\n共享后每个机构的老师和学生都看得到(要不要兑换码按各机构自己的设置),以后直营新传的也会共享。别的机构只能看,不能改、不能删;直营老师照样能改。`
      : '取消共享?\n\n别的机构的学生马上就看不到直营的音标视频了,他们兑过的码也打不开这些课。';
    if (!window.confirm(msg)) return;
    setBusy(true);
    setError('');
    try {
      setState(await phoneticsApi.setShare(next));
    } catch (e) {
      setError(getErrorMessage(e, '保存失败,稍后再试'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-panel rounded-2xl p-5 sm:p-6" aria-labelledby="phonetic-share-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e4f3f5] text-[#2f8791]">
            <Share2 className="h-5 w-5" />
          </span>
          <div>
            <h3 id="phonetic-share-heading" className="font-bold text-[#173047]">直营音标视频共享给所有机构</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              打开后,直营的音标视频每个机构的老师和学生都看得到,以后直营新传的也会共享;要不要兑换码按各机构自己的设置。
              别的机构只能看,不能改、不能删、不能排序;直营老师照样能改。关掉后别的机构马上看不到。
            </p>
          </div>
        </div>
        {state && (
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            aria-pressed={state.enabled}
            className={`admin-focus-ring inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-semibold transition disabled:opacity-60 ${
              state.enabled ? 'bg-[#e8f6ef] text-[#32815f] hover:bg-[#d8efe3]' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
          >
            {busy ? '保存中…' : state.enabled ? '共享中(点击取消)' : '没共享(点击共享)'}
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {state && (
        <p className="mt-3 text-sm text-slate-600">
          {state.enabled
            ? `现在: 直营的 ${state.videos} 节(上架 ${state.active_videos} 节)其他 ${state.other_orgs} 个机构都看得到`
            : `现在: 直营的 ${state.videos} 节只有直营自己看得到,其他 ${state.other_orgs} 个机构看不到`}
        </p>
      )}
    </section>
  );
}
