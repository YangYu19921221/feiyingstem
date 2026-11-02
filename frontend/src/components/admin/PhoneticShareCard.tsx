/**
 * 管理端首页「直营音标视频给哪些机构看」(2026-11-02)。规则真源 backend/app/services/phonetic_share.py。
 * 用户「选择那些机构可以看那些不可以看 默认是打开 然后非直营机构教师端不能上传视频」:
 * 每个机构一个开关,默认能看(新机构也是);能看 = 直营的全部音标视频(含以后新传的),只读。
 */
import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { phoneticsApi, type PhoneticShareOrg, type PhoneticShareStatus } from '../../api/phonetics';
import { getErrorMessage } from '../../utils/errorMessage';

const STATUS_LABEL: Record<string, string> = { active: '', suspended: '已停用', expired: '已到期' };

export default function PhoneticShareCard() {
  const [state, setState] = useState<PhoneticShareStatus | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    phoneticsApi.shareStatus().then(setState).catch((e) => setError(getErrorMessage(e, '读不到音标视频共享的设置')));
  }, []);

  const toggle = async (org: PhoneticShareOrg) => {
    if (busyId !== null) return;
    const next = !org.enabled;
    if (!next && !window.confirm(
      `关掉后「${org.name}」的老师和学生马上看不到直营的音标视频,他们兑过的码也打不开这些课。确定关掉?`)) return;
    setBusyId(org.id);
    setError('');
    try {
      setState(await phoneticsApi.setShareOrg(org.id, next));
    } catch (e) {
      setError(getErrorMessage(e, '保存失败,稍后再试'));
    } finally {
      setBusyId(null);
    }
  };

  const onCount = state?.orgs.filter((o) => o.enabled).length ?? 0;

  return (
    <section className="admin-panel rounded-2xl p-5 sm:p-6" aria-labelledby="phonetic-share-heading">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e4f3f5] text-[#2f8791]">
          <Share2 className="h-5 w-5" />
        </span>
        <div>
          <h3 id="phonetic-share-heading" className="font-bold text-[#173047]">直营音标视频给哪些机构看</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            开着的机构,老师和学生都看得到直营的全部音标视频(以后直营新传的也是),只能看,不能改、不能删;
            要不要兑换码按各机构自己的设置。新开的机构默认开着。音标视频只由直营上传,分校老师那边没有上传入口。
          </p>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {state && (
        <>
          <p className="mt-4 text-sm text-slate-600">
            直营现在有 {state.hq_videos} 节(上架 {state.hq_active_videos} 节),{state.orgs.length} 个机构里 {onCount} 个看得到
          </p>
          {state.orgs.length === 0 ? (
            <p className="mt-3 rounded-xl bg-[#f5f8fa] px-3.5 py-3 text-sm text-slate-500">还没有别的机构</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
              {state.orgs.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#173047]">
                      {o.name}
                      {STATUS_LABEL[o.status] && (
                        <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500">
                          {STATUS_LABEL[o.status]}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{o.students} 个学生</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(o)}
                    disabled={busyId !== null}
                    aria-pressed={o.enabled}
                    aria-label={`${o.name}: ${o.enabled ? '看得到,点击关掉' : '看不到,点击打开'}`}
                    className={`admin-focus-ring inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-xl px-3.5 text-sm font-semibold transition disabled:opacity-60 ${
                      o.enabled ? 'bg-[#e8f6ef] text-[#32815f] hover:bg-[#d8efe3]' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}`}
                  >
                    {busyId === o.id ? '保存中…' : o.enabled ? '看得到' : '看不到'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
