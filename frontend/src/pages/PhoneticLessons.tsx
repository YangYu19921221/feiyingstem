/**
 * 音标教材目录:48 节。每节两种练法 —— 「读音标」练发音、「写音标」练拼读
 * 与音标视频同属音标模块,不挂在单词本单元下
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, Video, Volume2, PenLine, Layers, History } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { segmentIpa } from '../utils/ipaPhonemes';
import { listPhoneticBooks, type PhoneticBook } from '../api/phoneticPractice';

export default function PhoneticLessons() {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/phonetics');
  const [books, setBooks] = useState<PhoneticBook[] | null>(null);
  const [error, setError] = useState('');

  /** 最后练过的那一节(跨教材取最近一次)。没练过就不显示这条 */
  const resume = useMemo(() => {
    const all = (books ?? []).flatMap(b => b.lessons).filter(l => l.last_practiced_at);
    if (!all.length) return null;
    return all.reduce((a, b) =>
      (a.last_practiced_at! > b.last_practiced_at! ? a : b));
  }, [books]);

  useEffect(() => {
    let alive = true;
    listPhoneticBooks()
      .then(d => { if (alive) setBooks(d); })
      .catch(() => { if (alive) setError('目录加载失败,请检查网络后重试。'); });
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-slate-600">{error}</p>
        <button onClick={goBack} className="rounded-lg bg-orange-500 px-5 py-2 text-white">返回</button>
      </div>
    );
  }

  if (!books) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-orange-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50/40 to-white pb-10">
      <header className="flex items-center gap-3 px-4 py-3">
        <button onClick={goBack} aria-label="返回" className="rounded-lg p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">音标练习 · 专用教材</p>
          {/* 标题必须说清这页有两种练法 —— 只写「看单词写音标」会让想练发音的孩子
              以为进错了页(这一页是目录,两个入口都在) */}
          <p className="text-xs text-slate-400">先「读音标」练发音,再「卡片写音标」练拼读</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4">
        {!books.length && (
          <p className="mt-16 text-center text-slate-400">还没有音标教材,请老师先导入。</p>
        )}

        {/* 「继续上次」:48 节在手机上是 9.7 屏,学到第 30 节的孩子每次进来都要划 6 屏
            才找到自己那一节 —— 而 48 张卡长得一样,划过去也认不出。这一条把它变成 0 屏 */}
        {resume && (
          <button
            onClick={() => navigate(`/student/phonetics/textbook/${resume.id}/cards`)}
            className="mb-5 flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left
                       shadow-sm ring-1 ring-orange-100 transition active:scale-[0.99]
                       hover:ring-orange-200"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl
                             bg-orange-50 text-orange-500">
              <History className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-slate-400">继续上次</span>
              <span className="block truncate font-medium text-slate-800">
                {resume.code}
                {!!resume.mastered_count && (
                  <span className="ml-2 text-xs font-normal text-emerald-600">
                    写对 {resume.mastered_count}/{resume.item_count}
                  </span>
                )}
              </span>
            </span>
            <span className="shrink-0 text-slate-300">→</span>
          </button>
        )}
        {books.map(b => (
          <section key={b.id} className="mb-8">
            <h2 className="mb-3 text-base font-medium text-slate-800">
              {b.name}
              <span className="ml-2 text-xs text-slate-400">{b.lessons.length} 节</span>
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {b.lessons.map(ls => (
                <div
                  key={ls.id}
                  className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-100"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{ls.code}</span>
                    <span className="text-xs text-slate-400">
                      {ls.item_count} 词
                      {/* 剔过敏感词的节要标出来,免得老师照纸书上课以为系统漏词 */}
                      {ls.removed_count > 0 && (
                        <span className="ml-1 text-amber-500">已剔{ls.removed_count}</span>
                      )}
                      {ls.has_video && <Video className="ml-1 inline h-3 w-3 text-orange-400" />}
                    </span>
                  </div>

                  {/* 这节教的音素 —— 48 张卡只有编号和词数时长得一模一样,
                      挑不出该练哪节。元音橙、辅音蓝,与角标/答题格同一套口径 */}
                  {!!ls.highlight?.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {ls.highlight.map(p => (
                        <span
                          key={p}
                          className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-xs"
                        >
                          {segmentIpa(p).map((seg, i) => (
                            <span
                              key={i}
                              className={
                                seg.kind === 'vowel'
                                  ? 'font-extrabold text-orange-600'
                                  : seg.kind === 'consonant'
                                    ? 'font-semibold text-sky-600'
                                    : 'text-slate-400'
                              }
                            >
                              {seg.text}
                            </span>
                          ))}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 「练过没有」的判据是 last_practiced_at 而不是写对数:
                      练了一整节但一个没写对(全点了「看答案」)的节,写对数是 0 ——
                      按写对数判会让它跟从没练过的卡长得一模一样,恰恰这种节最该回去练。
                      没练过的保持干净不占视觉 */}
                  {ls.last_practiced_at && ls.item_count > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            ls.mastered_count ? 'bg-emerald-400' : 'bg-slate-300'}`}
                          style={{
                            width: `${Math.max(
                              ls.mastered_count ? 0 : 4,   // 0 对也留一小截,示意"练过"
                              Math.min(100, ((ls.mastered_count ?? 0) / ls.item_count) * 100),
                            )}%`,
                          }}
                        />
                      </div>
                      <span className={`shrink-0 text-[11px] ${
                        ls.mastered_count ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {ls.mastered_count
                          ? `写对 ${ls.mastered_count}/${ls.item_count}`
                          : '练过 · 还没写对'}
                      </span>
                    </div>
                  )}
                  {/* 三种练法。前两个是主入口(学 → 练),整页版是同一件事的考核版式,
                      放第二排小字 —— 三个按钮挤一排在手机上字会小到点不准 */}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => navigate(`/student/phonetics/textbook/${ls.id}/read`)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg
                                 bg-orange-50 py-2 text-xs text-orange-700
                                 transition active:scale-95 hover:bg-orange-100"
                    >
                      <Volume2 className="h-3.5 w-3.5" /> 读音标
                    </button>
                    <button
                      onClick={() => navigate(`/student/phonetics/textbook/${ls.id}/cards`)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg
                                 bg-amber-50 py-2 text-xs text-amber-700
                                 transition active:scale-95 hover:bg-amber-100"
                    >
                      <Layers className="h-3.5 w-3.5" /> 卡片写音标
                    </button>
                  </div>
                  <button
                    onClick={() => navigate(`/student/phonetics/textbook/${ls.id}/fill`)}
                    className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg
                               py-1.5 text-[11px] text-slate-400
                               transition active:scale-95 hover:bg-slate-50"
                  >
                    <PenLine className="h-3 w-3" /> 整页版({ls.item_count} 词一次交卷)
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
