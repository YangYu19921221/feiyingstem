/**
 * 学生首页「问小鹰老师」入口: Hero 下面单独一张卡,不再混在「学习工具」的小卡片里
 * (那里是第二个、和听写 / 句子共用一张图,孩子扫过去认不出它能干什么)。
 *
 * 长得像一个缩小的聊天框: 小鹰老师头像 + 它说的一句话(气泡,和聊天页同一个样子)、
 * 一个假输入框(点了进聊天页,占位字自己打出几个例子问题)、三个能直接点的问题。
 * 点问题只把问题填好、不自动发(聊天页的 location.state.q 那套),省孩子的次数。
 * 只在本校开放时出现(status.enabled),由首页传进来。
 * 10-29 加「考考你」: 小鹰老师讲过、今天到期该回头考的点(后端 services/tutor_notes),卡片上直接写出来,
 * 点了进聊天自动出题(孩子自己点的;一天第一次不扣次数)。没有到期的就不显示
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Camera, ClipboardCheck, Zap } from 'lucide-react';
import type { TutorStatus } from '../../api/tutor';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 占位字逐字打出来,打完停一会儿换下一句;减少动态效果时只显示第一句 */
function useTypewriter(lines: string[]) {
  const still = reducedMotion();
  const [text, setText] = useState(still ? lines[0] : '');
  useEffect(() => {
    if (still) return; // 初始值已经是第一句
    let line = 0;
    let n = 0;
    let timer = 0;
    const tick = () => {
      const s = lines[line];
      if (n <= s.length) {
        setText(s.slice(0, n));
        n += 1;
        timer = window.setTimeout(tick, 110);
      } else {
        timer = window.setTimeout(() => {
          line = (line + 1) % lines.length;
          n = 0;
          tick();
        }, 2400);
      }
    };
    timer = window.setTimeout(tick, 600);
    return () => window.clearTimeout(timer);
  }, [lines, still]);
  return { text, still };
}

function TutorEntryCard({ status }: { status: TutorStatus }) {
  const navigate = useNavigate();
  const pictureOn = status.picture_enabled;

  // 能点的三个问题: 都是小鹰老师查得到孩子自己数据的(作业 / 常错词),第三个看画图开没开
  const asks = useMemo(
    () => [
      '今天的作业我做完了吗?',
      '用我常错的词考考我',
      pictureOn ? 'elephant 好难记,给我画张记忆图' : '一般现在时什么时候加 s?',
    ],
    [pictureOn],
  );
  // 输入框里打出来的例子: 和上面三个不重复,让孩子知道还能这样问
  const examples = useMemo(
    () => ['这道题选什么?我拍给你看', 'because 怎么记得住?', '帮我看看这句话哪里错了', '我这周学得怎么样?'],
    [],
  );
  const { text, still } = useTypewriter(examples);

  const open = (q?: string) => navigate('/student/tutor', q ? { state: { q } } : undefined);
  const left = Math.max(0, status.left);

  return (
    <section data-dashboard-reveal className="mb-5 sm:mb-8" aria-labelledby="tutor-entry-title">
      {/* 手机上下排;电脑左边小鹰老师、右边输入框和问题 */}
      <div className="relative overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-orange-50/70 p-4 shadow-[0_6px_20px_-12px_rgb(14_116_144/0.35)] sm:p-6 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center md:gap-8">
        <div className="flex items-start gap-3 sm:gap-5">
          <img
            src="/tools/tutor.jpg"
            alt=""
            className="h-16 w-16 shrink-0 select-none rounded-2xl object-cover ring-1 ring-sky-100 sm:h-24 sm:w-24"
            loading="lazy"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="tutor-entry-title" className="font-display text-lg font-bold text-ink sm:text-2xl">
                问小鹰老师
              </h2>
              <span className={`font-numeric text-xs font-semibold ${left <= 3 ? 'text-accent-warm' : 'text-sky-700'}`}>
                {left > 0 ? `还能问 ${left} 次` : '次数用完了'}
              </span>
            </div>
            {/* 小鹰老师说的话: 和聊天页它的气泡同一个样子(左上角收尖,指向头像) */}
            <p className="mt-1.5 w-fit max-w-full rounded-2xl rounded-tl-md border border-sky-100 bg-white px-3 py-2 text-sm leading-snug text-ink-soft shadow-sm [text-wrap:balance] sm:text-base">
              不会的题拍给我,一步步带你想明白
            </p>
          </div>
        </div>

        <div className="min-w-0">
        {/* 假输入框: 整条是一个按钮,点了进聊天页 */}
        <button
          type="button"
          onClick={() => open()}
          aria-label="去问小鹰老师"
          className="group mt-4 md:mt-0 flex min-h-12 w-full items-center gap-2.5 rounded-2xl border border-sky-200 bg-white py-1.5 pl-3.5 pr-1.5 text-left shadow-sm transition hover:border-sky-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
        >
          <Camera className="h-5 w-5 shrink-0 text-sky-600" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink-mute sm:text-base" aria-hidden="true">
            {text}
            {!still && <span className="tutor-caret" />}
          </span>
          <span className="btn-glow inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition group-hover:scale-105 sm:h-10 sm:w-10">
            <ArrowUp className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
          </span>
        </button>

        {status.review && (
          <button
            type="button"
            onClick={() => navigate('/student/tutor', { state: { review: { id: status.review!.note_id, topic: status.review!.topic } } })}
            className="mt-3 flex min-h-12 w-full items-center gap-2.5 rounded-2xl border border-sky-300 bg-sky-600 px-3.5 py-2 text-left text-white shadow-sm transition hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
          >
            <Zap className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm sm:text-base">
              <span className="font-semibold">{status.review.since}的「{status.review.topic}」,10 秒考考你</span>
              <span className="block text-xs text-white/80">这一次不算次数</span>
            </span>
          </button>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {asks.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => open(q)}
              className="inline-flex min-h-10 items-center rounded-full border border-sky-200 bg-white/80 px-3 text-xs font-medium text-sky-800 transition hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 sm:text-sm"
            >
              {q}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => navigate('/student/homework-check')}
          className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-orange-200 bg-white/80 px-3 text-left text-sm font-medium text-orange-800 transition hover:border-orange-300 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
        >
          <ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">作业做完了?拍一页,小鹰老师帮你批</span>
          <span aria-hidden="true">→</span>
        </button>

        <p className="mt-3 text-xs text-ink-mute">
          {left > 0
            ? `作业题只给提示不直接给答案${status.followup_free > 0 ? ' · 同一道题接着问不算次数' : ''}`
            : status.requested
              ? '已经请老师加次数了,加好就能接着问'
              : '进去点「请老师加次数」;刚问过的那道题还能接着问'}
        </p>
        </div>
      </div>
    </section>
  );
}

export default memo(TutorEntryCard);
