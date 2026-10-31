/**
 * 家长端「今天」: 作业做完几份、学了多久、切出去几次一共多久、摄像头里离开几次、卡住的词,
 * 孩子正在学时显示实时状态。规则真源 backend services/focus_watch.py 第 5 条。
 * 页面开着时每 30 秒刷新一次(切到后台不刷,切回来马上刷)。
 */
import { useCallback, useEffect, useState } from 'react';
import { fmtAway, focusWatchApi, type ParentToday } from '../../api/focusWatch';

const REFRESH_MS = 30_000;

function liveText(t: ParentToday): { text: string; tone: string } | null {
  const l = t.live;
  if (!l) return null;
  const where = l.unit_name ? `「${l.unit_name}」` : '';
  if (l.status === 'away') {
    const m = Math.max(1, Math.round(l.away_seconds / 60));
    return { text: `切出学习页面了,已经 ${m} 分钟`, tone: 'bg-red-50 text-red-700 border-red-200' };
  }
  if (l.no_face) return { text: `在学习页面${where},但摄像头里看不到人`, tone: 'bg-amber-50 text-amber-800 border-amber-200' };
  if (l.status === 'distracted') return { text: `在学习页面${where},但有一会儿没动了`, tone: 'bg-amber-50 text-amber-800 border-amber-200' };
  return { text: `正在学${where}`, tone: 'bg-green-50 text-green-700 border-green-200' };
}

const CAMERA_STATUS_TEXT: Record<string, string> = {
  on: '今天摄像头开着',
  denied: '今天摄像头没开: 孩子在浏览器里没允许',
  unavailable: '今天摄像头没开: 这台设备没有摄像头',
  error: '今天摄像头没开起来',
};

export default function ParentTodayCard({ studentId }: { studentId: number }) {
  // 按孩子存: 换了孩子,上一个孩子的数据不会闪一下
  const [state, setState] = useState<{ sid: number; data: ParentToday | null; failed: boolean }>(
    { sid: studentId, data: null, failed: false });
  const data = state.sid === studentId ? state.data : null;
  const failed = state.sid === studentId && state.failed;

  const load = useCallback(() => {
    focusWatchApi.today(studentId)
      .then(d => setState({ sid: studentId, data: d, failed: false }))
      .catch(() => setState(prev => ({ sid: studentId, data: prev.sid === studentId ? prev.data : null, failed: true })));
  }, [studentId]);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  if (!data) {
    return failed ? (
      <section className="card-soft mb-6 rounded-2xl p-5 text-sm text-ink-mute">
        今天的情况没拿到,<button onClick={load} className="text-accent-warm underline">再试一次</button>
      </section>
    ) : null;
  }

  const live = liveText(data);
  const sw = data.switch;
  const nf = data.no_face;

  return (
    <section className="card-soft mb-6 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">今天</h2>
        {live && (
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${live.tone}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            现在: {live.text}
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-white/70 px-3 py-2.5">
          <div className="text-xs text-ink-mute">老师布置的作业</div>
          <div className="mt-0.5 text-lg font-semibold text-ink">
            {data.tasks_total === 0 ? '今天没布置' : `${data.tasks_done} / ${data.tasks_total} 份`}
          </div>
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2.5">
          <div className="text-xs text-ink-mute">学了</div>
          <div className="mt-0.5 text-lg font-semibold text-ink">{data.study_minutes} 分钟 · {data.words_learned} 词</div>
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2.5">
          <div className="text-xs text-ink-mute">切出学习页面</div>
          <div className={`mt-0.5 text-lg font-semibold ${sw.count > 0 ? 'text-red-600' : 'text-ink'}`}>
            {sw.count === 0 ? '没有' : `${sw.count} 次${sw.seconds ? ` · 共 ${fmtAway(sw.seconds)}` : ''}`}
          </div>
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2.5">
          <div className="text-xs text-ink-mute">{data.camera.active ? '摄像头里离开座位' : '1 分钟没动'}</div>
          <div className="mt-0.5 text-lg font-semibold text-ink">
            {data.camera.active
              ? (nf.count === 0 ? '没有' : `${nf.count} 次 · 共 ${fmtAway(nf.seconds)}`)
              : (data.distracted_count === 0 ? '没有' : `${data.distracted_count} 次`)}
          </div>
        </div>
      </div>

      {sw.episodes.length > 0 && (
        <p className="mt-3 text-xs leading-5 text-ink-mute">
          离开得久的几次: {sw.episodes.map(e => `${e.at} 走开 ${fmtAway(e.seconds)}`).join(' · ')}
          <span className="block">只知道离开了学习页面,看不到去了哪个应用。</span>
        </p>
      )}
      {data.camera.active && nf.episodes.length > 0 && (
        <p className="mt-2 text-xs leading-5 text-ink-mute">
          摄像头里看不到人: {nf.episodes.map(e => `${e.at} 离开 ${fmtAway(e.seconds)}`).join(' · ')}
        </p>
      )}
      {data.camera.active && (
        <p className="mt-2 text-xs text-ink-mute">
          {CAMERA_STATUS_TEXT[data.camera.status_today || ''] || '今天孩子还没打开过学习页面'}
        </p>
      )}

      {data.stuck_words.length > 0 && (
        <div className="mt-3">
          <div className="text-xs text-ink-mute">听写时想了很久的词(明天会再考一次)</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {data.stuck_words.map(w => (
              <span key={w.word} className="rounded-lg bg-white/80 px-2 py-1 text-xs text-ink">
                <b>{w.word}</b> 想了 {w.seconds} 秒 · {w.outcome === 'correct' ? '后来写对了' : w.outcome === 'gave_up' ? '看了答案' : '写错了'}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
