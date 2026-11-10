/**
 * 教师端 - 单个学生摸底结果与学习规划详情
 *
 * 顶部：推荐起点 + 双技能
 * 中部：学习规划（阶段 / 漏洞 / 行动清单）
 * 底部：AI 叙述（按需加载）
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, LoaderCircle, Sparkles, AlertCircle } from 'lucide-react';
import { placementApi } from '../api/placement';
import type { TeacherPlan, PlacementResult } from '../api/placement';
import { getErrorMessage } from '../utils/errorMessage';

const BAND_LABEL: Record<number, string> = {
  1: '小学低段', 2: '小学高段', 3: '初中入门', 4: '初中进阶', 5: '高中',
};

const BAND_COLOR: Record<number, string> = {
  1: 'bg-green-100 text-green-700',
  2: 'bg-teal-100 text-teal-700',
  3: 'bg-blue-100 text-blue-700',
  4: 'bg-violet-100 text-violet-700',
  5: 'bg-rose-100 text-rose-700',
};

const MODE_LABEL: Record<string, string> = {
  flashcard: '闪卡', quiz: '选择题', spelling: '听写', fillblank: '填空',
};

export default function TeacherPlacementStudent() {
  const { student_id } = useParams<{ student_id: string }>();
  const studentId = Number(student_id);
  const navigate = useNavigate();

  const [result, setResult] = useState<PlacementResult | null>(null);
  const [plan, setPlan] = useState<TeacherPlan | null>(null);
  const [studentName, setStudentName] = useState('');
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loadingNarrative, setLoadingNarrative] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!studentId) return;
    Promise.all([
      placementApi.studentResult(studentId),
      placementApi.studentPlan(studentId),
    ])
      .then(([r, p]) => {
        setResult(r);
        setPlan(p.plan ?? null);
        setStudentName((p as any).student_name ?? '');
      })
      .catch(e => setErr(getErrorMessage(e, '加载失败，请刷新重试')));
  }, [studentId]);

  const loadNarrative = async () => {
    if (loadingNarrative) return;
    setLoadingNarrative(true);
    try {
      const p = await placementApi.studentPlan(studentId, true);
      setNarrative(p.ai_narrative);
    } catch (e) {
      setNarrative('AI 叙述生成失败，可参考下方算法规划。');
    } finally {
      setLoadingNarrative(false);
    }
  };

  if (err) return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm max-w-sm w-full">
        <p className="text-sm text-rose-600 mb-3">{err}</p>
        <button onClick={() => window.location.reload()}
          className="text-sm font-semibold text-orange-500">刷新</button>
      </div>
    </div>
  );

  if (!result || !plan) return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <LoaderCircle className="h-6 w-6 animate-spin text-orange-400" />
    </div>
  );

  if (!result.has_placement) return (
    <div className="min-h-screen bg-paper">
      <BackNav name="学生摸底" onBack={() => navigate('/teacher/placement')} />
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-ink-soft">该学生尚未完成摸底测评。</p>
          <button onClick={() => navigate('/teacher/placement')}
            className="mt-3 text-sm font-semibold text-orange-500">返回总览</button>
        </div>
      </div>
    </div>
  );

  const profile = result.skill_profile;
  const recPct = profile ? Math.round(profile.recognition_accuracy * 100) : 0;
  const spPct = profile?.spelling_accuracy !== null && profile?.spelling_accuracy !== undefined
    ? Math.round(profile.spelling_accuracy * 100) : null;

  return (
    <div className="min-h-screen bg-paper">
      <BackNav name={studentName || '学生摸底'} onBack={() => navigate('/teacher/placement')} />

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-5">
        {/* 推荐起点 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm text-center">
          <p className="text-xs text-ink-soft mb-1">{studentName} · 推荐起点</p>
          <p className="text-2xl font-bold text-ink">{result.placement_label}</p>
          {profile && (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 py-3">
                <p className="text-xs text-ink-soft mb-0.5">识别准确率</p>
                <p className="text-xl font-bold text-ink">{recPct}%</p>
              </div>
              <div className="rounded-xl bg-slate-50 py-3">
                <p className="text-xs text-ink-soft mb-0.5">拼写准确率</p>
                <p className="text-xl font-bold text-ink">{spPct !== null ? `${spPct}%` : '—'}</p>
              </div>
            </div>
          )}
        </section>

        {/* 各档表现 */}
        {profile && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm font-semibold text-ink">各难度表现</p>
            {Object.entries(profile.band_scores).map(([band, score]) => {
              const d = Number(band);
              const pct = Math.round(score * 100);
              return (
                <div key={band} className="mb-2 flex items-center gap-3">
                  <span className={`w-16 text-xs rounded-full px-2 py-0.5 text-center font-medium
                    ${BAND_COLOR[d] ?? 'bg-slate-100 text-slate-600'}`}>
                    {BAND_LABEL[d]}
                  </span>
                  <div className="flex-1 rounded-full bg-slate-100 h-2 overflow-hidden">
                    <div className="h-2 rounded-full bg-orange-400 transition-all"
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs text-ink-soft">{pct}%</span>
                </div>
              );
            })}
            {profile.first_gap_band && (
              <p className="mt-3 text-xs text-rose-500">
                <AlertCircle className="mr-1 inline h-3.5 w-3.5" />
                第一个漏洞出现在 {BAND_LABEL[profile.first_gap_band] ?? `第${profile.first_gap_band}档`}
              </p>
            )}
          </section>
        )}

        {/* AI 叙述 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">学习规划建议</h2>
            {!narrative && !loadingNarrative && (
              <button onClick={loadNarrative}
                className="flex items-center gap-1 text-xs font-medium text-orange-500 hover:text-orange-600">
                <Sparkles className="h-3.5 w-3.5" />
                生成 AI 叙述
              </button>
            )}
          </div>
          {loadingNarrative && (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <LoaderCircle className="h-4 w-4 animate-spin text-orange-400" />
              AI 生成中…
            </div>
          )}
          {narrative && (
            <p className="mb-3 rounded-xl bg-orange-50 p-4 text-sm leading-relaxed text-ink-soft">
              {narrative}
            </p>
          )}
          {/* 推荐书目 */}
          {plan.recommended_book_hint && (
            <div className="mb-3 rounded-xl bg-slate-50 p-3 text-xs text-ink-soft">
              <span className="font-medium text-ink">推荐书目：</span>
              {plan.recommended_book_hint}
            </div>
          )}
          {/* 每日词量 */}
          <div className="flex gap-3">
            <div className="flex-1 rounded-xl bg-slate-50 py-2 text-center">
              <p className="text-xs text-ink-soft">每日推荐词数</p>
              <p className="text-lg font-bold text-ink">{plan.daily_quota}</p>
            </div>
            <div className="flex-1 rounded-xl bg-slate-50 py-2 text-center">
              <p className="text-xs text-ink-soft">规划总周数</p>
              <p className="text-lg font-bold text-ink">{plan.total_plan_weeks}</p>
            </div>
          </div>
        </section>

        {/* 阶段规划 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-ink">阶段规划</h2>
          <div className="space-y-3">
            {plan.phases.map((p, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">
                    第{i + 1}阶段 · {p.name}
                  </p>
                  <span className="text-xs text-ink-soft">{p.duration_weeks} 周</span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{p.goal}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.focus_modes.map(m => (
                    <span key={m} className="rounded bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
                      {MODE_LABEL[m] ?? m}
                    </span>
                  ))}
                  <span className="rounded bg-slate-50 px-2 py-0.5 text-xs text-ink-soft">
                    {p.daily_quota} 词/天
                  </span>
                </div>
                {p.note && <p className="mt-2 text-xs text-ink-mute leading-relaxed">{p.note}</p>}
              </div>
            ))}
          </div>
        </section>

        {/* 漏洞诊断 */}
        {plan.gap_remediation.needed && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-ink">查缺补漏</h2>
            {plan.gap_remediation.gap_band_labels.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {plan.gap_remediation.gap_band_labels.map(l => (
                  <span key={l} className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                    {l} 有漏洞
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-soft leading-relaxed">{plan.gap_remediation.strategy}</p>
          </section>
        )}

        {/* 教师行动清单 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold text-ink">你该做什么</h2>
          <div className="space-y-3">
            {plan.teacher_actions.map((a) => (
              <div key={a.priority} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-600">
                  {a.priority}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{a.action}</p>
                  <p className="mt-0.5 text-xs text-ink-soft leading-relaxed">{a.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 薄弱词 */}
        {result.weak_words && result.weak_words.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-ink">测评中答错的词（{result.weak_words.length}）</h2>
            <div className="flex flex-wrap gap-2">
              {result.weak_words.map(w => (
                <span key={w.word_id}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${BAND_COLOR[w.difficulty] ?? 'bg-slate-100 text-slate-600'}`}>
                  {w.word}
                </span>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function BackNav({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <nav className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        <button onClick={onBack} aria-label="返回"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="truncate text-base font-bold text-ink">{name}</h1>
      </div>
    </nav>
  );
}
