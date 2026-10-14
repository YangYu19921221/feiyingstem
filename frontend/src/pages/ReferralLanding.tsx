/**
 * 家长推荐落地页 /invite/:code(公开,不用登录)
 *
 * 打开它的人是**被推荐的新家长**,大概率在微信里点开,所以:
 * - 手机优先、单列,一屏讲清「谁推荐的 + 哪家机构 + 您能得到什么」,再往下就是表单
 * - 只问 4 样:家长称呼、手机号(必填)、孩子称呼、年级;不要密码、不要验证码(生产短信没配,
 *   加了就是一道挡死所有人的门)。真伪由老师打电话核实,奖励也只在到店报名后才发
 * - 推荐人只显示「张同学」(后端已脱敏),不在公开链接上摆孩子全名
 * - 不写任何「转发得奖励」「分享领红包」—— 微信判利益诱导分享会封域名,而学生端也在这个域名下
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, LoaderCircle, Phone } from 'lucide-react';
import { getPublicInvite, submitReferralLead, type PublicInvite } from '../api/referral';

const GRADES = ['幼儿园', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'];

const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

export default function ReferralLanding() {
  const { code = '' } = useParams();
  const [info, setInfo] = useState<PublicInvite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ parent_name: '', parent_phone: '', child_name: '', child_grade: '', note: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<'created' | 'duplicate' | null>(null);

  useEffect(() => {
    getPublicInvite(code)
      .then((r) => {
        setInfo(r);
        document.title = `${r.org_name} · 邀请您免费体验`;
      })
      .catch((e) => setLoadError(errText(e, '邀请链接打不开,请联系推荐您的家长重新发一次')));
  }, [code]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const phone = form.parent_phone.replace(/[\s-]/g, '');
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setFormError('请填写 11 位手机号,老师会用这个号码联系您');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const r = await submitReferralLead(code, { ...form, parent_phone: phone });
      setDone(r.status);
    } catch (err) {
      setFormError(errText(err, '提交没成功,请检查网络后再试一次'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FFF8F0] px-6">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-4xl" aria-hidden>🔗</p>
          <h1 className="mt-3 text-lg font-bold text-gray-800">链接已失效</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">{loadError}</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FFF8F0]" aria-busy="true">
        <LoaderCircle className="h-7 w-7 animate-spin text-[#FF6B35]" aria-label="加载中" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FFF8F0] pb-10">
      {/* 头部:机构 + 谁推荐的 */}
      <header className="bg-gradient-to-br from-[#FF6B35] to-[#FF8F5E] px-5 pb-10 pt-8 text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-center gap-3">
            {info.org_logo
              ? <img src={info.org_logo} alt="" className="h-11 w-11 rounded-xl bg-white object-contain p-1" />
              : <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 text-2xl" aria-hidden>🦅</span>}
            <p className="text-lg font-bold">{info.org_name}</p>
          </div>
          <h1 className="mt-6 text-2xl font-black leading-snug">
            {info.referrer}的家长<br />邀请您来免费体验
          </h1>
          {info.referrer_words > 0 && (
            <p className="mt-3 text-sm text-white/90">
              {info.referrer}在这里已经学会了 <b className="text-[#FFD23F]">{info.referrer_words}</b> 个单词
            </p>
          )}
        </div>
      </header>

      <div className="mx-auto -mt-6 max-w-md space-y-4 px-4">
        {/* 新朋友能得到什么 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-gray-800">🎁 您能得到</h2>
          <p className="mt-2 text-[15px] leading-7 text-gray-700">
            {info.friend_offer || '一次免费的英语水平测评,老师当面讲解孩子现在的情况和适合的学习方法。'}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
            <li>· 孩子每天在系统里背单词、做作业,学了多少、错在哪,家长手机上都看得见</li>
            <li>· 留下电话后,老师会打电话和您约时间,不会反复打扰</li>
          </ul>
        </section>

        {/* 表单 / 完成 */}
        {done ? (
          <section className="rounded-2xl bg-white p-6 text-center shadow-sm" role="status">
            <CheckCircle2 className="mx-auto h-12 w-12 text-[#5FD35F]" aria-hidden />
            <h2 className="mt-3 text-lg font-bold text-gray-800">
              {done === 'created' ? '已收到,谢谢您!' : '您已经登记过了'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {info.org_name}的老师会尽快打电话联系您,请留意来电。
            </p>
          </section>
        ) : (
          <form onSubmit={submit} className="rounded-2xl bg-white p-5 shadow-sm" noValidate>
            <h2 className="font-bold text-gray-800">留个联系方式,老师和您约时间</h2>
            <div className="mt-4 space-y-3.5">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">手机号 <span className="text-[#FF6B35]">*</span></span>
                <div className="relative mt-1">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                  <input
                    type="tel" inputMode="numeric" autoComplete="tel" required maxLength={20}
                    value={form.parent_phone} onChange={set('parent_phone')}
                    placeholder="老师用这个号码联系您"
                    aria-invalid={!!formError}
                    className="w-full rounded-xl border border-gray-200 py-3 pl-9 pr-3 text-base outline-none focus:border-[#FF6B35] focus:ring-2 focus:ring-[#FF6B35]/20"
                  />
                </div>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">怎么称呼您</span>
                <input
                  type="text" autoComplete="name" maxLength={30}
                  value={form.parent_name} onChange={set('parent_name')} placeholder="如:王妈妈"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-base outline-none focus:border-[#FF6B35] focus:ring-2 focus:ring-[#FF6B35]/20"
                />
              </label>
              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="text-sm font-medium text-gray-700">孩子称呼</span>
                  <input
                    type="text" maxLength={30}
                    value={form.child_name} onChange={set('child_name')} placeholder="小名也行"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-base outline-none focus:border-[#FF6B35] focus:ring-2 focus:ring-[#FF6B35]/20"
                  />
                </label>
                <label className="block w-32">
                  <span className="text-sm font-medium text-gray-700">年级</span>
                  <select
                    value={form.child_grade} onChange={set('child_grade')}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-2 py-3 text-base outline-none focus:border-[#FF6B35]"
                  >
                    <option value="">请选择</option>
                    {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">方便接电话的时间(选填)</span>
                <input
                  type="text" maxLength={100}
                  value={form.note} onChange={set('note')} placeholder="如:工作日晚上 7 点后"
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-base outline-none focus:border-[#FF6B35] focus:ring-2 focus:ring-[#FF6B35]/20"
                />
              </label>
            </div>
            {formError && <p className="mt-3 text-sm text-red-600" role="alert">{formError}</p>}
            <button
              type="submit" disabled={submitting}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF6B35] text-base font-bold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? '提交中…' : '预约免费体验'}
            </button>
            <p className="mt-3 text-center text-xs leading-5 text-gray-400">
              您的电话只给{info.org_name}的老师用来联系您,不会公开,也不会给推荐您的家长看。
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
