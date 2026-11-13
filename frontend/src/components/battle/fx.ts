/**
 * 宠物对战: 一回合的招式怎么排(纯数据,不引用 three.js —— 对战页外壳要用它,不能把 3D 库拖进主包)。
 *
 * 规矩:
 * 1. **每一方一回合最多挨一记**: 对手打过来的伤害和自己答错扣的 10 点合成一记演。
 *    以前分开演,一回合最多四记,孩子看不清谁打了谁。后端 core/pet_formulas.round_fx_counts 是同一套合并规则
 *    (它按这个数算几秒后发下一题),改这里要一起改。
 * 2. 先出招的是答得快的那一方;答错被反击的排在真正的攻击后面。
 * 3. 时间全部从 config/petSpecies 的常量来(与后端同值,有测试比对)。
 */
import type { Battle, RoundResult } from '../../api/petBattle';
import {
  EFFECT_STEP_NORMAL,
  EFFECT_STEP_ULTIMATE,
  FX_TAIL,
  IMPACT_AT_NORMAL,
  IMPACT_AT_ULTIMATE,
  getPetDefinition,
  getPetImage,
  getSkillVfxRecipe,
  type PetElement,
  type SkillParticle,
  type SkillSkeleton,
} from '../../config/petSpecies';

/** 1 = 我(画面左前方),2 = 对手(右后方) */
export type Side = 1 | 2;
export type FxKind = 'normal' | 'ultimate' | 'backfire';
/** 普通攻击的三种打法: 冲过去撞 / 打出一发 / 原地发力在对方脚下炸开 */
export type AttackMode = 'dash' | 'shot' | 'burst';

export interface BattleFx {
  id: string;
  kind: FxKind;
  attacker: Side;
  target: Side;
  /** 这一记让 target 掉多少血(对手的攻击 + 自己答错扣的,合在一起) */
  damage: number;
  /** 这一记打完 target 还剩多少血 */
  hpAfter: number;
  /** 出招的宠物 */
  species: string;
  element: PetElement;
  mode: AttackMode;
  /** 主色 / 内芯色(十六进制) */
  color: string;
  core: string;
  particle?: SkillParticle;
  skeleton?: SkillSkeleton;
  shake: 'light' | 'medium' | 'heavy';
  /** 伤害数字下面那行小字: 属性克制 / 答错被反击 */
  text?: string;
  skillName?: string;
  cutIn?: string;
  /** 这一记从回合开演算起第几秒起手、第几秒打中 */
  start: number;
  impact: number;
  /** 这一记把 target 的血打空了 */
  ko: boolean;
  /** 出招的一方选了「重击」: 命中更重 */
  heavy?: boolean;
  /** 挨打的一方选了「防守」: 身前亮一下护盾,被打退得少 */
  guarded?: boolean;
}

/** 结果一到先留一拍再起手: 孩子的眼睛要从答题区挪回战场 */
export const FX_LEAD_IN = 0.12;

const ELEMENT_LOOK: Record<PetElement, { color: string; mode: AttackMode; particle: SkillParticle }> = {
  normal: { color: '#ffd9a8', mode: 'dash', particle: 'star' },
  fire: { color: '#ff8a3c', mode: 'shot', particle: 'ember' },
  water: { color: '#38d6f5', mode: 'shot', particle: 'bubble' },
  grass: { color: '#8fdc3a', mode: 'shot', particle: 'leaf' },
  electric: { color: '#5cc8ff', mode: 'shot', particle: 'spark' },
  ice: { color: '#b4f1ff', mode: 'shot', particle: 'ice' },
  fighting: { color: '#ff5a4a', mode: 'dash', particle: 'shard' },
  poison: { color: '#c58bff', mode: 'shot', particle: 'wisp' },
  ground: { color: '#e08a2c', mode: 'dash', particle: 'shard' },
  flying: { color: '#c9eeff', mode: 'dash', particle: 'petal' },
  psychic: { color: '#f08cff', mode: 'burst', particle: 'star' },
  bug: { color: '#b4ea4a', mode: 'dash', particle: 'leaf' },
  rock: { color: '#c79a52', mode: 'dash', particle: 'shard' },
  ghost: { color: '#a98cff', mode: 'burst', particle: 'wisp' },
  dragon: { color: '#8b95ff', mode: 'dash', particle: 'star' },
  dark: { color: '#8ea0c0', mode: 'dash', particle: 'wisp' },
  steel: { color: '#d7e2ee', mode: 'dash', particle: 'metal' },
  fairy: { color: '#ffb0d6', mode: 'burst', particle: 'petal' },
};

export function elementLook(element: PetElement) {
  return ELEMENT_LOOK[element] ?? ELEMENT_LOOK.normal;
}

// ---------------------------------------------------------------- 场地

export type ArenaId = 'meadow' | 'volcano' | 'snow' | 'beach' | 'moon' | 'storm' | 'canyon' | 'sky';

export const ARENA_IMAGE: Record<ArenaId, string> = {
  meadow: '/battle-arena/meadow.jpg',
  volcano: '/battle-arena/volcano.jpg',
  snow: '/battle-arena/snow.jpg',
  beach: '/battle-arena/beach.jpg',
  moon: '/battle-arena/moon.jpg',
  storm: '/battle-arena/storm.jpg',
  canyon: '/battle-arena/canyon.jpg',
  sky: '/battle-arena/sky.jpg',
};

export const ARENA_NAME: Record<ArenaId, string> = {
  meadow: '青草原', volcano: '熔岩地', snow: '极光雪原', beach: '浅滩', moon: '月光林地',
  storm: '雷暴高地', canyon: '红岩峡谷', sky: '云上神殿',
};

const ELEMENT_ARENA: Record<PetElement, ArenaId> = {
  normal: 'meadow', grass: 'meadow', bug: 'meadow', fairy: 'meadow',
  fire: 'volcano', dragon: 'volcano',
  ice: 'snow',
  water: 'beach',
  ghost: 'moon', dark: 'moon', psychic: 'moon', poison: 'moon',
  electric: 'storm', steel: 'storm',
  ground: 'canyon', rock: 'canyon', fighting: 'canyon',
  flying: 'sky',
};

/** 这一场在哪儿打: 双方属性各对应一块场地,按对战编号定用哪一块(同一场每次进来是同一块) */
export function pickArena(battleId: number, myElement: PetElement, oppElement: PetElement): ArenaId {
  const pair = [ELEMENT_ARENA[myElement] ?? 'meadow', ELEMENT_ARENA[oppElement] ?? 'meadow'];
  return pair[Math.abs(battleId) % 2];
}

/** 由场地图的地址认出是哪块场地(对战页只把图的地址传给战场) */
export function arenaIdOf(url: string): ArenaId | null {
  const hit = (Object.keys(ARENA_IMAGE) as ArenaId[]).find((id) => ARENA_IMAGE[id] === url);
  return hit ?? null;
}

// ---------------------------------------------------------------- 场地里一直飘着的东西

/**
 * 雪 / 火星 / 雨点 / 萤火虫 …: 飘在镜头和宠物之间的立体空间里,离镜头近的大、远的小,
 * 镜头一动它们错开得最明显 —— 平面的画靠它有了「前后」。
 */
export interface Ambience {
  /** fall 从上往下落 / rise 从地面往上升 / drift 横着飘 / wander 原地慢慢游 */
  kind: 'fall' | 'rise' | 'drift' | 'wander';
  color: string;
  /** 每秒出几个(低配机减半;系统开了「减少动态效果」不出) */
  rate: number;
  size: number;
  speed: number;
  /** 一个能飘几秒 */
  life: number;
  /** 雷暴高地: 隔一阵天边亮一下(很轻,一次只亮一下,不连闪) */
  lightning?: boolean;
  /** 只飘在离镜头这么远以外(世界坐标 z 的上限,默认 6.5)。雨点贴着镜头是一个个大圆球,不像雨 */
  maxZ?: number;
}

export const ARENA_AMBIENCE: Record<ArenaId, Ambience> = {
  meadow: { kind: 'drift', color: '#fff3b8', rate: 5, size: 0.11, speed: 0.55, life: 6, maxZ: 5 },
  volcano: { kind: 'rise', color: '#ff9a3c', rate: 9, size: 0.15, speed: 1.3, life: 3.6, maxZ: 5 },
  snow: { kind: 'fall', color: '#ffffff', rate: 14, size: 0.14, speed: 1.5, life: 5, maxZ: 5.5 },
  beach: { kind: 'rise', color: '#c8f4ff', rate: 4, size: 0.12, speed: 0.5, life: 5, maxZ: 5 },
  moon: { kind: 'wander', color: '#d8ff8a', rate: 3, size: 0.16, speed: 0.35, life: 7, maxZ: 5 },
  storm: { kind: 'fall', color: '#bcd4ff', rate: 60, size: 0.085, speed: 19, life: 0.5, lightning: true, maxZ: 1.5 },
  canyon: { kind: 'drift', color: '#ffd9a0', rate: 6, size: 0.12, speed: 1.4, life: 5, maxZ: 5 },
  sky: { kind: 'rise', color: '#ffffff', rate: 5, size: 0.14, speed: 0.7, life: 5, maxZ: 5 },
};

// ---------------------------------------------------------------- 一回合的招式

function sideOf(serverPlayer: 1 | 2, iAmPlayer1: boolean): Side {
  return serverPlayer === (iAmPlayer1 ? 1 : 2) ? 1 : 2;
}

export function buildRoundFx(result: RoundResult, before: Battle, iAmPlayer1: boolean): BattleFx[] {
  const p = {
    1: {
      damage: result.player1_damage, ult: result.player1_used_ultimate, text: result.player1_type_text,
      time: result.player1_time_ms ?? 99999, hpAfter: result.player1_hp_after, pet: before.player1_pet,
      stance: result.player1_stance, guarded: !!result.player1_guarded, spell: result.player1_spell,
    },
    2: {
      damage: result.player2_damage, ult: result.player2_used_ultimate, text: result.player2_type_text,
      time: result.player2_time_ms ?? 99999, hpAfter: result.player2_hp_after, pet: before.player2_pet,
      stance: result.player2_stance, guarded: !!result.player2_guarded, spell: result.player2_spell,
    },
  } as const;

  type Draft = Omit<BattleFx, 'start' | 'impact'> & { order: number };
  const drafts: Draft[] = [];
  ([[1, 2], [2, 1]] as const).forEach(([a, t]) => {
    const atk = p[a];
    const def = p[t];
    const attack = atk.damage > 0 ? atk.damage : 0;
    const selfHit = def.damage < 0 ? -def.damage : 0;
    if (attack + selfHit <= 0) return;
    const kind: FxKind = attack > 0 ? (atk.ult ? 'ultimate' : 'normal') : 'backfire';
    const species = atk.pet.species;
    const def0 = getPetDefinition(species);
    const look = elementLook(def0.element);
    const recipe = getSkillVfxRecipe(species);
    const target = sideOf(t, iAmPlayer1);
    const isUlt = kind === 'ultimate';
    // 伤害数字下面那行小字,最多两段: 属性克制 / 重击 / 快答 / 被防住 / 咒语没念对
    const heavy = kind === 'normal' && atk.stance === 'heavy';
    const guarded = attack > 0 && def.guarded;
    // 我自己 5 秒内答对的普通攻击: 服务端给了速度加成(3 秒内 +10 / 5 秒内 +5,大招没有),写出来让孩子知道快有用
    const quick = kind === 'normal' && target === 2 && atk.time < 5000 ? '快答加成' : '';
    // 想放大招、咒语没拼对: 这一记只是普通攻击
    const fizzled = kind === 'normal' && target === 2 && atk.spell && atk.spell.ok === false;
    let text: string | undefined;
    if (kind === 'backfire') {
      text = target === 1
        ? (def.stance === 'heavy' ? '重击打空,被反击' : '答错,被反击')
        : '对手答错,趁机反击';
    } else {
      const parts = [
        fizzled ? '咒语没念对' : '',
        atk.text || '',
        heavy ? '重击' : '',
        guarded ? (target === 1 ? '防住了一部分' : '被防住一部分') : '',
        quick,
      ].filter(Boolean).slice(0, 2);
      if (parts.length) text = parts.join(' · ');
      else if (selfHit > 0) text = target === 1 ? '答错,多挨一下' : undefined;
    }
    drafts.push({
      id: `${result.round_number}-${a}`,
      kind,
      attacker: sideOf(a, iAmPlayer1),
      target,
      damage: attack + selfHit,
      hpAfter: Math.max(0, def.hpAfter),
      species,
      element: def0.element,
      mode: look.mode,
      color: isUlt ? recipe.color : look.color,
      core: isUlt ? recipe.core || '#ffffff' : '#ffffff',
      particle: isUlt ? recipe.particle ?? look.particle : look.particle,
      skeleton: isUlt ? recipe.skeleton : undefined,
      shake: isUlt ? recipe.shake || 'medium' : heavy ? 'medium' : 'light',
      heavy,
      guarded,
      text,
      skillName: isUlt ? def0.ultimate.name : undefined,
      cutIn: isUlt ? getPetImage(species, atk.pet.evolution_stage) : undefined,
      ko: def.hpAfter <= 0,
      // 真正的攻击按答题快慢排,答错被反击的排最后;一样快时我先出手
      order: (kind === 'backfire' ? 1_000_000 : 0) + atk.time + (sideOf(a, iAmPlayer1) === 1 ? 0 : 0.5),
    });
  });
  drafts.sort((x, y) => x.order - y.order);

  let t = FX_LEAD_IN;
  return drafts.map((draft) => {
    const d: Omit<Draft, 'order'> & { order?: number } = { ...draft };
    delete d.order;
    const isUlt = d.kind === 'ultimate';
    const fx: BattleFx = { ...d, start: t, impact: t + (isUlt ? IMPACT_AT_ULTIMATE : IMPACT_AT_NORMAL) };
    t += isUlt ? EFFECT_STEP_ULTIMATE : EFFECT_STEP_NORMAL;
    return fx;
  });
}

/** 这一回合的招式一共演多久(秒);没有招式是 0 */
export function roundDuration(fx: BattleFx[]): number {
  if (!fx.length) return 0;
  const last = fx[fx.length - 1];
  return last.start + (last.kind === 'ultimate' ? EFFECT_STEP_ULTIMATE : EFFECT_STEP_NORMAL) + FX_TAIL;
}

// ---------------------------------------------------------------- 声音提示点(3D 和平面两种战场共用)

export type SfxName =
  | 'tap' | 'arm' | 'ready' | 'whoosh' | 'shot' | 'hit' | 'hitHeavy' | 'backfire' | 'cutin' | 'charge'
  | 'zap' | 'roar' | 'splash' | 'shimmer' | 'swish' | 'ko' | 'correct' | 'wrong' | 'tick' | 'beep' | 'go'
  | 'victory' | 'defeat' | 'draw' | 'enter' | 'switch' | 'guard';

const PARTICLE_SOUND: Record<SkillParticle, SfxName> = {
  spark: 'zap', ember: 'roar', bubble: 'splash', ice: 'shimmer', star: 'shimmer', petal: 'shimmer',
  metal: 'shimmer', leaf: 'swish', wisp: 'swish', shard: 'roar',
};

/** 一记招式里什么时候响什么(秒,相对这一记起手) */
export function fxCues(fx: BattleFx): Array<{ at: number; name: SfxName }> {
  if (fx.kind === 'ultimate') {
    return [
      { at: 0, name: 'cutin' },
      { at: 0.25, name: 'charge' },
      { at: 1.4, name: fx.particle ? PARTICLE_SOUND[fx.particle] : 'swish' },
      { at: IMPACT_AT_ULTIMATE, name: 'hitHeavy' },
    ];
  }
  if (fx.kind === 'backfire') {
    return [{ at: 0.1, name: 'whoosh' }, { at: IMPACT_AT_NORMAL, name: 'backfire' }];
  }
  return [
    { at: 0.12, name: fx.mode === 'dash' ? 'whoosh' : 'shot' },
    { at: IMPACT_AT_NORMAL, name: fx.guarded ? 'guard' : fx.heavy ? 'hitHeavy' : 'hit' },
  ];
}
