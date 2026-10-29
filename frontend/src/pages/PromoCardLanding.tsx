/**
 * 体验卡落地页 /c/:code(公开,不用登录)—— 家长扫卡背面的二维码打开
 *
 * 这是「活码」: 卡上印的是这个固定地址,扫码后显示哪个微信 / 群码由销售在后台随时换,卡不用重印
 * (个人微信群码 7 天过期、满 200 人扫不进,不能直接印在卡上)。
 *
 * 顺序是**先留电话,再给二维码**(后端 GET 不下发二维码): 不留电话线索就归不到发卡的销售。
 * - 只问手机号(必填)+ 孩子年级 + 怎么称呼;不要验证码(生产没配短信,加了就是一道挡死所有人的门)
 * - 二维码图片要能长按识别: 带 data-allow-save(全站长按拦截认它),微信里长按图片 → 「识别图中二维码」
 * - 不写「转发有奖」「分享领红包」—— 微信判利益诱导分享会封域名,学生端也在这个域名下
 * - 朋友发来的链接带 ?f={分享码}: 原样带给后端(只认同机构的),登记成功后记成那家推荐的。
 *   登记成功页给一个中性的「邀请朋友一起体验」+ 复制链接;**奖励(延 7 天)这里一个字都不写**,由销售私聊告诉家长
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Copy, LoaderCircle, Phone } from 'lucide-react';
import {
  getPublicCard, inviteUrl, submitCardLead, type CardSubmitResult, type PublicCard,
} from '../api/promo';
import { formatPrice } from '../utils/promoPrice';

const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

const STEPS = ['留下手机号', '加班主任微信', '7 天每天学 20 分钟'];
/** 孩子开通后登录学习的网址(卡背面也印这个域名)。不写 https:// —— 家长手输 http 会被 301 到 https */
const STUDY_SITE = 'es.feiyingsteam.com';

export default function PromoCardLanding() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const ref = (params.get('f') || '').slice(0, 30);
  const [info, setInfo] = useState<PublicCard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ parent_phone: '', parent_name: '', child_grade: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<CardSubmitResult | null>(null);

  useEffect(() => {
    getPublicCard(code)
      .then((r) => {
        setInfo(r);
        document.title = `${r.org_name} · 飞鹰AI陪跑体验`;
      })
      .catch((e) => setLoadError(errText(e, '这张卡打不开,请联系发卡的老师')));
  }, [code]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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
      setDone(await submitCardLead(code, { ...form, parent_phone: phone, ref: ref || undefined }));
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
          <p className="text-4xl" aria-hidden>🎫</p>
          <h1 className="mt-3 text-lg font-bold text-gray-800">这张卡打不开</h1>
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
      <header className="bg-gradient-to-br from-[#FF6B35] to-[#FF8F5E] px-5 pb-12 pt-7 text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-center gap-3">
            {info.org_logo
              ? <img src={info.org_logo} alt="" className="h-10 w-10 rounded-xl bg-white object-contain p-1" />
              : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-2xl" aria-hidden>🦅</span>}
            <p className="font-bold">{info.org_name}</p>
          </div>
          <h1 className="mt-5 text-[26px] font-black leading-snug">飞鹰AI陪跑体验</h1>
          <p className="mt-1 text-sm text-white/90">AI 智能背单词 · 老师每天点评</p>
          <div className="mt-4 inline-flex items-baseline gap-1 rounded-full bg-white px-4 py-1.5 text-[#FF6B35]">
            <span className="text-sm font-bold">7 天体验</span>
            <span className="text-2xl font-black">¥{formatPrice(info.trial_price)}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-7 max-w-md space-y-4 px-4">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-bold text-gray-800">体验包含</h2>
          <p className="mt-2 text-[15px] leading-7 text-gray-700">{info.offer_text}</p>
          <ol className="mt-4 flex items-start justify-between gap-2 text-center text-xs text-gray-600">
            {STEPS.map((s, i) => (
              <li key={s} className="flex flex-1 flex-col items-center gap-1.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FF6B35] text-sm font-bold text-white">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </section>

        {done ? (
          <section className="rounded-2xl bg-white p-6 text-center shadow-sm" role="status">
            <CheckCircle2 className="mx-auto h-11 w-11 text-[#5FD35F]" aria-hidden />
            <h2 className="mt-2 text-lg font-bold text-gray-800">
              {done.status === 'created' ? '登记好了' : '您之前登记过了'}
            </h2>
            {done.qr_image_url ? (
              <>
                <p className="mt-1 text-sm text-gray-600">
                  长按下面的二维码,加{done.sales_name ? `「${done.sales_name}」` : '班主任'}微信
                </p>
                <img
                  src={done.qr_image_url}
                  alt="班主任微信二维码"
                  data-allow-save
                  className="allow-select mx-auto mt-4 w-60 max-w-full rounded-xl border border-gray-100"
                />
                <p className="mt-3 text-sm leading-6 text-gray-600">
                  {done.wechat_hint || '加上之后发一句「孩子的年级」,老师帮孩子开通体验账号。'}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-gray-600">
                {info.org_name}的老师会尽快打电话联系您,请留意来电。
              </p>
            )}
            {/* 开通后孩子去哪学: 家长最常问的一句,这里先告诉他(收藏 / 截图都行) */}
            <div className="mt-5 rounded-xl bg-orange-50 px-4 py-3 text-left text-sm leading-6 text-orange-900">
              <p className="font-semibold">孩子学习的网址</p>
              <p className="mt-0.5 select-all font-mono text-base font-bold tracking-wide text-[#FF6B35]">{STUDY_SITE}</p>
              <p className="mt-0.5 text-xs text-orange-800/80">老师开通账号后,用手机或电脑浏览器打开这个网址登录就能学。建议现在收藏。</p>
            </div>
            {done.share && <InviteBlock share={done.share} />}
          </section>
        ) : (
          <form onSubmit={submit} className="rounded-2xl bg-white p-5 shadow-sm" noValidate>
            <h2 className="font-bold text-gray-800">留下手机号,加班主任微信</h2>
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
              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="text-sm font-medium text-gray-700">怎么称呼您</span>
                  <input
                    type="text" autoComplete="name" maxLength={30}
                    value={form.parent_name} onChange={set('parent_name')} placeholder="如:王妈妈"
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-3 text-base outline-none focus:border-[#FF6B35] focus:ring-2 focus:ring-[#FF6B35]/20"
                  />
                </label>
                <label className="block w-32">
                  <span className="text-sm font-medium text-gray-700">孩子年级</span>
                  <select
                    value={form.child_grade} onChange={set('child_grade')}
                    className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-2 py-3 text-base outline-none focus:border-[#FF6B35]"
                  >
                    <option value="">请选择</option>
                    {info.grades.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </label>
              </div>
            </div>
            {formError && <p className="mt-3 text-sm text-red-600" role="alert">{formError}</p>}
            <button
              type="submit" disabled={submitting}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF6B35] text-base font-bold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {submitting ? '提交中…' : '下一步:加老师微信'}
            </button>
            <p className="mt-3 text-center text-xs leading-5 text-gray-400">
              您的手机号只给{info.org_name}的老师用来联系您,不会公开。
            </p>
          </form>
        )}
      </div>
    </main>
  );
}


/** 登记成功后: 邀请朋友一起体验(中性措辞,不写奖励)+ 看看哪些朋友来了 */
function InviteBlock({ share }: { share: NonNullable<CardSubmitResult['share']> }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(share.card_code, share.share_code);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt('长按复制下面的链接', url);
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-pink-100 bg-pink-50/60 px-4 py-3 text-left text-sm leading-6 text-pink-900">
      <p className="font-semibold">邀请朋友一起体验</p>
      <p className="mt-0.5 text-xs text-pink-900/80">身边有孩子也在学英语的朋友,可以把这个链接发给他。</p>
      <button type="button" onClick={copy}
        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-white px-3 text-sm font-semibold text-pink-600 shadow-sm">
        <Copy className="h-4 w-4" aria-hidden /> {copied ? '已复制' : '复制邀请链接'}
      </button>
      {share.view_code && (
        <p className="mt-2 text-xs">
          <Link to={`/c/share/${encodeURIComponent(share.view_code)}`} className="text-pink-700 underline">看看哪些朋友来了</Link>
          <span className="text-pink-900/60"> · 建议收藏这个页面</span>
        </p>
      )}
    </div>
  );
}
