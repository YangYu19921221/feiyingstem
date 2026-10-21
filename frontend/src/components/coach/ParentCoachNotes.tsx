/** 家长端「老师的点评」—— 陪跑老师最近两周给孩子留的话。没有就不显示。看了记已读 */
import { useEffect, useState } from 'react';
import { coachApi } from '../../api/coach';

type Item = { date: string; content: string; author_name: string };

const fmt = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

export default function ParentCoachNotes({ studentId }: { studentId: number }) {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    let alive = true;
    setItems([]);
    coachApi.forChild(studentId).then((r) => { if (alive) setItems(r.items); }).catch(() => {});
    return () => { alive = false; };
  }, [studentId]);

  if (items.length === 0) return null;
  return (
    <section className="card-soft mb-6 rounded-2xl p-5">
      <p className="mb-3 text-xs text-ink-mute">老师的点评</p>
      <ul className="space-y-3">
        {items.slice(0, 7).map((n) => (
          <li key={n.date} className="flex gap-3">
            <span className="w-14 shrink-0 pt-0.5 text-xs text-ink-mute font-numeric">{fmt(n.date)}</span>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{n.content}</p>
              <p className="mt-0.5 text-xs text-ink-mute">—— {n.author_name}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
