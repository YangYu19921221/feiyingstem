/**
 * 「要请你当面讲的点」(2026-10-29,后端 services/tutor_notes「交给老师」)
 *
 * 孩子在小鹰老师出的练习里,同一个点错了 threshold 次还没会: AI 讲不通的,老师当面讲两分钟最有效。
 * 讲过了点「我讲过了」写一句(可不写),这一条就收起来;之后孩子又错了会重新出现,带着上次讲的记录。
 * 学会了(小鹰老师回头考连对三次)就不再出现。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getTutorHandoffs, handleTutorHandoff, type TutorHandoff } from '../../api/tutor';
import { getErrorMessage } from '../../utils/errorMessage';
import { toast } from '../Toast';

export default function TutorHandoffList({ onCount }: { onCount?: (n: number) => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<TutorHandoff[] | null>(null);
  const [threshold, setThreshold] = useState(3);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getTutorHandoffs().then((r) => {
      setItems(r.items);
      setThreshold(r.threshold);
      setError('');
      onCount?.(r.pending);
    }).catch((e: unknown) => setError(getErrorMessage(e, '读取失败')));
  }, [onCount]);
  useEffect(() => { load(); }, [load]);

  const done = async (it: TutorHandoff) => {
    if (busy) return;
    setBusy(true);
    try {
      await handleTutorHandoff(it.note_id, note.trim());
      setItems((xs) => {
        const next = (xs || []).filter((x) => x.note_id !== it.note_id);
        onCount?.(next.length);
        return next;
      });
      setOpen(null);
      setNote('');
      toast.success('记下了。明天小鹰老师会回头考他一下');
    } catch (e) {
      toast.error(getErrorMessage(e, '没记上,再点一次'));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (items === null) return <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />正在读取…</p>;
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">暂时没有。孩子在小鹰老师的练习里同一个点错满 {threshold} 次还没会,会出现在这里。</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => (
        <li key={it.note_id} className="py-3">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800">
                <button type="button" onClick={() => navigate(`/teacher/students/${it.student_id}`)}
                  className="font-semibold hover:text-orange-700 hover:underline">{it.student_name}</button>
                <span className="ml-1.5 text-xs text-slate-400">{it.class_name}</span>
              </p>
              <p className="mt-0.5 text-sm text-slate-700">
                {it.kind === 'word' ? '单词 ' : ''}<span className="font-medium">{it.topic}</span>
                <span className="ml-2 text-xs text-rose-600">练习里错了 {it.times_wrong} 次</span>
              </p>
              {it.detail && <p className="mt-0.5 text-xs text-slate-500">卡在: {it.detail}</p>}
              {it.handled && (
                <p className="mt-0.5 text-xs text-amber-700">
                  {new Date(`${it.handled.at}Z`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} {it.handled.by}讲过
                  {it.handled.note ? `(${it.handled.note})` : ''},之后又错了 {it.times_wrong - it.handled.wrong_then} 次
                </p>
              )}
            </div>
            {open !== it.note_id && (
              <button type="button" onClick={() => { setOpen(it.note_id); setNote(''); }}
                className="min-h-9 shrink-0 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50">
                我讲过了
              </button>
            )}
          </div>
          {open === it.note_id && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void done(it); if (e.key === 'Escape') setOpen(null); }}
                placeholder="怎么讲的(可不写),如「用 he/she/it 三张卡片区分主语」" aria-label="怎么讲的"
                className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-orange-300" />
              <button type="button" disabled={busy} onClick={() => void done(it)}
                className="min-h-10 rounded-lg bg-slate-800 px-3 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60">记下</button>
              <button type="button" onClick={() => setOpen(null)} className="min-h-10 px-2 text-sm text-slate-500 hover:text-slate-700">取消</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
