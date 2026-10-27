/**
 * 管理端「AI 学习助手」卡片里的「各机构次数」(2026-10-27,用户「总管理端可以给别的机构发总 AI 学习助手次数」)。
 *
 * 每个机构一行: 开没开(为什么开)、每个学生送几次、次数池(还剩 / 一共 / 进货 / 赠送 / 已分)、学生数、问过的人数,
 * 行尾「发次数」打开 OrgTutorPoolDialog(进货到账 / 平台赠送 / 扣回)。
 * 规则(后端 services/tutor): 发过次数的机构自动开通;老政策机构的学生不送免费次数,全靠老师从池里分;直营不走池子。
 */
import { useCallback, useEffect, useState } from 'react';
import { getTutorOrgs, type TutorOrgRow } from '../../api/tutor';
import OrgTutorPoolDialog from './OrgTutorPoolDialog';

export default function TutorOrgsPanel() {
  const [rows, setRows] = useState<TutorOrgRow[] | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(() => getTutorOrgs()
    .then((r) => { setRows(r.items); setError(''); })
    .catch((e: unknown) => setError(e instanceof Error ? e.message : '读取失败')), []);
  useEffect(() => {
    getTutorOrgs().then((r) => setRows(r.items))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '读取失败'));
  }, []);
  const close = useCallback(() => setOpenId(null), []);

  return (
    <div className="mt-5 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-[#173047]">各机构次数</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        给加盟机构发次数: 机构付了钱记「进货到账」,不收费的记「平台赠送」。发过次数的机构自动开通(不受上面「开给谁」限制,
        选「关闭」时照样全关);老政策机构的学生不送免费次数,由机构老师在「学习助手次数」页从池里分给学生。
      </p>
      {error && <p className="mt-2 text-sm text-red-600">读取失败: {error}</p>}
      {rows && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs text-slate-600">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1.5 pr-3 font-medium">机构</th>
                <th className="pr-3 font-medium">小鹰老师</th>
                <th className="pr-3 font-medium">每生送</th>
                <th className="pr-3 font-medium">池里还剩</th>
                <th className="pr-3 font-medium">进货 / 赠送 / 已分</th>
                <th className="pr-3 font-medium">学生 / 问过</th>
                <th className="font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((o) => (
                <tr key={o.id} className={o.status !== 'active' ? 'opacity-60' : ''}>
                  <td className="py-2 pr-3 font-medium text-slate-800">
                    {o.name}
                    {o.card_plan === 'pack' && <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700">卡包</span>}
                    {o.status !== 'active' && <span className="ml-1 text-[10px] text-slate-400">已停用</span>}
                  </td>
                  <td className="pr-3">
                    {o.open ? <span className="text-emerald-700">开了 · {o.open}</span> : <span className="text-slate-400">没开</span>}
                  </td>
                  <td className="pr-3">{o.free_per_student} 次</td>
                  <td className={`pr-3 font-semibold ${o.pool && o.pool.total > 0 && o.pool.left === 0 ? 'text-rose-600' : 'text-slate-800'}`}>
                    {o.pool ? o.pool.left : '—'}
                  </td>
                  <td className="pr-3">{o.pool ? `${o.pool.purchased ?? 0} / ${o.pool.gifted ?? 0} / ${o.pool.used}` : '直营不走池子'}</td>
                  <td className="pr-3">{o.students} / {o.asked_students}</td>
                  <td className="text-right">
                    {o.uses_pool && (
                      <button type="button" onClick={() => setOpenId(o.id)}
                        className="admin-focus-ring min-h-9 rounded-lg px-2.5 font-semibold text-[#c76333] hover:bg-[#fce9dc]">
                        发次数
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId != null && <OrgTutorPoolDialog orgId={openId} onClose={close} onChanged={() => { void load(); }} />}
    </div>
  );
}
