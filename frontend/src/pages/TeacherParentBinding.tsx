/**
 * 老师端「家长绑定」—— 给本班学生的家长一人发一条绑定链接,看谁的家长还没绑上
 *
 * 为什么有这页: 学生自己生成绑定码的入口藏在光荣榜里,一年 363 个码 0 个家长绑上
 * (另一半原因是家长手机号和孩子学生号相同被拦,后端已修)。能把家长拉进来的是老师。
 *
 * 规则真源 backend/app/api/v1/parent.py: 链接 7 天有效、只能用一次;已有没用掉的链接
 * 再点「复制」还是同一条(老师可能已经发出去了),要作废才点「换新」。
 * 链接要一人一条私发 —— 谁点开都能绑上这个孩子,发到群里等于把孩子的学情给全群看。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, KeyRound, LoaderCircle, Printer, RefreshCw, Search, Unlink, UsersRound, X } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { parentBindingApi, parentRegisterUrl, type ParentBindingStudent } from '../api/parent';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

type Filter = 'unbound' | 'bound' | 'all';

interface Slip { student_id: number; name: string; code: string; url: string; qr: string; expires: string }

const displayName = (s: { full_name: string; username: string }) => s.full_name || s.username;

/** 10月28日 */
const fmtDay = (iso: string) => {
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const inviteText = (name: string, url: string, expires: string) =>
  `${name}家长您好,这是${name}在「飞鹰AI英语」的家长查看链接。点开后用您的手机号注册(可以和孩子的账号用同一个手机号),`
  + `就能看到孩子每天学了多少、哪些单词还不会:\n${url}\n`
  + `(${fmtDay(expires)}前有效,只能绑定一次,请不要转发给别人)`;

async function copyText(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMsg);
  } catch {
    // 微信内置浏览器常不给剪贴板权限: 退回系统输入框,长按全选复制
    window.prompt('长按下面的文字复制', text);
  }
}

export default function TeacherParentBinding() {
  const [items, setItems] = useState<ParentBindingStudent[]>([]);
  const [stat, setStat] = useState({ bound: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('unbound');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<{ who: string; password: string } | null>(null);
  const [slips, setSlips] = useState<Slip[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await parentBindingApi.list();
      setItems(r.items);
      setStat({ bound: r.bound, total: r.total });
    } catch (e) {
      toast.error(getErrorMessage(e, '加载学生名单失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 绑定条渲染到页面上之后再弹打印框(图片是 data URL,下一帧就画好了)
  useEffect(() => {
    if (!slips || slips.length === 0) return;
    const t = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(t);
  }, [slips]);

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return items.filter((s) => {
      if (filter === 'unbound' && s.parents.length > 0) return false;
      if (filter === 'bound' && s.parents.length === 0) return false;
      if (!kw) return true;
      return displayName(s).toLowerCase().includes(kw) || s.username.toLowerCase().includes(kw)
        || s.class_name.toLowerCase().includes(kw);
    });
  }, [items, filter, q]);
  const unbound = useMemo(() => items.filter((s) => s.parents.length === 0), [items]);

  const copyLink = async (s: ParentBindingStudent, renew = false) => {
    if (renew && !window.confirm(`作废「${displayName(s)}」之前发出的链接,换一条新的?\n\n旧链接家长再点就打不开了,只在发错人时用。`)) return;
    setBusy(`code-${s.id}`);
    try {
      const r = await parentBindingApi.code(s.id, renew);
      await copyText(inviteText(displayName(s), parentRegisterUrl(r.code), r.expires_at),
        renew ? '新链接已复制,旧链接已作废' : '已复制,去微信私发给这位家长');
      setItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, pending: { code: r.code, expires_at: r.expires_at } } : x)));
    } catch (e) {
      toast.error(getErrorMessage(e, '链接没生成出来,请重试'));
    } finally {
      setBusy(null);
    }
  };

  const unbind = async (s: ParentBindingStudent, linkId: number, who: string) => {
    if (!window.confirm(`解除「${displayName(s)}」和家长「${who}」的绑定?\n\n解除后这位家长就看不到孩子的学习数据了,家长账号不会删除。`)) return;
    setBusy(`unbind-${linkId}`);
    try {
      await parentBindingApi.unbind(linkId);
      toast.success('已解除绑定');
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '解除失败'));
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async (linkId: number, who: string) => {
    if (!window.confirm(`给家长「${who}」重置一个新密码?\n\n旧密码会失效,新密码只显示这一次。`)) return;
    setBusy(`reset-${linkId}`);
    try {
      const r = await parentBindingApi.resetPassword(linkId);
      setNewPassword({ who, password: r.password });
    } catch (e) {
      toast.error(getErrorMessage(e, '重置失败'));
    } finally {
      setBusy(null);
    }
  };

  const printSlips = async () => {
    if (unbound.length === 0) return;
    setBusy('print');
    try {
      const r = await parentBindingApi.codes(unbound.map((s) => s.id));
      const nameOf = new Map(unbound.map((s) => [s.id, displayName(s)]));
      const list = await Promise.all(r.items.map(async (it) => {
        const url = parentRegisterUrl(it.code);
        return {
          student_id: it.student_id,
          name: nameOf.get(it.student_id) || it.child_name || it.username,
          code: it.code, url, expires: it.expires_at,
          qr: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
        };
      }));
      setSlips(list);
      const pendingOf = new Map(r.items.map((it) => [it.student_id, { code: it.code, expires_at: it.expires_at }]));
      setItems((prev) => prev.map((x) => (pendingOf.has(x.id) ? { ...x, pending: pendingOf.get(x.id)! } : x)));
    } catch (e) {
      toast.error(getErrorMessage(e, '绑定条没生成出来,请重试'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-[#f5f8fc] text-slate-800 print:hidden">
        <StaffWorkspaceHeader role="teacher" title="家长绑定" subtitle="家长绑上以后,孩子每天学了什么、哪些词不会,家长自己就能看" icon={UsersRound} backTo="/teacher/dashboard" />

        <main className="teacher-workspace-main mx-auto max-w-5xl space-y-5">
          <section className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm leading-6 text-orange-900">
            <p>① 点学生右边的「复制链接」,在微信里<b>一人一条私发</b>给这个孩子的家长。家长点开,用自己的手机号注册就绑上了。</p>
            <p>② 家长的手机号<b>可以和孩子的学生账号一样</b>。链接 7 天有效、只能用一次。</p>
            <p className="text-orange-700">③ 别把链接发到家长群:谁点开都能绑上这个孩子。不方便私发就「打印绑定条」,让孩子带回家。</p>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-500">家长已绑定</p>
              <p className="text-2xl font-bold text-emerald-600">
                {stat.bound}<span className="text-base font-semibold text-slate-400"> / {stat.total} 个学生</span>
              </p>
            </div>
            <button type="button" onClick={printSlips} disabled={busy !== null || unbound.length === 0}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[#FF6B35] px-4 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50">
              {busy === 'print' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}
              打印绑定条{unbound.length > 0 ? `(未绑定 ${unbound.length} 人)` : ''}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
            {([['unbound', `未绑定 ${unbound.length}`], ['bound', `已绑定 ${stat.bound}`], ['all', `全部 ${stat.total}`]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={`min-h-9 rounded-lg px-3 text-sm ${filter === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {label}
              </button>
            ))}
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜姓名 / 班级" aria-label="搜索学生"
                className="w-44 rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-orange-400" />
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl bg-white py-14 text-center text-sm text-slate-500 shadow-sm">
              {stat.total === 0 ? '你的班里还没有学生' : q ? '没找到这个学生' : filter === 'unbound' ? '全部学生的家长都绑上了' : '还没有家长绑定'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              {shown.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800">
                      {displayName(s)}
                      {s.class_name && <span className="ml-2 text-xs font-normal text-slate-400">{s.class_name}</span>}
                    </p>
                    {s.parents.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {s.parents.map((p) => {
                          const who = `${p.name} ${p.phone}`.trim();
                          return (
                            <span key={p.link_id} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 py-1 pl-2.5 pr-1 text-xs text-emerald-800">
                              {who}
                              <button type="button" onClick={() => resetPassword(p.link_id, who)} disabled={busy !== null}
                                title="家长忘了密码" aria-label={`重置${who}的密码`}
                                className="inline-flex min-h-8 items-center gap-0.5 rounded-md px-1.5 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                                <KeyRound className="h-3.5 w-3.5" aria-hidden /> 重置密码
                              </button>
                              <button type="button" onClick={() => unbind(s, p.link_id, who)} disabled={busy !== null}
                                title="绑错人了 / 家长换了" aria-label={`解除${who}的绑定`}
                                className="inline-flex min-h-8 items-center gap-0.5 rounded-md px-1.5 text-slate-500 hover:bg-white disabled:opacity-50">
                                <Unlink className="h-3.5 w-3.5" aria-hidden /> 解绑
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-0.5 text-xs text-slate-500">
                        <span className="mr-2 rounded bg-orange-50 px-1.5 py-0.5 font-semibold text-orange-700">未绑定</span>
                        {s.pending ? `链接已生成,${fmtDay(s.pending.expires_at)}前有效` : '还没发过链接'}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button type="button" onClick={() => copyLink(s)} disabled={busy !== null}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold disabled:opacity-50 ${
                        s.parents.length === 0 ? 'bg-[#FF6B35] text-white hover:opacity-90' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                      {busy === `code-${s.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                      {s.parents.length === 0 ? '复制链接' : '再绑一位家长'}
                    </button>
                    {s.pending && (
                      <button type="button" onClick={() => copyLink(s, true)} disabled={busy !== null}
                        title="链接发错人了:作废旧的,换一条新的" aria-label={`给${displayName(s)}换新链接`}
                        className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 换新
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </main>

        {newPassword && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4" onClick={() => setNewPassword(null)}>
            <div role="dialog" aria-modal="true" aria-label="新密码" onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800">新密码只显示这一次</h2>
                <button type="button" onClick={() => setNewPassword(null)} aria-label="关闭"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
              </div>
              <p className="text-sm text-slate-600">家长「{newPassword.who}」用手机号 + 下面的密码登录家长端:</p>
              <p className="my-4 rounded-xl bg-slate-50 py-3 text-center font-mono text-2xl font-bold tracking-widest text-slate-800">{newPassword.password}</p>
              <button type="button"
                onClick={() => copyText(`家长端登录: ${window.location.origin}/parent/login\n手机号: 您注册时的手机号\n新密码: ${newPassword.password}`, '已复制,发给这位家长')}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#FF6B35] text-sm font-bold text-white hover:opacity-90">
                <Copy className="h-4 w-4" aria-hidden /> 复制登录方式
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 打印用的绑定条: 平时不显示,打印时只出这一块 */}
      {slips && (
        <div className="hidden print:block">
          <div className="flex flex-wrap">
            {slips.map((s) => (
              <div key={s.student_id} className="flex w-1/2 gap-3 border border-dashed border-slate-400 p-3" style={{ breakInside: 'avoid' }}>
                <img src={s.qr} alt="" className="h-28 w-28 shrink-0" />
                <div className="min-w-0 text-[11px] leading-snug text-black">
                  <p className="text-sm font-bold">{s.name} 家长您好</p>
                  <p className="mt-1">微信扫左边的码,用您的手机号注册(可以和孩子的账号同一个手机号),就能看到孩子每天学了多少、哪些单词还不会。</p>
                  <p className="mt-1">扫不了就打开 <b>{window.location.host}/parent/register</b>,输入绑定码 <b className="font-mono text-xs tracking-wider">{s.code}</b></p>
                  <p className="mt-1 text-[10px] text-slate-600">{fmtDay(s.expires)}前有效 · 只能绑定一次,请不要给别人</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
