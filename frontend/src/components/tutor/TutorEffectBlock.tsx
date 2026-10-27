/**
 * 「问过小鹰老师的词,后来拼对了吗」(2026-10-27,后端 services/tutor_insight.effect)。
 * 老师的本班情况页和管理端学习助手卡片共用。不够 min_words 个词不下结论;文案写明这不完全是小鹰老师的功劳。
 */
import type { TutorEffect } from '../../api/tutor';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export default function TutorEffectBlock({ e }: { e: TutorEffect }) {
  if (!e.noted_words) {
    return <p className="text-sm text-slate-500">孩子们还没在小鹰老师那里练过单词,暂时没有数据。</p>;
  }
  if (!e.enough) {
    return (
      <p className="text-sm leading-6 text-slate-500">
        小鹰老师记了 {e.noted_words} 个孩子问过、练过的词,其中 {e.words} 个之后在正式练习里又遇到了。
        要有 {e.min_words} 个词以上才好比较,数据还不够,先不下结论。
      </p>
    );
  }
  const up = e.before != null && e.after != null ? Math.round((e.after - e.before) * 100) : null;
  return (
    <div>
      <div className="flex flex-wrap items-end gap-6">
        <div><p className="text-xs text-slate-500">问小鹰老师之前</p><p className="text-2xl font-bold text-slate-700">{pct(e.before)}</p></div>
        <div><p className="text-xs text-slate-500">问过之后</p><p className="text-2xl font-bold text-emerald-700">{pct(e.after)}</p></div>
        {up != null && <p className={`pb-1 text-sm font-semibold ${up >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{up >= 0 ? `提高 ${up} 个百分点` : `降低 ${-up} 个百分点`}</p>}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        算的是 {e.words} 个词: 孩子在小鹰老师那里问过、练过,之前 {e.before_days} 天内和之后都在正式练习(听写、拼写、测试)里遇到过的词,
        比较前后拼对的比例。这只说明「问过之后拼得怎么样」,不能完全算成小鹰老师的功劳,孩子自己也在复习。
      </p>
    </div>
  );
}

