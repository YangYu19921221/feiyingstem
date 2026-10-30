import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Home, Monitor, Pencil, School, Trash2, Wifi } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { toast } from '../components/Toast';
import {
  classroomNetApi, type ClassroomNetSettings, type ClassroomStudent, type ImpactItem,
} from '../api/classroomNet';
import { getErrorMessage } from '../utils/errorMessage';
import { getClassroomDeviceKey, setClassroomDeviceKey, clearClassroomDeviceKey } from '../utils/classroomDevice';

/**
 * 电教室网络(2026-10-30): 音标视频「只能在电教室看」。
 * 规则真源 backend/app/services/classroom_net.py 文件头,**这里的说明要和它同步**。
 * 老师和机构管理员共用这一页(/teacher/classroom-net、/admin/classroom-net);开关只给机构管理员和平台管理员。
 */

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 当前账号角色(只用来挑顶栏样式;权限以后端为准) */
const myRole = (): string => {
  try { return JSON.parse(localStorage.getItem('user') || '{}').role || ''; } catch { return ''; }
};

const card = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
const btn = 'min-h-10 rounded-lg px-3 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50';

export default function ClassroomNet() {
  const { pathname } = useLocation();
  const isTeacherPath = pathname.startsWith('/teacher');
  const [data, setData] = useState<ClassroomNetSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [devName, setDevName] = useState('电教室 1 号机');
  const [students, setStudents] = useState<ClassroomStudent[]>([]);
  const [studentsLimited, setStudentsLimited] = useState(false);
  const [q, setQ] = useState('');
  const [impact, setImpact] = useState<ImpactItem[] | null>(null);
  const [allowFor, setAllowFor] = useState<{ id: number; name: string } | null>(null);
  const [allowUntil, setAllowUntil] = useState('');
  const [allowNote, setAllowNote] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await classroomNetApi.get();
      setData(r);
      // 本机存着设备码但后端说这台不是(被移除了),本机的也删掉,免得一直带着没用的码
      if (!r.this_device && getClassroomDeviceKey()) clearClassroomDeviceKey();
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStudents = useCallback(async (kw?: string) => {
    try {
      const r = await classroomNetApi.students(kw);
      setStudents(r.items);
      setStudentsLimited(r.limited);
    } catch { setStudents([]); }
  }, []);

  const loadImpact = useCallback(async () => {
    try { setImpact((await classroomNetApi.impact()).items); } catch { setImpact([]); }
  }, []);

  useEffect(() => { load(); loadStudents(); loadImpact(); }, [load, loadStudents, loadImpact]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    } finally {
      setBusy(false);
    }
  };

  const register = () => act(async () => {
    const name = devName.trim();
    if (!name) throw new Error('给这台电脑起个名字');
    const r = await classroomNetApi.registerDevice(name);
    if (r.key) setClassroomDeviceKey(r.key);
  }, '这台电脑已登记为电教室电脑');

  const switchMode = (mode: 'any' | 'classroom') => {
    if (mode === 'classroom') {
      const n = (impact || []).filter((x) => !x.home_allow?.active).length;
      const msg = n > 0
        ? `打开后,学生只能在电教室的网络里看音标视频。\n\n最近 14 天有 ${n} 个孩子在电教室以外看过(名单在页面下面),打开后他们在那儿就看不了了。需要的话先给他们开「允许在家看」。\n\n确定打开?`
        : '打开后,学生只能在电教室的网络里看音标视频。确定打开?';
      if (!window.confirm(msg)) return;
    }
    act(() => classroomNetApi.setMode(mode), mode === 'classroom' ? '已打开: 学生只能在电教室看' : '已改回: 在哪都能看');
  };

  const allowList = useMemo(() => students.filter((s) => s.home_allow), [students]);

  const saveAllow = async () => {
    if (!allowFor) return;
    setBusy(true);
    try {
      await classroomNetApi.setHomeAllow(allowFor.id, { until_day: allowUntil || null, note: allowNote.trim() || null });
      toast.success(`「${allowFor.name}」可以在家看了`);
      setAllowFor(null);
      await Promise.all([loadStudents(q), loadImpact(), load()]);
    } catch (e) {
      toast.error(getErrorMessage(e, '保存失败'));
    } finally {
      setBusy(false);
    }
  };

  const removeAllow = async (id: number, name: string) => {
    setBusy(true);
    try {
      await classroomNetApi.removeHomeAllow(id);
      toast.success(`「${name}」改回只能在电教室看`);
      await Promise.all([loadStudents(q), loadImpact(), load()]);
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    } finally {
      setBusy(false);
    }
  };

  const openAllow = (id: number, name: string) => {
    setAllowFor({ id, name });
    setAllowUntil('');
    setAllowNote('');
  };

  const on = data?.mode === 'classroom';

  return (
    <div className="min-h-screen bg-paper">
      <StaffWorkspaceHeader
        role={isTeacherPath ? 'teacher' : myRole() === 'org_admin' ? 'org' : 'admin'}
        title="电教室网络"
        subtitle="音标视频只能在电教室看(可选)"
        icon={School}
        backTo={isTeacherPath ? '/teacher/dashboard' : '/admin'}
      />
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        {loading && <p className="text-sm text-ink-mute">加载中…</p>}
        {data && (
          <>
            {/* 现在是什么状态 */}
            <div className={`${card} ${on ? 'border-orange-200 bg-orange-50/50' : ''}`}>
              <p className="text-xs font-semibold text-ink-mute">学生看音标视频</p>
              <p className="mt-1 font-display text-2xl font-bold text-[#173047]">
                {on ? '只能在电教室看' : '在哪都能看'}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {on
                  ? `学生连着电教室的网络才能看,在家看不了(视频、讲义都是)。老师和管理员不受限。允许在家看的孩子 ${data.home_allow_count} 个。`
                  : '现在没有限制。打开后,学生只能连着电教室的网络看,在家看不了。'}
              </p>
              {data.can_switch ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {on ? (
                    <button disabled={busy} onClick={() => switchMode('any')}
                      className={`${btn} bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50`}>
                      改回在哪都能看
                    </button>
                  ) : (
                    <button disabled={busy || data.classroom_ips.length === 0} onClick={() => switchMode('classroom')}
                      className={`${btn} bg-primary text-white hover:brightness-105`}>
                      打开: 只能在电教室看
                    </button>
                  )}
                  {!on && data.classroom_ips.length === 0 && (
                    <p className="self-center text-xs text-amber-700">先在电教室的电脑上登记(下面第一块),认出电教室网络后才能打开</p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-ink-mute">这个开关管整个机构,由机构管理员切。你可以登记电教室电脑、给本班孩子开「允许在家看」。</p>
              )}
            </div>

            {/* 这台设备 */}
            <div className={card}>
              <h2 className="flex items-center gap-2 text-base font-bold text-[#173047]"><Monitor className="h-4 w-4" />你现在用的这台设备</h2>
              <p className="mt-2 text-sm text-slate-600">
                网络地址 <span className="font-numeric font-semibold text-ink">{data.my_ip || '读不到'}</span>
                {data.ip_is_classroom
                  ? <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-green-700">是电教室网络</span>
                  : <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">不是电教室网络</span>}
              </p>
              {data.this_device ? (
                <p className="mt-2 text-sm text-green-700">这台电脑已登记为电教室电脑「{data.this_device.name}」。学校换了网络地址,它会自己报上新地址。</p>
              ) : (
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-ink">在电教室吗?把这台电脑登记成电教室电脑</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                    只在电教室里、学生上课用的那几台电脑上点(登记一两台就够,同一个网络的平板都跟着算)。
                    <strong className="text-ink">不要在自己的手机或家里的电脑上点</strong>,否则你家的网络也会被当成电教室。
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input value={devName} onChange={(e) => setDevName(e.target.value)} maxLength={30}
                      className="min-h-10 w-48 rounded-lg border border-slate-200 px-3 text-sm focus:border-orange-400 focus:outline-none" />
                    <button disabled={busy} onClick={register} className={`${btn} bg-primary text-white hover:brightness-105`}>
                      这台电脑在电教室
                    </button>
                  </div>
                </div>
              )}
              {!data.ip_is_classroom && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-800">在电教室,但学生说看不了?</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    多半是学校刚换了网络地址、登记过的电脑还没开机。打开那台电脑上这个网站就会自己报上新地址;
                    等不及就点下面这个,只管今天,24 点自动失效,不登记设备。
                  </p>
                  <button disabled={busy} onClick={() => act(() => classroomNetApi.addTempNet(), '今天这个网络算作电教室了')}
                    className={`${btn} mt-2 bg-amber-500 text-white hover:brightness-105`}>
                    今天先把这个网络算作电教室
                  </button>
                </div>
              )}
            </div>

            {/* 电教室网络 */}
            <div className={card}>
              <h2 className="flex items-center gap-2 text-base font-bold text-[#173047]"><Wifi className="h-4 w-4" />现在算电教室的网络地址</h2>
              {data.classroom_ips.length === 0 ? (
                <p className="mt-2 text-sm text-ink-mute">还没有。在电教室的电脑上登记一台就有了。</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {data.classroom_ips.map((x) => (
                    <li key={x.ip} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <span className="font-numeric font-semibold text-ink">{x.ip}</span>
                      <span className="text-xs text-ink-soft">来自 {x.sources.join('、')}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-mute">电教室电脑报过的地址保留 {data.keep_days} 天(学校两条线路轮流用也不会漏)。只认完全相同的地址。</p>
              {data.temp_nets.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-ink-soft">今天临时加的</p>
                  {data.temp_nets.map((t) => (
                    <div key={t.id} className="mt-1 flex items-center gap-3 text-sm">
                      <span className="font-numeric">{t.ip}</span>
                      <span className="text-xs text-ink-mute">{t.created_by_name} · {fmt(t.created_at)}</span>
                      <button disabled={busy} onClick={() => act(() => classroomNetApi.removeTempNet(t.id), '已去掉')}
                        className="text-xs text-rose-600 hover:underline">去掉</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 电教室电脑 */}
            <div className={card}>
              <h2 className="text-base font-bold text-[#173047]">电教室电脑({data.devices.length})</h2>
              {data.devices.length === 0 && <p className="mt-2 text-sm text-ink-mute">还没有登记。</p>}
              <div className="mt-2 space-y-3">
                {data.devices.map((d) => (
                  <div key={d.id} className="rounded-lg border border-slate-100 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{d.name}</span>
                      {data.this_device?.id === d.id && <span className="rounded bg-orange-100 px-1.5 text-xs text-orange-700">就是这台</span>}
                      <span className="text-xs text-ink-mute">{d.created_by_name} 登记 · 最近报到 {fmt(d.last_seen_at)}</span>
                      <span className="ml-auto flex gap-2">
                        <button disabled={busy} aria-label="改名" title="改名"
                          onClick={() => {
                            const n = window.prompt('新名字', d.name);
                            if (n && n.trim()) act(() => classroomNetApi.renameDevice(d.id, n.trim()), '已改名');
                          }}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                        <button disabled={busy} aria-label="移除" title="移除"
                          onClick={() => {
                            if (window.confirm(`移除「${d.name}」? 它报过的网络地址马上不算电教室了。`)) {
                              act(async () => {
                                await classroomNetApi.removeDevice(d.id);
                                if (data.this_device?.id === d.id) clearClassroomDeviceKey();
                              }, '已移除');
                            }
                          }}
                          className="rounded p-1.5 text-rose-500 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button>
                      </span>
                    </div>
                    {d.ips.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {d.ips.map((x) => (
                          <li key={x.ip} className={x.counts ? 'text-slate-600' : 'text-slate-400 line-through'}>
                            <span className="font-numeric">{x.ip}</span>
                            {x.new && <span className="ml-1.5 rounded bg-amber-100 px-1 font-semibold text-amber-700 no-underline">新</span>}
                            <span className="ml-2">{fmt(x.first_seen_at)} 第一次 · {fmt(x.last_seen_at)} 最近</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-mute">
                某台电脑突然冒出一个不认识的「新」地址,而学校并没有换网络,可能是有人把这台电脑的登记带回了家 —— 移除这台电脑,再在电教室重新登记一次。
              </p>
            </div>

            {/* 打开之前: 最近谁在电教室以外看过 */}
            {impact && impact.length > 0 && (
              <div className={card}>
                <h2 className="text-base font-bold text-[#173047]">最近 14 天在电教室以外看过的孩子({impact.length})</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  {on ? '他们现在在那儿看不了了。' : '打开开关后,他们在那儿就看不了了。'}
                  按网络地址估的(学校旧的网络地址也会被认出来),不一定都是在家。确实需要在家看的,点「允许在家看」。
                </p>
                <ul className="mt-2 divide-y divide-slate-100">
                  {impact.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <span className="font-semibold text-ink">{x.name}</span>
                      <span className="text-xs text-ink-soft">外面 {x.outside_views} 次 · 电教室 {x.inside_views} 次 · 最近一次 {fmt(x.last_outside_at)}</span>
                      <span className="ml-auto">
                        {x.home_allow?.active
                          ? <span className="text-xs text-green-700">已允许在家看</span>
                          : <button disabled={busy} onClick={() => openAllow(x.id, x.name)}
                              className={`${btn} min-h-8 bg-slate-100 text-slate-700 hover:bg-slate-200`}>允许在家看</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 允许在家看 */}
            <div className={card}>
              <h2 className="flex items-center gap-2 text-base font-bold text-[#173047]"><Home className="h-4 w-4" />允许在家看的孩子</h2>
              <p className="mt-1 text-xs text-ink-soft">请病假、在外地的孩子可以单独放开,能设到哪天为止。{isTeacherPath ? '你只能设本班的孩子。' : ''}</p>
              <div className="mt-2 flex gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜孩子的名字或用户名"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) loadStudents(q.trim()); }}
                  className="min-h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm focus:border-orange-400 focus:outline-none" />
                <button onClick={() => loadStudents(q.trim())} className={`${btn} bg-slate-100 text-slate-700 hover:bg-slate-200`}>搜</button>
              </div>
              {studentsLimited && !q.trim() && allowList.length === 0 && (
                <p className="mt-2 text-sm text-ink-mute">还没有允许在家看的孩子。搜名字找到孩子后可以开。</p>
              )}
              <ul className="mt-2 divide-y divide-slate-100">
                {students.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                    <span className="font-semibold text-ink">{s.name}</span>
                    {s.home_allow ? (
                      <span className={`text-xs ${s.home_allow.active ? 'text-green-700' : 'text-slate-400'}`}>
                        {s.home_allow.active ? '允许在家看' : '已过期'}
                        {s.home_allow.until_day ? ` · 到 ${s.home_allow.until_day}` : ' · 一直'}
                        {s.home_allow.note ? ` · ${s.home_allow.note}` : ''}
                      </span>
                    ) : <span className="text-xs text-ink-mute">只能在电教室看</span>}
                    <span className="ml-auto flex gap-2">
                      <button disabled={busy} onClick={() => openAllow(s.id, s.name)}
                        className={`${btn} min-h-8 bg-slate-100 text-slate-700 hover:bg-slate-200`}>
                        {s.home_allow ? '改' : '允许在家看'}
                      </button>
                      {s.home_allow && (
                        <button disabled={busy} onClick={() => removeAllow(s.id, s.name)}
                          className={`${btn} min-h-8 text-rose-600 hover:bg-rose-50`}>取消</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* 规则说明: 与 services/classroom_net.py 文件头同步 */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-700">
              <p className="font-semibold text-[#173047]">怎么认出是在电教室</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>登记过的电教室电脑,打开这个网站时会把电教室现在的网络地址报上来(没人登录也报)。学校换了地址,它下次报到就跟上了,不用人改。</li>
                <li>学生的设备(平板、电脑)连的网络地址和电教室电脑报过的一样,就算在电教室。报过的地址保留 {data.keep_days} 天。</li>
                <li>学生直接用电教室电脑登录,一定算在电教室。</li>
                <li>老师、助教、机构管理员在哪都能看(要在家备课)。</li>
                <li>在家被拦下的那次不扣次卡。</li>
              </ul>
              <p className="mt-3 font-semibold text-[#173047]">挡不住的情况</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>在学校连着电教室网络时打开的那一节,如果视频走的是腾讯云 COS,出了学校最多 3 小时内还能接着放(那个地址绑不了网络)。从服务器本机放的,出了学校就停。</li>
                <li>孩子在学校用手机流量、没连学校的网络,会被当成不在电教室。</li>
                <li>有人把电教室电脑的登记带回家,家里的地址会出现在上面那台电脑的列表里(标「新」),看到了就移除那台电脑。</li>
              </ul>
            </div>
          </>
        )}
      </div>

      {allowFor && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog" aria-modal="true" aria-label="允许在家看" onClick={() => setAllowFor(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-lg font-bold text-ink">允许「{allowFor.name}」在家看</p>
            <label className="mt-3 block text-sm text-slate-600">
              到哪天为止(不填 = 一直允许)
              <input type="date" min={todayStr()} value={allowUntil} onChange={(e) => setAllowUntil(e.target.value)}
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
            </label>
            <label className="mt-3 block text-sm text-slate-600">
              备注(可不填)
              <input value={allowNote} onChange={(e) => setAllowNote(e.target.value)} maxLength={60} placeholder="如: 请病假"
                className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />
            </label>
            <div className="mt-4 flex gap-2">
              <button disabled={busy} onClick={saveAllow} className={`${btn} flex-1 bg-primary text-white`}>保存</button>
              <button onClick={() => setAllowFor(null)} className={`${btn} flex-1 bg-slate-100 text-slate-700`}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
