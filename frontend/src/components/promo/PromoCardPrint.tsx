/**
 * 一版体验卡的卡面编辑 + 印刷文件: 选模板(几十套,按风格筛)、改卡上印的名字和电话、预览、下载正面 / 背面
 *
 * 用户 10-23:「老师可以在上面自定义加自己的号码和选不同的模版,这样就不会拿错卡片」。
 * 名字电话印两处: 正面底部一条(拿在手里一眼分得清是谁的卡)+ 背面二维码下面(家长扫不了码时能直接打电话)。
 * 选的模板和名字电话存在后端(PUT /promo/channels/{id}/design),下次打开、换台电脑都还在。
 * 背面的二维码是这版卡的固定地址,扫码后显示什么由销售在「我的二维码」里换 —— 卡印出去不用重印。
 * 正面徽章里的价格 = 机构「设置」里的体验价,现画(10-24 起底图不再印死 ¥99);改了价格要重新下载印刷文件。
 * 正面名字电话下面的地址 = 机构「设置」里的地址(10-29 起),全机构的卡一样;搬了家改设置、重新下载就是新地址。
 * 下载(11-04 起): 图片按 600dpi 重新画(预览只按 300dpi 画,快);PDF 正反面两页一个文件,二维码是矢量的,见 utils/promoPrint
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, FileText, LoaderCircle, X } from 'lucide-react';
import { cardUrl, updateCardDesign, type CardDesign, type PromoChannel } from '../../api/promo';
import { PROMO_TEMPLATES, TEMPLATE_GROUPS, templateOf, type TemplateGroup } from '../../data/promoTemplates';
import PromoCardThumb from './PromoCardThumb';
import { formatPrice } from '../../utils/promoPrice';
import { HI_RES, downloadCanvas, downloadCardPdf, drawCardBack, drawCardFront, trimmedDataUrl } from '../../utils/promoPrint';
import { copyText } from '../../utils/copyText';
import { toast } from '../Toast';

const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

interface Props {
  channel: PromoChannel;
  /** 机构「设置」里的体验价(元),印在正面徽章里 */
  price: number;
  /** 机构「设置」里的地址,印在正面名字电话下面(空 = 不印) */
  address: string;
  onClose: () => void;
  /** 卡面保存后通知外面刷新列表 */
  onSaved?: (c: PromoChannel) => void;
}

export default function PromoCardPrint({ channel, price, address, onClose, onSaved }: Props) {
  const url = cardUrl(channel.code);
  const [design, setDesign] = useState<CardDesign>(channel.design);
  const [saved, setSaved] = useState<CardDesign>(channel.design);
  // 50 套一屏翻不完: 按风格筛。默认停在当前模板所在的那一组,打开就看得到选中的是哪张
  const [group, setGroup] = useState<TemplateGroup | '全部'>(() => templateOf(channel.design.template_id).group);
  const [saving, setSaving] = useState(false);
  const [front, setFront] = useState<HTMLCanvasElement | null>(null);
  const [back, setBack] = useState<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 正在下载哪一个(重新画 600dpi 要一两秒,按钮上转圈,别让人以为没点上)
  const [busy, setBusy] = useState<'正面' | '背面' | 'pdf' | null>(null);
  const dirty = design.template_id !== saved.template_id || design.display_name !== saved.display_name
    || design.display_phone !== saved.display_phone;

  const opts = useMemo(() => ({
    templateId: design.template_id, url, code: channel.code, name: design.display_name, phone: design.display_phone, price, address,
  }), [design, url, channel.code, price, address]);

  useEffect(() => {
    let alive = true;
    // 打字时每个字都重画太频繁,停 300ms 再画
    const t = window.setTimeout(() => {
      Promise.all([drawCardFront(opts), drawCardBack(opts)])
        .then(([f, b]) => { if (alive) { setFront(f); setBack(b); setErr(null); } })
        .catch((e) => { if (alive) setErr(String(e?.message || e)); });
    }, 300);
    return () => { alive = false; window.clearTimeout(t); };
  }, [opts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving(true);
    try {
      const c = await updateCardDesign(channel.id, design);
      setSaved(c.design);
      setDesign(c.design);
      onSaved?.(c);
      return true;
    } catch (e) {
      toast(errText(e, '卡面没保存上'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const safe = `${design.display_name || channel.name}`.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 20);
  const baseName = `体验卡_${safe}_${channel.code}_${templateOf(design.template_id).name}_${formatPrice(price)}元`;
  const dl = async (side: '正面' | '背面') => {
    if (busy) return;
    // 下载前先存卡面: 印出去的卡和系统里记的必须是同一套,否则以后补印会印错
    if (!(await save())) return;
    setBusy(side);
    try {
      const c = side === '正面' ? await drawCardFront(opts, HI_RES) : await drawCardBack(opts, HI_RES);
      await downloadCanvas(c, `${baseName}_${side}.png`);
    } catch (e) {
      toast(`下载失败: ${String((e as Error)?.message || e)}。换个浏览器(电脑上的 Chrome / Edge)再试`, 'error');
    } finally {
      setBusy(null);
    }
  };
  const dlPdf = async () => {
    if (busy) return;
    if (!(await save())) return;
    setBusy('pdf');
    try {
      await downloadCardPdf(opts, `${baseName}_正反面.pdf`);
    } catch (e) {
      toast(`PDF 没生成出来: ${String((e as Error)?.message || e)}。可以先下载两张图片`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 sm:px-3 sm:py-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="体验卡卡面与印刷文件"
        className="flex h-full max-h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
          <div>
            <h2 className="text-base font-bold text-slate-800 sm:text-lg">卡面与印刷 · {channel.name}</h2>
            <p className="mt-0.5 break-all text-xs text-slate-500">卡码 {channel.code} · 扫码地址 {url}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-4 sm:gap-5 sm:p-5 lg:grid-cols-[1fr_300px]">
          {/* 三块直接做 grid 子项: 手机单列按 预览 → 名字电话/模板 → 印刷说明 排(印刷说明 order-last);
              大屏左列上预览、下说明,右列整列是名字电话/模板 */}
          <div className="space-y-4 lg:col-start-1 lg:row-start-1">
            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{err}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {[{ c: front, label: '正面' }, { c: back, label: '背面' }].map(({ c, label }) => (
                <figure key={label} className="space-y-2">
                  <div className="flex aspect-[3/2] items-center justify-center overflow-hidden rounded-2xl bg-slate-100 shadow-inner">
                    {c ? <img src={trimmedDataUrl(c)} alt={`体验卡${label}预览`} className="h-full w-full object-contain" />
                      : <LoaderCircle className="h-6 w-6 animate-spin text-slate-400" aria-label="生成中" />}
                  </div>
                  <figcaption className="flex items-center justify-between text-sm text-slate-600">
                    <span>{label}</span>
                    <button type="button" disabled={!c || saving || !!busy} onClick={() => dl(label as '正面' | '背面')}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#FF6B35]/40 bg-white px-3 text-sm font-bold text-[#c2451a] hover:bg-orange-50 disabled:opacity-40">
                      {busy === label ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                      {label}图片
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <button type="button" disabled={!front || !back || saving || !!busy} onClick={dlPdf}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#FF6B35] px-4 text-sm font-bold text-white hover:bg-[#f05a24] disabled:opacity-40">
                {busy === 'pdf' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
                {busy === 'pdf' ? '正在生成 PDF…' : '下载 PDF(正反面)'}
              </button>
              <span className="text-xs leading-5 text-slate-500">发给印刷厂用 PDF 最好;图片是 600dpi 的 PNG,一面一张</span>
            </div>
          </div>

          <div className="order-last space-y-4 lg:order-none lg:col-start-1 lg:row-start-2">
            <div className="rounded-xl bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-900">
              <b>给印刷厂说:</b>成品 <b>90×60mm</b>(不是普通名片的 90×54),文件已含四边各 2mm 出血(94×64mm),
              双面彩印,按成品线裁切。同一版卡每张都一样,不用可变数据。
              <br />优先发 <b>PDF</b>:正反面在一个文件里(第 1 页正面、第 2 页背面),二维码是矢量的;印刷厂要图片就发两张 PNG(600dpi)。
              <br />正面印的价格是 <b>¥{formatPrice(price)}</b>(「设置」里的体验价)
              {address ? <>、地址是 <b>{address}</b></> : '、没有印地址(在「设置」里填了才印)'}。
              改了价格或地址要重新下载、重新印 —— 已经印出去的卡改不了。
              <br />印之前先用手机扫一下下载的背面图,能打开填手机号的页面再下单。
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => copyText(url, '扫码地址已复制')}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <Copy className="h-4 w-4" aria-hidden /> 复制扫码地址
              </button>
              <a href={url} target="_blank" rel="noreferrer"
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                打开看家长看到的页面
              </a>
            </div>
          </div>

          <aside className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <section>
              <h3 className="text-sm font-bold text-slate-700">卡上印的名字和电话</h3>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">印在正面底部和背面二维码下面,一眼分得清是谁的卡。电话留空就不印。</p>
              <label className="mt-2 block">
                <span className="text-xs text-slate-500">名字</span>
                <input value={design.display_name} maxLength={20}
                  onChange={(e) => setDesign((d) => ({ ...d, display_name: e.target.value }))}
                  placeholder="如:王老师"
                  className="mt-0.5 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#FF6B35]" />
              </label>
              <label className="mt-2 block">
                <span className="text-xs text-slate-500">电话</span>
                <input value={design.display_phone} maxLength={20} inputMode="tel"
                  onChange={(e) => setDesign((d) => ({ ...d, display_phone: e.target.value.replace(/[^0-9+\- ]/g, '') }))}
                  placeholder="如:138 0000 0000"
                  className="mt-0.5 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-[#FF6B35]" />
              </label>
            </section>

            <section>
              <h3 className="text-sm font-bold text-slate-700">
                选模板 <span className="font-normal text-slate-500">· {templateOf(design.template_id).name}</span>
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">每个销售用不同的模板,发卡时不会拿错。</p>
              <div className="-mx-4 mt-2 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="按风格筛模板">
                {(['全部', ...TEMPLATE_GROUPS] as const).map((g) => (
                  <button key={g} type="button" onClick={() => setGroup(g)}
                    className={`min-h-8 shrink-0 rounded-full px-3 text-xs font-semibold ${group === g ? 'bg-[#FF6B35] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {g}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:max-h-[340px] lg:grid-cols-3 lg:overflow-y-auto lg:pr-1" role="radiogroup" aria-label="卡面模板">
                {PROMO_TEMPLATES.filter((t) => group === '全部' || t.group === group).map((t) => {
                  const on = t.id === design.template_id;
                  return (
                    <button key={t.id} type="button" role="radio" aria-checked={on} aria-label={t.name}
                      onClick={() => setDesign((d) => ({ ...d, template_id: t.id }))}
                      className={`relative overflow-hidden rounded-lg border-2 text-left ${on ? 'border-[#FF6B35]' : 'border-transparent hover:border-slate-300'}`}>
                      <PromoCardThumb templateId={t.id} price={price} className="block aspect-[3/2] w-full" />
                      <span className="block truncate bg-white px-1 py-0.5 text-[11px] text-slate-600">{t.no}. {t.name}</span>
                      {on && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#FF6B35] text-white">
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <button type="button" disabled={!dirty || saving} onClick={() => save().then((ok) => ok && toast('卡面已保存', 'success'))}
              className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-800 text-sm font-bold text-white disabled:opacity-40">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
              {dirty ? '保存卡面' : '卡面已保存'}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
