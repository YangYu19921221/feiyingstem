/**
 * 音标教材目录:48 节。每节两种练法 —— 「读音标」练发音、「写音标」练拼读
 * 与音标视频同属音标模块,不挂在单词本单元下
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LoaderCircle, Video, Volume2, PenLine } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { listPhoneticBooks, type PhoneticBook } from '../api/phoneticPractice';

export default function PhoneticLessons() {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/phonetics');
  const [books, setBooks] = useState<PhoneticBook[] | null>(null);
  const [error, setError] = useState('');

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
          <p className="text-xs text-slate-400">先「读音标」练发音,再「写音标」练拼读</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4">
        {!books.length && (
          <p className="mt-16 text-center text-slate-400">还没有音标教材,请老师先导入。</p>
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
                  {/* 两种练法:先看音标读出来(学),再看单词写音标(考) */}
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
                      onClick={() => navigate(`/student/phonetics/textbook/${ls.id}/fill`)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg
                                 bg-slate-50 py-2 text-xs text-slate-600
                                 transition active:scale-95 hover:bg-slate-100"
                    >
                      <PenLine className="h-3.5 w-3.5" /> 写音标
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
