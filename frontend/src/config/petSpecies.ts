export type PetElement =
  | 'normal' | 'fire' | 'water' | 'grass' | 'electric' | 'ice'
  | 'fighting' | 'poison' | 'ground' | 'flying' | 'psychic' | 'bug'
  | 'rock' | 'ghost' | 'dragon' | 'dark' | 'steel' | 'fairy';

export type PetStage = {
  name: string;
  image: string | null;
  backImage?: string | null;
  unlockLevel: number;
  isGem?: boolean;
};

export type PetSpeciesDefinition = {
  id: string;
  label: string;
  description: string;
  element: PetElement;
  emoji: string;
  ultimate: { name: string; emoji: string; image: string };
  stages: readonly [PetStage, PetStage, PetStage, PetStage, PetStage];
};

const egg = (): PetStage => ({ name: '伙伴蛋', image: null, unlockLevel: 1 });
const getBackImagePath = (image: string): string | null => (
  image.startsWith('/pets/') && image.endsWith('.png')
    ? image.replace('/pets/', '/pets/back/')
    : null
);
const stage = (name: string, image: string, unlockLevel: number): PetStage => ({
  name,
  image,
  backImage: getBackImagePath(image),
  unlockLevel,
});
const gemStage = (name: string, image: string): PetStage => ({
  name: `晶耀${name}`,
  image,
  backImage: getBackImagePath(image),
  unlockLevel: 45,
  isGem: true,
});

const skillImages: Record<'electric' | 'fire' | 'leaf' | 'water' | 'star', string> = {
  electric: '/pet-skill-electric.webp',
  fire: '/pet-skill-fire.webp',
  leaf: '/pet-skill-leaf.webp',
  water: '/pet-skill-water.webp',
  star: '/pet-skill-star.webp',
};

const pet = (
  id: string,
  label: string,
  description: string,
  element: PetElement,
  emoji: string,
  ultimateName: string,
  skill: keyof typeof skillImages,
  forms: readonly [[string, string], [string, string], [string, string]],
): PetSpeciesDefinition => ({
  id,
  label,
  description,
  element,
  emoji,
  ultimate: { name: ultimateName, emoji, image: skillImages[skill] },
  stages: [
    egg(),
    stage(forms[0][0], forms[0][1], 5),
    stage(forms[1][0], forms[1][1], 15),
    stage(forms[2][0], forms[2][1], 30),
    gemStage(forms[2][0], forms[2][1]),
  ],
});

export const PET_SPECIES: readonly PetSpeciesDefinition[] = [
  pet('pikachu', '皮卡丘家族', '电气伙伴，最终进化为雷丘', 'electric', '⚡', '十万伏特', 'electric', [
    ['皮丘', '/pets/pichu.png'], ['皮卡丘', '/pets/pikachu.png'], ['雷丘', '/pets/raichu.png'],
  ]),
  pet('eevee', '伊布', '进化潜力丰富，成长后建立最强羁绊', 'normal', '✨', '高速星星', 'star', [
    ['伊布', '/pets/eevee.png'], ['成长伊布', '/pets/eevee.png'], ['羁绊伊布', '/pets/eevee.png'],
  ]),
  pet('bulbasaur', '妙蛙种子家族', '草系伙伴，温柔而可靠', 'grass', '🍃', '飞叶快刀', 'leaf', [
    ['妙蛙种子', '/pets/bulbasaur.png'], ['妙蛙草', '/pets/ivysaur.png'], ['妙蛙花', '/pets/venusaur.png'],
  ]),
  pet('charmander', '小火龙家族', '火焰尾巴，热情勇敢', 'fire', '🔥', '火焰喷射', 'fire', [
    ['小火龙', '/pets/charmander.png'], ['火恐龙', '/pets/charmeleon.png'], ['喷火龙', '/pets/charizard.png'],
  ]),
  pet('squirtle', '杰尼龟家族', '沉稳聪明的水系伙伴', 'water', '💧', '水炮', 'water', [
    ['杰尼龟', '/pets/squirtle.png'], ['卡咪龟', '/pets/wartortle.png'], ['水箭龟', '/pets/blastoise.png'],
  ]),
  pet('jigglypuff', '胖丁家族', '爱唱歌的妖精系伙伴', 'fairy', '🎵', '魔法闪耀', 'star', [
    ['胖丁', '/pets/jigglypuff.png'], ['成长胖丁', '/pets/jigglypuff.png'], ['胖可丁', '/pets/wigglytuff.png'],
  ]),
  pet('gastly', '鬼斯家族', '神出鬼没的幽灵系伙伴', 'ghost', '👻', '暗影球', 'star', [
    ['鬼斯', '/pets/gastly.png'], ['鬼斯通', '/pets/haunter.png'], ['耿鬼', '/pets/gengar.png'],
  ]),
  pet('dratini', '迷你龙家族', '优雅而强大的龙系伙伴', 'dragon', '🐉', '龙之波动', 'star', [
    ['迷你龙', '/pets/dratini.png'], ['哈克龙', '/pets/dragonair.png'], ['快龙', '/pets/dragonite.png'],
  ]),
  pet('machop', '腕力家族', '坚持训练的格斗系伙伴', 'fighting', '🥊', '爆裂拳', 'star', [
    ['腕力', '/pets/machop.png'], ['豪力', '/pets/machoke.png'], ['怪力', '/pets/machamp.png'],
  ]),
  pet('abra', '凯西家族', '聪明敏锐的超能力伙伴', 'psychic', '🔮', '精神强念', 'star', [
    ['凯西', '/pets/abra.png'], ['勇基拉', '/pets/kadabra.png'], ['胡地', '/pets/alakazam.png'],
  ]),
  pet('geodude', '小拳石家族', '坚韧可靠的岩石系伙伴', 'rock', '🪨', '岩崩', 'star', [
    ['小拳石', '/pets/geodude.png'], ['隆隆石', '/pets/graveler.png'], ['隆隆岩', '/pets/golem.png'],
  ]),
  pet('vulpix', '六尾家族', '美丽优雅的火系伙伴', 'fire', '🔥', '大字爆炎', 'fire', [
    ['六尾', '/pets/vulpix.png'], ['成长六尾', '/pets/vulpix.png'], ['九尾', '/pets/ninetales.png'],
  ]),
  pet('growlithe', '卡蒂狗家族', '忠诚勇敢的火系伙伴', 'fire', '🔥', '神速烈焰', 'fire', [
    ['卡蒂狗', '/pets/growlithe.png'], ['成长卡蒂狗', '/pets/growlithe.png'], ['风速狗', '/pets/arcanine.png'],
  ]),
  pet('magikarp', '鲤鱼王家族', '坚持成长，终会一飞冲天', 'water', '💧', '水流尾', 'water', [
    ['鲤鱼王', '/pets/magikarp.png'], ['跃动鲤鱼王', '/pets/magikarp.png'], ['暴鲤龙', '/pets/gyarados.png'],
  ]),
  pet('oddish', '走路草家族', '安静可爱的草系伙伴', 'grass', '🍃', '花瓣舞', 'leaf', [
    ['走路草', '/pets/oddish.png'], ['臭臭花', '/pets/gloom.png'], ['霸王花', '/pets/vileplume.png'],
  ]),
  pet('poliwag', '蚊香蝌蚪家族', '活泼好动的水系伙伴', 'water', '💧', '水流裂破', 'water', [
    ['蚊香蝌蚪', '/pets/poliwag.png'], ['蚊香君', '/pets/poliwhirl.png'], ['蚊香泳士', '/pets/poliwrath.png'],
  ]),
  pet('caterpie', '绿毛虫家族', '快速蜕变的虫系伙伴', 'bug', '🐛', '银色旋风', 'leaf', [
    ['绿毛虫', '/pets/caterpie.png'], ['铁甲蛹', '/pets/metapod.png'], ['巴大蝶', '/pets/butterfree.png'],
  ]),
  pet('weedle', '独角虫家族', '小小身躯也能爆发强大力量', 'bug', '🐛', '飞弹针', 'leaf', [
    ['独角虫', '/pets/weedle.png'], ['铁壳蛹', '/pets/kakuna.png'], ['大针蜂', '/pets/beedrill.png'],
  ]),
  pet('bellsprout', '喇叭芽家族', '灵活坚韧的草系伙伴', 'grass', '🍃', '强力鞭打', 'leaf', [
    ['喇叭芽', '/pets/bellsprout.png'], ['口呆花', '/pets/weepinbell.png'], ['大食花', '/pets/victreebel.png'],
  ]),
  pet('horsea', '墨海马家族', '在水流中不断磨炼的伙伴', 'water', '💧', '龙卷水炮', 'water', [
    ['墨海马', '/pets/horsea.png'], ['海刺龙', '/pets/seadra.png'], ['刺龙王', '/pets/kingdra.png'],
  ]),
  pet('larvitar', '幼基拉斯家族', '从岩石中积蓄力量的伙伴', 'rock', '🪨', '尖石攻击', 'star', [
    ['幼基拉斯', '/pets/larvitar.png'], ['沙基拉斯', '/pets/pupitar.png'], ['班基拉斯', '/pets/tyranitar.png'],
  ]),
  pet('ralts', '拉鲁拉丝家族', '能感知情绪的超能力伙伴', 'psychic', '🔮', '精神冲击', 'star', [
    ['拉鲁拉丝', '/pets/ralts.png'], ['奇鲁莉安', '/pets/kirlia.png'], ['沙奈朵', '/pets/gardevoir.png'],
  ]),
  pet('chikorita', '菊草叶家族', '温和坚定的草系伙伴', 'grass', '🍃', '日光束', 'leaf', [
    ['菊草叶', '/pets/chikorita.png'], ['月桂叶', '/pets/bayleef.png'], ['大竺葵', '/pets/meganium.png'],
  ]),
  pet('cyndaquil', '火球鼠家族', '背上的火焰会随斗志燃烧', 'fire', '🔥', '喷火', 'fire', [
    ['火球鼠', '/pets/cyndaquil.png'], ['火岩鼠', '/pets/quilava.png'], ['火暴兽', '/pets/typhlosion.png'],
  ]),
  pet('totodile', '小锯鳄家族', '精力充沛的水系伙伴', 'water', '💧', '水流尾', 'water', [
    ['小锯鳄', '/pets/totodile.png'], ['蓝鳄', '/pets/croconaw.png'], ['大力鳄', '/pets/feraligatr.png'],
  ]),
  pet('treecko', '木守宫家族', '冷静敏捷的森林伙伴', 'grass', '🍃', '叶刃', 'leaf', [
    ['木守宫', '/pets/treecko.png'], ['森林蜥蜴', '/pets/grovyle.png'], ['蜥蜴王', '/pets/sceptile.png'],
  ]),
  pet('torchic', '火稚鸡家族', '越训练越勇猛的火系伙伴', 'fire', '🔥', '爆炸烈焰', 'fire', [
    ['火稚鸡', '/pets/torchic.png'], ['力壮鸡', '/pets/combusken.png'], ['火焰鸡', '/pets/blaziken.png'],
  ]),
  pet('mudkip', '水跃鱼家族', '能感知水流变化的可靠伙伴', 'water', '💧', '浊流', 'water', [
    ['水跃鱼', '/pets/mudkip.png'], ['沼跃鱼', '/pets/marshtomp.png'], ['巨沼怪', '/pets/swampert.png'],
  ]),
  pet('bagon', '宝贝龙家族', '怀抱飞翔梦想的龙系伙伴', 'dragon', '🐉', '龙星群', 'star', [
    ['宝贝龙', '/pets/bagon.png'], ['甲壳龙', '/pets/shelgon.png'], ['暴飞龙', '/pets/salamence.png'],
  ]),
  pet('beldum', '铁哑铃家族', '以磁力凝聚力量的钢系伙伴', 'steel', '⚙️', '彗星拳', 'star', [
    ['铁哑铃', '/pets/beldum.png'], ['金属怪', '/pets/metang.png'], ['巨金怪', '/pets/metagross.png'],
  ]),
  pet('gible', '圆陆鲨家族', '拥有惊人成长潜力的龙系伙伴', 'dragon', '🐉', '龙神俯冲', 'star', [
    ['圆陆鲨', '/pets/gible.png'], ['尖牙陆鲨', '/pets/gabite.png'], ['烈咬陆鲨', '/pets/garchomp.png'],
  ]),
  pet('snivy', '藤藤蛇家族', '从容优雅的草系伙伴', 'grass', '🍃', '疯狂植物', 'leaf', [
    ['藤藤蛇', '/pets/snivy.png'], ['青藤蛇', '/pets/servine.png'], ['君主蛇', '/pets/serperior.png'],
  ]),
  pet('tepig', '暖暖猪家族', '食欲和斗志同样旺盛', 'fire', '🔥', '高温重压', 'fire', [
    ['暖暖猪', '/pets/tepig.png'], ['炒炒猪', '/pets/pignite.png'], ['炎武王', '/pets/emboar.png'],
  ]),
  pet('oshawott', '水水獭家族', '认真磨炼贝壳刀法的伙伴', 'water', '💧', '贝壳刃', 'water', [
    ['水水獭', '/pets/oshawott.png'], ['双刃丸', '/pets/dewott.png'], ['大剑鬼', '/pets/samurott.png'],
  ]),
  pet('rowlet', '木木枭家族', '安静专注的森林射手', 'grass', '🍃', '缝影', 'leaf', [
    ['木木枭', '/pets/rowlet.png'], ['投羽枭', '/pets/dartrix.png'], ['狙射树枭', '/pets/decidueye.png'],
  ]),
  pet('litten', '火斑喵家族', '骄傲又可靠的火系伙伴', 'fire', '🔥', '极恶飞跃粉碎击', 'fire', [
    ['火斑喵', '/pets/litten.png'], ['炎热喵', '/pets/torracat.png'], ['炽焰咆哮虎', '/pets/incineroar.png'],
  ]),
  pet('popplio', '球球海狮家族', '用水泡和歌声鼓舞伙伴', 'water', '💧', '海神庄严交响乐', 'water', [
    ['球球海狮', '/pets/popplio.png'], ['花漾海狮', '/pets/brionne.png'], ['西狮海壬', '/pets/primarina.png'],
  ]),
  pet('book_fox', '书狐', '爱读书的折纸小狐，最终成为贤者狐', 'normal', '📚', '知识星辉', 'star', [
    ['书页幼狐', '/pets/fox-1.jpeg'], ['博闻书狐', '/pets/fox-2.jpeg'], ['贤者书狐', '/pets/fox-3.jpeg'],
  ]),
  pet('paper_owl', '文鸮', '博学的折纸猫头鹰，最终成为博士', 'psychic', '🎓', '智慧光束', 'star', [
    ['折纸雏鸮', '/pets/owl-1.jpeg'], ['学者文鸮', '/pets/owl-2.jpeg'], ['博士文鸮', '/pets/owl-3.jpeg'],
  ]),
  pet('word_turtle', '词龟', '沉稳的折纸小龟，龟壳刻着智慧纹路', 'water', '📖', '词海奔流', 'water', [
    ['字芽小龟', '/pets/turtle-1.jpeg'], ['词纹灵龟', '/pets/turtle-2.jpeg'], ['典藏圣龟', '/pets/turtle-3.jpeg'],
  ]),
];

export const PET_SPECIES_BY_ID: Record<string, PetSpeciesDefinition> = Object.fromEntries(
  PET_SPECIES.map((definition) => [definition.id, definition]),
);

export function getPetDefinition(species: string): PetSpeciesDefinition {
  return PET_SPECIES_BY_ID[species] || PET_SPECIES_BY_ID.pikachu;
}

export function getPetStage(species: string, evolutionStage: number): PetStage {
  const stages = getPetDefinition(species).stages;
  return stages[Math.max(0, Math.min(evolutionStage, stages.length - 1))];
}

export function getPetStageImage(species: string, evolutionStage: number): string | null {
  return getPetStage(species, evolutionStage).image;
}

// Battle, healing and compact widgets still need a visible creature before hatching.
export function getPetImage(species: string, evolutionStage: number): string {
  const definition = getPetDefinition(species);
  return getPetStage(species, evolutionStage).image || definition.stages[1].image!;
}

function getVisiblePetStage(species: string, evolutionStage: number): PetStage {
  const definition = getPetDefinition(species);
  const current = getPetStage(species, evolutionStage);
  return current.image ? current : definition.stages[1];
}

export function getPetBackImage(species: string, evolutionStage: number): string {
  const stage = getVisiblePetStage(species, evolutionStage);
  return stage.backImage || stage.image!;
}

export function hasPetBackImage(species: string, evolutionStage: number): boolean {
  return Boolean(getVisiblePetStage(species, evolutionStage).backImage);
}

export function getNextPetStage(species: string, evolutionStage: number): PetStage | null {
  return getPetDefinition(species).stages[evolutionStage + 1] || null;
}
