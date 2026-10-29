/**
 * 推荐人家长看进度 /c/share/:viewCode(公开,不用登录)
 *
 * 只写事实: 几家朋友来了、几家付了体验费、孩子的体验到哪天。朋友手机号打码,不出孩子姓名。
 * **不写「转发得 7 天」「再邀 N 人领…」这类话** —— 微信判利益诱导分享会封域名,学生端也在这个域名下;
 * 规则由销售私聊告诉家长。这个链接只在家长自己第一次登记成功时、或销售那里拿得到(分享链接是另一个码,朋友打不开这页)
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { getShareProgress, type ShareProgress } from '../api/promo';

const TONE: Record<string, string> = {
  counted: 'bg-emerald-50 text-emerald-700',
  over: 'bg-slate-100 text-slate-600',
  refunded: 'bg-slate-100 text-slate-500',
  existing: 'bg-slate-100 text-slate-500',
  pending: 'bg-orange-50 text-orange-700',
};

/** 2026-11-19 → 11 月 19 日 */
const cnDay = (d: string) => `${Number(d.slice(5, 7))} 月 ${Number(d.slice(8, 10))} 日`;

export default function PromoShareProgress() {
  const { viewCode = '' } = useParams();
  const [data, setData] = useState<ShareProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getShareProgress(viewCode)
      .then((r) => { setData(r); document.title = `${r.org_name} · 邀请的朋友`; })
      .catch((e) => {
        const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
        setError(typeof d === 'string' ? d : '这个链接打不开了');
      });
  }, [viewCode]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FFF8F0] px-6">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-gray-800">这个链接打不开了</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">{error},请联系老师。</p>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FFF8F0]" aria-busy="true">
        <LoaderCircle className="h-7 w-7 animate-spin text-[#FF6B35]" aria-label="加载中" />
      </main>
    );
  }

  const paid = data.friends.filter((f) => f.state === 'counted' || f.state === 'over').length;
  return (
    <main className="min-h-screen bg-[#FFF8F0] px-4 py-8">
      <div className="mx-auto max-w-md space-y-4">
        <header>
          <p className="text-sm font-semibold text-[#FF6B35]">{data.org_name}</p>
          <h1 className="mt-1 text-2xl font-black text-gray-800">邀请的朋友</h1>
        </header>
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-[15px] leading-7 text-gray-700">
            {data.friends.length === 0
              ? '还没有朋友通过您的链接登记。'
              : <>已有 <b>{data.friends.length}</b> 家朋友登记,其中 <b>{paid}</b> 家付了体验费。</>}
          </p>
          {data.trial_last_day ? (
            <p className="mt-2 text-[15px] leading-7 text-gray-700">
              孩子的体验{data.trial_active ? '到' : '已于'} <b className="text-[#FF6B35]">{cnDay(data.trial_last_day)}</b>{data.trial_active ? '' : '结束'}
              {data.added_days > 0 && <span className="text-sm text-gray-500">(朋友付了体验费,多了 {data.added_days} 天)</span>}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-gray-500">老师给孩子开通体验后,这里会显示体验到哪天。</p>
          )}
        </section>
        {data.friends.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <ul className="divide-y divide-gray-100">
              {data.friends.map((f, i) => (
                <li key={`${f.phone}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="tabular-nums text-gray-700">{f.phone}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[f.state] || ''}`}>{f.label}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-center text-xs leading-5 text-gray-400">这个页面只给您自己看,里面有朋友的手机尾号,请不要转发。</p>
      </div>
    </main>
  );
}
