/**
 * 教师端学生详情:「开口背」后台转写结果(10-11)。
 * 机器转写只供参考 —— 孩子那边不判对错、不拦人;这里让老师看出谁在糊弄、哪句老漏词。
 */
import { useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import { getStudentSentenceSpeech, type SentenceSpeechItem } from '../../api/sentences';

export default function SentenceSpeechPanel({ studentId }: { studentId: number }) {
  const [items, setItems] = useState<SentenceSpeechItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getStudentSentenceSpeech(studentId)
      .then((r) => alive && setItems(r.items))
      .catch(() => alive && setError('开口背记录加载失败'));
    return () => { alive = false; };
  }, [studentId]);

  // 一条都没有就不占地方(大多数学生还没用过句子背诵)
  if (!error && (!items || items.length === 0)) return null;

  const done = (items || []).filter((i) => i.status === 'done');
  const passed = done.filter((i) => i.passed).length;
  const pending = (items || []).filter((i) => i.status === 'pending').length;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
          <Mic className="h-5 w-5 text-orange-500" />
          句子开口背
        </h2>
        {items && (
          <p className="text-xs text-slate-500">
            最近 {items.length} 句 · 背出 {passed}/{done.length}{pending > 0 ? ` · ${pending} 句转写中` : ''}
          </p>
        )}
      </div>
      <p className="mb-3 text-xs text-slate-400">机器转写,仅供参考;学生端不显示对错。漏了关键词才算没背出,漏 a / is 这类小词不算。</p>
      {error ? (
        <div className="py-4 text-center text-sm text-slate-500">{error}</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items!.map((i) => (
            <li key={i.id} className="py-2.5 text-sm">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs ${
                  i.status !== 'done' ? 'bg-slate-100 text-slate-500'
                    : i.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {i.status === 'pending' ? '转写中' : i.status === 'failed' ? '没听清' : i.passed ? '背出' : '没背出'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-slate-800">{i.english}</div>
                  {i.status === 'done' && (
                    <div className="mt-0.5 text-xs text-slate-500">
                      听到:「{i.transcript || '(没听到内容)'}」
                      {i.missed_words.length > 0 && <span className="ml-2 text-red-600">漏/错: {i.missed_words.join('、')}</span>}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-xs text-slate-400">{i.unit_name}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
