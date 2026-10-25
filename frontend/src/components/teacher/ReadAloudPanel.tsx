/**
 * 教师端学生详情:「例句跟读」录音(2026-10-24)
 *
 * 机器转写只供参考(没拿真人录音验证过)。老师在这里回放孩子的录音、标「读对了 / 没读对」,
 * 标多了就能算出机器判断和老师一致的比例 —— 这是决定以后要不要给孩子看对错的依据。
 * 录音保留 14 天,过期只剩文字结果。
 */
import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play } from 'lucide-react';
import {
  fetchReadAloudAudio, getStudentReadAloud, setReadAloudVerdict,
  type ReadAloudRecordingItem, type ReadAloudStudentReport,
} from '../../api/readAloud';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

export default function ReadAloudPanel({ studentId }: { studentId: number }) {
  const [data, setData] = useState<ReadAloudStudentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    getStudentReadAloud(studentId)
      .then((r) => alive && setData(r))
      .catch(() => alive && setError('跟读记录加载失败'));
    return () => { alive = false; };
  }, [studentId]);

  // 卸载时停播并释放录音 blob
  useEffect(() => () => {
    audioRef.current?.pause();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPlaying(null);
  };

  const play = async (item: ReadAloudRecordingItem) => {
    if (playing === item.id) { stop(); return; }
    stop();
    try {
      const url = await fetchReadAloudAudio(item.id);
      urlRef.current = url;
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => { if (audioRef.current === a) stop(); };
      setPlaying(item.id);
      await a.play();
    } catch (e) {
      stop();
      toast.error(getErrorMessage(e, '录音放不出来'));
    }
  };

  const mark = async (item: ReadAloudRecordingItem, v: 'ok' | 'bad') => {
    const next = item.teacher_verdict === v ? null : v;   // 再点一次 = 取消
    try {
      await setReadAloudVerdict(item.id, next);
      setData((d) => {
        if (!d) return d;
        const items = d.items.map((i) => (i.id === item.id ? { ...i, teacher_verdict: next } : i));
        const marked = items.filter((i) => i.status === 'done' && i.teacher_verdict);
        return {
          ...d, items,
          summary: {
            ...d.summary, marked: marked.length,
            agree: marked.filter((i) => (i.teacher_verdict === 'ok') === !!i.passed).length,
          },
        };
      });
    } catch (e) {
      toast.error(getErrorMessage(e, '没标上'));
    }
  };

  // 一条都没有就不占地方(多数学生还没读过)
  if (!error && (!data || data.items.length === 0)) return null;
  const s = data?.summary;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
          <Mic className="h-5 w-5 text-orange-500" aria-hidden="true" />
          例句跟读
        </h2>
        {s && (
          <p className="text-xs text-slate-500">
            最近 {data!.items.length} 句 · 机器判读出 {s.passed}/{s.done}{s.pending > 0 ? ` · ${s.pending} 句识别中` : ''}
          </p>
        )}
      </div>
      <p className="mb-4 text-xs leading-5 text-slate-500">
        机器识别还在验证,只供参考,孩子那边不显示对错。听一下录音、点「读对了 / 没读对」,
        {s && s.marked > 0 ? `你已标 ${s.marked} 句,机器和你一致 ${s.agree} 句。` : '标得越多越能看出机器准不准。'}
        录音保留 {data?.keep_days ?? 14} 天。
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-slate-100">
        {(data?.items || []).map((i) => (
          <li key={i.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{i.sentence}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {i.unit_name}{i.created_at ? ` · ${new Date(i.created_at + 'Z').toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}
                {' · '}
                {i.status === 'pending' ? '识别中'
                  : i.status === 'failed' ? '识别失败'
                    : i.passed ? <span className="text-green-700">机器: 读出来了</span>
                      : <span className="text-amber-700">机器: 没读出 {i.missed_words.slice(0, 4).join(', ') || '部分词'}</span>}
              </p>
              {i.transcript && <p className="mt-0.5 truncate text-xs text-slate-400">听到: {i.transcript}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {i.has_audio ? (
                <button type="button" onClick={() => void play(i)} aria-label={playing === i.id ? '停止' : '播放录音'}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                  {playing === i.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
              ) : <span className="text-xs text-slate-400">录音已过期</span>}
              {i.status === 'done' && (
                <>
                  <button type="button" onClick={() => void mark(i, 'ok')} aria-pressed={i.teacher_verdict === 'ok'}
                    className={`min-h-9 rounded-lg border px-2.5 text-xs font-medium ${i.teacher_verdict === 'ok' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    读对了
                  </button>
                  <button type="button" onClick={() => void mark(i, 'bad')} aria-pressed={i.teacher_verdict === 'bad'}
                    className={`min-h-9 rounded-lg border px-2.5 text-xs font-medium ${i.teacher_verdict === 'bad' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    没读对
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
