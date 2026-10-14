/**
 * 推荐线索(家长老带新)—— 老师 /teacher/referrals、机构管理员 /admin/referrals 共用这一页(后端同一组 /referral/leads)
 *
 * 老师: 只看本班学生推荐来的;可以给本班学生拿邀请链接发给家长(生产上家长账号是 0,
 *       这是主要入口)
 * 机构管理员: 看全机构 + 「推荐设置」(给老生的奖励、给新朋友的承诺)
 *
 * 两个确认弹层都别省:
 * - 确认报名会发金币、记「待兑现」的线下奖励,而且**不能撤销**(撤销再点一次 = 第二份奖励)
 * - 手机号已是本机构账号的(老客户),默认不发奖励,老师要明确勾选才发
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gift, LoaderCircle, Search, Settings2, Share2, X } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import InviteShareDialog from '../components/referral/InviteShareDialog';
import client from '../api/client';
import {
  LEAD_STATUSES, enrollReferralLead, getTeacherStudentInvite, listReferralLeads,
  markReferralRewardGranted, saveReferralSettings, updateReferralLead,
  type InviteInfo, type LeadStatus, type ReferralLeadItem, type ReferralLeadList, type ReferralSettings,
} from '../api/referral';
import { toast } from '../components/Toast';

const errText = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

const STATUS_TONE: Record<LeadStatus, string> = {
  new: 'bg-orange-50 text-orange-700',
  contacted: 'bg-sky-50 text-sky-700',
  trial: 'bg-violet-50 text-violet-700',
  enrolled: 'bg-emerald-50 text-emerald-700',
  invalid: 'bg-slate-100 text-slate-500',
};

const fmt = (s: string | null) => (s ? s.replace('T', ' ').slice(5, 16) : '');

function currentRole(): string {
  try { return JSON.parse(localStorage.getItem('user') || '{}').role || ''; } catch { return ''; }
}

interface StudentRow { id: number; username: string; full_name: string | null }

export default function ReferralLeads() {
  const role = currentRole();
  const isTeacher = role === 'teacher';
  const [data, setData] = useState<ReferralLeadList | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [enrolling, setEnrolling] = useState<ReferralLeadItem | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showStudents, setShowStudents] = useState(false);
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listReferralLeads({ status, search: query }));
    } catch (e) {
      toast(errText(e, '推荐线索加载失败'), 'error');
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useEffect(() => { load(); }, [load]);

  const setLeadStatus = async (lead: ReferralLeadItem, st: LeadStatus) => {
    if (st === 'enrolled') { setEnrolling(lead); return; }
    try {
      await updateReferralLead(lead.id, { status: st });
      load();
    } catch (e) {
      toast(errText(e, '改状态失败'), 'error');
    }
  };

  const saveNote = async (lead: ReferralLeadItem, note: string) => {
    if (note === lead.staff_note) return;
    try {
      await updateReferralLead(lead.id, { staff_note: note });
      toast('备注已保存', 'success');
    } catch (e) {
      toast(errText(e, '备注没保存上'), 'error');
    }
  };

  const grantOffline = async (lead: ReferralLeadItem) => {
    if (!window.confirm(`确认已经把「${lead.reward_text}」兑现给 ${lead.referrer_name} 家了吗?`)) return;
    try {
      await markReferralRewardGranted(lead.id);
      load();
    } catch (e) {
      toast(errText(e, '操作失败'), 'error');
    }
  };

  const counts = data?.counts;
  const settings = data?.settings;

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader
        role={isTeacher ? 'teacher' : role === 'org_admin' ? 'org' : 'admin'}
        title="推荐线索"
        subtitle={isTeacher ? '本班学生家长推荐来的新家庭' : '全机构家长推荐来的新家庭'}
        icon={Gift}
      />

      <main className="teacher-workspace-main space-y-5">
        {/* 怎么用: 第一次进来的人最需要这三句 */}
        <section className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm leading-6 text-orange-900">
          <b>怎么用:</b>
          ① {isTeacher ? '点「给学生家长发邀请」,选一个学生,把海报或文字发给他的家长' : '老师在这里给学生家长发邀请;家长在家长端首页也能自己生成'}
          → ② 朋友家长扫码留电话,这里出现一条「待联系」
          → ③ 联系、约试听,到店报名后点「确认报名」,系统才给推荐的孩子发奖励。
          <span className="text-orange-700">只留电话不发奖励。</span>
          {' '}<a href="/admin/franchise-kit?doc=referral" className="font-semibold text-orange-700 underline">看运营方案和话术 →</a>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          {isTeacher && (
            <button type="button" onClick={() => setShowStudents(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#FF6B35] px-4 text-sm font-bold text-white hover:opacity-90">
              <Share2 className="h-4 w-4" /> 给学生家长发邀请
            </button>
          )}
          {data?.can_edit_settings && (
            <button type="button" onClick={() => setShowSettings(true)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Settings2 className="h-4 w-4" /> 推荐设置
            </button>
          )}
          {settings && (
            <span className="text-xs text-slate-500">
              {settings.enabled ? '推荐已开启' : '推荐已关闭(邀请链接打不开)'}
              {' · '}老生奖励:{settings.reward_coins > 0 ? `${settings.reward_coins} 金币` : '不发金币'}
              {settings.reward_text ? ` + ${settings.reward_text}` : ''}
            </span>
          )}
        </div>

        {/* 统计 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['全部线索', data?.total ?? 0, 'text-slate-800'],
            ['待联系', counts?.new ?? 0, 'text-orange-600'],
            ['已报名', counts?.enrolled ?? 0, 'text-emerald-600'],
            ['奖励待兑现', data?.pending_rewards ?? 0, 'text-amber-600'],
          ].map(([label, n, tone]) => (
            <div key={label as string} className="rounded-xl bg-white p-4 text-center shadow-sm">
              <p className={`text-3xl font-bold ${tone}`}>{n as number}</p>
              <p className="text-sm text-slate-500">{label as string}</p>
            </div>
          ))}
        </div>

        {/* 推荐榜 */}
        {data && data.top_referrers.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700">推荐最多的学生家庭</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.top_referrers.map((r) => (
                <span key={r.student_id} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                  {r.name} <span className="text-xs text-slate-500">推荐 {r.leads} · 报名 <b className="text-emerald-600">{r.enrolled}</b></span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* 筛选 */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          <button type="button" onClick={() => setStatus('')}
            className={`rounded-lg px-3 py-1.5 text-sm ${status === '' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            全部
          </button>
          {LEAD_STATUSES.map((s) => (
            <button key={s.key} type="button" onClick={() => setStatus(s.key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${status === s.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {s.label} {counts ? <span className="opacity-60">{counts[s.key]}</span> : null}
            </button>
          ))}
          <form className="ml-auto flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()); }}>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="手机号 / 称呼"
                aria-label="搜索线索" className="w-44 rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-orange-400" />
            </div>
          </form>
        </div>

        {/* 列表 */}
        {loading && !data ? (
          <div className="flex justify-center py-16"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" /></div>
        ) : data && data.items.length === 0 ? (
          <div className="rounded-xl bg-white py-14 text-center text-sm text-slate-500 shadow-sm">
            {status || query ? '没有符合条件的线索' : '还没有推荐线索。先给学生家长发一份邀请海报试试。'}
          </div>
        ) : (
          <div className="space-y-3">
            {data?.items.map((lead) => (
              <LeadCard key={`${lead.id}:${lead.staff_note}`} lead={lead} onStatus={setLeadStatus} onNote={saveNote} onGrant={grantOffline} />
            ))}
          </div>
        )}
      </main>

      {enrolling && (
        <EnrollDialog lead={enrolling} settings={settings ?? null}
          onClose={() => setEnrolling(null)}
          onDone={() => { setEnrolling(null); load(); }} />
      )}
      {showSettings && settings && (
        <SettingsDialog settings={settings} onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); load(); }} />
      )}
      {showStudents && (
        <StudentPicker onClose={() => setShowStudents(false)}
          onPick={(info) => { setShowStudents(false); setInvite(info); }} />
      )}
      {invite && <InviteShareDialog info={invite} audience="teacher" onClose={() => setInvite(null)} />}
    </div>
  );
}

function LeadCard({ lead, onStatus, onNote, onGrant }: {
  lead: ReferralLeadItem;
  onStatus: (l: ReferralLeadItem, s: LeadStatus) => void;
  onNote: (l: ReferralLeadItem, note: string) => void;
  onGrant: (l: ReferralLeadItem) => void;
}) {
  // 备注框的初值只取一次;列表刷新后备注变了,由父组件换 key 重挂(见调用处),不在 effect 里回灌
  const [note, setNote] = useState(lead.staff_note);
  const enrolled = lead.status === 'enrolled';
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800">
            {lead.parent_name || '未留称呼'}
            <a href={`tel:${lead.parent_phone}`} className="ml-2 font-mono text-sky-700 hover:underline">{lead.parent_phone}</a>
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            孩子:{lead.child_name || '—'}{lead.child_grade ? ` · ${lead.child_grade}` : ''}
            <span className="mx-1.5 text-slate-300">|</span>
            推荐人:<b>{lead.referrer_name}</b> 的家长
          </p>
          {lead.note && <p className="mt-0.5 text-xs text-slate-500">家长留言:{lead.note}</p>}
          {lead.existing_account && (
            <p className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              ⚠️ 这个手机号已是本机构的账号(可能是老客户),确认报名时默认不发推荐奖励
            </p>
          )}
        </div>
        <div className="text-right text-xs text-slate-400">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[lead.status]}`}>{lead.status_label}</span>
          <p className="mt-1.5">{fmt(lead.created_at)} 提交</p>
        </div>
      </div>

      {enrolled ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50/60 px-3 py-2 text-sm text-emerald-800">
          <span>{fmt(lead.enrolled_at)} 确认报名</span>
          <span>·</span>
          <span>{lead.reward_coins > 0 ? `已发 ${lead.reward_coins} 金币` : '未发金币'}</span>
          {lead.reward_text && (
            <>
              <span>·</span>
              <span>线下奖励「{lead.reward_text}」{lead.reward_status === 'granted' ? '已兑现' : '待兑现'}</span>
              {lead.reward_status === 'pending' && (
                <button type="button" onClick={() => onGrant(lead)}
                  className="rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">
                  标记已兑现
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {LEAD_STATUSES.filter((s) => s.key !== lead.status).map((s) => (
            <button key={s.key} type="button" onClick={() => onStatus(lead, s.key)}
              className={s.key === 'enrolled'
                ? 'rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700'
                : 'rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50'}>
              {s.key === 'enrolled' ? '确认报名' : `标为${s.label}`}
            </button>
          ))}
        </div>
      )}

      <label className="mt-3 block">
        <span className="sr-only">跟进备注</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => onNote(lead, note)}
          placeholder="跟进备注(离开输入框自动保存),如:约了周六上午试听"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400" />
      </label>
    </article>
  );
}

function EnrollDialog({ lead, settings, onClose, onDone }: {
  lead: ReferralLeadItem; settings: ReferralSettings | null; onClose: () => void; onDone: () => void;
}) {
  const [grant, setGrant] = useState(!lead.existing_account);
  const [saving, setSaving] = useState(false);
  const coins = settings?.reward_coins ?? 0;
  const text = settings?.reward_text ?? '';
  const submit = async () => {
    setSaving(true);
    try {
      const r = await enrollReferralLead(lead.id, grant);
      toast(r.coins > 0 ? `已确认报名,给 ${lead.referrer_name} 发了 ${r.coins} 金币` : '已确认报名', 'success');
      onDone();
    } catch (e) {
      toast(errText(e, '确认失败'), 'error');
      setSaving(false);
    }
  };
  return (
    <Modal title="确认报名" onClose={onClose}>
      <p className="text-sm leading-6 text-slate-700">
        确认 <b>{lead.child_name || lead.parent_name || lead.parent_phone}</b> 已经到店报名并交费?
        确认后<b>不能撤销</b>。
      </p>
      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
        推荐人 <b>{lead.referrer_name}</b> 将得到:
        {coins > 0 ? <b> {coins} 金币(立即到账)</b> : ' 不发金币'}
        {text && <>,线下奖励 <b>{text}</b>(记成「待兑现」,兑现后回来点一下)</>}
        {coins === 0 && !text && <span className="text-slate-500">(机构还没设推荐奖励)</span>}
      </div>
      {lead.existing_account && (
        <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <input type="checkbox" checked={grant} onChange={(e) => setGrant(e.target.checked)} className="mt-1" />
          <span>这个手机号已是本机构的账号。我核实过确实是新报名(比如给弟弟妹妹报的),仍然发推荐奖励</span>
        </label>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
        <button type="button" onClick={submit} disabled={saving}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
          {saving ? '确认中…' : '确认报名'}
        </button>
      </div>
    </Modal>
  );
}

function SettingsDialog({ settings, onClose, onSaved }: {
  settings: ReferralSettings; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    enabled: settings.enabled,
    reward_coins: String(settings.reward_coins),
    reward_text: settings.reward_text,
    friend_offer: settings.friend_offer,
  });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const coins = Number(form.reward_coins || 0);
    if (!Number.isInteger(coins) || coins < 0 || coins > settings.max_reward_coins) {
      toast(`金币要填 0–${settings.max_reward_coins} 的整数`, 'warning');
      return;
    }
    setSaving(true);
    try {
      await saveReferralSettings({ ...form, reward_coins: coins });
      toast('推荐设置已保存', 'success');
      onSaved();
    } catch (e) {
      toast(errText(e, '保存失败'), 'error');
      setSaving(false);
    }
  };
  return (
    <Modal title="推荐设置" onClose={onClose}>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        开启家长推荐(关掉后所有邀请链接都打不开)
      </label>
      <label className="mt-4 block text-sm">
        <span className="font-medium text-slate-700">新朋友能得到什么(写在海报和落地页上)</span>
        <input value={form.friend_offer} maxLength={200} onChange={(e) => setForm({ ...form, friend_offer: e.target.value })}
          placeholder="如:免费测评一次 + 体验课 1 节"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 outline-none focus:border-orange-400" />
      </label>
      <div className="mt-4 rounded-lg bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-700">朋友报名后,给推荐的老生家庭</p>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <input value={form.reward_coins} inputMode="numeric" onChange={(e) => setForm({ ...form, reward_coins: e.target.value.replace(/\D/g, '') })}
            aria-label="奖励金币" className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-orange-400" />
          金币(0 = 不发,最多 {settings.max_reward_coins})
        </div>
        <input value={form.reward_text} maxLength={200} onChange={(e) => setForm({ ...form, reward_text: e.target.value })}
          placeholder="线下奖励,如:赠送 2 节课 / 学习用品一份(留空 = 没有)"
          className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400" />
        <p className="mt-2 text-xs leading-5 text-slate-500">
          奖励只在老师点「确认报名」后才发,只留电话不发。海报上不会出现老生奖励(微信不允许「转发有奖」),
          它只在老师发给老生家长的话里出现。
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button>
        <button type="button" onClick={submit} disabled={saving}
          className="rounded-lg bg-[#FF6B35] px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </Modal>
  );
}

function StudentPicker({ onClose, onPick }: { onClose: () => void; onPick: (info: InviteInfo) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await client.get<{ items: StudentRow[] }>('/teacher/students', { params: { q: q.trim() || undefined, size: 100 } });
        if (!cancelled) setRows(r.items || []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [q]);

  const pick = async (s: StudentRow) => {
    setBusyId(s.id);
    try {
      onPick(await getTeacherStudentInvite(s.id));
    } catch (e) {
      toast(errText(e, '邀请链接没拿到'), 'error');
      setBusyId(null);
    }
  };

  const list = useMemo(() => rows, [rows]);
  return (
    <Modal title="选一个学生,把邀请发给他的家长" onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜姓名 / 用户名" autoFocus
        aria-label="搜索学生" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-400" />
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><LoaderCircle className="h-5 w-5 animate-spin text-orange-500" aria-label="加载中" /></div>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">{q ? '没找到这个学生' : '你的班里还没有学生'}</p>
        ) : list.map((s) => (
          <button key={s.id} type="button" onClick={() => pick(s)} disabled={busyId !== null}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-orange-50 disabled:opacity-60">
            <span><b>{s.full_name || s.username}</b> <span className="text-xs text-slate-400">@{s.username}</span></span>
            {busyId === s.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <span className="text-xs text-orange-600">生成邀请</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
