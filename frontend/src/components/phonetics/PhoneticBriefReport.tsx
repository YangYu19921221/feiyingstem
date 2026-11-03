/**
 * 音标学习报告 —— 学生自己 / 家长看的简版(2026-11-03)
 *
 * 只说: 练了几天多久、写对 / 读对多少、哪几个音还要练(每个能点「去练」进那一节)、一两句建议。
 * **不显示录音、不显示写成了什么、不和别人比**(口径 8,backend/app/services/phonetic_report.brief)
 * 学生版「去练」直接进卡片写音标那一节;家长版只告诉家长是哪一节,不放跳转(家长账号进不了学生页)
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { phonemeAudioUrl } from '../../utils/ipaPhonemes';
import { childPhoneticReport, myPhoneticReport, pct, type BriefReport, type ReportDays } from '../../api/phoneticReport';
import { getErrorMessage } from '../../utils/errorMessage';

export default function PhoneticBriefReport({ childId, title = '我的音标学习', compact = false }: {
  /** 家长看孩子时传孩子 id;不传 = 学生看自己 */
  childId?: number;
  title?: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const [days, setDays] = useState<ReportDays>(30);
  const [r, setR] = useState<BriefReport | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (childId ? childPhoneticReport(childId, days) : myPhoneticReport(days))
      .then(d => { if (alive) { setR(d); setErr(''); } })
      .catch(e => { if (alive) setErr(getErrorMessage(e, '音标报告加载失败')); });
    return () => { alive = false; };
  }, [childId, days]);

  if (err) return <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{err}</p>;
  if (!r) return <div className="flex justify-center py-6"><LoaderCircle className="h-6 w-6 animate-spin text-orange-400" /></div>;
  // 学生首页: 一次都没练过就整块不显示(满屏 0 对刚进来的孩子是一句「你什么都没做」)
  if (!r.has_data && compact) return null;

  const who = childId ? '孩子' : '你';
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-orange-100 sm:p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-slate-800">📊 {title}</h2>
        <select value={days} onChange={e => setDays(Number(e.target.value) as ReportDays)} aria-label="时间范围"
          className="ml-auto rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
          <option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option><option value={0}>全部</option>
        </select>
      </div>

      {!r.has_data ? (
        <p className="mt-3 text-sm text-slate-600">{days ? `近 ${days} 天` : '还'}没有练过音标。{childId ? '' : '去「音标」先看一节视频,再读、再写。'}</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="练了" value={`${r.active_days} 天`} sub={`约 ${r.minutes} 分钟`} />
            <Tile label="写音标" value={r.write.words ? pct(r.write.first_right, r.write.words) : '—'} sub={r.write.words ? `一遍写对 ${r.write.first_right} / ${r.write.words} 词` : '还没写过'} />
            <Tile label="读音标" value={r.read.words ? `${r.read.green} 次` : '—'} sub={r.read.words ? `读到绿 · 读过 ${r.read.words} 个词` : '还没读过'} />
            <Tile label="听力" value={r.listen.items ? pct(r.listen.first_right, r.listen.items) : '—'} sub={r.listen.items ? `一遍全对 ${r.listen.first_right} / ${r.listen.items} 题` : '还没做过'} />
          </div>

          {r.practice.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700">{who}还要多练这几个音</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.practice.map(p => (
                  <div key={p.phoneme} className="flex items-center gap-2 rounded-xl bg-orange-50 px-3 py-2 ring-1 ring-orange-200">
                    <button type="button" onClick={() => { const u = phonemeAudioUrl(p.phoneme); if (u) new Audio(u).play().catch(() => {}); }}
                      className="font-mono text-lg font-semibold text-orange-700" aria-label={`听 ${p.phoneme} 这个音`}>/{p.phoneme}/</button>
                    <span className="text-xs text-slate-600">对 {p.right}/{p.seen}{p.words.length ? ` · 如 ${p.words.join('、')}` : ''}</span>
                    {p.lesson && (childId
                      ? <span className="text-xs text-slate-500">在 {p.lesson.code}</span>
                      : <button type="button" onClick={() => navigate(`/student/phonetics/textbook/${p.lesson!.id}/cards`)}
                          className="rounded-lg bg-orange-500 px-2 py-1 text-xs font-semibold text-white">去练 {p.lesson.code}</button>)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {r.advice.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {r.advice.map((a, i) => (
                <li key={i} className="rounded-lg bg-slate-50 p-2.5 text-sm text-slate-700">💡 {childId ? a.text : a.text.replace(/^孩子/, '')}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl bg-orange-50/50 p-2.5">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      <p className="text-[11px] leading-tight text-slate-500">{sub}</p>
    </div>
  );
}
