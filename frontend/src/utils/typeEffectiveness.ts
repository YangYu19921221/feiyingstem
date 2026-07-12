/**
 * 宝可梦属性克制系统 - 前端配置
 */

export type PokemonType =
  | 'normal' | 'fire' | 'water' | 'grass' | 'electric' | 'ice'
  | 'fighting' | 'poison' | 'ground' | 'flying' | 'psychic' | 'bug'
  | 'rock' | 'ghost' | 'dragon' | 'dark' | 'steel' | 'fairy';

// 属性中文名称
export const TYPE_NAMES: Record<PokemonType, string> = {
  normal: '普通',
  fire: '火',
  water: '水',
  grass: '草',
  electric: '电',
  ice: '冰',
  fighting: '格斗',
  poison: '毒',
  ground: '地面',
  flying: '飞行',
  psychic: '超能力',
  bug: '虫',
  rock: '岩石',
  ghost: '幽灵',
  dragon: '龙',
  dark: '恶',
  steel: '钢',
  fairy: '妖精',
};

// 属性emoji图标
export const TYPE_ICONS: Record<PokemonType, string> = {
  normal: '⚪',
  fire: '🔥',
  water: '💧',
  grass: '🌱',
  electric: '⚡',
  ice: '❄️',
  fighting: '🥊',
  poison: '☠️',
  ground: '🏔️',
  flying: '🦅',
  psychic: '🔮',
  bug: '🐛',
  rock: '🪨',
  ghost: '👻',
  dragon: '🐉',
  dark: '🌑',
  steel: '⚙️',
  fairy: '🧚',
};

// 属性颜色
export const TYPE_COLORS: Record<PokemonType, string> = {
  normal: '#A8A878',
  fire: '#F08030',
  water: '#6890F0',
  grass: '#78C850',
  electric: '#F8D030',
  ice: '#98D8D8',
  fighting: '#C03028',
  poison: '#A040A0',
  ground: '#E0C068',
  flying: '#A890F0',
  psychic: '#F85888',
  bug: '#A8B820',
  rock: '#B8A038',
  ghost: '#705898',
  dragon: '#7038F8',
  dark: '#705848',
  steel: '#B8B8D0',
  fairy: '#EE99AC',
};

// 属性克制关系表
interface TypeEffectiveness {
  super: PokemonType[];  // 克制的属性 (2x)
  weak: PokemonType[];   // 被抵抗的属性 (0.5x)
  immune: PokemonType[]; // 无效的属性 (0x)
}

const TYPE_EFFECTIVENESS: Record<PokemonType, TypeEffectiveness> = {
  normal: {
    super: [],
    weak: ['rock', 'steel'],
    immune: ['ghost'],
  },
  fire: {
    super: ['grass', 'ice', 'bug', 'steel'],
    weak: ['fire', 'water', 'rock', 'dragon'],
    immune: [],
  },
  water: {
    super: ['fire', 'ground', 'rock'],
    weak: ['water', 'grass', 'dragon'],
    immune: [],
  },
  grass: {
    super: ['water', 'ground', 'rock'],
    weak: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon', 'steel'],
    immune: [],
  },
  electric: {
    super: ['water', 'flying'],
    weak: ['electric', 'grass', 'dragon'],
    immune: ['ground'],
  },
  ice: {
    super: ['grass', 'ground', 'flying', 'dragon'],
    weak: ['fire', 'water', 'ice', 'steel'],
    immune: [],
  },
  fighting: {
    super: ['normal', 'ice', 'rock', 'dark', 'steel'],
    weak: ['poison', 'flying', 'psychic', 'bug', 'fairy'],
    immune: ['ghost'],
  },
  poison: {
    super: ['grass', 'fairy'],
    weak: ['poison', 'ground', 'rock', 'ghost'],
    immune: ['steel'],
  },
  ground: {
    super: ['fire', 'electric', 'poison', 'rock', 'steel'],
    weak: ['grass', 'bug'],
    immune: ['flying'],
  },
  flying: {
    super: ['grass', 'fighting', 'bug'],
    weak: ['electric', 'rock', 'steel'],
    immune: [],
  },
  psychic: {
    super: ['fighting', 'poison'],
    weak: ['psychic', 'steel'],
    immune: ['dark'],
  },
  bug: {
    super: ['grass', 'psychic', 'dark'],
    weak: ['fire', 'fighting', 'poison', 'flying', 'ghost', 'steel', 'fairy'],
    immune: [],
  },
  rock: {
    super: ['fire', 'ice', 'flying', 'bug'],
    weak: ['fighting', 'ground', 'steel'],
    immune: [],
  },
  ghost: {
    super: ['psychic', 'ghost'],
    weak: ['dark'],
    immune: ['normal'],
  },
  dragon: {
    super: ['dragon'],
    weak: ['steel'],
    immune: ['fairy'],
  },
  dark: {
    super: ['psychic', 'ghost'],
    weak: ['fighting', 'dark', 'fairy'],
    immune: [],
  },
  steel: {
    super: ['ice', 'rock', 'fairy'],
    weak: ['fire', 'water', 'electric', 'steel'],
    immune: [],
  },
  fairy: {
    super: ['fighting', 'dragon', 'dark'],
    weak: ['fire', 'poison', 'steel'],
    immune: [],
  },
};

/**
 * 计算属性克制倍率
 * @param attackerType 进攻方属性
 * @param defenderType 防守方属性
 * @returns 伤害倍率 (0, 0.5, 1, 2)
 */
export function getEffectiveness(attackerType: PokemonType, defenderType: PokemonType): number {
  const effectiveness = TYPE_EFFECTIVENESS[attackerType];

  if (!effectiveness) return 1;

  // 无效 (0倍)
  if (effectiveness.immune.includes(defenderType)) return 0;

  // 效果拔群 (2倍)
  if (effectiveness.super.includes(defenderType)) return 2;

  // 效果不好 (0.5倍)
  if (effectiveness.weak.includes(defenderType)) return 0.5;

  // 普通效果 (1倍)
  return 1;
}

/**
 * 获取效果描述文本
 */
export function getEffectivenessText(multiplier: number): string {
  if (multiplier === 0) return '完全无效！';
  if (multiplier === 0.5) return '效果不好...';
  if (multiplier === 2) return '效果拔群！';
  return '';
}

/**
 * 获取效果emoji
 */
export function getEffectivenessEmoji(multiplier: number): string {
  if (multiplier === 0) return '❌';
  if (multiplier === 0.5) return '🛡️';
  if (multiplier === 2) return '💥';
  return '';
}

/**
 * 项目中宠物的属性配置
 */
export const PET_TYPES: Record<string, PokemonType> = {
  pikachu: 'electric',      // 皮卡丘 - 电系
  raichu: 'electric',       // 雷丘 - 电系
  eevee: 'normal',          // 伊布 - 普通系
  bulbasaur: 'grass',       // 妙蛙种子 - 草系
  ivysaur: 'grass',         // 妙蛙草 - 草系
  venusaur: 'grass',        // 妙蛙花 - 草系
  charmander: 'fire',       // 小火龙 - 火系
  charmeleon: 'fire',       // 火恐龙 - 火系
  charizard: 'fire',        // 喷火龙 - 火系
  squirtle: 'water',        // 杰尼龟 - 水系
  wartortle: 'water',       // 卡咪龟 - 水系
  blastoise: 'water',       // 水箭龟 - 水系
};

/**
 * 获取宠物的属性
 */
export function getPetType(species: string): PokemonType {
  return PET_TYPES[species.toLowerCase()] || 'normal';
}

/**
 * 获取属性优势信息
 */
export function getTypeAdvantages(type: PokemonType) {
  return TYPE_EFFECTIVENESS[type] || { super: [], weak: [], immune: [] };
}
