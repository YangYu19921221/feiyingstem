import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { listSentenceUnits, type SentenceUnit } from '../api/sentences';
import { toast } from '../components/Toast';
import { parseError } from '../utils/errorMessage';

export default function StudentSentenceUnits() {
  const navigate = useNavigate();
  const { bookId } = useParams<{ bookId: string }>();
  const bid = parseInt(bookId || '0', 10);
  const [units, setUnits] = useState<SentenceUnit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bid) return;
    (async () => {
      try { setUnits(await listSentenceUnits(bid)); }
      catch (err: any) { toast.error(parseError(err, '加载失败').message); }
      finally { setLoading(false); }
    })();
  }, [bid]);

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-ink-soft hover:text-ink text-sm">
            <ArrowLeft className="w-4 h-4" /> 返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">选择单元</h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 py-8">
        <section className="student-colorful-surface mb-6 overflow-hidden rounded-2xl border border-slate-200/80 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-5">
            <div>
              <p className="mb-1 text-xs font-semibold text-orange-700">学习单元</p>
              <h2 className="font-display text-2xl font-bold text-slate-800">选一个单元，开始开口练习</h2>
              <p className="mt-2 text-sm text-slate-600">完成每个单元后，你会看到自己的进度变化。</p>
            </div>
            <img src="/eagle-studying.jpeg" alt="" className="hidden h-24 w-32 rounded-xl object-cover shadow-sm sm:block" />
          </div>
        </section>
        {loading ? (
          <div className="py-16 text-center text-sm text-ink-mute">加载中…</div>
        ) : units.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-black/10 rounded-2xl">
            <p className="text-ink-soft">该句子集还没有单元</p>
          </div>
        ) : (
          <div className="card-soft rounded-2xl divide-y divide-black/[0.05] overflow-hidden">
            {units.map(u => (
              <div
                key={u.id}
                onClick={() => u.sentence_count > 0 && navigate(`/student/sentences/${bid}/${u.id}/learn`)}
                className={`flex items-center gap-3 px-5 py-4 ${
                  u.sentence_count > 0 ? 'hover:bg-black/[0.02] cursor-pointer' : 'opacity-60'
                }`}
              >
                <div className="w-7 h-7 rounded-full bg-black/[0.04] flex items-center justify-center text-xs font-semibold font-numeric text-ink-soft">
                  {u.unit_number}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink truncate">{u.name}</p>
                  <p className="text-xs text-ink-mute mt-0.5">
                    {u.sentence_count} 句{u.sentence_count === 0 ? ' · 还没有句子' : ''}
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
