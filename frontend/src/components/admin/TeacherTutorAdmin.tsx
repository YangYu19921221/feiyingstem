/**
 * 管理端「AI 学习助手」卡片里的「教师端小鹰老师」一组(2026-10-29,后端 services/teacher_tutor.py)
 *
 * 老师自己问小鹰老师(备课 / 出卷 / 看全班卡在哪): 开不开、每位老师每月几次(默认 1000,北京时间每月 1 号恢复)。
 * 直营老师不扣机构池;加盟机构老师每问一次从机构次数池扣 1 次(深度思考按学生端同一个「深度思考算几次」)。
 * 单独一个保存按钮: 和上面学生那组设置分开存,改这里不会顺手改到学生的开放范围。
 */
import { useState } from 'react';
import { saveTeacherTutorAdmin, type TutorAdminState } from '../../api/tutor';

export default function TeacherTutorAdmin({ state, onSaved }: {
  state: TutorAdminState['teacher'];
  onSaved: (t: TutorAdminState['teacher']) => void;
}) {
  const [enabled, setEnabled] = useState(state.enabled);
  const [monthly, setMonthly] = useState(state.monthly);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = enabled !== state.enabled || monthly !== state.monthly;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      onSaved(await saveTeacherTutorAdmin({ enabled, monthly }));
      setNote({ ok: true, text: '已保存' });
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setNote({ ok: false, text: typeof detail === 'string' ? detail : '没保存上,再试一次' });
    } finally {
      setBusy(false);
    }
  };

  const input = 'admin-focus-ring min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-[#173047]';
  return (
    <div className="mt-5 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-[#173047]">教师端小鹰老师</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        老师自己问小鹰老师: 备课、出练习卷(带答案能下载 PDF)、看全班和某个孩子卡在哪。学生的名字不发给 AI。
        直营老师不扣次数池;加盟机构老师每问一次从机构次数池扣 1 次(¥{state.price} / 次,和老师给学生加次数同一个池)。
        {' '}{state.month} 本月 {state.teachers} 位老师用了 {state.used} 次。
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          开着(关了老师那边不显示入口;学生那边不受影响)
        </label>
        <label className="block text-xs text-slate-500">每位老师每月最多几次(北京时间每月 1 号恢复)
          <input type="number" min={1} max={10000} value={monthly}
            onChange={(e) => setMonthly(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))} className={`${input} mt-1`} />
        </label>
        <div className="flex items-end gap-3">
          <button type="button" onClick={() => void save()} disabled={busy || !dirty}
            className="min-h-10 rounded-lg bg-[#173047] px-4 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? '正在保存…' : '保存教师端设置'}
          </button>
          {note && <span className={`text-xs ${note.ok ? 'text-emerald-700' : 'text-red-600'}`}>{note.text}</span>}
        </div>
      </div>
    </div>
  );
}
