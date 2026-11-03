/**
 * 音标学习报告 —— 老师版(学生详情页一整块,也能单独全屏打开)
 *
 * 用户 11-03「越详细越好老师才知道学生差哪里」。排版按老师要做的事从上往下:
 *   ① 下一步练什么(规则写的建议,每条能点进那一节)
 *   ② 差在哪: 弱音素(写对几次 / 常写成什么 / 在哪几个词上错)+ 写混的成对音
 *   ③ 读音毛病: 词尾多带音 / 元音不对 / 开头辅音没读,每类举词;读得最差的词能直接点「听」孩子那一次录音
 *   ④ 写错的词(写成了什么)、听力错的词
 *   ⑤ 全部音素表(元音 / 辅音分开,颜色看正确率)、练过的每一节、每天练了多少
 * 口径(只认第一遍、出现 4 次以上才下结论…)真源 backend/app/services/phonetic_report.py,这里不另算
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, CalendarDays, Headphones, Layers, Lightbulb, LoaderCircle, Mic, Pause, Play, Video } from 'lucide-react';
import { readingAudioUrl } from '../../api/phoneticReading';
import { phonemeAudioUrl } from '../../utils/ipaPhonemes';
import {
  DAYS_OPTIONS, pct, studentPhoneticReport, type FullReport, type PhonemeStat, type ReportDays,
} from '../../api/phoneticReport';
import { getErrorMessage } from '../../utils/errorMessage';

const GRADE_LABEL: Record<string, { text: string; tone: string }> = {
  green: { text: '读对了', tone: 'bg-emerald-100 text-emerald-700' },
  yellow: { text: '接近', tone: 'bg-amber-100 text-amber-800' },
  red: { text: '差得多', tone: 'bg-rose-100 text-rose-700' },
};
const KIND_LABEL = { write: '写音标', read: '读音标', listen: '听力' } as const;

function rateTone(rate: number | null, enough: boolean) {
  if (!enough || rate == null) return 'bg-slate-50 text-slate-500 ring-slate-200';
  if (rate >= 0.9) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (rate >= 0.75) return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-rose-50 text-rose-700 ring-rose-300';
}

/** 一个音标块: 点了读这个音 */
function Ph({ p, big }: { p: string; big?: boolean }) {
  const url = phonemeAudioUrl(p);
  return (
    <button type="button" onClick={() => url && new Audio(url).play().catch(() => {})} title={url ? '点一下听这个音' : undefined}
      className={`inline-flex items-center rounded-md bg-white px-1.5 font-mono ring-1 ring-slate-300 hover:bg-slate-50 ${big ? 'text-xl' : 'text-base'}`}>
      /{p}/
    </button>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: typeof Lightbulb; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="flex items-center gap-2 text-base font-bold text-slate-800">
        <Icon className="h-4 w-4 text-[#2f8791]" aria-hidden /> {title}
      </h3>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function PhoneticReportPanel({ studentId }: { studentId: number }) {
  const [days, setDays] = useState<ReportDays>(30);
  const [r, setR] = useState<FullReport | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  // 练过的节一多(做完一整本是 48 节)整块会拖得很长: 先给最近 8 节
  const [allLessons, setAllLessons] = useState(false);

  useEffect(() => {
    let alive = true;
    studentPhoneticReport(studentId, days)
      .then(d => { if (alive) { setR(d); setErr(''); } })
      .catch(e => { if (alive) setErr(getErrorMessage(e, '音标报告加载失败')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId, days]);

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
          <BookOpen className="h-5 w-5 text-[#2f8791]" aria-hidden /> 音标学习报告
        </h2>
        <div role="group" aria-label="时间范围" className="ml-auto flex rounded-lg bg-slate-100 p-0.5">
          {DAYS_OPTIONS.map(o => (
            <button key={o.v} type="button" onClick={() => { if (o.v !== days) { setLoading(true); setDays(o.v); } }} aria-pressed={days === o.v}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${days === o.v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        写音标按<strong>第一遍</strong>算(第二遍辅音是系统填好的);一个音练到 4 次以上才判会不会。
        点任意 /音标/ 能听这个音,读错的词能听孩子当时的录音。
      </p>

      {loading && !r ? (
        <div className="flex justify-center py-10"><LoaderCircle className="h-6 w-6 animate-spin text-[#2f8791]" /></div>
      ) : err ? (
        <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</p>
      ) : r && !r.has_data ? (
        <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          {days ? `近 ${days} 天` : '一直'}没有练过音标(写音标 / 读音标 / 听力 / 视频都没有)。可以在「作业管理 → 布置句子 / 音标 / 复习 / 跟读作业」给他布置一节。
        </p>
      ) : r ? (
        <div className={loading ? 'opacity-60' : ''}>
          <Overview r={r} />

          <Section icon={Lightbulb} title="下一步练什么">
            <ol className="space-y-1.5">
              {r.advice.map((a, i) => (
                <li key={i} className="flex gap-2 rounded-lg bg-[#2f8791]/5 p-2.5 text-sm text-slate-800">
                  <span className="font-bold text-[#2f8791]">{i + 1}.</span>
                  <span className="min-w-0 flex-1">{a.text}{a.lesson && <span className="ml-1 text-xs text-slate-500">(练习: {a.lesson.code})</span>}</span>
                </li>
              ))}
            </ol>
          </Section>

          {(r.weak_phonemes.length > 0 || r.confusions.length > 0) && (
            <Section icon={AlertTriangle} title="差在哪(写音标 + 听力)" hint="正确率低于 75%、而且练了 4 次以上的音">
              {r.weak_phonemes.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {r.weak_phonemes.map(p => <WeakCard key={p.phoneme} p={p} />)}
                </div>
              )}
              {r.confusions.length > 0 && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold text-slate-600">常写混的(该写 → 写成了)</p>
                  <div className="flex flex-wrap gap-2">
                    {r.confusions.map(c => (
                      <span key={c.should + c.wrote} className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-slate-200">
                        <Ph p={c.should} /> → <Ph p={c.wrote} />
                        <span className="text-xs text-rose-600">{c.times} 次</span>
                        <span className="text-xs text-slate-500">({c.words.slice(0, 2).join('、')})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {(r.read_issues.length > 0 || r.hard_reads.length > 0) && (
            <Section icon={Mic} title="读音标的问题" hint="机器判的,只供参考;点「听」能听孩子读的那一次,和「标准音」对比">
              {r.read_issues.length > 0 && (
                <div className="space-y-1.5">
                  {r.read_issues.map(i => (
                    <div key={i.code} className="rounded-lg bg-amber-50 p-2.5 text-sm">
                      <p className="font-semibold text-amber-900">{i.label} · {i.times} 次
                        <span className="ml-2 font-normal text-amber-800">如 {i.words.join('、')}</span></p>
                      <p className="mt-0.5 text-xs text-amber-800">怎么纠: {i.how}</p>
                    </div>
                  ))}
                </div>
              )}
              {r.hard_reads.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead><tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-1.5 pr-2">词</th><th className="pr-2">节</th><th className="pr-2">读了</th>
                      <th className="pr-2">最好一次</th><th className="pr-2">毛病</th><th>听</th>
                    </tr></thead>
                    <tbody>
                      {r.hard_reads.map(w => (
                        <tr key={w.word + w.code} className="border-b last:border-0">
                          <td className="py-1.5 pr-2"><span className="font-mono font-semibold">{w.word}</span>
                            <span className="ml-1 font-mono text-xs text-slate-500">{w.phonetic}</span></td>
                          <td className="pr-2 text-xs text-slate-500">{w.code}</td>
                          <td className="pr-2">{w.tries} 次{w.self_passed && <span className="ml-1 text-xs text-amber-700">(自己点过「读对了」)</span>}</td>
                          <td className="pr-2">{w.best && GRADE_LABEL[w.best] ? <span className={`rounded px-1.5 py-0.5 text-xs ${GRADE_LABEL[w.best].tone}`}>{GRADE_LABEL[w.best].text}</span> : <span className="text-xs text-slate-400">没判出来</span>}</td>
                          <td className="pr-2 text-xs text-slate-600">{w.issue_label ?? ''}</td>
                          <td>{w.last_reading_id && <PlayRecording id={w.last_reading_id} word={w.word} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {r.hard_writes.length > 0 && (
            <Section icon={Layers} title="写错的词(第一遍)" hint="写成了什么,_ 是空着没填">
              <div className="flex flex-wrap gap-2">
                {r.hard_writes.map(w => (
                  <span key={w.word + w.code} className="rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-200">
                    <span className="font-mono font-semibold">{w.word}</span>
                    <span className="mx-1 font-mono text-emerald-700">[{w.answer}]</span>
                    <span className="font-mono text-rose-600 line-through">[{w.wrote}]</span>
                    {w.ever_ok ? <span className="ml-1 text-xs text-emerald-600">后来写对了</span> : <span className="ml-1 text-xs text-rose-600">还没写对</span>}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {r.listen_wrong.length > 0 && (
            <Section icon={Headphones} title="听力没对的">
              <div className="flex flex-wrap gap-2">
                {r.listen_wrong.map((w, i) => (
                  <span key={i} className="rounded-lg bg-white px-2.5 py-1.5 text-sm ring-1 ring-slate-200">
                    <span className="font-mono font-semibold">{w.word}</span>
                    <span className="ml-1 text-xs text-slate-500">{w.set}</span>
                    <span className="ml-1 text-xs text-rose-600">
                      {w.gave_up ? '看了答案' : [!w.word_ok && `单词写成 ${w.wrote || '(空)'}`, !w.phonetic_ok && '音标错'].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                ))}
              </div>
            </Section>
          )}

          <Section icon={BookOpen} title="每个音写得怎么样" hint="绿 ≥ 90% · 黄 75–89% · 红 < 75% · 灰 = 练得太少还看不出">
            <PhonemeGrid list={showAll ? r.phonemes : r.phonemes.filter(p => p.enough)} />
            {r.phonemes.some(p => !p.enough) && (
              <button type="button" onClick={() => setShowAll(v => !v)} className="mt-1.5 text-xs text-[#2f8791] underline">
                {showAll ? '只看练够 4 次的' : `也看练得少的(${r.phonemes.filter(p => !p.enough).length} 个)`}
              </button>
            )}
          </Section>

          {r.lessons.length > 0 && (
            <Section icon={CalendarDays} title="练过的每一节">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead><tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-1.5 pr-2">节</th><th className="pr-2">练法</th><th className="pr-2">词数</th><th className="pr-2">结果</th><th>最后一次</th>
                  </tr></thead>
                  <tbody>
                    {(allLessons ? r.lessons : r.lessons.slice(0, 8)).map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 font-medium">{l.code}</td>
                        <td className="pr-2 text-xs">{KIND_LABEL[l.kind]}</td>
                        <td className="pr-2">{l.items}</td>
                        <td className="pr-2 text-xs">
                          {l.kind === 'read' ? `读到绿 ${l.green} / ${l.items}` : `第一遍对 ${l.first_right} / ${l.items}`}
                          {l.kind === 'listen' && (l.word_wrong || l.phonetic_wrong) ? ` · 单词错 ${l.word_wrong} · 音标错 ${l.phonetic_wrong}` : ''}
                        </td>
                        <td className="text-xs text-slate-500">{l.last ? new Date(l.last).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.lessons.length > 8 && (
                <button type="button" onClick={() => setAllLessons(v => !v)} className="mt-1.5 text-xs text-[#2f8791] underline">
                  {allLessons ? '只看最近 8 节' : `展开全部 ${r.lessons.length} 节`}
                </button>
              )}
            </Section>
          )}

          {r.daily.length > 1 && (
            <Section icon={CalendarDays} title="每天练了多少" hint="一个点 = 那天交了几次(写、读、听力加起来)">
              <DailyBars daily={r.daily} />
            </Section>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Overview({ r }: { r: FullReport }) {
  const s = r.summary;
  const tiles = [
    { icon: CalendarDays, label: '练了', value: `${s.active_days} 天`, sub: `共约 ${s.minutes} 分钟` },
    { icon: Layers, label: '写音标', value: s.write.words ? pct(s.write.first_right, s.write.words) : '—',
      sub: s.write.words ? `第一遍对 ${s.write.first_right} / ${s.write.words} 词 · ${s.write.lessons} 节` : '没写过' },
    { icon: Mic, label: '读音标', value: s.read.judged ? pct(s.read.green, s.read.judged) : '—',
      sub: s.read.words ? `读到绿 ${s.read.green} / 判了 ${s.read.judged} 次 · ${s.read.words} 词` : '没读过' },
    { icon: Headphones, label: '听力', value: s.listen.items ? pct(s.listen.first_right, s.listen.items) : '—',
      sub: s.listen.items ? `第一遍全对 ${s.listen.first_right} / ${s.listen.items} 题` : '没做过' },
    { icon: Video, label: '视频', value: `${s.video.completed} 节`, sub: s.video.started ? `看过 ${s.video.started} 节 · ${s.video.minutes} 分钟` : '没看过' },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {tiles.map(t => (
        <div key={t.label} className="rounded-lg bg-slate-50 p-2.5">
          <p className="flex items-center gap-1 text-xs text-slate-500"><t.icon className="h-3.5 w-3.5" aria-hidden />{t.label}</p>
          <p className="mt-0.5 text-xl font-bold text-slate-800">{t.value}</p>
          <p className="text-[11px] leading-tight text-slate-500">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

function WeakCard({ p }: { p: PhonemeStat }) {
  return (
    <div className="rounded-lg bg-rose-50 p-2.5 ring-1 ring-rose-200">
      <div className="flex items-center gap-2">
        <Ph p={p.phoneme} big />
        <span className="text-sm font-semibold text-rose-700">写对 {p.right} / {p.seen}({Math.round((p.rate ?? 0) * 100)}%)</span>
        {p.lesson && <span className="ml-auto text-xs text-slate-500">多在 {p.lesson.code}</span>}
      </div>
      {p.wrong_as.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-700">
          常写成 {p.wrong_as.map(w => <span key={w.phoneme} className="flex items-center gap-0.5"><Ph p={w.phoneme} /> ×{w.times}</span>)}
        </p>
      )}
      {p.words.length > 0 && <p className="mt-1 text-xs text-slate-600">错在: <span className="font-mono">{p.words.join('、')}</span></p>}
    </div>
  );
}

function PhonemeGrid({ list }: { list: PhonemeStat[] }) {
  const vowels = list.filter(p => p.vowel);
  const cons = list.filter(p => !p.vowel);
  const row = (title: string, items: PhonemeStat[]) => items.length > 0 && (
    <div className="mb-2">
      <p className="mb-1 text-xs text-slate-500">{title}</p>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {items.map(p => (
          <div key={p.phoneme} className={`rounded-lg px-1.5 py-1 text-center ring-1 ${rateTone(p.rate, p.enough)}`}
            title={p.wrong_as.length ? `常写成 ${p.wrong_as.map(w => '/' + w.phoneme + '/').join(' ')}` : undefined}>
            <p className="font-mono text-base font-semibold">{p.phoneme}</p>
            <p className="text-[11px]">{p.right}/{p.seen}</p>
          </div>
        ))}
      </div>
    </div>
  );
  if (!list.length) return <p className="text-sm text-slate-500">还没有练够 4 次的音。</p>;
  return <>{row('元音', vowels)}{row('辅音', cons)}</>;
}

function DailyBars({ daily }: { daily: { day: string; n: number }[] }) {
  const max = Math.max(...daily.map(d => d.n), 1);
  return (
    <div className="flex h-20 items-end gap-1 overflow-x-auto">
      {daily.map(d => (
        <div key={d.day} className="flex min-w-[1.25rem] flex-1 flex-col items-center gap-0.5" title={`${d.day}: ${d.n} 次`}>
          <div className="w-full rounded-t bg-[#2f8791]/70" style={{ height: `${Math.max(4, (d.n / max) * 60)}px` }} />
          <span className="text-[10px] text-slate-400">{d.day.slice(5).replace('-', '/')}</span>
        </div>
      ))}
    </div>
  );
}

/** 孩子那一次录音(录音接口照旧鉴权: 本机构老师能听) */
function PlayRecording({ id, word }: { id: number; word: string }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLAudioElement | null>(null);
  const toggle = () => {
    if (playing) { ref.current?.pause(); setPlaying(false); return; }
    const a = ref.current ?? new Audio(readingAudioUrl(id));
    ref.current = a;
    a.onended = () => setPlaying(false);
    a.currentTime = 0;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  return (
    <button type="button" onClick={toggle} aria-label={`听孩子读 ${word}`}
      className="flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 text-xs text-sky-700 hover:bg-sky-100">
      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} 听
    </button>
  );
}

