/**
 * 教师端「小鹰老师 · 本班情况」(2026-10-27,用户「按你的建议全做了」)
 *
 * 一页看本班孩子用学习助手的情况,从上到下:
 * 1. 需要关心的孩子(services/tutor_safety): 孩子说到难过、被欺负、想伤害自己,没处理的排最前,处理时写一句
 * 2. 这几天: 谁问了几次、最近一次、还卡着几个点(点名字进学生详情页看对话)
 * 3. 全班卡得最多的知识点 / 单词(小鹰老师的笔记里记的)
 * 4. 效果: 问过小鹰老师的词,在正式练习里拼对率前后对比(services/tutor_insight)。不够 5 个词不下结论
 * 入口: 教师工作台「激励与复盘 → 小鹰老师 · 本班情况」;有要马上关心的孩子时工作台顶上有红条
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeartHandshake, MessageCircle } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import TutorAlertList from '../components/tutor/TutorAlertList';
import {
  getTeacherAlerts, getTutorSummary, handleTeacherAlert,
  type AlertStatus, type TutorClassSummary,
} from '../api/tutor';
import EffectBlock from '../components/tutor/TutorEffectBlock';
import { getErrorMessage } from '../utils/errorMessage';

export default function TeacherTutorClass() {
  const navigate = useNavigate();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<TutorClassSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getTutorSummary(days).then((r) => { setData(r); setError(''); })
      .catch((e: unknown) => setError(getErrorMessage(e, '读取失败')));
  }, [days]);

  const loadAlerts = useCallback((s: AlertStatus) => getTeacherAlerts(s), []);
  const handleAlert = useCallback((id: number, note: string) => handleTeacherAlert(id, note), []);

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="小鹰老师 · 本班情况" subtitle="孩子们问了什么、卡在哪、有没有需要关心的"
        icon={MessageCircle} backTo="/teacher/dashboard" />
      <main className="teacher-workspace-main mx-auto max-w-5xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <HeartHandshake className="h-5 w-5 text-rose-600" aria-hidden="true" />需要关心的孩子
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            孩子在问小鹰老师时说到难过、被欺负、不想活或想伤害自己,会记在这里。小鹰老师会先安慰孩子、建议他告诉老师或家长,
            但不能代替你: 请看到后尽快和孩子聊一聊,处理完点「我处理好了」写一句。
          </p>
          <div className="mt-4">
            <TutorAlertList load={loadAlerts} handle={handleAlert} />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-slate-900">这几天谁问了小鹰老师</h2>
            <div className="ml-auto flex gap-1">
              {[7, 14, 30].map((d) => (
                <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
                  className={`min-h-9 rounded-lg px-3 text-sm ${days === d ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  近 {d} 天
                </button>
              ))}
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          {data && (
            <>
              <p className="mt-2 text-sm text-slate-500">
                本班 {data.items.length} 个孩子,{data.asked_students} 个问过,一共问了 {data.questions} 次。点名字看他问了什么。
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="text-xs text-slate-400">
                    <tr><th className="py-2 pr-3 font-medium">孩子</th><th className="pr-3 font-medium">班级</th>
                      <th className="pr-3 font-medium">问了几次</th><th className="pr-3 font-medium">还卡着</th><th className="font-medium">最近一次</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.items.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2 pr-3">
                          <button type="button" onClick={() => navigate(`/teacher/students/${s.id}`)}
                            className="font-medium text-slate-800 hover:text-orange-700 hover:underline">{s.name}</button>
                          {s.urgent > 0 && <span className="ml-2 rounded-full bg-rose-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">要马上关心</span>}
                          {s.urgent === 0 && s.alerts > 0 && <span className="ml-2 rounded-full bg-orange-100 px-1.5 py-0.5 text-[11px] font-semibold text-orange-800">需要关心</span>}
                        </td>
                        <td className="pr-3 text-slate-500">{s.class_name}</td>
                        <td className="pr-3">{s.questions || <span className="text-slate-300">0</span>}</td>
                        <td className="pr-3">{s.stuck ? `${s.stuck} 个点` : <span className="text-slate-300">—</span>}</td>
                        <td className="text-slate-500">{s.last_at ? new Date(`${s.last_at}Z`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {data && (
          <section className="grid gap-5 md:grid-cols-2">
            {([['卡得最多的知识点', data.stuck_points], ['卡得最多的单词', data.stuck_words]] as const).map(([title, list]) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-bold text-slate-900">{title}</h2>
                <p className="mt-1 text-xs text-slate-500">小鹰老师讲过、孩子做错了还没会的,按卡住的人数排。上课可以重点讲一讲。</p>
                {list.length === 0 ? <p className="mt-3 text-sm text-slate-400">暂时没有。</p> : (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {list.map((t) => (
                      <li key={t.topic} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-slate-800" title={t.topic}>{t.topic}</span>
                        <span className="shrink-0 text-xs text-slate-500">{t.students} 人 · 错 {t.wrong} 次</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}

        {data && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-bold text-slate-900">问过的词,后来拼对了吗</h2>
            <EffectBlock e={data.effect} />
          </section>
        )}
      </main>
    </div>
  );
}
