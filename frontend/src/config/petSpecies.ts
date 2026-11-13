/** 对战演出时间(秒)。
 *
 *  一回合里的招式一记接一记演: 普通攻击起手后 EFFECT_STEP_NORMAL 秒下一记起手,
 *  大招起手后 EFFECT_STEP_ULTIMATE 秒下一记起手,最后一记再多演 FX_TAIL 秒收尾;
 *  全部演完后留 ROUND_READ_SECONDS 秒看正确答案,服务端才发下一题。
 *
 *  **与后端 backend/app/core/pet_formulas.py 的 BATTLE_FX_* / BATTLE_READ_SECONDS 同值**
 *  (tests/test_pet_battle_pacing.py 解析这个文件比对): 服务端按它算「几秒后发下一题」,
 *  这里按它排动画,对不上就是最后一记被下一题掐断。
 *  放在这个纯数据文件里而不是对战场景里: 场景文件会把 three.js 拖进主包。 */
export const EFFECT_STEP_NORMAL = 1.3;
export const EFFECT_STEP_ULTIMATE = 3.3;
export const FX_TAIL = 0.3;
export const ROUND_READ_SECONDS = 1.6;

/** 一记招式从起手到「打中」的时刻(秒): 血条、伤害数字、受击动作都对齐它 */
export const IMPACT_AT_NORMAL = 0.45;
export const IMPACT_AT_ULTIMATE = 2.25;

/** 最后一击打中之后,倒下 + 胜利动作演多久才出结算页(秒) */
export const FINALE_KO_SECONDS = 2.4;
export const FINALE_PLAIN_SECONDS = 1.3;

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

/** 种族档位。真源在后端 core/pet_species(TIER_*),这里必须保持同名同值。
 *  普通种族只受队伍格约束;准传说/传说另有累计学词门槛,且走独立队伍格。 */
export type PetTier = 'normal' | 'semi_legend' | 'legend';

/** 传说门槛(累计学习的不同单词数)。真源在后端 core/pet_species,
 *  /pet/collection 也会把实际值带回来(semi_legend_words / legend_words);
 *  这两个常量只做接口没返回时的兜底与静态文案。 */
export const SEMI_LEGEND_WORDS = 5000;
export const LEGEND_WORDS = 8000;

export const TIER_LABEL: Record<PetTier, string> = {
  normal: '普通',
  semi_legend: '准传说',
  legend: '传说',
};

export const TIER_WORDS: Record<PetTier, number> = {
  normal: 0,
  semi_legend: SEMI_LEGEND_WORDS,
  legend: LEGEND_WORDS,
};

export type PetSpeciesDefinition = {
  id: string;
  label: string;
  description: string;
  element: PetElement;
  emoji: string;
  tier: PetTier;
  ultimate: { name: string; emoji: string; image: string };
  stages: readonly [PetStage, PetStage, PetStage, PetStage, PetStage];
};

const egg = (name = '伙伴蛋'): PetStage => ({ name, image: null, unlockLevel: 1 });
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
/** 传说的第五档叫「神话」而不是「晶耀」:传说三档是同一只的气场升级(本体→觉醒→究极),
 *  不是进化链,再叠「晶耀究极XX」既拗口也说不通。等级门槛与普通种族一致(45)。 */
const mythicStage = (name: string, image: string): PetStage => ({
  name: `神话${name}`,
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
  tier: 'normal',
  ultimate: { name: ultimateName, emoji, image: skillImages[skill] },
  stages: [
    egg(),
    stage(forms[0][0], forms[0][1], 5),
    stage(forms[1][0], forms[1][1], 15),
    stage(forms[2][0], forms[2][1], 30),
    gemStage(forms[2][0], forms[2][1]),
  ],
});

/** 传说种族。三档 = 本体 / 觉醒 / 究极(同一只的气场升级),第五档为神话。
 *  与 pet() 分开而不是加参数:传说的阶段命名、蛋名、第五档规则都不同,
 *  塞进 pet() 会让那个已被 40 个普通种族依赖的工厂长出一堆分支。 */
const legendPet = (
  id: string,
  label: string,
  description: string,
  element: PetElement,
  emoji: string,
  ultimateName: string,
  skill: keyof typeof skillImages,
  tier: Exclude<PetTier, 'normal'>,
  forms: readonly [[string, string], [string, string], [string, string]],
): PetSpeciesDefinition => ({
  id,
  label,
  description,
  element,
  emoji,
  tier,
  ultimate: { name: ultimateName, emoji, image: skillImages[skill] },
  stages: [
    egg('传说之卵'),
    stage(forms[0][0], forms[0][1], 5),
    stage(forms[1][0], forms[1][1], 15),
    stage(forms[2][0], forms[2][1], 30),
    mythicStage(forms[0][0], forms[2][1]),
  ],
});

export const PET_SPECIES: readonly PetSpeciesDefinition[] = [
  pet('sparkhog', '蒲电猬家族', '背上是蒲公英绒球的小刺猬，一抖就噼啪放电，最终长出雷电王冠', 'electric', '⚡', '蒲公英雷暴', 'electric', [
    ['蒲蒲猬', '/pets/sparkhog_1.png'], ['闪蒲猬', '/pets/sparkhog_2.png'], ['雷冠猬', '/pets/sparkhog_3.png'],
  ]),
  pet('alpaca', '云絮羊驼家族', '毛像云朵一样蓬松的小羊驼，越长大毛里藏的星星越多', 'normal', '✨', '星絮回旋', 'star', [
    ['绒绒驼', '/pets/alpaca_1.png'], ['云絮羊驼', '/pets/alpaca_2.png'], ['星光羊驼', '/pets/alpaca_3.png'],
  ]),
  pet('leafkoala', '叶耳熊家族', '耳朵是两片大叶子的小考拉，抱着树枝长大，最后头顶长成一片小森林', 'grass', '🍃', '万叶旋舞', 'leaf', [
    ['叶团团', '/pets/leafkoala_1.png'], ['藤叶熊', '/pets/leafkoala_2.png'], ['森冠熊', '/pets/leafkoala_3.png'],
  ]),
  pet('emberham', '火芯鼠家族', '耳朵尖是两朵小蜡烛火苗的仓鼠，最后披上了火焰披风', 'fire', '🔥', '烈焰披风', 'fire', [
    ['火芯仔', '/pets/emberham_1.png'], ['焰团鼠', '/pets/emberham_2.png'], ['炎披鼠王', '/pets/emberham_3.png'],
  ]),
  pet('narwhee', '螺角鲸家族', '额头长着一根螺旋小角的独角鲸宝宝，能浮在空中游来游去', 'water', '💧', '潮汐螺旋', 'water', [
    ['小螺鲸', '/pets/narwhee_1.png'], ['涡角鲸', '/pets/narwhee_2.png'], ['潮冠角鲸', '/pets/narwhee_3.png'],
  ]),
  pet('melopuff', '音团绒家族', '圆滚滚的棉花糖小猫，尾巴是一个音符，一唱歌大家就想睡觉', 'fairy', '🎵', '甜梦摇篮曲', 'star', [
    ['音团团', '/pets/melopuff_1.png'], ['乐符绒', '/pets/melopuff_2.png'], ['交响绒王', '/pets/melopuff_3.png'],
  ]),
  pet('umbrellaspirit', '伞灵家族', '一把会飘的油纸伞成了精，害羞地躲在伞下，晚上会发出紫色的光', 'ghost', '👻', '幽伞夜雨', 'star', [
    ['伞宝灵', '/pets/umbrellaspirit_1.png'], ['油纸伞灵', '/pets/umbrellaspirit_2.png'], ['千伞幽灵', '/pets/umbrellaspirit_3.png'],
  ]),
  pet('candydrake', '糖画龙家族', '像街边糖画一样晶莹的金色小龙，越长越大，龙鳞闪着焦糖光', 'dragon', '🐉', '金糖龙息', 'star', [
    ['糖糖龙', '/pets/candydrake_1.png'], ['糖画龙', '/pets/candydrake_2.png'], ['金糖龙王', '/pets/candydrake_3.png'],
  ]),
  pet('boxaroo', '拳袋鼠家族', '戴着红色拳套的小袋鼠，每天练拳，最后拿到了冠军金腰带', 'fighting', '🥊', '冠军连环拳', 'star', [
    ['拳仔袋', '/pets/boxaroo_1.png'], ['擂台袋鼠', '/pets/boxaroo_2.png'], ['袋鼠拳王', '/pets/boxaroo_3.png'],
  ]),
  pet('mindslug', '念力海蛞蝓家族', '会飘在空中的粉紫色海蛞蝓，触角一亮就能用念力把东西浮起来', 'psychic', '🔮', '星念涟漪', 'star', [
    ['念念蝓', '/pets/mindslug_1.png'], ['星念蝓', '/pets/mindslug_2.png'], ['灵光蝓仙', '/pets/mindslug_3.png'],
  ]),
  pet('pebbadillo', '卵石犰狳家族', '背着鹅卵石甲壳的小犰狳，缩成一团就能滚着撞过去', 'rock', '🪨', '滚石轰隆', 'star', [
    ['石豆犰', '/pets/pebbadillo_1.png'], ['岩甲犰', '/pets/pebbadillo_2.png'], ['山岳犰王', '/pets/pebbadillo_3.png'],
  ]),
  pet('blazekat', '焰尾獴家族', '站岗放哨的小獴，尾巴是一簇火苗，最后头顶出现太阳一样的光环', 'fire', '🔥', '日冕爆炎', 'fire', [
    ['火獴仔', '/pets/blazekat_1.png'], ['焰尾獴', '/pets/blazekat_2.png'], ['日冕獴王', '/pets/blazekat_3.png'],
  ]),
  pet('liondog', '醒狮家族', '像过年舞的醒狮一样的小狮子，鬃毛是火做的，会守护大家', 'fire', '🔥', '醒狮烈焰', 'fire', [
    ['醒狮仔', '/pets/liondog_1.png'], ['焰鬃狮', '/pets/liondog_2.png'], ['瑞火狮王', '/pets/liondog_3.png'],
  ]),
  pet('surfduck', '浪羽鸭家族', '灰扑扑的小鸭子总被笑话，努力冲浪长大后变成了闪着水光的白天鹅', 'water', '💧', '潮光羽浪', 'water', [
    ['灰绒鸭', '/pets/surfduck_1.png'], ['浪羽鸭', '/pets/surfduck_2.png'], ['潮光天鹅', '/pets/surfduck_3.png'],
  ]),
  pet('potsprout', '盆栽精家族', '一只会走路的小花盆，头上的嫩芽慢慢开成了一大片花', 'grass', '🍃', '百花盛放', 'leaf', [
    ['盆芽芽', '/pets/potsprout_1.png'], ['花盆灵', '/pets/potsprout_2.png'], ['百花盆王', '/pets/potsprout_3.png'],
  ]),
  pet('bubbleoct', '泡泡章家族', '爱吹泡泡的小章鱼，泡泡越吹越大，最后能用漩涡把对手卷起来', 'water', '💧', '漩涡泡泡阵', 'water', [
    ['泡泡章', '/pets/bubbleoct_1.png'], ['涡泡章', '/pets/bubbleoct_2.png'], ['深海章王', '/pets/bubbleoct_3.png'],
  ]),
  pet('silkmoth', '蚕蛾家族', '爱吃桑叶的蚕宝宝，吐丝结茧，最后变成翅膀带月光的白蚕蛾', 'bug', '🐛', '银丝月光', 'leaf', [
    ['蚕宝宝', '/pets/silkmoth_1.png'], ['银茧蚕', '/pets/silkmoth_2.png'], ['月光蚕蛾', '/pets/silkmoth_3.png'],
  ]),
  pet('honeybee', '蜜囊蜂家族', '圆滚滚的小蜜蜂，背着一罐蜂蜜，长大后成了守护蜂巢的骑士', 'bug', '🐝', '蜂巢针雨', 'leaf', [
    ['蜜豆蜂', '/pets/honeybee_1.png'], ['巢卫蜂', '/pets/honeybee_2.png'], ['蜂巢骑士', '/pets/honeybee_3.png'],
  ]),
  pet('pitcherplant', '瓶子草家族', '像小水瓶一样的瓶子草，盖子一开一合在说话，藤蔓能当鞭子', 'grass', '🍃', '露珠鞭击', 'leaf', [
    ['小瓶草', '/pets/pitcherplant_1.png'], ['露瓶草', '/pets/pitcherplant_2.png'], ['瓶草女王', '/pets/pitcherplant_3.png'],
  ]),
  pet('axolotl', '六角螈家族', '头上有六根粉色羽鳃的小蝾螈，一直在笑，最后鳃长成了珊瑚', 'water', '💧', '珊瑚漩流', 'water', [
    ['萌螈宝', '/pets/axolotl_1.png'], ['珊鳃螈', '/pets/axolotl_2.png'], ['珊瑚螈王', '/pets/axolotl_3.png'],
  ]),
  pet('geocub', '晶洞兽家族', '背上裂开就是一个闪光晶洞的小石兽，越长背上的紫水晶越大', 'rock', '🪨', '水晶山崩', 'star', [
    ['晶豆兽', '/pets/geocub_1.png'], ['晶洞兽', '/pets/geocub_2.png'], ['紫晶山君', '/pets/geocub_3.png'],
  ]),
  pet('lanternfairy', '灯笼仙家族', '提着小灯笼的仙子精灵，灯光能照见别人的心情', 'psychic', '🔮', '千灯祈愿', 'star', [
    ['灯芯灵', '/pets/lanternfairy_1.png'], ['灯笼仙', '/pets/lanternfairy_2.png'], ['千灯仙子', '/pets/lanternfairy_3.png'],
  ]),
  pet('lotuscalf', '莲叶鹿家族', '头上顶着一片荷叶的小鹿，走过的地方都会开出莲花', 'grass', '🍃', '清荷落雨', 'leaf', [
    ['荷芽鹿', '/pets/lotuscalf_1.png'], ['莲叶鹿', '/pets/lotuscalf_2.png'], ['千荷鹿神', '/pets/lotuscalf_3.png'],
  ]),
  pet('flamepanda', '焰熊猫家族', '毛色是火红和奶白的小熊猫，抱着一根着火的竹子当魔杖', 'fire', '🔥', '竹火冲天', 'fire', [
    ['火团团', '/pets/flamepanda_1.png'], ['焰纹熊猫', '/pets/flamepanda_2.png'], ['火竹熊猫王', '/pets/flamepanda_3.png'],
  ]),
  pet('otterwave', '浪花獭家族', '抱着贝壳的小水獭，喜欢冲浪，长大后能召唤海浪', 'water', '💧', '浪花连环掌', 'water', [
    ['浪花獭', '/pets/otterwave_1.png'], ['冲浪獭', '/pets/otterwave_2.png'], ['海潮獭王', '/pets/otterwave_3.png'],
  ]),
  pet('chameleaf', '变色龙家族', '尾巴卷成蚊香一样的小变色龙，身上能变出叶子的花纹藏起来', 'grass', '🍃', '千叶隐身斩', 'leaf', [
    ['叶纹蜥', '/pets/chameleaf_1.png'], ['藤卷变色龙', '/pets/chameleaf_2.png'], ['森影变色龙', '/pets/chameleaf_3.png'],
  ]),
  pet('sunrooster', '朝阳鸡家族', '每天第一个叫醒太阳的小鸡，越长大羽毛越像燃烧的朝霞', 'fire', '🔥', '破晓金焰', 'fire', [
    ['朝阳雏', '/pets/sunrooster_1.png'], ['啼晓鸡', '/pets/sunrooster_2.png'], ['金乌鸡神', '/pets/sunrooster_3.png'],
  ]),
  pet('mudhippo', '泥潭河马家族', '爱在泥坑里打滚的小河马，长大后一个翻身就能掀起泥浪', 'water', '💧', '泥浪大翻滚', 'water', [
    ['泥豆马', '/pets/mudhippo_1.png'], ['泥潭河马', '/pets/mudhippo_2.png'], ['沼泽河马王', '/pets/mudhippo_3.png'],
  ]),
  pet('cloudkite', '风筝龙家族', '像一只会飞的风筝的小龙，尾巴是彩色飘带，最后能飞上九霄', 'dragon', '🐉', '万丈风筝阵', 'star', [
    ['纸鸢龙', '/pets/cloudkite_1.png'], ['风筝龙', '/pets/cloudkite_2.png'], ['云霄龙王', '/pets/cloudkite_3.png'],
  ]),
  pet('clockbot', '发条机兽家族', '背上插着发条钥匙的小机器兽，越转越快，最后变成会走的钟塔', 'steel', '⚙️', '齿轮星爆拳', 'star', [
    ['发条仔', '/pets/clockbot_1.png'], ['齿轮兽', '/pets/clockbot_2.png'], ['钟塔机神', '/pets/clockbot_3.png'],
  ]),
  pet('dunewhale', '沙海鲸家族', '在沙漠里游泳的小鲸龙，鳍像船帆，能在沙子里潜行', 'dragon', '🐉', '沙海龙卷', 'star', [
    ['沙鲸仔', '/pets/dunewhale_1.png'], ['沙鳍龙', '/pets/dunewhale_2.png'], ['沙海龙鲸', '/pets/dunewhale_3.png'],
  ]),
  pet('bambooweasel', '竹叶貂家族', '披着竹叶斗篷的小貂，动作很快，召唤竹子从地里长出来', 'grass', '🍃', '千竹破土', 'leaf', [
    ['竹芽貂', '/pets/bambooweasel_1.png'], ['竹叶貂', '/pets/bambooweasel_2.png'], ['青竹貂君', '/pets/bambooweasel_3.png'],
  ]),
  pet('lavaboar', '熔岩野猪家族', '背上有熔岩纹的小野猪，鼻子一喷就冒火星', 'fire', '🔥', '熔岩冲撞', 'fire', [
    ['火炭猪', '/pets/lavaboar_1.png'], ['熔岩猪', '/pets/lavaboar_2.png'], ['火山猪王', '/pets/lavaboar_3.png'],
  ]),
  pet('shellpenguin', '贝甲企鹅家族', '背着扇贝当小盾牌的企鹅宝宝，长大后挥着贝壳刀保护大家', 'water', '💧', '贝刃回旋', 'water', [
    ['贝贝鹅', '/pets/shellpenguin_1.png'], ['贝刃企鹅', '/pets/shellpenguin_2.png'], ['海螺企鹅帝', '/pets/shellpenguin_3.png'],
  ]),
  pet('acornsquirrel', '橡果松鼠家族', '戴着橡果帽的小松鼠，练成了用松果和树叶当箭的神射手', 'grass', '🌰', '松果箭雨', 'leaf', [
    ['橡果鼠', '/pets/acornsquirrel_1.png'], ['松果射手', '/pets/acornsquirrel_2.png'], ['森林神射手', '/pets/acornsquirrel_3.png'],
  ]),
  pet('firetanuki', '火狸家族', '拍着肚皮打鼓的小狸猫，鼓声越响火越旺', 'fire', '🔥', '烈火战鼓', 'fire', [
    ['火狸仔', '/pets/firetanuki_1.png'], ['鼓焰狸', '/pets/firetanuki_2.png'], ['烈鼓狸王', '/pets/firetanuki_3.png'],
  ]),
  pet('jellyfish', '彩纱水母家族', '像一朵会发光的小伞在海里跳舞的水母，最后能放出极光', 'water', '🪼', '极光水母舞', 'water', [
    ['泡泡母', '/pets/jellyfish_1.png'], ['彩纱水母', '/pets/jellyfish_2.png'], ['极光水母后', '/pets/jellyfish_3.png'],
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
  // ===== 2026-08 新增 12 个普通家族。优先补 TYPE_CHART 里此前一只都没有的属性
  // (冰/恶/地面/毒/飞行),让属性克制在对战里真正转得起来。=====
  pet('voltaeel', '霓虹电鳗家族', '身上亮着霓虹灯条纹的小电鳗，可以在空中游动、放出闪电', 'electric', '⚡', '霓虹雷暴', 'electric', [
    ['电鳗宝', '/pets/voltaeel_1.png'], ['霓虹鳗', '/pets/voltaeel_2.png'], ['雷霆鳗龙', '/pets/voltaeel_3.png'],
  ]),
  pet('snowleopard', '雪豹家族', '住在雪山上的小雪豹，尾巴又长又粗，最后身上结出了冰晶铠甲', 'ice', '❄️', '冰川暴雪', 'star', [
    ['雪团豹', '/pets/snowleopard_1.png'], ['霜纹豹', '/pets/snowleopard_2.png'], ['冰川豹王', '/pets/snowleopard_3.png'],
  ]),
  pet('shadowcat', '夜影猫家族', '额头有一弯月牙的小黑猫，能躲进影子里，最后召唤月蚀', 'dark', '🌑', '月蚀暗光', 'star', [
    ['影喵', '/pets/shadowcat_1.png'], ['夜影猫', '/pets/shadowcat_2.png'], ['月蚀猫王', '/pets/shadowcat_3.png'],
  ]),
  pet('dartfrog', '彩毒蛙家族', '颜色越鲜艳越厉害的小毒蛙，警告大家别靠近，最后能喷出七彩毒雾', 'poison', '☠️', '七彩毒雾', 'star', [
    ['彩毒蛙', '/pets/dartfrog_1.png'], ['毒雾蛙', '/pets/dartfrog_2.png'], ['剧彩蛙王', '/pets/dartfrog_3.png'],
  ]),
  pet('digmole', '掘地鼹家族', '戴着矿工帽的小鼹鼠，挖遍地下的宝石，最后一跺脚就地震', 'ground', '🏜️', '大地震裂', 'star', [
    ['土豆鼹', '/pets/digmole_1.png'], ['矿灯鼹', '/pets/digmole_2.png'], ['大地鼹王', '/pets/digmole_3.png'],
  ]),
  pet('dunecamel', '沙丘骆驼家族', '背着两个驼峰的小骆驼，走过沙漠时脚下会卷起沙尘', 'ground', '🐫', '沙丘风暴', 'star', [
    ['沙驼仔', '/pets/dunecamel_1.png'], ['沙丘骆驼', '/pets/dunecamel_2.png'], ['沙漠驼王', '/pets/dunecamel_3.png'],
  ]),
  pet('swallow', '剪尾燕家族', '尾巴像剪刀的小燕子，飞得最快，翅膀一挥就是一道风刃', 'flying', '🐦', '剪风斩', 'star', [
    ['春燕仔', '/pets/swallow_1.png'], ['剪尾燕', '/pets/swallow_2.png'], ['疾风燕王', '/pets/swallow_3.png'],
  ]),
  pet('hummingbird', '翠羽蜂鸟家族', '最小的鸟，翅膀扇得看不清，长大后羽毛像彩虹一样发光', 'flying', '🕊️', '虹光俯冲', 'star', [
    ['蜂鸟仔', '/pets/hummingbird_1.png'], ['翠羽蜂鸟', '/pets/hummingbird_2.png'], ['虹光蜂鸟', '/pets/hummingbird_3.png'],
  ]),
  pet('ironrhino', '钢甲犀家族', '角是闪亮钢铁做的小犀牛，长大后全身披上钢甲', 'steel', '⚙️', '钢角冲锋', 'star', [
    ['铁角犀', '/pets/ironrhino_1.png'], ['钢甲犀', '/pets/ironrhino_2.png'], ['钢铁犀王', '/pets/ironrhino_3.png'],
  ]),
  pet('seahorse', '潮剑海马家族', '卷着尾巴的小海马，用水流练剑，最后成了守护珊瑚礁的骑士', 'water', '💧', '潮流剑舞', 'water', [
    ['小海马', '/pets/seahorse_1.png'], ['潮剑海马', '/pets/seahorse_2.png'], ['海马骑士', '/pets/seahorse_3.png'],
  ]),
  pet('flamingo', '焰舞烈鸟家族', '单脚站着跳芭蕾的火烈鸟，跳起来羽毛会变成火焰', 'fire', '🔥', '烈焰芭蕾', 'fire', [
    ['粉焰雏', '/pets/flamingo_1.png'], ['焰羽烈鸟', '/pets/flamingo_2.png'], ['焰舞烈鸟', '/pets/flamingo_3.png'],
  ]),
  pet('cactus', '仙人掌家族', '头上开着小花的仙人球，长大后成了戴拳套的仙人掌拳手', 'grass', '🌵', '千刺重锤', 'leaf', [
    ['仙人球', '/pets/cactus_1.png'], ['掌刺拳手', '/pets/cactus_2.png'], ['沙漠掌王', '/pets/cactus_3.png'],
  ]),
  // ===== 第三批 10 个家族(2026-08-11 上线,11-04 换成原创)。与后端 core/pet_species 同一批 key。=====
  pet('flyingsquirrel', '滑翔鼯鼠家族', '张开身上的皮膜就能滑翔的小鼯鼠，飞过之处刮起大风', 'flying', '🌬️', '狂风滑翔', 'star', [
    ['飞鼠仔', '/pets/flyingsquirrel_1.png'], ['滑翔鼯鼠', '/pets/flyingsquirrel_2.png'], ['风翼鼯鼠王', '/pets/flyingsquirrel_3.png'],
  ]),
  pet('terracotta', '陶俑家族', '陶土捏成的小士兵活了过来，守护着古老的宝藏', 'rock', '🪨', '陶石炮', 'star', [
    ['陶俑仔', '/pets/terracotta_1.png'], ['陶甲俑', '/pets/terracotta_2.png'], ['石甲将军', '/pets/terracotta_3.png'],
  ]),
  pet('dragonfly', '翠翼蜻蜓家族', '停在荷叶上的小蜻蜓，翅膀像玻璃，飞得又快又稳', 'bug', '🪽', '疾风剪翼', 'star', [
    ['小蜻蜓', '/pets/dragonfly_1.png'], ['翠翼蜻蜓', '/pets/dragonfly_2.png'], ['疾翼蜻蜓王', '/pets/dragonfly_3.png'],
  ]),
  pet('goldmonkey', '金丝猴家族', '毛色金灿灿的小猴子，每天在山顶练拳，最后拳风能吹开云海', 'fighting', '🥊', '云海拳风', 'star', [
    ['金丝猴仔', '/pets/goldmonkey_1.png'], ['拳法金猴', '/pets/goldmonkey_2.png'], ['齐云拳圣', '/pets/goldmonkey_3.png'],
  ]),
  pet('sloth', '树懒家族', '动作超慢、一直在笑的小树懒，看起来懒，压下来却力气超大', 'normal', '🦥', '慢慢大压制', 'star', [
    ['懒懒宝', '/pets/sloth_1.png'], ['抱树懒', '/pets/sloth_2.png'], ['树懒长老', '/pets/sloth_3.png'],
  ]),
  pet('magnetcrab', '磁钳蟹家族', '两只钳子是马蹄形磁铁的小螃蟹，一靠近铁东西就吸过来', 'steel', '🧲', '电磁钳炮', 'electric', [
    ['磁钳蟹', '/pets/magnetcrab_1.png'], ['磁甲蟹', '/pets/magnetcrab_2.png'], ['磁暴蟹王', '/pets/magnetcrab_3.png'],
  ]),
  pet('yak', '牦牛家族', '披着长长厚毛的高原小牦牛，冲起来像一座会跑的小山', 'normal', '🐂', '雪原狂奔', 'star', [
    ['小牦牛', '/pets/yak_1.png'], ['冲锋牦牛', '/pets/yak_2.png'], ['雪原牦牛王', '/pets/yak_3.png'],
  ]),
  pet('peacock', '孔雀家族', '小时候毛茸茸的孔雀宝宝，长大一开屏，羽毛上全是会发光的眼睛花纹', 'flying', '🦚', '百羽开屏', 'star', [
    ['孔雀雏', '/pets/peacock_1.png'], ['开屏孔雀', '/pets/peacock_2.png'], ['百羽孔雀王', '/pets/peacock_3.png'],
  ]),
  pet('ladybug', '七星瓢虫家族', '背上有七颗黑点的小瓢虫，长大后穿上红色甲胄成了七星甲士', 'bug', '🐞', '七星连撞', 'star', [
    ['瓢虫宝', '/pets/ladybug_1.png'], ['七星瓢虫', '/pets/ladybug_2.png'], ['七星甲士', '/pets/ladybug_3.png'],
  ]),
  pet('mosssnail', '苔壳蜗牛家族', '背着长满青苔小花园的蜗牛，走得慢，壳上的花园越长越大', 'grass', '🐌', '苔藓风暴', 'leaf', [
    ['苔壳蜗', '/pets/mosssnail_1.png'], ['花园蜗牛', '/pets/mosssnail_2.png'], ['森林蜗牛王', '/pets/mosssnail_3.png'],
  ]),
  // ===== 第二批 42 个普通家族(2026-11-05,画风更酷,补冰/恶/幽灵/妖精/毒)。与后端同一批 key。=====
  pet('aurorawolf', '极光狼家族', '在雪夜里奔跑的狼，鬃毛会流出彩色的极光', 'fairy', '🐺', '极光狼嚎', 'star', [
    ['光幼狼', '/pets/aurorawolf_1.png'], ['极光狼', '/pets/aurorawolf_2.png'], ['极光狼王', '/pets/aurorawolf_3.png'],
  ]),
  pet('crystalstag', '晶角鹿家族', '鹿角是一簇簇水晶，月光照上去会折出七彩的光', 'fairy', '💎', '晶光之角', 'star', [
    ['晶芽鹿', '/pets/crystalstag_1.png'], ['晶角鹿', '/pets/crystalstag_2.png'], ['棱晶鹿王', '/pets/crystalstag_3.png'],
  ]),
  pet('dawnpegasus', '晨曦天马家族', '背上长着金色羽翼的天马，第一缕晨光照到它就飞起来', 'fairy', '🦄', '晨曦冲锋', 'star', [
    ['晨驹', '/pets/dawnpegasus_1.png'], ['晨曦天马', '/pets/dawnpegasus_2.png'], ['破晓天马', '/pets/dawnpegasus_3.png'],
  ]),
  pet('rosefencer', '蔷薇剑猫家族', '披着蔷薇花瓣斗篷的剑士猫，剑术又快又优雅', 'fairy', '🌹', '蔷薇百花斩', 'star', [
    ['蔷薇猫', '/pets/rosefencer_1.png'], ['剑士猫', '/pets/rosefencer_2.png'], ['蔷薇剑圣', '/pets/rosefencer_3.png'],
  ]),
  pet('armorghost', '空甲武士家族', '一套没有人的古代盔甲，里面燃着蓝色的火，守护着古城', 'ghost', '👻', '青焰一闪', 'star', [
    ['空盔灵', '/pets/armorghost_1.png'], ['空甲武士', '/pets/armorghost_2.png'], ['青焰大将', '/pets/armorghost_3.png'],
  ]),
  pet('piyinglong', '皮影龙家族', '皮影戏里的龙活了过来，身体是镂空雕花的彩色皮影', 'ghost', '🎭', '灯影龙舞', 'star', [
    ['皮影蛇', '/pets/piyinglong_1.png'], ['皮影龙', '/pets/piyinglong_2.png'], ['千灯影龙', '/pets/piyinglong_3.png'],
  ]),
  pet('operamask', '脸谱灵家族', '京剧脸谱成了精，一转身就换一张脸', 'ghost', '🎭', '变脸幻影', 'star', [
    ['小脸谱', '/pets/operamask_1.png'], ['脸谱灵', '/pets/operamask_2.png'], ['千面戏王', '/pets/operamask_3.png'],
  ]),
  pet('wispmoth', '冥灯蛾家族', '翅膀上的花纹像一盏盏小灯笼，夜里会发出幽蓝的光', 'ghost', '🦋', '冥灯幻舞', 'star', [
    ['冥灯虫', '/pets/wispmoth_1.png'], ['冥灯蛾', '/pets/wispmoth_2.png'], ['幽灯蛾皇', '/pets/wispmoth_3.png'],
  ]),
  pet('frostlynx', '霜耳猞猁家族', '耳尖长着冰棱的猞猁，在雪地里一点声音都没有', 'ice', '❄️', '冰棱突袭', 'star', [
    ['霜耳猞', '/pets/frostlynx_1.png'], ['冰爪猞猁', '/pets/frostlynx_2.png'], ['寒刃猞猁', '/pets/frostlynx_3.png'],
  ]),
  pet('glacierpenguin', '冰川骑士家族', '戴着冰做的头盔的企鹅，长大成了扛着冰锤的骑士', 'ice', '🐧', '冰川重锤', 'star', [
    ['冰盔鹅', '/pets/glacierpenguin_1.png'], ['冰甲企鹅', '/pets/glacierpenguin_2.png'], ['冰川骑士', '/pets/glacierpenguin_3.png'],
  ]),
  pet('icewyvern', '霜翼飞龙家族', '翅膀像冰片一样透明的飞龙，飞过的地方都会下雪', 'ice', '🐲', '霜翼风暴', 'star', [
    ['霜翼仔', '/pets/icewyvern_1.png'], ['霜翼飞龙', '/pets/icewyvern_2.png'], ['冰原翼王', '/pets/icewyvern_3.png'],
  ]),
  pet('snowowl', '雪鸮家族', '夜里在雪原上无声飞行的猫头鹰，眼睛像两盏金灯', 'ice', '🦉', '雪夜猎影', 'star', [
    ['雪鸮雏', '/pets/snowowl_1.png'], ['雪鸮', '/pets/snowowl_2.png'], ['雪原鸮王', '/pets/snowowl_3.png'],
  ]),
  pet('shadowfox', '影刃狐家族', '尾巴像影子做的刀刃，跑起来只看得见一道黑影', 'dark', '🌑', '影刃乱舞', 'star', [
    ['影狐仔', '/pets/shadowfox_1.png'], ['影刃狐', '/pets/shadowfox_2.png'], ['夜行狐将', '/pets/shadowfox_3.png'],
  ]),
  pet('nightraven', '夜鸦家族', '羽毛黑得发亮的乌鸦，很聪明，喜欢收集闪光的东西', 'dark', '🐦‍⬛', '黑羽风暴', 'star', [
    ['夜鸦雏', '/pets/nightraven_1.png'], ['夜鸦', '/pets/nightraven_2.png'], ['夜幕鸦王', '/pets/nightraven_3.png'],
  ]),
  pet('obsidianpanther', '黑曜豹家族', '身上镶着黑曜石的黑豹，在夜里跑得最快', 'dark', '🐆', '黑曜突刺', 'star', [
    ['黑曜豹仔', '/pets/obsidianpanther_1.png'], ['黑曜豹', '/pets/obsidianpanther_2.png'], ['黑曜豹王', '/pets/obsidianpanther_3.png'],
  ]),
  pet('cloakbat', '斗篷蝠家族', '把翅膀当斗篷披着的蝙蝠，是黑夜里的侠客', 'dark', '🦇', '月下夜袭', 'star', [
    ['斗篷蝠', '/pets/cloakbat_1.png'], ['夜斗蝠', '/pets/cloakbat_2.png'], ['暗夜蝠侠', '/pets/cloakbat_3.png'],
  ]),
  pet('venomscorpion', '紫晶蝎家族', '尾巴尖是一颗发光紫晶的蝎子，甲壳像宝石一样亮', 'poison', '🦂', '紫晶毒刺', 'star', [
    ['晶蝎仔', '/pets/venomscorpion_1.png'], ['紫晶蝎', '/pets/venomscorpion_2.png'], ['毒晶蝎王', '/pets/venomscorpion_3.png'],
  ]),
  pet('mistserpent', '毒雾蛇家族', '在沼泽迷雾里游走的长蛇，鳞片上的花纹像毒蘑菇', 'poison', '🐍', '迷雾缠绕', 'star', [
    ['雾鳞蛇', '/pets/mistserpent_1.png'], ['毒雾蛇', '/pets/mistserpent_2.png'], ['雾沼蛇王', '/pets/mistserpent_3.png'],
  ]),
  pet('mushknight', '菌盔骑士家族', '戴着毒蘑菇头盔的小骑士，一挥剑就飘出孢子', 'poison', '🍄', '孢子突击', 'star', [
    ['小菌盔', '/pets/mushknight_1.png'], ['菌盔卫士', '/pets/mushknight_2.png'], ['孢子骑士', '/pets/mushknight_3.png'],
  ]),
  pet('rockrhino', '岩角犀家族', '角是一块尖石头的犀牛，冲过去连山都会震', 'ground', '🦏', '大地冲锋', 'star', [
    ['岩角犀仔', '/pets/rockrhino_1.png'], ['岩甲犀', '/pets/rockrhino_2.png'], ['山岳犀王', '/pets/rockrhino_3.png'],
  ]),
  pet('canyoneagle', '峡谷鹰家族', '住在红色峡谷的鹰，俯冲时能卷起沙暴', 'ground', '🦅', '沙暴俯冲', 'star', [
    ['砂羽雏', '/pets/canyoneagle_1.png'], ['峡谷鹰', '/pets/canyoneagle_2.png'], ['红岩鹰王', '/pets/canyoneagle_3.png'],
  ]),
  pet('sandmantis', '沙镰螳家族', '沙漠里的螳螂，两把镰刀像弯月，藏在沙里伏击', 'ground', '🏜️', '沙镰旋斩', 'star', [
    ['沙螳仔', '/pets/sandmantis_1.png'], ['沙镰螳', '/pets/sandmantis_2.png'], ['沙漠镰王', '/pets/sandmantis_3.png'],
  ]),
  pet('stormfalcon', '风暴隼家族', '飞得比风还快的隼，翅膀一扇就是一阵旋风', 'flying', '🌪️', '风暴疾斩', 'star', [
    ['风隼雏', '/pets/stormfalcon_1.png'], ['风暴隼', '/pets/stormfalcon_2.png'], ['雷云隼王', '/pets/stormfalcon_3.png'],
  ]),
  pet('skywhale', '云鲸家族', '在云海里游泳的鲸，背上住着一座小小的云岛', 'flying', '☁️', '云海轰鸣', 'star', [
    ['云鲸仔', '/pets/skywhale_1.png'], ['云鲸', '/pets/skywhale_2.png'], ['天穹云鲸', '/pets/skywhale_3.png'],
  ]),
  pet('swordkite', '剑翎鸢家族', '每根羽毛都像一把小剑的鸢鸟，展翅时羽毛闪着金属光', 'flying', '🪶', '万剑翎雨', 'star', [
    ['剑翎雏', '/pets/swordkite_1.png'], ['剑翎鸢', '/pets/swordkite_2.png'], ['剑翎王', '/pets/swordkite_3.png'],
  ]),
  pet('gryphon', '狮鹫家族', '鹰的头、狮子的身子，守护着高山上的宝藏', 'flying', '🦁', '狮鹫天降', 'star', [
    ['狮鹫仔', '/pets/gryphon_1.png'], ['狮鹫', '/pets/gryphon_2.png'], ['金冠狮鹫', '/pets/gryphon_3.png'],
  ]),
  pet('thundertiger', '雷纹虎家族', '身上的条纹是一道道闪电，吼一声天上就打雷', 'electric', '⚡', '雷纹猛扑', 'electric', [
    ['雷纹虎仔', '/pets/thundertiger_1.png'], ['雷纹虎', '/pets/thundertiger_2.png'], ['雷霆虎王', '/pets/thundertiger_3.png'],
  ]),
  pet('voltbeetle', '电角甲虫家族', '头上的长角能接住闪电的甲虫，甲壳闪着金属光', 'electric', '🪲', '电磁犄角', 'electric', [
    ['电角虫', '/pets/voltbeetle_1.png'], ['雷角甲虫', '/pets/voltbeetle_2.png'], ['电磁甲帝', '/pets/voltbeetle_3.png'],
  ]),
  pet('sparkfox', '电光狐家族', '尾巴里装满了电的狐狸，跑起来像一道闪电', 'electric', '🦊', '电光九连闪', 'electric', [
    ['电光狐仔', '/pets/sparkfox_1.png'], ['电光狐', '/pets/sparkfox_2.png'], ['雷尾狐王', '/pets/sparkfox_3.png'],
  ]),
  pet('ironwolf', '铁甲狼家族', '身上披着钢甲的狼，牙齿像钢刀一样硬', 'steel', '🐺', '钢牙裂斩', 'star', [
    ['铁甲狼仔', '/pets/ironwolf_1.png'], ['铁甲狼', '/pets/ironwolf_2.png'], ['钢铁狼王', '/pets/ironwolf_3.png'],
  ]),
  pet('mechadragon', '机甲龙家族', '齿轮和钢铁做成的机械龙，胸口有一颗蓝色的能量核心', 'steel', '🤖', '机甲龙炮', 'star', [
    ['机甲龙仔', '/pets/mechadragon_1.png'], ['机甲龙', '/pets/mechadragon_2.png'], ['机甲龙皇', '/pets/mechadragon_3.png'],
  ]),
  pet('bladeknight', '剑灵骑士家族', '一把古剑化成的骑士，身边总飘着几把小剑', 'steel', '⚔️', '千剑归一', 'star', [
    ['小剑灵', '/pets/bladeknight_1.png'], ['剑灵骑士', '/pets/bladeknight_2.png'], ['圣剑骑士', '/pets/bladeknight_3.png'],
  ]),
  pet('rockgolem', '符文石巨人家族', '刻满古老符文的石头巨人，符文一亮就充满力量', 'rock', '🗿', '符文崩山拳', 'star', [
    ['符文石', '/pets/rockgolem_1.png'], ['石巨人', '/pets/rockgolem_2.png'], ['符文山岳', '/pets/rockgolem_3.png'],
  ]),
  pet('crystalturtle', '晶岩龟家族', '背上长着一座水晶山的龟，是走得最慢也最结实的伙伴', 'rock', '🐢', '晶岩堡垒', 'star', [
    ['晶石龟', '/pets/crystalturtle_1.png'], ['晶岩龟', '/pets/crystalturtle_2.png'], ['晶山龟王', '/pets/crystalturtle_3.png'],
  ]),
  pet('lavadrake', '熔岩飞龙家族', '住在火山口的飞龙，鳞片缝里流着岩浆', 'dragon', '🐉', '熔岩龙吼', 'fire', [
    ['熔岩幼龙', '/pets/lavadrake_1.png'], ['熔岩飞龙', '/pets/lavadrake_2.png'], ['火山龙王', '/pets/lavadrake_3.png'],
  ]),
  pet('stormdragon', '雷云龙家族', '在雷雨云里游的长龙，龙须一甩就是闪电', 'dragon', '🌩️', '雷云龙卷', 'electric', [
    ['云纹幼龙', '/pets/stormdragon_1.png'], ['雷云龙', '/pets/stormdragon_2.png'], ['苍穹雷龙', '/pets/stormdragon_3.png'],
  ]),
  pet('jadeserpent', '翡翠蛟家族', '鳞片像翡翠一样温润的蛟，住在深山的瀑布下', 'dragon', '🐍', '翠玉龙息', 'star', [
    ['翠蛟仔', '/pets/jadeserpent_1.png'], ['翡翠蛟', '/pets/jadeserpent_2.png'], ['碧玉蛟王', '/pets/jadeserpent_3.png'],
  ]),
  pet('kungfucrane', '鹤拳家族', '练白鹤拳的丹顶鹤，单脚一站就是一个漂亮的架势', 'fighting', '🥋', '白鹤亮翅', 'star', [
    ['鹤拳雏', '/pets/kungfucrane_1.png'], ['鹤拳师', '/pets/kungfucrane_2.png'], ['鹤拳宗师', '/pets/kungfucrane_3.png'],
  ]),
  pet('bullwarrior', '斗牛勇士家族', '戴着护腕的水牛勇士，力气大、讲义气', 'fighting', '🐃', '斗牛冲天拳', 'star', [
    ['小斗牛', '/pets/bullwarrior_1.png'], ['斗牛勇士', '/pets/bullwarrior_2.png'], ['斗牛战神', '/pets/bullwarrior_3.png'],
  ]),
  pet('mantisninja', '螳影忍者家族', '戴着忍者面巾的绿螳螂，两把刀快得看不见', 'bug', '🗡️', '螳影双刀', 'star', [
    ['螳忍仔', '/pets/mantisninja_1.png'], ['螳影忍者', '/pets/mantisninja_2.png'], ['螳影上忍', '/pets/mantisninja_3.png'],
  ]),
  pet('lionknight', '狮心骑士家族', '最勇敢的狮子骑士，从不在朋友前面后退一步', 'normal', '🦁', '狮心怒吼', 'star', [
    ['狮心仔', '/pets/lionknight_1.png'], ['狮心骑士', '/pets/lionknight_2.png'], ['狮心王', '/pets/lionknight_3.png'],
  ]),
  pet('starmage', '星术猫头鹰家族', '戴着星星法师帽的猫头鹰，看一眼星空就知道明天的天气', 'psychic', '🔮', '星轨禁咒', 'star', [
    ['星术雏', '/pets/starmage_1.png'], ['星术鸮', '/pets/starmage_2.png'], ['星辰大法师', '/pets/starmage_3.png'],
  ]),
  // ===== 传说伙伴(取材中国神话)。准传说需累计学 5000 个不同单词，顶级传说需 8000，
  // 且走独立于普通 5 格的专属队伍格(后端 pet_formulas.MAX_LEGEND_SLOTS)。=====
  legendPet('baize', '白泽', '准传说 · 雪山深处的神兽白泽，懂得世间万物的名字', 'ice', '❄️', '玄冰千里', 'star', 'semi_legend', [
    ['白泽', '/pets/baize_1.png'], ['觉醒白泽', '/pets/baize_2.png'], ['究极白泽', '/pets/baize_3.png'],
  ]),
  legendPet('thunderkui', '雷鼓夔', '准传说 · 传说中只有一条腿的雷兽夔，一跺脚就像擂响了天鼓', 'electric', '⚡', '夔鼓雷鸣', 'electric', 'semi_legend', [
    ['雷鼓夔', '/pets/thunderkui_1.png'], ['觉醒雷鼓夔', '/pets/thunderkui_2.png'], ['究极雷鼓夔', '/pets/thunderkui_3.png'],
  ]),
  legendPet('vermilion', '朱雀', '准传说 · 守护南方的神鸟朱雀，飞过的地方天空都被染红', 'fire', '🔥', '南明离火', 'fire', 'semi_legend', [
    ['朱雀', '/pets/vermilion_1.png'], ['觉醒朱雀', '/pets/vermilion_2.png'], ['究极朱雀', '/pets/vermilion_3.png'],
  ]),
  legendPet('kun', '北冥鲲', '准传说 · 庄子写过的大鱼，北海里的鲲，传说能化身为鹏飞上九万里', 'water', '💧', '鲲鹏扶摇', 'water', 'semi_legend', [
    ['北冥鲲', '/pets/kun_1.png'], ['觉醒北冥鲲', '/pets/kun_2.png'], ['究极北冥鲲', '/pets/kun_3.png'],
  ]),
  legendPet('jaderabbit', '玉兔', '顶级传说 · 住在月亮上捣药的玉兔，能听懂所有人的心愿', 'psychic', '🌙', '广寒月光', 'star', 'legend', [
    ['玉兔', '/pets/jaderabbit_1.png'], ['觉醒玉兔', '/pets/jaderabbit_2.png'], ['究极玉兔', '/pets/jaderabbit_3.png'],
  ]),
  legendPet('ninecolordeer', '九色鹿', '顶级传说 · 敦煌壁画里的九色鹿，身上的九种颜色是九种力量', 'psychic', '🦌', '九色神光', 'star', 'legend', [
    ['九色鹿', '/pets/ninecolordeer_1.png'], ['觉醒九色鹿', '/pets/ninecolordeer_2.png'], ['究极九色鹿', '/pets/ninecolordeer_3.png'],
  ]),
  legendPet('yinglong', '应龙', '顶级传说 · 长着翅膀的神龙应龙，能呼风唤雨、帮大禹治水', 'dragon', '🐉', '画龙点睛', 'star', 'legend', [
    ['应龙', '/pets/yinglong_1.png'], ['觉醒应龙', '/pets/yinglong_2.png'], ['究极应龙', '/pets/yinglong_3.png'],
  ]),
  legendPet('qilin', '麒麟', '顶级传说 · 只在太平盛世出现的瑞兽麒麟，被称为百兽之首', 'normal', '✨', '祥瑞之光', 'star', 'legend', [
    ['麒麟', '/pets/qilin_1.png'], ['觉醒麒麟', '/pets/qilin_2.png'], ['究极麒麟', '/pets/qilin_3.png'],
  ]),
  // ---- 第二批稀有(2026-11-05): 准传说 毕方/獬豸/重明鸟/狰,顶级传说 四象白虎/青龙/玄武 + 九尾天狐 ----
  legendPet('bifang', '毕方', '准传说 · 只有一条腿的火鹤神鸟，它出现的地方会燃起天火', 'fire', '🔥', '毕方焚天', 'fire', 'semi_legend', [
    ['毕方', '/pets/bifang_1.png'], ['觉醒毕方', '/pets/bifang_2.png'], ['究极毕方', '/pets/bifang_3.png'],
  ]),
  legendPet('xiezhi', '獬豸', '准传说 · 头上一只角的神兽獬豸，能分辨对错，专撞说谎的人', 'fighting', '⚖️', '正义独角', 'star', 'semi_legend', [
    ['獬豸', '/pets/xiezhi_1.png'], ['觉醒獬豸', '/pets/xiezhi_2.png'], ['究极獬豸', '/pets/xiezhi_3.png'],
  ]),
  legendPet('chongming', '重明鸟', '准传说 · 每只眼睛里有两个瞳孔的神鸟，能看穿一切妖邪', 'psychic', '👁️', '重明破邪', 'star', 'semi_legend', [
    ['重明鸟', '/pets/chongming_1.png'], ['觉醒重明', '/pets/chongming_2.png'], ['究极重明', '/pets/chongming_3.png'],
  ]),
  legendPet('zheng', '狰', '准传说 · 红豹子一样的山中神兽，一只角、五条尾巴，叫声像敲石头', 'rock', '🐆', '五尾崩石', 'star', 'semi_legend', [
    ['狰', '/pets/zheng_1.png'], ['觉醒狰', '/pets/zheng_2.png'], ['究极狰', '/pets/zheng_3.png'],
  ]),
  legendPet('whitetiger', '白虎', '顶级传说 · 镇守西方的神兽白虎，一啸能让风停下来', 'steel', '🐅', '白虎啸天', 'star', 'legend', [
    ['白虎', '/pets/whitetiger_1.png'], ['觉醒白虎', '/pets/whitetiger_2.png'], ['究极白虎', '/pets/whitetiger_3.png'],
  ]),
  legendPet('azuredragon', '青龙', '顶级传说 · 镇守东方的神龙青龙，管着春天和万物生长', 'dragon', '🐉', '青龙腾云', 'leaf', 'legend', [
    ['青龙', '/pets/azuredragon_1.png'], ['觉醒青龙', '/pets/azuredragon_2.png'], ['究极青龙', '/pets/azuredragon_3.png'],
  ]),
  legendPet('blacktortoise', '玄武', '顶级传说 · 镇守北方的神兽玄武，龟和蛇合在一起，最能守', 'ground', '🐢', '玄武镇岳', 'water', 'legend', [
    ['玄武', '/pets/blacktortoise_1.png'], ['觉醒玄武', '/pets/blacktortoise_2.png'], ['究极玄武', '/pets/blacktortoise_3.png'],
  ]),
  legendPet('ninetailfox', '九尾天狐', '顶级传说 · 修炼千年的九尾天狐，九条尾巴各藏着一团狐火', 'fairy', '🦊', '九尾狐火', 'star', 'legend', [
    ['天狐', '/pets/ninetailfox_1.png'], ['觉醒天狐', '/pets/ninetailfox_2.png'], ['究极天狐', '/pets/ninetailfox_3.png'],
  ]),
];

export const PET_SPECIES_BY_ID: Record<string, PetSpeciesDefinition> = Object.fromEntries(
  PET_SPECIES.map((definition) => [definition.id, definition]),
);

// ==============================
// 技能特效配方:骨架 × 颜色 × 演出参数
// 骨架是 BattleScene3D 里的程序化特效组件(纯代码,零素材);
// 一行配方 = 一只宠物的专属大招观感。新增宠物只需在这里加一行。
// ==============================
export type SkillSkeleton = 'beam' | 'pillar' | 'slash' | 'aura' | 'projectile' | 'burst';

// 粒子贴图:黑底 PNG/WebP,前端走 mix-blend-mode:screen 叠加(黑色自动消失,
// 不需要透明通道)。素材由 backend/scripts/gen_skill_particles.py 生成。
export type SkillParticle =
  | 'spark' | 'ember' | 'bubble' | 'leaf' | 'wisp'
  | 'star' | 'shard' | 'ice' | 'petal' | 'metal';

export const PARTICLE_IMAGE: Record<SkillParticle, string> = {
  spark: '/vfx/particle-spark.webp',
  ember: '/vfx/particle-ember.webp',
  bubble: '/vfx/particle-bubble.webp',
  leaf: '/vfx/particle-leaf.webp',
  wisp: '/vfx/particle-wisp.webp',
  star: '/vfx/particle-star.webp',
  shard: '/vfx/particle-shard.webp',
  ice: '/vfx/particle-ice.webp',
  petal: '/vfx/particle-petal.webp',
  metal: '/vfx/particle-metal.webp',
};

export type SkillVfxRecipe = {
  skeleton: SkillSkeleton;
  color: string;                    // 光效主色(外层辉光)
  core?: string;                    // 内芯色,默认近白
  from?: 'sky' | 'ground';          // pillar 专用:天降(默认) or 地涌
  shake?: 'light' | 'medium' | 'heavy'; // 命中震屏强度,默认 medium
  particle?: SkillParticle;         // 命中迸散的实物粒子,缺省用纯色圆点
};

const SKILL_VFX: Record<string, SkillVfxRecipe> = {
  sparkhog:       { skeleton: 'pillar', color: '#38bdf8', core: '#fef9c3', shake: 'heavy', particle: 'spark' },  // 蒲公英雷暴
  alpaca:         { skeleton: 'projectile', color: '#fbbf24', core: '#fff7ed', particle: 'star' },              // 星絮回旋
  leafkoala:      { skeleton: 'slash', color: '#84cc16', particle: 'leaf' },                                     // 万叶旋舞
  emberham:       { skeleton: 'beam', color: '#fb923c', core: '#fef08a', shake: 'heavy', particle: 'ember' },     // 烈焰披风
  narwhee:        { skeleton: 'beam', color: '#22d3ee', core: '#e0f2fe', shake: 'heavy', particle: 'bubble' },     // 潮汐螺旋
  melopuff:       { skeleton: 'aura', color: '#f9a8d4', particle: 'star' },                                      // 甜梦摇篮曲
  umbrellaspirit: { skeleton: 'projectile', color: '#a78bfa', core: '#4c1d95', particle: 'wisp' },               // 幽伞夜雨
  candydrake:     { skeleton: 'beam', color: '#818cf8', core: '#e0e7ff', particle: 'star' },                     // 金糖龙息
  boxaroo:        { skeleton: 'slash', color: '#ef4444', shake: 'heavy', particle: 'shard' },                     // 冠军连环拳
  mindslug:       { skeleton: 'aura', color: '#e879f9', particle: 'star' },                                      // 星念涟漪
  pebbadillo:     { skeleton: 'pillar', color: '#a16207', core: '#fde68a', shake: 'heavy', particle: 'shard' },   // 滚石轰隆
  blazekat:       { skeleton: 'burst', color: '#fb923c', core: '#fef08a', particle: 'ember' },                    // 日冕爆炎
  liondog:        { skeleton: 'slash', color: '#fb923c', shake: 'medium', particle: 'ember' },                    // 醒狮烈焰
  surfduck:       { skeleton: 'slash', color: '#22d3ee', particle: 'bubble' },                                     // 潮光羽浪
  potsprout:      { skeleton: 'aura', color: '#f472b6', particle: 'petal' },                                      // 百花盛放
  bubbleoct:      { skeleton: 'burst', color: '#22d3ee', particle: 'bubble' },                                     // 漩涡泡泡阵
  silkmoth:       { skeleton: 'aura', color: '#cbd5e1', particle: 'metal' },                                      // 银丝月光
  honeybee:       { skeleton: 'projectile', color: '#a3e635', particle: 'leaf' },                                // 蜂巢针雨
  pitcherplant:   { skeleton: 'slash', color: '#84cc16', particle: 'leaf' },                                     // 露珠鞭击
  axolotl:        { skeleton: 'beam', color: '#22d3ee', core: '#cffafe', particle: 'bubble' },                     // 珊瑚漩流
  geocub:         { skeleton: 'projectile', color: '#a16207', shake: 'heavy', particle: 'shard' },                // 水晶山崩
  lanternfairy:   { skeleton: 'aura', color: '#e879f9', particle: 'star' },                                      // 千灯祈愿
  lotuscalf:      { skeleton: 'beam', color: '#facc15', core: '#fefce8', particle: 'leaf' },                     // 清荷落雨
  flamepanda:     { skeleton: 'beam', color: '#fb923c', core: '#fef08a', particle: 'ember' },                     // 竹火冲天
  otterwave:      { skeleton: 'slash', color: '#22d3ee', particle: 'bubble' },                                     // 浪花连环掌
  chameleaf:      { skeleton: 'slash', color: '#84cc16', particle: 'leaf' },                                     // 千叶隐身斩
  sunrooster:     { skeleton: 'burst', color: '#fb923c', core: '#fde047', shake: 'heavy', particle: 'ember' },    // 破晓金焰
  mudhippo:       { skeleton: 'burst', color: '#b45309', core: '#67e8f9', particle: 'bubble' },                    // 泥浪大翻滚
  cloudkite:      { skeleton: 'pillar', color: '#818cf8', core: '#fbcfe8', shake: 'heavy', particle: 'star' },   // 万丈风筝阵
  clockbot:       { skeleton: 'projectile', color: '#cbd5e1', core: '#f8fafc', shake: 'heavy', particle: 'metal' }, // 齿轮星爆拳
  dunewhale:      { skeleton: 'slash', color: '#818cf8', shake: 'heavy', particle: 'shard' },                     // 沙海龙卷
  bambooweasel:   { skeleton: 'pillar', color: '#84cc16', from: 'ground', shake: 'heavy', particle: 'leaf' },    // 千竹破土
  lavaboar:       { skeleton: 'burst', color: '#fb923c', shake: 'heavy', particle: 'ember' },                     // 熔岩冲撞
  shellpenguin:   { skeleton: 'slash', color: '#22d3ee', core: '#f0fdfa', particle: 'bubble' },                    // 贝刃回旋
  acornsquirrel:  { skeleton: 'projectile', color: '#84cc16', core: '#fef9c3', particle: 'leaf' },               // 松果箭雨
  firetanuki:     { skeleton: 'slash', color: '#ef4444', core: '#fde047', shake: 'heavy', particle: 'ember' },    // 烈火战鼓
  jellyfish:      { skeleton: 'aura', color: '#22d3ee', core: '#fce7f3', shake: 'medium', particle: 'bubble' },    // 极光水母舞
  book_fox:   { skeleton: 'aura', color: '#fbbf24', particle: 'star' },                                      // 知识星辉
  paper_owl:  { skeleton: 'beam', color: '#e879f9', core: '#fdf4ff', particle: 'star' },                     // 智慧光束
  word_turtle: { skeleton: 'beam', color: '#22d3ee', core: '#dbeafe', particle: 'bubble' },                    // 词海奔流
  // ---- 2026-08 新增普通家族 ----
  voltaeel:       { skeleton: 'pillar', color: '#38bdf8', core: '#fef9c3', shake: 'heavy', particle: 'spark' },   // 霓虹雷暴
  snowleopard:    { skeleton: 'burst', color: '#a5f3fc', core: '#f0f9ff', shake: 'heavy', particle: 'ice' },      // 冰川暴雪
  shadowcat:      { skeleton: 'beam', color: '#64748b', core: '#c084fc', shake: 'heavy', particle: 'wisp' },      // 月蚀暗光
  dartfrog:       { skeleton: 'projectile', color: '#c084fc', core: '#f5d0fe', particle: 'shard' },              // 七彩毒雾
  digmole:        { skeleton: 'pillar', color: '#d97706', from: 'ground', shake: 'heavy', particle: 'shard' },    // 大地震裂
  dunecamel:      { skeleton: 'pillar', color: '#a16207', from: 'ground', shake: 'heavy', particle: 'shard' },    // 沙丘风暴
  swallow:        { skeleton: 'slash', color: '#bae6fd', core: '#f8fafc', particle: 'wisp' },                     // 剪风斩
  hummingbird:    { skeleton: 'projectile', color: '#bae6fd', core: '#fff7ed', shake: 'medium', particle: 'star' }, // 虹光俯冲
  ironrhino:      { skeleton: 'projectile', color: '#cbd5e1', core: '#f8fafc', shake: 'heavy', particle: 'metal' }, // 钢角冲锋
  seahorse:       { skeleton: 'slash', color: '#22d3ee', core: '#ecfeff', particle: 'bubble' },                    // 潮流剑舞
  flamingo:       { skeleton: 'burst', color: '#fb923c', core: '#fde047', particle: 'ember' },                     // 烈焰芭蕾
  cactus:         { skeleton: 'slash', color: '#84cc16', shake: 'heavy', particle: 'leaf' },                      // 千刺重锤
  // ---- 第三批家族 ----
  flyingsquirrel: { skeleton: 'burst', color: '#bae6fd', core: '#fff7ed', shake: 'heavy', particle: 'wisp' },      // 狂风滑翔
  terracotta:     { skeleton: 'projectile', color: '#a8a29e', core: '#e7e5e4', shake: 'heavy', particle: 'shard' }, // 陶石炮
  dragonfly:      { skeleton: 'slash', color: '#4ade80', core: '#f0fdf4', shake: 'medium', particle: 'shard' },     // 疾风剪翼
  goldmonkey:     { skeleton: 'projectile', color: '#38bdf8', core: '#e0f2fe', shake: 'heavy', particle: 'spark' }, // 云海拳风
  sloth:          { skeleton: 'slash', color: '#14b8a6', core: '#fef3c7', shake: 'heavy', particle: 'shard' },      // 慢慢大压制
  magnetcrab:     { skeleton: 'beam', color: '#cbd5e1', core: '#fef9c3', shake: 'heavy', particle: 'spark' },       // 电磁钳炮
  yak:            { skeleton: 'slash', color: '#a16207', core: '#fed7aa', shake: 'heavy', particle: 'shard' },      // 雪原狂奔
  peacock:        { skeleton: 'projectile', color: '#14b8a6', core: '#fef9c3', shake: 'medium', particle: 'star' }, // 百羽开屏
  ladybug:        { skeleton: 'slash', color: '#92400e', core: '#fde68a', shake: 'heavy', particle: 'shard' },      // 七星连撞
  mosssnail:      { skeleton: 'burst', color: '#65a30d', core: '#ecfccb', shake: 'medium', particle: 'leaf' },      // 苔藓风暴
  // ---- 第二批家族 ----
  aurorawolf:     { skeleton: 'aura', color: '#f9a8d4', core: '#fdf4ff', shake: 'medium', particle: 'petal' }, // 极光狼嚎
  crystalstag:    { skeleton: 'aura', color: '#f9a8d4', core: '#fdf4ff', shake: 'medium', particle: 'petal' }, // 晶光之角
  dawnpegasus:    { skeleton: 'aura', color: '#f9a8d4', core: '#fdf4ff', shake: 'medium', particle: 'petal' }, // 晨曦冲锋
  rosefencer:     { skeleton: 'aura', color: '#f9a8d4', core: '#fdf4ff', shake: 'medium', particle: 'petal' }, // 蔷薇百花斩
  armorghost:     { skeleton: 'projectile', color: '#22d3ee', core: '#312e81', shake: 'medium', particle: 'wisp' }, // 青焰一闪
  piyinglong:     { skeleton: 'projectile', color: '#22d3ee', core: '#312e81', shake: 'medium', particle: 'wisp' }, // 灯影龙舞
  operamask:      { skeleton: 'projectile', color: '#22d3ee', core: '#312e81', shake: 'medium', particle: 'wisp' }, // 变脸幻影
  wispmoth:       { skeleton: 'projectile', color: '#22d3ee', core: '#312e81', shake: 'medium', particle: 'wisp' }, // 冥灯幻舞
  frostlynx:      { skeleton: 'burst', color: '#a5f3fc', core: '#f0f9ff', shake: 'heavy', particle: 'ice' }, // 冰棱突袭
  glacierpenguin: { skeleton: 'burst', color: '#a5f3fc', core: '#f0f9ff', shake: 'heavy', particle: 'ice' }, // 冰川重锤
  icewyvern:      { skeleton: 'burst', color: '#a5f3fc', core: '#f0f9ff', shake: 'heavy', particle: 'ice' }, // 霜翼风暴
  snowowl:        { skeleton: 'burst', color: '#a5f3fc', core: '#f0f9ff', shake: 'heavy', particle: 'ice' }, // 雪夜猎影
  shadowfox:      { skeleton: 'slash', color: '#7c3aed', core: '#1e1b4b', shake: 'heavy', particle: 'wisp' }, // 影刃乱舞
  nightraven:     { skeleton: 'slash', color: '#7c3aed', core: '#1e1b4b', shake: 'heavy', particle: 'wisp' }, // 黑羽风暴
  obsidianpanther:{ skeleton: 'slash', color: '#7c3aed', core: '#1e1b4b', shake: 'heavy', particle: 'wisp' }, // 黑曜突刺
  cloakbat:       { skeleton: 'slash', color: '#7c3aed', core: '#1e1b4b', shake: 'heavy', particle: 'wisp' }, // 月下夜袭
  venomscorpion:  { skeleton: 'projectile', color: '#a855f7', core: '#f5d0fe', particle: 'shard' }, // 紫晶毒刺
  mistserpent:    { skeleton: 'projectile', color: '#a855f7', core: '#f5d0fe', particle: 'shard' }, // 迷雾缠绕
  mushknight:     { skeleton: 'projectile', color: '#a855f7', core: '#f5d0fe', particle: 'shard' }, // 孢子突击
  rockrhino:      { skeleton: 'pillar', color: '#d97706', from: 'ground', shake: 'heavy', particle: 'shard' }, // 大地冲锋
  canyoneagle:    { skeleton: 'pillar', color: '#d97706', from: 'ground', shake: 'heavy', particle: 'shard' }, // 沙暴俯冲
  sandmantis:     { skeleton: 'pillar', color: '#d97706', from: 'ground', shake: 'heavy', particle: 'shard' }, // 沙镰旋斩
  stormfalcon:    { skeleton: 'slash', color: '#bae6fd', core: '#f8fafc', shake: 'medium', particle: 'wisp' }, // 风暴疾斩
  skywhale:       { skeleton: 'slash', color: '#bae6fd', core: '#f8fafc', shake: 'medium', particle: 'wisp' }, // 云海轰鸣
  swordkite:      { skeleton: 'slash', color: '#bae6fd', core: '#f8fafc', shake: 'medium', particle: 'wisp' }, // 万剑翎雨
  gryphon:        { skeleton: 'slash', color: '#bae6fd', core: '#f8fafc', shake: 'medium', particle: 'wisp' }, // 狮鹫天降
  thundertiger:   { skeleton: 'pillar', color: '#facc15', core: '#fefce8', shake: 'heavy', particle: 'spark' }, // 雷纹猛扑
  voltbeetle:     { skeleton: 'pillar', color: '#facc15', core: '#fefce8', shake: 'heavy', particle: 'spark' }, // 电磁犄角
  sparkfox:       { skeleton: 'pillar', color: '#facc15', core: '#fefce8', shake: 'heavy', particle: 'spark' }, // 电光九连闪
  ironwolf:       { skeleton: 'slash', color: '#cbd5e1', core: '#f8fafc', shake: 'heavy', particle: 'metal' }, // 钢牙裂斩
  mechadragon:    { skeleton: 'slash', color: '#cbd5e1', core: '#f8fafc', shake: 'heavy', particle: 'metal' }, // 机甲龙炮
  bladeknight:    { skeleton: 'slash', color: '#cbd5e1', core: '#f8fafc', shake: 'heavy', particle: 'metal' }, // 千剑归一
  rockgolem:      { skeleton: 'pillar', color: '#a16207', core: '#fde68a', shake: 'heavy', particle: 'shard' }, // 符文崩山拳
  crystalturtle:  { skeleton: 'pillar', color: '#a16207', core: '#fde68a', shake: 'heavy', particle: 'shard' }, // 晶岩堡垒
  lavadrake:      { skeleton: 'beam', color: '#f97316', core: '#fef08a', shake: 'heavy', particle: 'ember' }, // 熔岩龙吼
  stormdragon:    { skeleton: 'pillar', color: '#60a5fa', core: '#fefce8', shake: 'heavy', particle: 'spark' }, // 雷云龙卷
  jadeserpent:    { skeleton: 'beam', color: '#818cf8', core: '#fef9c3', shake: 'heavy', particle: 'star' }, // 翠玉龙息
  kungfucrane:    { skeleton: 'slash', color: '#ef4444', core: '#fef2f2', shake: 'heavy', particle: 'shard' }, // 白鹤亮翅
  bullwarrior:    { skeleton: 'slash', color: '#ef4444', core: '#fef2f2', shake: 'heavy', particle: 'shard' }, // 斗牛冲天拳
  mantisninja:    { skeleton: 'slash', color: '#4ade80', core: '#f0fdf4', shake: 'medium', particle: 'leaf' }, // 螳影双刀
  lionknight:     { skeleton: 'burst', color: '#fbbf24', core: '#fffbeb', shake: 'heavy', particle: 'star' }, // 狮心怒吼
  starmage:       { skeleton: 'aura', color: '#a78bfa', core: '#ede9fe', shake: 'medium', particle: 'star' }, // 星轨禁咒
  // ---- 传说:统一给最重的震屏与双色内芯,大招观感必须压过普通宠物 ----
  baize:          { skeleton: 'burst', color: '#a5f3fc', core: '#ffffff', shake: 'heavy', particle: 'ice' },      // 玄冰千里
  thunderkui:     { skeleton: 'pillar', color: '#facc15', core: '#ffffff', shake: 'heavy', particle: 'spark' },   // 夔鼓雷鸣
  vermilion:      { skeleton: 'beam', color: '#f97316', core: '#fef9c3', shake: 'heavy', particle: 'ember' },     // 南明离火
  kun:            { skeleton: 'pillar', color: '#22d3ee', from: 'ground', shake: 'heavy', particle: 'bubble' },   // 鲲鹏扶摇
  jaderabbit:     { skeleton: 'aura', color: '#f9a8d4', core: '#ffffff', shake: 'heavy', particle: 'star' },      // 广寒月光
  ninecolordeer:  { skeleton: 'beam', color: '#e879f9', core: '#ffffff', shake: 'heavy', particle: 'star' },      // 九色神光
  yinglong:       { skeleton: 'beam', color: '#f59e0b', core: '#fef9c3', shake: 'heavy', particle: 'star' },     // 画龙点睛
  qilin:          { skeleton: 'pillar', color: '#fbbf24', core: '#ffffff', shake: 'heavy', particle: 'star' },    // 祥瑞之光
  bifang:         { skeleton: 'beam', color: '#3b82f6', core: '#fef2f2', shake: 'heavy', particle: 'ember' }, // 毕方焚天
  xiezhi:         { skeleton: 'slash', color: '#ef4444', core: '#fef2f2', shake: 'heavy', particle: 'shard' }, // 正义独角
  chongming:      { skeleton: 'aura', color: '#a78bfa', core: '#ede9fe', shake: 'medium', particle: 'star' }, // 重明破邪
  zheng:          { skeleton: 'pillar', color: '#a16207', core: '#fde68a', shake: 'heavy', particle: 'shard' }, // 五尾崩石
  whitetiger:     { skeleton: 'slash', color: '#e2e8f0', core: '#ffffff', shake: 'heavy', particle: 'metal' }, // 白虎啸天
  azuredragon:    { skeleton: 'beam', color: '#14b8a6', core: '#f0fdfa', shake: 'heavy', particle: 'leaf' }, // 青龙腾云
  blacktortoise:  { skeleton: 'pillar', color: '#0e7490', core: '#ecfeff', from: 'ground', shake: 'heavy', particle: 'bubble' }, // 玄武镇岳
  ninetailfox:    { skeleton: 'aura', color: '#c084fc', core: '#ffffff', shake: 'heavy', particle: 'petal' }, // 九尾狐火
};

// 没写配方的种族按元素兜底,保证新增宠物漏配也有像样的大招
const ELEMENT_VFX_FALLBACK: Record<PetElement, SkillVfxRecipe> = {
  normal: { skeleton: 'burst', color: '#f9a8d4' },
  fire: { skeleton: 'beam', color: '#fb923c', core: '#fef08a' },
  water: { skeleton: 'beam', color: '#22d3ee' },
  grass: { skeleton: 'slash', color: '#84cc16' },
  electric: { skeleton: 'pillar', color: '#38bdf8', shake: 'heavy' },
  ice: { skeleton: 'burst', color: '#a5f3fc' },
  fighting: { skeleton: 'slash', color: '#ef4444', shake: 'heavy' },
  poison: { skeleton: 'burst', color: '#c084fc' },
  ground: { skeleton: 'pillar', color: '#d97706', from: 'ground' },
  flying: { skeleton: 'slash', color: '#bae6fd' },
  psychic: { skeleton: 'aura', color: '#e879f9' },
  bug: { skeleton: 'projectile', color: '#a3e635' },
  rock: { skeleton: 'pillar', color: '#a16207', shake: 'heavy' },
  ghost: { skeleton: 'projectile', color: '#a78bfa' },
  dragon: { skeleton: 'beam', color: '#818cf8', shake: 'heavy' },
  dark: { skeleton: 'burst', color: '#64748b' },
  steel: { skeleton: 'projectile', color: '#cbd5e1' },
  fairy: { skeleton: 'aura', color: '#f9a8d4' },
};

/** 默认种族(没养宠物 / 认不出的 id 一律按它显示)。与后端 core/pet_species.DEFAULT_SPECIES 同值。 */
export const DEFAULT_SPECIES = 'sparkhog';

/** 2026-11-04 宝可梦种族换成原创伙伴: 旧 id → 新 id(真源后端 core/pet_species.LEGACY_SPECIES)。
 *  库里的 user_pets 启动时已整体换掉,这里只兜住还没刷新的旧页面 / 旧对战记录里的旧 id,
 *  否则它们会全部显示成默认那一只。 */
export const LEGACY_SPECIES: Record<string, string> = {
  pikachu: 'sparkhog',
  eevee: 'alpaca',
  bulbasaur: 'leafkoala',
  charmander: 'emberham',
  squirtle: 'narwhee',
  jigglypuff: 'melopuff',
  gastly: 'umbrellaspirit',
  dratini: 'candydrake',
  machop: 'boxaroo',
  abra: 'mindslug',
  geodude: 'pebbadillo',
  vulpix: 'blazekat',
  growlithe: 'liondog',
  magikarp: 'surfduck',
  oddish: 'potsprout',
  poliwag: 'bubbleoct',
  caterpie: 'silkmoth',
  weedle: 'honeybee',
  bellsprout: 'pitcherplant',
  horsea: 'axolotl',
  larvitar: 'geocub',
  ralts: 'lanternfairy',
  chikorita: 'lotuscalf',
  cyndaquil: 'flamepanda',
  totodile: 'otterwave',
  treecko: 'chameleaf',
  torchic: 'sunrooster',
  mudkip: 'mudhippo',
  bagon: 'cloudkite',
  beldum: 'clockbot',
  gible: 'dunewhale',
  snivy: 'bambooweasel',
  tepig: 'lavaboar',
  oshawott: 'shellpenguin',
  rowlet: 'acornsquirrel',
  litten: 'firetanuki',
  popplio: 'jellyfish',
  mareep: 'voltaeel',
  swinub: 'snowleopard',
  deino: 'shadowcat',
  nidoran: 'dartfrog',
  trapinch: 'digmole',
  sandile: 'dunecamel',
  zubat: 'swallow',
  starly: 'hummingbird',
  rookidee: 'ironrhino',
  froakie: 'seahorse',
  fennekin: 'flamingo',
  chespin: 'cactus',
  pidgey: 'flyingsquirrel',
  onix: 'terracotta',
  scyther: 'dragonfly',
  riolu: 'goldmonkey',
  munchlax: 'sloth',
  magnemite: 'magnetcrab',
  tauros: 'yak',
  doduo: 'peacock',
  pinsir: 'ladybug',
  tropius: 'mosssnail',
  articuno: 'baize',
  zapdos: 'thunderkui',
  moltres: 'vermilion',
  suicune: 'kun',
  mew: 'jaderabbit',
  mewtwo: 'ninecolordeer',
  rayquaza: 'yinglong',
  arceus: 'qilin',
};

export function getSkillVfxRecipe(species: string): SkillVfxRecipe {
  const definition = getPetDefinition(species);
  return SKILL_VFX[definition.id] || ELEMENT_VFX_FALLBACK[definition.element];
}

export function getPetDefinition(species: string): PetSpeciesDefinition {
  return PET_SPECIES_BY_ID[species] || PET_SPECIES_BY_ID[LEGACY_SPECIES[species]] || PET_SPECIES_BY_ID[DEFAULT_SPECIES];
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

/** 最终进化形态（用于通关庆祝这类"高光展示"场合：哪怕现在还是幼体，也show最帅的样子）。
 *  已练到晶耀（stage 4）的返回晶耀档，好让光环特效生效；否则返回第三段进化。 */
export function getPetFinalStage(species: string, evolutionStage: number): PetStage {
  const stages = getPetDefinition(species).stages;
  return evolutionStage >= 4 ? stages[4] : stages[3];
}

export function getPetTier(species: string): PetTier {
  return getPetDefinition(species).tier;
}

/** 是否传说(含准传说)。传说走独立队伍格、有累计学词门槛。 */
export function isLegendary(species: string): boolean {
  return getPetTier(species) !== 'normal';
}

/** 领养该种族所需的累计学词数;普通种族返回 0(只受队伍格约束)。 */
export function wordsRequiredFor(species: string): number {
  return TIER_WORDS[getPetTier(species)];
}

/** 稀有度战力加成,必须与后端 core/pet_species.TIER_POWER_BONUS 同值。 */
export const TIER_POWER_BONUS: Record<PetTier, { damage: number; ultimate: number; hp: number }> = {
  normal: { damage: 0, ultimate: 0, hp: 0 },
  semi_legend: { damage: 4, ultimate: 12, hp: 30 },
  legend: { damage: 8, ultimate: 25, hp: 60 },
};

export function tierPowerBonus(species: string) {
  return TIER_POWER_BONUS[getPetTier(species)];
}

/**
 * 宠物最大 HP,与后端 pet_formulas.calculate_max_hp 同公式(含稀有度加成)。
 * 别再就地手写 `100 + level*5 + stage*20`:传说有 +hp 加成,漏算会让血条超过 100%。
 */
export function getPetMaxHp(level: number, evolutionStage: number, species: string): number {
  return 100 + level * 5 + evolutionStage * 20 + tierPowerBonus(species).hp;
}

export const LEGENDARY_SPECIES: readonly PetSpeciesDefinition[] =
  PET_SPECIES.filter((definition) => definition.tier !== 'normal');
export const NORMAL_SPECIES: readonly PetSpeciesDefinition[] =
  PET_SPECIES.filter((definition) => definition.tier === 'normal');
