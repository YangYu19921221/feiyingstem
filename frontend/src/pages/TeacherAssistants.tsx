import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Users } from 'lucide-react';
import { assistantApi, type Assistant } from '../api/assistants';
import { toast } from '../components/Toast';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

/** 后端 detail 可能是字符串或 422 的数组,统一成一句人话 */
const errMsg = (e: unknown, fallback: string) => {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return '填写有误:用户名至少 2 位、密码至少 6 位';
  return fallback;
};

const fmt = (iso: string | null) => {
  if (!iso) return '从未登录';
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const TeacherAssistants = () => {
  const [items, setItems] = useState<Assistant[]>([]);
  const [max, setMax] = useState(10);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ full_name: '', username: '', password: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await assistantApi.list();
      setItems(r.items);
      setMax(r.max);
    } catch (e) {
      toast.error(errMsg(e, '加载助教列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const full = items.length >= max;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim() || !form.username.trim() || form.password.length < 6) {
      toast.error('姓名、用户名都要填,密码至少 6 位');
      return;
    }
    setSaving(true);
    try {
      await assistantApi.create({ ...form, full_name: form.full_name.trim(), username: form.username.trim() });
      toast.success(`已添加助教,把用户名「${form.username.trim()}」和密码告诉 TA 即可登录`);
      setForm({ full_name: '', username: '', password: '' });
      load();
    } catch (err) {
      toast.error(errMsg(err, '添加失败'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (a: Assistant) => {
    try {
      await assistantApi.update(a.id, { is_active: !a.is_active });
      toast.success(a.is_active ? `已停用「${a.full_name}」,TA 将无法登录` : `已启用「${a.full_name}」`);
      load();
    } catch (err) {
      toast.error(errMsg(err, '操作失败'));
    }
  };

  const resetPwd = async (a: Assistant) => {
    const pwd = window.prompt(`给「${a.full_name}」设置新密码(至少 6 位):`);
    if (pwd === null) return;
    if (pwd.length < 6) { toast.error('密码至少 6 位'); return; }
    try {
      await assistantApi.resetPassword(a.id, pwd);
      toast.success('密码已重置,TA 之前的登录会被踢下线');
    } catch (err) {
      toast.error(errMsg(err, '重置失败'));
    }
  };

  const remove = async (a: Assistant) => {
    if (!window.confirm(`删除助教「${a.full_name}」?\n删除后 TA 不能再登录;TA 布置过的作业和操作记录会保留,仍显示 TA 的名字。`)) return;
    try {
      await assistantApi.remove(a.id);
      toast.success('已删除');
      load();
    } catch (err) {
      toast.error(errMsg(err, '删除失败'));
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <StaffWorkspaceHeader role="teacher" title="我的助教" subtitle="每人一个账号,谁布置的作业、谁加的金币都查得到" icon={Users} backTo="/teacher/dashboard" />

      <div className="mx-auto max-w-4xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        <div className="rounded-xl border border-orange-100 bg-orange-50/60 p-4 text-sm leading-relaxed text-slate-700">
          <p className="font-semibold text-[#173047]">助教能做什么</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>用自己的账号登录,看到你的班级、学生和作业,可以布置作业、加减金币</li>
            <li>作业列表会显示「布置人」;所有操作都记在助教本人名下,机构管理员在「操作记录」里查得到</li>
            <li>助教只能关闭/删除自己布置的作业,不能删班级、移出学生,也不能再添加助教</li>
            <li>加金币要用助教自己设的金币密码(不用把你的告诉 TA)</li>
          </ul>
        </div>

        <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold text-[#173047]"><UserPlus className="h-4 w-4" />添加助教</h2>
            <span className="text-xs text-slate-500">已用 {items.length} / {max}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-slate-600">
              姓名
              <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} maxLength={50}
                placeholder="如:张老师" disabled={full}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none" />
            </label>
            <label className="text-sm text-slate-600">
              登录用户名
              <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} maxLength={50}
                placeholder="至少 2 位" autoComplete="off" disabled={full}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none" />
            </label>
            <label className="text-sm text-slate-600">
              初始密码
              <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} maxLength={50}
                placeholder="至少 6 位" autoComplete="new-password" disabled={full}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none" />
            </label>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">{full ? `最多 ${max} 个助教(停用的也算),删掉不用的才能再加` : '助教不占机构的老师名额'}</p>
            <button type="submit" disabled={saving || full}
              className="rounded-lg bg-[#FF6B35] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#e85a28] disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? '添加中…' : '添加'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-5 py-3 text-base font-bold text-[#173047]">助教列表</h2>
          {loading ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">加载中…</p>
          ) : items.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">还没有助教。几位老师共用你这个账号的话,给每人加一个,出问题就知道是谁做的了</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map(a => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#173047]">
                      {a.full_name}
                      {!a.is_active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">已停用</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">用户名 {a.username} · 最近登录 {fmt(a.last_login)}</p>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button type="button" onClick={() => resetPwd(a)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50">重置密码</button>
                    <button type="button" onClick={() => toggleActive(a)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-600 hover:bg-slate-50">{a.is_active ? '停用' : '启用'}</button>
                    <button type="button" onClick={() => remove(a)} className="rounded-lg border border-red-100 px-2.5 py-1.5 text-red-500 hover:bg-red-50">删除</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeacherAssistants;
