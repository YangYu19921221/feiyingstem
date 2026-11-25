/**
 * 一道题(七种,都是点一点,不用打字)。题目的样子、判分都在服务器(backend/app/grammar/items.py):
 * 这里只管摆出来、把孩子点的那一下交上去、按服务器回的结果摆。
 *
 *   pick  选一块放进空格          hear  听一句,选是哪张图
 *   tap   点出某一块              gap   点一个空隙,把一块插进去
 *   order 把几块排成一句          sort  一块一块分到两个筐里(一块交一次)
 *   fix   小鹰同学拼错了: 先点出错的那块,再挑一块换上(交两次)
 *
 * 错了: 那个东西抖一下 + 小鹰老师说这一种错法的那句话;同一步错够次数,服务器把答案指出来(show),
 * 页面在那上面画一个「👆」,还是要孩子自己点。做完: 摆出整句,读一遍。
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Volume2 } from 'lucide-react';
import type { AnswerResult, Block, Item, ItemState, NextPart, Pos, Reveal, Say } from '../../api/grammar';
import { BlockPiece, BlockRow, BlockRows, type PieceState } from './BlockView';

interface Props {
  item: Item;
  /** 进来时这道题做到哪了(接着上次的 / 进度被服务器纠正过) */
  init: ItemState;
  /** 声音文件的目录 */
  media: string;
  /** 这一下是不是误触(刚换题那一瞬间的余点) */
  guard: () => boolean;
  /** 交一次。交不上(网络 / 进度变了)回 null,外面已经提示过 */
  onAnswer: (part: number, answer: unknown) => Promise<AnswerResult | null>;
  /** 换字幕并念出来,后面还可以接着放几段声音 */
  say: (s: Say | null | undefined, more?: (string | null | undefined)[]) => void;
  /** 只放声音(点一块积木听它怎么读) */
  playUrl: (url: string) => void;
  talking: boolean;
  onDone: () => void;
}

function isPos(v: unknown, r: number, i: number): boolean {
  return !!v && typeof v === 'object' && (v as Pos).r === r && (v as Pos).i === i;
}

export default function ItemStage({ item, init, media, guard, onAnswer, say, playUrl, talking, onDone }: Props) {
  const [part, setPart] = useState(init.part);
  const [show, setShow] = useState<unknown>(init.show ?? null);
  const [shake, setShake] = useState<string | null>(null);
  const [dim, setDim] = useState<string[]>([]);
  const [fixNext, setFixNext] = useState<NextPart | null>(init.next ?? null);
  const [bad, setBad] = useState<Pos | null>(init.bad ?? null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [done, setDone] = useState(init.done);
  const [busy, setBusy] = useState(false);
  const [tray, setTray] = useState<number[]>(
    item.type === 'order' && Array.isArray(init.show) ? (init.show as number[]) : [],
  );
  const [got, setGot] = useState<Block[][]>([[], []]);

  const hear = (b: Block) => { if (b.a) playUrl(`${media}/${b.a}.mp3`); };

  /** 这个东西现在该是什么样: 抖 / 被指着 / 点错过变淡 */
  const st = (mark: string, pointed: boolean): PieceState | undefined => {
    if (shake === mark) return 'wrong';
    if (pointed) return 'point';
    if (dim.includes(mark)) return 'dim';
    return undefined;
  };

  const submit = async (answer: unknown, mark: string, fade = false) => {
    if (busy || done || guard()) return;
    setBusy(true);
    const res = await onAnswer(part, answer);
    setBusy(false);
    if (!res) return;

    if (!res.ok) {
      setShake(mark);
      window.setTimeout(() => setShake((s) => (s === mark ? null : s)), 450);
      if (fade) setDim((d) => (d.includes(mark) ? d : [...d, mark]));
      const shown = res.show !== undefined && res.show !== null;
      if (shown) {
        setShow(res.show);
        // 排句子: 直接帮他按对的顺序摆好,让他自己点「排好了」
        if (item.type === 'order' && Array.isArray(res.show)) setTray(res.show as number[]);
      }
      const line = shown && item.type !== 'order' && res.show_say ? res.show_say : res.hint;
      say(line, item.type === 'hear' ? [item.audio] : undefined);
      return;
    }

    setShow(null);
    setDim([]);
    if (item.type === 'sort' && item.items) {
      const b = item.items[part];
      const bin = Number(answer) === 1 ? 1 : 0;
      setGot((g) => g.map((list, n) => (n === bin ? [...list, b] : list)));
    }
    if (res.done) {
      setDone(true);
      setReveal(res.reveal ?? null);
      say(res.praise, [res.reveal?.audio]);
      onDone();
      return;
    }
    setPart(res.part);
    if (item.type === 'fix') {
      setBad(answer as Pos);
      setFixNext(res.next ?? null);
      say(res.next?.prompt);
    } else if (item.type === 'sort' && item.items) {
      const nextBlock = item.items[res.part];
      if (nextBlock) hear(nextBlock);
    }
  };

  const scene = item.scene ? <div className="gb-scene" aria-hidden="true">{item.scene}</div> : null;
  const zh = item.zh ? <p className="gb-zh">{item.zh}</p> : null;
  const rows = reveal ? reveal.rows : item.rows ?? [];
  const hearRow = (_r: number, _i: number, b: Block) => hear(b);

  // ---------------------------------------------------------------- 选一块放进空格
  if (item.type === 'pick') {
    return (
      <>
        <div className="gb-stage">
          {scene}
          <BlockRows rows={rows} onTap={hearRow} />
          {zh}
        </div>
        {!done && (
          <div className="gb-controls">
            <div className="gb-options" role="group" aria-label="选一块">
              {(item.options ?? []).map((o, i) => (
                <BlockPiece key={o.id} block={o} state={st(`o${i}`, show === i)} disabled={busy}
                  onTap={() => { void submit(i, `o${i}`, true); }} />
              ))}
            </div>
          </div>
        )}
      </>
    );
  }

  // ---------------------------------------------------------------- 听一句,选是哪张图
  if (item.type === 'hear') {
    return (
      <>
        <div className="gb-stage">
          {done && reveal ? <BlockRows rows={reveal.rows} onTap={hearRow} /> : (
            <button type="button" className={`gb-speaker${talking ? ' is-talking' : ''}`} aria-label="再听一遍"
              onClick={() => { if (item.audio) playUrl(item.audio); }}>
              <Volume2 size={44} strokeWidth={2.4} aria-hidden="true" />
            </button>
          )}
        </div>
        {!done && (
          <div className="gb-controls">
            <div className="gb-cards" role="group" aria-label="选一张图">
              {(item.cards ?? []).map((c, i) => {
                const s = st(`c${i}`, show === i);
                return (
                  <button key={`${c.emoji}${c.zh}`} type="button" className={`gb-card${s ? ` is-${s}` : ''}`} disabled={busy}
                    onClick={() => { void submit(i, `c${i}`, true); }}>
                    <span className="gb-card-emoji" aria-hidden="true">{c.emoji}</span>
                    <span className="gb-card-zh">{c.zh}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  }

  // ---------------------------------------------------------------- 点出某一块
  if (item.type === 'tap') {
    return (
      <div className="gb-stage">
        {scene}
        <BlockRows
          rows={rows}
          disabled={busy}
          onTap={done ? hearRow : (r, i) => { void submit({ r, i }, `b${r}-${i}`); }}
          stateOf={done ? undefined : (r, i) => st(`b${r}-${i}`, isPos(show, r, i))}
        />
        {zh}
      </div>
    );
  }

  // ---------------------------------------------------------------- 点一个空隙,把一块插进去
  if (item.type === 'gap') {
    return (
      <div className="gb-stage">
        {scene}
        {!done && item.insert && (
          <div className="gb-insert">
            <BlockPiece block={item.insert} onTap={() => { if (item.insert) hear(item.insert); }} />
            <span className="gb-insert-arrow" aria-hidden="true">▼</span>
          </div>
        )}
        <div className="gb-rows">
          {rows.slice(0, 1).map((row) => (
            <BlockRow
              key="r0"
              rowKey="r0"
              blocks={row}
              disabled={busy}
              onTap={done ? (_i, b) => hear(b) : undefined}
              gaps={done ? undefined : {
                onTap: (i) => { void submit(i, `g${i}`); },
                stateOf: (i) => {
                  const s = st(`g${i}`, show === i);
                  return s === 'wrong' || s === 'point' ? s : undefined;
                },
              }}
            />
          ))}
        </div>
        {zh}
      </div>
    );
  }

  // ---------------------------------------------------------------- 把几块排成一句
  if (item.type === 'order') {
    const pool = item.pool ?? [];
    return (
      <>
        <div className="gb-stage">
          {scene}
          {zh}
          {done && reveal ? <BlockRows rows={reveal.rows} onTap={hearRow} /> : (
            <div className={`gb-tray${shake === 'tray' ? ' is-wrong' : ''}`} aria-label="你排的句子">
              {tray.length === 0 && <span className="gb-tray-hint">点下面的积木,排成一句话</span>}
              <AnimatePresence initial={false}>
                {tray.map((pi) => (
                  <motion.span key={pool[pi].id} layout="position" initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
                    <BlockPiece block={pool[pi]} piece disabled={busy}
                      onTap={() => setTray((t) => t.filter((x) => x !== pi))} />
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
        {!done && (
          <div className="gb-controls">
            <div className="gb-options gb-options--pool" role="group" aria-label="可以用的积木">
              {pool.map((b, i) => (
                <span key={b.id} className={tray.includes(i) ? 'gb-hidden' : undefined} aria-hidden={tray.includes(i)}>
                  <BlockPiece block={b} piece disabled={busy || tray.includes(i)}
                    onTap={() => { hear(b); setTray((t) => (t.includes(i) ? t : [...t, i])); }} />
                </span>
              ))}
            </div>
            <button type="button" className={`gb-primary${show !== null ? ' is-ready' : ''}`}
              disabled={busy || tray.length === 0} onClick={() => { void submit(tray, 'tray'); }}>
              排好了
            </button>
          </div>
        )}
      </>
    );
  }

  // ---------------------------------------------------------------- 一块一块分到两个筐里
  if (item.type === 'sort') {
    const list = item.items ?? [];
    const cur = !done ? list[part] : undefined;
    return (
      <>
        <div className="gb-stage">
          <AnimatePresence mode="wait" initial={false}>
            {cur && (
              <motion.div key={cur.id} className={`gb-cur${shake === 'cur' ? ' is-wrong' : ''}`}
                initial={{ opacity: 0, scale: 0.5, y: -20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5, y: 50 }} transition={{ duration: 0.22 }}>
                <BlockPiece block={cur} onTap={() => hear(cur)} />
              </motion.div>
            )}
          </AnimatePresence>
          <p className="gb-sort-count">{Math.min(part + (done ? 0 : 1), list.length)} / {list.length}</p>
        </div>
        <div className="gb-controls">
          <div className="gb-bins" role="group" aria-label="两个筐">
            {(item.bins ?? []).map((b, i) => {
              const s = st(`n${i}`, !done && show === i);
              return (
                <button key={b.label} type="button" className={`gb-bin${s === 'point' ? ' is-point' : ''}`}
                  disabled={busy || done} onClick={() => { void submit(i, 'cur'); }}>
                  <span className="gb-bin-label">{b.label}</span>
                  {b.sub && <span className="gb-bin-sub">{b.sub}</span>}
                  <span className="gb-bin-got">
                    {got[i].map((x) => <BlockPiece key={x.id} block={x} />)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------- 小鹰同学拼错了: 点出错的那块,再换一块
  const fixing = !done && part === 1;
  return (
    <>
      <div className="gb-stage">
        {!done && <span className="gb-tag">小鹰同学拼的</span>}
        {scene}
        <BlockRows
          rows={rows}
          disabled={busy}
          onTap={done ? hearRow : part === 0 ? (r, i) => { void submit({ r, i }, `b${r}-${i}`); } : undefined}
          stateOf={done ? undefined : (r, i) => {
            if (fixing) return bad && bad.r === r && bad.i === i ? 'bad' : undefined;
            return st(`b${r}-${i}`, isPos(show, r, i));
          }}
        />
        {zh}
      </div>
      {fixing && fixNext && (
        <div className="gb-controls">
          <div className="gb-options" role="group" aria-label="换成哪一块">
            {fixNext.options.map((o, i) => (
              <BlockPiece key={o.id} block={o} state={st(`o${i}`, show === i)} disabled={busy}
                onTap={() => { void submit(i, `o${i}`, true); }} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
