/**
 * 卡包规则说明页(2026-10-08)—— 给老师看的,一屏看懂「课本要先兑换学习卡」。
 * 路由 /teacher/card-rules,老师 / 机构管理员 / 平台都能进。
 * 数字全来自后端 /teacher/card-rules(真源 services/card_pack.py),这里不写死。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, KeyRound } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import CardPackRules from '../components/admin/CardPackRules';
import { cardPackApi, type PackCatalog } from '../api/cardPack';

export default function TeacherCardRules() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ card_plan: 'legacy' | 'pack'; catalog: PackCatalog } | null>(null);
  const [failed, setFailed] = useState(false);
  const role = (() => {
    try { return (JSON.parse(localStorage.getItem('user') || 'null') as { role?: string } | null)?.role; }
    catch { return undefined; }
  })();
  const isManager = role === 'org_admin' || role === 'admin';

  useEffect(() => {
    cardPackApi.rules()
      .then(r => setData(r as unknown as { card_plan: 'legacy' | 'pack'; catalog: PackCatalog }))
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="staff-legacy-page min-h-screen text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="学习卡规则" subtitle="哪些书要学生先兑换学习卡、老师布置作业要注意什么"
                            icon={KeyRound} backTo={isManager ? undefined : '/teacher/dashboard'} />
      <main className="teacher-workspace-main mx-auto max-w-3xl space-y-5">
        {failed && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">规则加载失败,请刷新重试。</p>}

        {data?.card_plan === 'legacy' && (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            本机构是<strong>原合作政策</strong>,下面这套学习卡规则不适用:老师照常分配单词本、布置作业即可。
          </p>
        )}

        {data && (
          <>
            {/* 老师最常用的三句话,放最上面 */}
            <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-amber-900">
                <BookOpen className="h-5 w-5" aria-hidden="true" />老师只要记住三句话
              </h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-800">
                <li><strong>课本要学生自己兑换学习卡才能学。</strong>老师不能在后台直接把课本分配给学生,布置作业也不会自动开书。</li>
                <li><strong>布置课本作业前,先确认学生已经兑换了卡。</strong>没兑换的学生打开作业会看到「这本书要先兑换学习卡」。</li>
                <li><strong>入门课和本机构自己建的书不受限制</strong>,照常直接分配、布置作业。</li>
              </ol>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-base font-bold text-slate-900">学生没卡,怎么开通</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-700">
                <li>找机构管理员要一张兑换码(管理员在「兑换码管理 → 按卡种发码」里生成)。</li>
                <li>把兑换码发给学生或家长。</li>
                <li>学生登录后在首页「我的书架」右上角点「兑换教材」,输入兑换码就开通了。</li>
                <li>开通后,之前布置的作业马上就能做,不用重新布置。</li>
              </ol>
              {isManager && (
                <button type="button" onClick={() => navigate('/admin/subscriptions')}
                        className="mt-4 rounded-lg bg-[#3976a9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2e628f]">
                  去兑换码管理发卡
                </button>
              )}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-base font-bold text-slate-900">卡的种类和规则</h2>
              <CardPackRules catalog={data.catalog} compact={!isManager} />
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700">
              <h2 className="text-base font-bold text-slate-900">常见问题</h2>
              <dl className="mt-3 space-y-3">
                <div>
                  <dt className="font-semibold text-slate-900">学生说「这本书要先兑换学习卡」?</dt>
                  <dd>说明他还没兑换这本书的卡。让他在首页「我的书架 → 兑换教材」输入兑换码,或找管理员要一张。</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">学生半年到期了怎么办?</dt>
                  <dd>再给他兑一张含同样那几本书的卡,到期日接着往后加半年,学习记录都在。</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">学校换了版本 / 孩子转学了?</dt>
                  <dd>给他发一张新版本的卡。原来那张卡在有效期内照样能用。</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-900">平台上了新课本,学生要重新兑换吗?</dt>
                  <dd>要。卡开的是发码时选的那几本书,新课本不会自动加进旧卡,找管理员再发一张。</dd>
                </div>
              </dl>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
