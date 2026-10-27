/**
 * 管理端 / 机构管理端「需要关心的孩子」(2026-10-27,后端 services/tutor_safety)
 *
 * 平台管理员看全部机构(带机构名),机构管理员只看本机构(后端 _alert_scope 显式按 org_id 过滤)。
 * 孩子的班主任在「小鹰老师 · 本班情况」里也看得到同一批;谁先处理都行,处理人和处理说明两边都显示。
 * 下面附「问过的词后来拼对了吗」(services/tutor_insight.effect,按同样的范围算)。
 * 入口: 管理端首页「AI 学习助手」卡片顶上 / 机构管理首页「学习助手提醒」卡片
 */
import { useCallback, useEffect, useState } from 'react';
import { HeartHandshake } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import TutorAlertList from '../components/tutor/TutorAlertList';
import TutorEffectBlock from '../components/tutor/TutorEffectBlock';
import { getAdminAlerts, getAdminTutorEffect, handleAdminAlert, type AlertStatus, type TutorEffect } from '../api/tutor';

export default function AdminTutorAlerts() {
  const isAdmin = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null')?.role === 'admin'; } catch { return false; }
  })();
  const [effect, setEffect] = useState<TutorEffect | null>(null);
  useEffect(() => {
    getAdminTutorEffect().then(setEffect).catch(() => setEffect(null));
  }, []);
  const load = useCallback((s: AlertStatus) => getAdminAlerts(s), []);
  const handle = useCallback((id: number, note: string) => handleAdminAlert(id, note), []);

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role={isAdmin ? 'admin' : 'org'} title="需要关心的孩子" subtitle="学习助手里说到难过、被欺负、想伤害自己的孩子"
        icon={HeartHandshake} backTo={isAdmin ? '/admin' : '/org'} />
      <main className="mx-auto max-w-[1100px] space-y-5 px-4 py-5 sm:px-6 lg:px-10">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm leading-6 text-slate-500">
            孩子在问小鹰老师时说到这些事,小鹰老师会先安慰、建议他告诉老师或家长,并在这里记一条。孩子的老师在「小鹰老师 · 本班情况」里也看得到。
            {isAdmin ? '这里是全部机构的。' : '这里是本机构的。'}
          </p>
          <div className="mt-4">
            <TutorAlertList load={load} handle={handle} showOrg={isAdmin} />
          </div>
        </section>
        {effect && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-base font-bold text-slate-900">问过的词,后来拼对了吗{isAdmin ? '(全平台)' : '(本机构)'}</h2>
            <TutorEffectBlock e={effect} />
          </section>
        )}
      </main>
    </div>
  );
}
