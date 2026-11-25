/**
 * 句子积木怎么画: 一块积木、一排积木、小鹰老师说的一句话。
 *
 * 颜色和形状是服务器算好的(backend/app/grammar/blocks.py),这里只管画:
 * - 颜色看 r: 谁(橙)/ 是·干什么(蓝)/ 什么·怎么样(绿)/ 哪里·什么时候(黄)/ 小帮手(紫)/ 其它(灰)
 * - 形状看 k + ks: 「谁」那块朝后面伸出一个头(圆 / 尖 / 方),am is are 和动作词在同一边有一个同样形状的口。
 *   头和口对得上的两块会扣在一起 —— 规则做成看得见的样子(He 是尖头,只扣得上带尖口的 is / likes)
 * - 一块 = 左帽子 + 中间 + 右帽子。帽子是 SVG,口是真的挖空的(透明),后面什么底色都行
 */
import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Block, LinkKind, Role } from '../../api/grammar';
import './blocks.css';

export type PieceState = 'wrong' | 'dim' | 'point' | 'right' | 'bad';

const PALETTE: Record<Role, { fill: string; edge: string; ink: string }> = {
  w: { fill: '#ffb56b', edge: '#e2812a', ink: '#5a2a00' },
  d: { fill: '#8cc8ff', edge: '#4a97dc', ink: '#0b3a66' },
  o: { fill: '#9be39b', edge: '#52b052', ink: '#14501a' },
  p: { fill: '#ffe066', edge: '#d9ae1a', ink: '#5c4400' },
  h: { fill: '#d9b8ff', edge: '#a377de', ink: '#43207a' },
  n: { fill: '#e3e8ef', edge: '#b0bccb', ink: '#334155' },
  x: { fill: '#e3e8ef', edge: '#b0bccb', ink: '#334155' },
};

function vars(r: Role): CSSProperties {
  const c = PALETTE[r] ?? PALETTE.n;
  return { '--gb-c-fill': c.fill, '--gb-c-edge': c.edge, '--gb-c-ink': c.ink } as CSSProperties;
}

type CapKind = 'plain' | `mouth-${LinkKind}` | `head-${LinkKind}`;

/**
 * 左边帽子的轮廓(高 48 的格子里画的)。右边的帽子用同一条线左右翻过来。
 * 头伸出去 12–14 格、占半个积木高(11-15 浏览器里看过: 伸 9 格时手机上圆的、尖的、方的分不出来);
 * 口比头大一圈(每边 1.5 格),两块扣上以后中间留一道缝,看得出是「扣」上的。
 * 改这里的尺寸要同时改 blocks.css 的 .gb-wrap--lock(两块重叠多少)
 */
const CAPS: Record<CapKind, { w: number; d: string }> = {
  plain: { w: 12, d: 'M12 0H10Q0 0 0 10V38Q0 48 10 48H12Z' },
  'mouth-c': { w: 20, d: 'M20 0H6Q0 0 0 6V10.5A13.5 13.5 0 0 1 0 37.5V42Q0 48 6 48H20Z' },
  'mouth-t': { w: 20, d: 'M20 0H6Q0 0 0 6V8.5L15.5 24L0 39.5V42Q0 48 6 48H20Z' },
  'mouth-s': { w: 20, d: 'M20 0H6Q0 0 0 6V10.5H13.5V37.5H0V42Q0 48 6 48H20Z' },
  'head-c': { w: 22, d: 'M22 0H20Q14 0 14 6V12A12 12 0 0 0 14 36V42Q14 48 20 48H22Z' },
  'head-t': { w: 22, d: 'M22 0H20Q14 0 14 6V10L0 24L14 38V42Q14 48 20 48H22Z' },
  'head-s': { w: 22, d: 'M22 0H20Q14 0 14 6V12H2V36H14V42Q14 48 20 48H22Z' },
};

function Cap({ kind, flip }: { kind: CapKind; flip?: boolean }) {
  const c = CAPS[kind];
  return (
    <svg
      className={`gb-cap${flip ? ' gb-cap--flip' : ''}`}
      viewBox={`0 0 ${c.w} 48`}
      style={{ width: `calc(var(--gb-h) * ${c.w} / 48)` }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={c.d} />
    </svg>
  );
}

/** 这一块两边各是什么帽子。「谁」是头,别的(am is are / 动作词 / do does)是口 */
function capKinds(b: Block): [CapKind, CapKind] {
  if (!b.k || !b.ks) return ['plain', 'plain'];
  const kind: CapKind = b.r === 'w' ? `head-${b.k}` : `mouth-${b.k}`;
  return b.ks === 'l' ? [kind, 'plain'] : ['plain', kind];
}

/** 左边那块的头(或口)和右边那块的口(或头)对得上: 两块扣在一起 */
function locks(a: Block, b: Block): boolean {
  if (!a.k || !b.k || a.k !== b.k || a.ks !== 'r' || b.ks !== 'l') return false;
  return (a.r === 'w') !== (b.r === 'w');
}

interface PieceProps {
  block: Block;
  state?: PieceState;
  hl?: boolean;
  onTap?: () => void;
  disabled?: boolean;
  /** 标点也画成一块能点的积木(排句子那种题里,句号问号也要孩子自己放) */
  piece?: boolean;
}

export function BlockPiece({ block, state, hl, onTap, disabled, piece }: PieceProps) {
  if (block.slot) {
    return <span className="gb-slot" style={vars(block.r)} aria-label="空格">?</span>;
  }
  if (block.r === 'x' && !piece) {
    return <span className="gb-punct">{block.t}</span>;
  }
  const [left, right] = capKinds(block);
  const pointing = state === 'point';
  const cls = ['gb', hl ? 'is-hl' : '', state && !pointing ? `is-${state}` : ''].filter(Boolean).join(' ');
  const inner: ReactNode = (
    <>
      <Cap kind={left} />
      <span className="gb-body">
        {block.segs
          ? block.segs.map(([text, kind], i) => (
            <span key={`${i}${kind}`} className={kind ? `gb-${kind}` : undefined}>{text}</span>
          ))
          : block.t}
      </span>
      <Cap kind={right} flip />
    </>
  );
  const node = onTap ? (
    <button type="button" className={cls} style={vars(block.r)} onClick={onTap} disabled={disabled} aria-label={block.t}>
      {inner}
    </button>
  ) : (
    <span className={cls} style={vars(block.r)}>{inner}</span>
  );
  // 「👆」挂在外面一层: 挂在积木自己身上会被积木的投影滤镜一起描一道边
  return pointing ? <span className="gb-pt is-point">{node}</span> : node;
}

interface RowProps {
  blocks: Block[];
  /** 这一排的名字。同一排里同名的积木在画面变化时是「同一块」,会滑到新位置而不是消失再出现 */
  rowKey: string;
  hl?: string[];
  onTap?: (i: number, b: Block) => void;
  stateOf?: (i: number, b: Block) => PieceState | undefined;
  /** 每块前面画一个能点的空隙(把一块插进去的那种题) */
  gaps?: { onTap: (i: number) => void; stateOf?: (i: number) => 'wrong' | 'point' | undefined };
  disabled?: boolean;
}

export function BlockRow({ blocks, rowKey, hl, onTap, stateOf, gaps, disabled }: RowProps) {
  const lit = new Set(hl ?? []);
  // 标点跟着它前面那一块走(同一组): 一排放不下要换行时,句号不会孤零零掉到下一行
  const groups: number[][] = [];
  blocks.forEach((b, i) => {
    if (b.r === 'x' && groups.length) groups[groups.length - 1].push(i);
    else groups.push([i]);
  });
  const words = blocks.filter((b) => b.r !== 'x');
  const letters = words.reduce((n, b) => n + (b.slot ? 4 : Math.max(b.t.length, 2)), 0);
  // 一排放得下多大就画多大。先估这一排按正常大小(积木高 48)有多宽: 一个字母约 12px、一块约 30px 的边、块之间 8px;
  // 再对着最窄的手机(375 宽,能用的约 345)分档: 短句子(I am Amy.)放大,长句子缩一号、两号。
  // 11-15 实测: 只按词数分档时,四个词的句子(We don't play football.)在 375 宽度上会换行
  const est = letters * 12 + words.length * 30 + Math.max(0, words.length - 1) * 8 + 10;
  // 带空隙按钮的一排(每块前面多一个「+」)单独一档: 手机上不缩就排不成一行(句子断成两行)
  const size = gaps ? ' gb-row--gaps'
    : est > 394 ? ' gb-row--xtight'
      : est > 345 ? ' gb-row--tight'
        : est <= 276 ? ' gb-row--big' : '';
  const lockedAt = (first: number) => first > 0 && !gaps && locks(blocks[first - 1], blocks[first]);
  return (
    <div className={`gb-row${size}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        {groups.map((members) => {
          const first = members[0];
          const lock = lockedAt(first);
          // 这一组和前面或后面那组扣着,而且头长在这一组身上 → 压在上面
          // (头伸进了另一块的口里,那一小块地方点下去应该算点了带头的这块)
          const nextFirst = first + members.length;
          const headOnTop = blocks[first].r === 'w'
            && (lock || (nextFirst < blocks.length && lockedAt(nextFirst)));
          return (
            <motion.span
              key={`${rowKey}:${blocks[first].id}`}
              layout="position"
              className={`gb-wrap${lock ? ' gb-wrap--lock' : ''}${headOnTop ? ' gb-wrap--top' : ''}`}
              initial={{ opacity: 0, scale: 0.4, y: -18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              {members.map((i) => {
                const b = blocks[i];
                const gapState = gaps?.stateOf?.(i);
                return (
                  <span key={b.id} className={`gb-unit${b.r === 'x' ? ' gb-unit--x' : ''}`}>
                    {gaps && (
                      <button
                        type="button"
                        className={`gb-gap${gapState ? ` is-${gapState}` : ''}`}
                        onClick={() => gaps.onTap(i)}
                        disabled={disabled}
                        aria-label={b.r === 'x' ? '放在句子最后' : `放在「${b.t}」前面`}
                      >
                        +
                      </button>
                    )}
                    <BlockPiece
                      block={b}
                      hl={lit.has(b.id.split('~')[0])}
                      state={stateOf?.(i, b)}
                      onTap={onTap && b.r !== 'x' && !b.slot ? () => onTap(i, b) : undefined}
                      disabled={disabled}
                    />
                  </span>
                );
              })}
            </motion.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** 几排积木(一帧画面 / 一道题的句子) */
export function BlockRows({ rows, hl, onTap, stateOf, disabled }: {
  rows: Block[][];
  hl?: string[];
  onTap?: (r: number, i: number, b: Block) => void;
  stateOf?: (r: number, i: number, b: Block) => PieceState | undefined;
  disabled?: boolean;
}) {
  return (
    <div className="gb-rows">
      {rows.map((row, r) => (
        <BlockRow
          key={`r${r}`}
          rowKey={`r${r}`}
          blocks={row}
          hl={hl}
          onTap={onTap ? (i, b) => onTap(r, i, b) : undefined}
          stateOf={stateOf ? (i, b) => stateOf(r, i, b) : undefined}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

/** 小鹰老师说的一句: {花括号} 里的英文加粗换字体,花括号不显示 */
export function SayText({ text }: { text: string }) {
  const parts = text.split(/(\{[^{}]*\})/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('{') && p.endsWith('}')
        ? <b key={`${i}${p}`} className="gb-en">{p.slice(1, -1)}</b>
        : <span key={`${i}${p}`}>{p}</span>))}
    </>
  );
}
