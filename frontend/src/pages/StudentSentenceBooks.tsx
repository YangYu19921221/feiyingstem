import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { listSentenceBooks, type SentenceBook } from '../api/sentences';
import { toast } from '../components/Toast';
import { parseError } from '../utils/errorMessage';

export default function StudentSentenceBooks() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<SentenceBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try { setBooks(await listSentenceBooks()); }
      catch (err: any) { toast.error(parseError(err, '加载失败').message); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-ink-soft hover:text-ink text-sm">
            <ArrowLeft className="w-4 h-4" /> 返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">句子背诵</h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 py-8">
        <section className="student-colorful-surface mb-6 overflow-hidden rounded-2xl border border-slate-200/80 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-5">
            <div>
              <p className="mb-1 text-xs font-semibold text-orange-700">句子背诵</p>
              <h2 className="font-display text-2xl font-bold text-slate-800">把句子读熟，再把表达说出来</h2>
              <p className="mt-2 text-sm text-slate-600">听写与选择两种模式，按句子集循序练习。</p>
            </div>
            <img src="/hero-memory.jpeg" alt="" className="hidden h-24 w-32 rounded-xl object-cover shadow-sm sm:block" />
          </div>
        </section>
        <section className="mb-6">
          <p className="text-ink-mute text-sm mb-1.5">背诵英文短句 · 听写 + 选择两种模式</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink tracking-tight">
            选一本句子集开始
          </h2>
        </section>

        {loading ? (
          <div className="py-16 text-center text-sm text-ink-mute">加载中…</div>
        ) : books.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-black/10 rounded-2xl">
            <p className="text-ink-soft mb-1">老师还没有上传句子集</p>
            <p className="text-xs text-ink-mute">等老师从后台上传后就能看到</p>
          </div>
        ) : (
          <div className="card-soft rounded-2xl divide-y divide-black/[0.05] overflow-hidden">
            {books.map(b => (
              <div
                key={b.id}
                className="flex items-center gap-3 px-5 py-4 hover:bg-black/[0.02] cursor-pointer"
                onClick={() => navigate(`/student/sentences/${b.id}`)}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-semibold"
                  style={{ background: b.cover_color || '#5FD35F' }}>
                  💬
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-ink truncate">{b.name}</p>
                    {(b.grade_level || b.volume) && (
                      <span className="text-[11px] text-accent-warm bg-accent-warm/[0.10] px-1.5 py-0.5 rounded-full">
                        {[b.grade_level, b.volume].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-mute mt-0.5">
                    {b.unit_count} 单元 · {b.sentence_count} 句
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-ink-mute" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
