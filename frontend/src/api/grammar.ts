/**
 * 语法小课「句子积木」。规则真源 backend/app/services/grammar_course.py 文件头;
 * 积木的写法 / 颜色 / 形状真源 backend/app/grammar/blocks.py,七种题真源 backend/app/grammar/items.py。
 * 答案只在服务器: 这里拿到的题没有答案,孩子每点一下交一次。
 */
import client from './client';

/** 积木的颜色: w 谁 / d 是·干什么 / o 什么·怎么样 / p 哪里·什么时候 / h 小帮手(do does not)/ n 其它小词 / x 标点 */
export type Role = 'w' | 'd' | 'o' | 'p' | 'h' | 'n' | 'x';
/** 形状: c 圆的(I · am)/ t 尖的(他她它 · is · likes · does)/ s 方的(你 · 好几个 · are) */
export type LinkKind = 'c' | 't' | 's';

export interface Block {
  /** 动画里认「同一块」用的名字(原形: am / is / are 都是 be) */
  id: string;
  t: string;
  r: Role;
  /** 要孩子填的空 */
  slot?: boolean;
  /** 一块里分开上色的几段: [文字, '' | 'tail' 尾巴 | 'neg' 否定] */
  segs?: [string, '' | 'tail' | 'neg'][];
  /** 形状,和它在哪一边 */
  k?: LinkKind;
  ks?: 'l' | 'r';
  /** 读音文件名(不带目录和 .mp3) */
  a?: string;
}

/** 小鹰老师说的一句: 中文里用 {花括号} 包着英文 */
export interface Say {
  text: string;
  audio: string;
}

export interface Frame {
  say: Say | null;
  rows: Block[][];
  scene: string | null;
  zh: string | null;
  /** 要亮起来的积木(按 id 的原形) */
  hl: string[];
}

export type ItemType = 'pick' | 'hear' | 'tap' | 'gap' | 'order' | 'sort' | 'fix';

export interface Item {
  key: string;
  type: ItemType;
  level: number;
  /** 这道题要交几次(分筐: 一块一次;改错: 两次) */
  parts: number;
  prompt: Say;
  scene: string | null;
  zh: string | null;
  rows?: Block[][];
  options?: Block[];
  /** 听句选图: 那一句的声音 */
  audio?: string;
  cards?: { emoji: string; zh: string }[];
  ask?: 'odd' | 'extra' | 'front';
  insert?: Block;
  pool?: Block[];
  bins?: { label: string; sub: string | null; k: LinkKind | null }[];
  items?: Block[];
}

export type Step = { kind: 'watch'; frames: Frame[] } | { kind: 'item'; item: Item };

export interface Pos {
  r: number;
  i: number;
}

export interface NextPart {
  options: Block[];
  prompt: Say;
}

export interface ItemState {
  part: number;
  tries: number;
  wrong: number;
  done: boolean;
  /** 改错题做到第二步时: 第二步的选项 */
  next?: NextPart | null;
  /** 改错题第一步已经点对的那一块 */
  bad?: Pos;
  /** 同一步错够了次数,服务器指给他看的答案(和交上去的同一种格式) */
  show?: unknown;
}

export interface Reveal {
  rows: Block[][];
  en: string;
  audio: string;
}

export interface Finish {
  total: number;
  first_right: number;
  good: boolean;
  say: Say;
}

export interface LessonBrief {
  id: number;
  name: string;
  title: string;
  goal: string;
  practice_count: number;
}

export interface RunView {
  run_id: number;
  version: number;
  /** 接着上次没上完的 */
  resumed: boolean;
  lesson: LessonBrief;
  /** 声音文件的目录 */
  media: string;
  lines: Record<string, Say>;
  steps: Step[];
  practice: Item[];
  rule: { rows: Block[][]; say: Say };
  state: Record<string, ItemState>;
  finish: Finish | null;
  show_after: number;
}

export interface AnswerResult {
  ok: boolean;
  done: boolean;
  part: number;
  tries: number;
  wrong: number;
  version: number;
  hint?: Say;
  show?: unknown;
  show_say?: Say;
  next?: NextPart | null;
  reveal?: Reveal | null;
  praise?: Say;
  finish: Finish | null;
}

export interface RunState {
  run_id: number;
  version: number;
  state: Record<string, ItemState>;
  finish: Finish | null;
}

export interface LessonRow extends LessonBrief {
  done: boolean;
  times: number;
  best: number | null;
}

export interface LessonsView {
  enabled: boolean;
  reason: string;
  /** 老师 / 管理员在试课(学生还看不到) */
  preview: boolean;
  /** 管理端首页 / 教师工作台上放不放入口(样课阶段: 平台管理员和直营老师) */
  entry: boolean;
  lines: { id: string; name: string; sub: string; lessons: LessonRow[] }[];
}

export const grammarApi = {
  lessons: () => client.get<LessonsView>('/student/grammar/lessons'),
  start: (lessonId: number, fresh = false) =>
    client.post<RunView>(`/student/grammar/lessons/${lessonId}/start`, { fresh }),
  run: (runId: number) => client.get<RunState>(`/student/grammar/runs/${runId}`),
  answer: (runId: number, key: string, part: number, answer: unknown) =>
    client.post<AnswerResult>(`/student/grammar/runs/${runId}/answer`, { key, part, answer }),
};
