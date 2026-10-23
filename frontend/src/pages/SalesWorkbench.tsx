/**
 * 销售工作台 /sales —— 销售账号(role=sales)登录后只有这一页
 *
 * 三块: ①我的二维码(家长扫卡留电话后看到的那张,随时换)②我的卡(打印文件)③我的线索(跟单)。
 * 销售看不到学生学习数据、看不到别的销售的线索(后端按 sales_user_id 过滤)。
 * 机构管理员 / 平台管理员自己也发卡时同样用这一页传自己的二维码。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LoaderCircle, LogOut, Printer, QrCode, Upload } from 'lucide-react';
import ChangePasswordModal from '../components/ChangePasswordModal';
import PromoCardPrint from '../components/promo/PromoCardPrint';
import PromoLeadsPanel from '../components/promo/PromoLeadsPanel';
import { cardUrl, getMyPromo, updateMyPromo, uploadMyQr, type MyPromo, type PromoChannel } from '../api/promo';
import { templateImg, templateOf } from '../data/promoTemplates';
import { copyText } from '../utils/copyText';
import { toast } from '../components/Toast';

const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

export default function SalesWorkbench() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MyPromo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [kind, setKind] = useState<'wechat' | 'group'>('wechat');
  const [hint, setHint] = useState('');
  const [uploading, setUploading] = useState(false);
  const [printing, setPrinting] = useState<PromoChannel | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const r = await getMyPromo();
      setMe(r);
      setKind(r.profile.qr_kind);
      setHint(r.profile.wechat_hint);
    } catch (e) {
      setLoadErr(errText(e, '加载失败,请刷新再试'));
    }
  };
  useEffect(() => { load(); }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast('图片不能超过 2MB,截图后再传', 'error'); return; }
    setUploading(true);
    try {
      const p = await uploadMyQr(f, kind);
      setMe((m) => m && { ...m, profile: p });
      toast('二维码换好了,家长扫卡后看到的就是这张', 'success');
    } catch (err) {
      toast(errText(err, '上传失败'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const saveHint = async () => {
    if (!me || hint === me.profile.wechat_hint) return;
    try {
      const p = await updateMyPromo({ wechat_hint: hint });
      setMe((m) => m && { ...m, profile: p });
      toast('已保存', 'success');
    } catch (e) {
      toast(errText(e, '没保存上'), 'error');
    }
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login', { replace: true });
  };

  if (loadErr) {
    return <main className="flex min-h-screen items-center justify-center bg-[#f5f8fc] px-6 text-sm text-red-600">{loadErr}</main>;
  }
  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f8fc]" aria-busy="true">
        <LoaderCircle className="h-7 w-7 animate-spin text-[#FF6B35]" aria-label="加载中" />
      </main>
    );
  }

  const p = me.profile;
  return (
    <div className="min-h-screen bg-[#f5f8fc] pb-16 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-lg font-bold">销售工作台</h1>
            <p className="text-xs text-slate-500">{me.name} · 体验卡 ¥{me.settings.trial_price}</p>
          </div>
          <div className="flex items-center gap-2">
            {me.role !== 'sales' && (
              <button type="button" onClick={() => navigate('/admin/promo')}
                className="min-h-9 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                回体验卡管理
              </button>
            )}
            <button type="button" onClick={() => setShowPwd(true)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <KeyRound className="h-4 w-4" aria-hidden /> 改密码
            </button>
            <button type="button" onClick={logout}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <LogOut className="h-4 w-4" aria-hidden /> 退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5">
        <section className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm leading-6 text-orange-900">
          <b>怎么用:</b>① 先传你的微信二维码 → ② 下载自己那版卡去印 → ③ 家长扫卡留了电话,这里出现一条「待联系」,
          他同时就看到了你的二维码 → ④ 加上微信、收了体验费、开好账号,每一步在这里点一下,写一句跟进。
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold"><QrCode className="h-5 w-5 text-[#FF6B35]" aria-hidden />我的二维码</h2>
          <p className="mt-1 text-xs text-slate-500">家长扫卡、留了电话后看到的就是这张。随时能换,卡不用重印。</p>
          <div className="mt-4 flex flex-col gap-5 sm:flex-row">
            <div className="flex h-44 w-44 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
              {p.qr_image_url
                ? <img src={p.qr_image_url} alt="我的二维码" className="h-full w-full object-contain" />
                : <span className="px-4 text-center text-xs text-slate-400">还没传。没传的话家长留完电话只看到「老师会联系您」</span>}
            </div>
            <div className="flex-1 space-y-3">
              {p.qr_stale && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
                  群二维码已经传了 6 天以上,微信群码 7 天就过期,家长会扫不进来。请重新截一张传上来。
                </p>
              )}
              <fieldset className="flex flex-wrap gap-3 text-sm">
                <legend className="sr-only">二维码类型</legend>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="qrkind" checked={kind === 'wechat'} onChange={() => setKind('wechat')} />
                  我的个人微信(推荐,长期有效)
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="qrkind" checked={kind === 'group'} onChange={() => setKind('group')} />
                  微信群码(7 天过期,满 200 人扫不进)
                </label>
              </fieldset>
              <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF6B35] px-4 text-sm font-bold text-white disabled:opacity-50">
                {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
                {p.qr_image_url ? '换一张' : '上传二维码图片'}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPick} />
              {p.qr_updated_at && <p className="text-xs text-slate-400">上次更换 {p.qr_updated_at.replace('T', ' ')}</p>}
              <label className="block">
                <span className="text-sm font-medium text-slate-700">二维码下面写一句话(选填)</span>
                <input value={hint} onChange={(e) => setHint(e.target.value)} onBlur={saveHint} maxLength={60}
                  placeholder="如:加我微信,发一句孩子年级,我帮孩子开通"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#FF6B35]" />
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold"><Printer className="h-5 w-5 text-[#FF6B35]" aria-hidden />我的卡</h2>
          {me.channels.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">还没有你名下的卡。请机构管理员在「地推体验卡 → 卡码」里给你开一版。</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {me.channels.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <img src={templateImg(c.design.template_id, 'thumb')} alt="" className="h-12 w-[72px] shrink-0 rounded-md object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.name} {!c.is_active && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">已停用</span>}</p>
                    <p className="text-xs text-slate-500">
                      模板「{templateOf(c.design.template_id).name}」· 卡上印 {[c.design.display_name, c.design.display_phone].filter(Boolean).join(' ') || '(没印名字电话)'}
                      · 卡码 {c.code} · 被扫开 {c.view_count} 次
                    </p>
                  </div>
                  <button type="button" onClick={() => copyText(cardUrl(c.code), '扫码地址已复制')}
                    className="min-h-9 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    复制地址
                  </button>
                  <button type="button" onClick={() => setPrinting(c)} disabled={!c.is_active}
                    className="min-h-9 rounded-lg bg-slate-800 px-3 text-sm font-semibold text-white disabled:opacity-40">
                    卡面与印刷
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-bold">我的线索</h2>
          <PromoLeadsPanel manager={false} />
        </section>
      </main>

      {printing && (
        <PromoCardPrint channel={printing} onClose={() => setPrinting(null)}
          onSaved={(c) => setMe((m) => m && { ...m, channels: m.channels.map((x) => (x.id === c.id ? { ...x, design: c.design } : x)) })} />
      )}
      <ChangePasswordModal isOpen={showPwd} onClose={() => setShowPwd(false)} />
    </div>
  );
}
