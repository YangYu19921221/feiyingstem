/**
 * 语法小课「句子积木」: 上一节课(2026-11-15,样课)。规则真源 backend/app/services/grammar_course.py 文件头。
 *
 * 一屏一步,只有一个大按钮往下走:
 *   开头 →(看和听: 小鹰老师说一句,台上的积木跟着变 / 跟着做: 一道小题)交替 → 「自己试一试」→ 自己练几道 → 小结
 * 屏幕上的字只有最上面一行字幕(小鹰老师正在说的那句),别的都是积木和图。
 * 答案只在服务器: 孩子每点一下交一次;页面上的进度以服务器为准(交上去发现进度变了,按服务器回的重摆)。
 * 没上完就走了,6 小时内再点开从没做完的那道题接着上。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LoaderCircle, Volume2, X } from 'lucide-react';
import {
  grammarApi, type AnswerResult, type Block, type Finish, type Frame, type Item, type ItemState, type RunView,
  type Say,
} from '../api/grammar';
import { BlockRows, SayText } from '../components/grammar/BlockView';
import ItemStage from '../components/grammar/ItemStage';
import useLessonAudio from '../components/grammar/useLessonAudio';
import useAccidentalTapGuard from '../hooks/useAccidentalTapGuard';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

type Screen =
  | { kind: 'intro' }
  | { kind: 'frame'; group: string; frame: Frame }
  | { kind: 'item'; item: Item; practice: boolean; n: number }
  | { kind: 'practice' }
  | { kind: 'finish' };

const BLANK: ItemState = { part: 0, tries: 0, wrong: 0, done: false };
const HOME = '/student/grammar';

function buildScreens(v: RunView): Screen[] {
  const out: Screen[] = [{ kind: 'intro' }];
  v.steps.forEach((st, s) => {
    if (st.kind === 'watch') {
      st.frames.forEach((frame) => out.push({ kind: 'frame', group: `w${s}`, frame }));
    } else {
      out.push({ kind: 'item', item: st.item, practice: false, n: 0 });
    }
  });
  out.push({ kind: 'practice' });
  v.practice.forEach((item, n) => out.push({ kind: 'item', item, practice: true, n: n + 1 }));
  out.push({ kind: 'finish' });
  return out;
}

/** 点「开始 / 接着学」以后从哪一屏开始: 第一道没做完的题;它前面紧挨着的「看和听」重新听一遍 */
function resumeIndex(screens: Screen[], state: Record<string, ItemState>): number {
  const first = screens.findIndex((s) => s.kind === 'item' && !state[s.item.key]?.done);
  if (first < 0) return screens.length - 1;
  let i = first;
  while (i > 1 && screens[i - 1].kind !== 'item') i -= 1;
  return i;
}

function soundsOf(v: RunView): string[] {
  const out: string[] = Object.values(v.lines).map((l) => l.audio);
  v.steps.forEach((st) => {
    if (st.kind === 'watch') st.frames.forEach((f) => { if (f.say) out.push(f.say.audio); });
    else {
      out.push(st.item.prompt.audio);
      if (st.item.audio) out.push(st.item.audio);
    }
  });
  v.practice.forEach((it) => {
    out.push(it.prompt.audio);
    if (it.audio) out.push(it.audio);
  });
  out.push(v.rule.say.audio);
  return out;
}

export default function GrammarLesson() {
  const { lessonId } = useParams();
  const id = Number(lessonId);
  const navigate = useNavigate();
  const { play, stop, unlock, preload, playing, blocked, missing } = useLessonAudio();
  const { markShown, isAccidentalTap } = useAccidentalTapGuard();

  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState('');
  const [states, setStates] = useState<Record<string, ItemState>>({});
  const [finish, setFinish] = useState<Finish | null>(null);
  const [idx, setIdx] = useState(0);
  const [caption, setCaption] = useState<Say | null>(null);
  const [itemDone, setItemDone] = useState(false);
  const [sync, setSync] = useState(0);
  // 回调里要读最新的值(回调本身不想每次渲染都换一个)
  const viewRef = useRef<RunView | null>(null);
  const statesRef = useRef<Record<string, ItemState>>({});
  const finishRef = useRef<Finish | null>(null);

  const load = useCallback(async (fresh: boolean) => {
    setError('');
    setView(null);
    viewRef.current = null;
    if (!Number.isInteger(id) || id <= 0) {
      setError('没有这节课');
      return;
    }
    try {
      const v = await grammarApi.start(id, fresh);
      viewRef.current = v;
      statesRef.current = v.state;
      finishRef.current = v.finish;
      setStates(v.state);
      setFinish(v.finish);
      setIdx(0);
      setView(v);
      preload(soundsOf(v));       // 讲解和题目的声音先拉下来,点「下一步」时不用等
    } catch (e) {
      setError(getErrorMessage(e, '这节课没打开,稍后再试'));
    }
  }, [id, preload]);

  useEffect(() => { void load(false); }, [load]);

  const screens = useMemo(() => (view ? buildScreens(view) : []), [view]);
  const resumeAt = useMemo(() => (view ? resumeIndex(screens, view.state) : 1), [view, screens]);
  const screen: Screen | undefined = screens[idx];

  // 换了一屏: 换字幕、念这一屏的那句话
  useEffect(() => {
    const v = viewRef.current;
    const s = screens[idx];
    if (!v || !s) return;
    markShown();
    if (s.kind === 'intro') {
      setCaption(v.lines.start ?? null);
      void play(v.lines.start?.audio);
    } else if (s.kind === 'frame') {
      setCaption(s.frame.say);
      void play(s.frame.say?.audio);
    } else if (s.kind === 'practice') {
      setCaption(v.lines.practice ?? null);
      void play(v.lines.practice?.audio);
    } else if (s.kind === 'item') {
      const st = statesRef.current[s.item.key];
      setItemDone(!!st?.done);
      const line = st && !st.done && st.next ? st.next.prompt : s.item.prompt;
      setCaption(line);
      void play([line.audio, s.item.type === 'hear' && !st?.done ? s.item.audio : null]);
    } else {
      setCaption(v.rule.say);
      void play([v.rule.say.audio, finishRef.current?.say.audio]);
    }
    // 只在换屏 / 进度被服务器纠正时重来;别的值都从 ref 里读最新的
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, screens, sync]);

  // 小结那一屏却没有小结(进度是被服务器纠正过来的): 去取一次
  useEffect(() => {
    const v = viewRef.current;
    if (!v || screen?.kind !== 'finish' || finish) return;
    grammarApi.run(v.run_id).then((r) => {
      if (r.finish) {
        finishRef.current = r.finish;
        setFinish(r.finish);
      }
    }).catch(() => { /* 取不到就只显示规则那几排积木 */ });
  }, [screen?.kind, finish]);

  const goto = useCallback((n: number) => {
    stop();
    setIdx(Math.max(0, Math.min(n, screens.length - 1)));
  }, [screens.length, stop]);

  const next = useCallback(() => {
    if (isAccidentalTap()) return;
    goto(idx + 1);
  }, [goto, idx, isAccidentalTap]);

  const exit = useCallback(() => {
    stop();
    navigate(HOME);
  }, [navigate, stop]);

  const sayLine = useCallback((s: Say | null | undefined, more?: (string | null | undefined)[]) => {
    if (s) setCaption(s);
    void play([s?.audio, ...(more ?? [])]);
  }, [play]);

  const playUrl = useCallback((url: string) => { void play(url); }, [play]);

  const onAnswer = useCallback(async (key: string, part: number, answer: unknown): Promise<AnswerResult | null> => {
    const v = viewRef.current;
    if (!v) return null;
    try {
      const res = await grammarApi.answer(v.run_id, key, part, answer);
      const prev = statesRef.current[key] ?? BLANK;
      const merged = {
        ...statesRef.current,
        [key]: { ...prev, part: res.part, tries: res.tries, wrong: res.wrong, done: res.done },
      };
      statesRef.current = merged;
      setStates(merged);
      if (res.finish) {
        finishRef.current = res.finish;
        setFinish(res.finish);
      }
      return res;
    } catch (e) {
      const resp = (e as {
        response?: { status?: number; data?: { detail?: { state?: Record<string, ItemState>; finish?: Finish | null } } };
      }).response;
      const detail = resp?.data?.detail;
      if (resp?.status === 409 && detail && typeof detail === 'object' && detail.state) {
        // 进度变了(另一台设备做过 / 连点了两下): 按服务器的重摆这道题,不用告诉孩子出错了
        statesRef.current = detail.state;
        setStates(detail.state);
        if (detail.finish) {
          finishRef.current = detail.finish;
          setFinish(detail.finish);
        }
        setSync((n) => n + 1);
      } else {
        toast.error(getErrorMessage(e, '没交上,再点一次'));
      }
      return null;
    }
  }, []);

  const onItemDone = useCallback(() => {
    setItemDone(true);
    markShown();        // 「下一个」刚出来的那一瞬间,手指可能还在点题目
  }, [markShown]);

  let primary: { label: string; act: () => void } | null = null;
  if (view && screen) {
    if (screen.kind === 'intro') {
      primary = { label: view.resumed && resumeAt > 1 ? '接着学' : '开始', act: () => { unlock(); goto(resumeAt); } };
    } else if (screen.kind === 'frame') {
      primary = { label: '下一步', act: next };
    } else if (screen.kind === 'practice') {
      primary = { label: '开始练', act: next };
    } else if (screen.kind === 'item') {
      primary = itemDone ? { label: idx === screens.length - 2 ? '看小结' : '下一个', act: next } : null;
    } else {
      primary = { label: '回课表', act: exit };
    }
  }

  // 电脑上按回车 = 点大按钮(焦点在别的按钮上时不抢;按住不放不连跳)
  const primaryRef = useRef(primary);
  useEffect(() => { primaryRef.current = primary; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('button, input, textarea, a')) return;
      primaryRef.current?.act();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (error) {
    return (
      <div className="gb-root">
        <div className="gb-state">
          <p>{error}</p>
          <button type="button" className="gb-primary" onClick={() => { void load(false); }}>再试一次</button>
          <button type="button" className="gb-secondary" onClick={exit}>回课表</button>
        </div>
      </div>
    );
  }
  if (!view || !screen) {
    return (
      <div className="gb-root">
        <div className="gb-state" role="status">
          <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
          <p>正在打开这节课</p>
        </div>
      </div>
    );
  }

  const hearBlock = (_r: number, _i: number, b: Block) => {
    if (b.a) playUrl(`${view.media}/${b.a}.mp3`);
  };
  const label = screen.kind === 'finish' ? '小结'
    : screen.kind === 'item' && screen.practice ? `自己练 ${screen.n}/${view.practice.length}`
      : screen.kind === 'item' ? '跟着做'
        : screen.kind === 'practice' ? '自己练' : '看和听';
  const pct = Math.round((idx / Math.max(1, screens.length - 1)) * 100);

  let body: ReactNode;
  if (screen.kind === 'intro') {
    body = (
      <div className="gb-stage">
        <span className="gb-hero-no">第 {view.lesson.id % 100} 节</span>
        <h1 className="gb-hero-name">{view.lesson.name}</h1>
        <p className="gb-hero-title">{view.lesson.title}</p>
        <p className="gb-hero-goal">{view.lesson.goal}</p>
        {view.resumed && resumeAt > 1 && <p className="gb-zh">上次学到一半,接着来</p>}
      </div>
    );
  } else if (screen.kind === 'frame') {
    // 同一步「看和听」的几帧共用一个舞台(key 不变): 名字相同的积木会滑到新位置,孩子看得见是哪一块动了
    body = (
      <div className="gb-stage" key={screen.group}>
        {screen.frame.scene && <div className="gb-scene" aria-hidden="true">{screen.frame.scene}</div>}
        <BlockRows rows={screen.frame.rows} hl={screen.frame.hl} onTap={hearBlock} />
        {screen.frame.zh && <p className="gb-zh">{screen.frame.zh}</p>}
      </div>
    );
  } else if (screen.kind === 'practice') {
    body = (
      <div className="gb-stage">
        <div className="gb-big-emoji" aria-hidden="true">✍️</div>
        <h2 className="gb-hero-name">自己试一试</h2>
        <p className="gb-hero-goal">一共 {view.practice.length} 道。做错了没关系,小鹰老师会告诉你哪里不对。</p>
      </div>
    );
  } else if (screen.kind === 'item') {
    const item = screen.item;
    body = (
      <ItemStage
        key={`${item.key}:${sync}`}
        item={item}
        init={states[item.key] ?? BLANK}
        media={view.media}
        guard={isAccidentalTap}
        onAnswer={(part, answer) => onAnswer(item.key, part, answer)}
        say={sayLine}
        playUrl={playUrl}
        talking={playing}
        onDone={onItemDone}
      />
    );
  } else {
    body = (
      <div className="gb-stage">
        <div className="gb-big-emoji" aria-hidden="true">{!finish || finish.good ? '🎉' : '💪'}</div>
        {finish && (
          <>
            <p className="gb-score">自己练,一次做对 <b>{finish.first_right}</b> / {finish.total}</p>
            <div className="gb-dots" aria-hidden="true">
              {view.practice.map((it) => (
                <span key={it.key} className={`gb-dot ${states[it.key]?.wrong ? 'is-miss' : 'is-hit'}`} />
              ))}
            </div>
          </>
        )}
        <div className="gb-rule">
          <BlockRows rows={view.rule.rows} onTap={hearBlock} />
        </div>
        {finish && <p className="gb-hero-goal"><SayText text={finish.say.text} /></p>}
      </div>
    );
  }

  return (
    <div className="gb-root">
      <div className="gb-col gb-top">
        <button type="button" className="gb-icon" onClick={exit} aria-label="回课表">
          <X size={24} aria-hidden="true" />
        </button>
        <div className="gb-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
          aria-label="这节课上到哪了">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="gb-stagelabel">{label}</span>
      </div>

      <div className="gb-col">
        <div className="gb-caption">
          <img className={`gb-avatar${playing ? ' is-talking' : ''}`} src="/tutor-avatar.jpg" alt="" />
          <p className="gb-caption-text" role="status" aria-live="polite">
            {caption ? <SayText text={caption.text} /> : ' '}
            {blocked && <span className="gb-caption-note">点一下屏幕,打开声音</span>}
            {!blocked && missing && <span className="gb-caption-note">这节课的声音还没配好,先看字幕</span>}
          </p>
          <button type="button" className="gb-icon" aria-label="再听一遍"
            onClick={() => { if (caption) void play(caption.audio); }}>
            <Volume2 size={22} aria-hidden="true" />
          </button>
        </div>
      </div>

      <main className="gb-col gb-main">{body}</main>

      <div className="gb-col gb-foot">
        {primary && (
          <button type="button" className="gb-primary" onClick={primary.act}>{primary.label}</button>
        )}
        {screen.kind === 'finish' && (
          <button type="button" className="gb-secondary" onClick={() => { void load(true); }}>再学一遍</button>
        )}
      </div>
    </div>
  );
}
