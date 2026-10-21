/**
 * 学生首页「老师的话」—— 陪跑老师今天(或最近 3 天)留的一句话。没有就整块不显示。
 * 打开首页即记已读(老师看板上能看到孩子看没看)。
 */
import { useEffect, useState } from 'react';
import { coachApi, type MyCoachNote } from '../../api/coach';

export default function CoachNoteCard() {
  const [note, setNote] = useState<MyCoachNote | null>(null);

  useEffect(() => {
    let alive = true;
    coachApi.mine().then((r) => { if (alive) setNote(r.note); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!note) return null;
  const d = new Date(`${note.date}T00:00:00`);
  return (
    <section data-dashboard-reveal className="mb-5 sm:mb-8">
      <div className="flex gap-3 rounded-2xl border-2 border-orange-200 bg-orange-50 px-5 py-4">
        <span className="text-3xl" aria-hidden="true">💬</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-orange-700">
            {note.author_name} {note.is_today ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`}对你说
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-base leading-relaxed text-slate-800">{note.content}</p>
        </div>
      </div>
    </section>
  );
}
