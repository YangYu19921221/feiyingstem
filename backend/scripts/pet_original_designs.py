"""原创伙伴设计表 —— 替换原来 67 个宝可梦种族(2026-11-04)。

为什么换: 原来的立绘、名字、招式名全是宝可梦的,版权方是任天堂 / 宝可梦公司。
本文件是**唯一真源**: 出图脚本 gen_pet_originals.py 读它出图,
codegen 脚本 apply_pet_originals.py 读它改写前端 petSpecies.ts 和后端 core/pet_species.py。

每条:
- old    原来的种族 id(只用于把生产库 user_pets.species 一一对应换过来,见 core/pet_species.LEGACY_SPECIES)
- id     新种族 id(英文小写,图片文件名 /pets/{id}_1.png …)
- label / desc / emoji / ult   图鉴上的名字、简介、图标、大招名
- names  三个形态的名字(幼年 / 成长 / 最终)
- look   这个家族三张图共用的外形描述(颜色、标志性特征),保证进化前后认得出是同一只
- forms  三张图各自的姿态 / 体型差别

元素、稀有度、技能特效骨架沿用原来那一格(apply 脚本从旧注册表读),只换外形和名字,
所以对战平衡、属性克制一点不变。

⚠️ 提示词只写外观,**不写任何现有动画 / 游戏角色的名字**,也别照着某只宝可梦去描述 ——
   改成"看着像皮卡丘的另一只"仍然侵权。设计要从日常动物、物件、中国神话里来。
"""

DESIGNS = [
    # ---------------- 第 1 段 ----------------
    dict(old="pikachu", id="sparkhog", label="蒲电猬家族", emoji="⚡", ult="蒲公英雷暴",
         names=("蒲蒲猬", "闪蒲猬", "雷冠猬"),
         desc="背上是蒲公英绒球的小刺猬，一抖就噼啪放电，最终长出雷电王冠",
         look="a round teal-green hedgehog whose back spines are soft white dandelion puffs with tiny "
              "glowing cyan sparks between them, a cream belly, big shiny black eyes, a small pink nose, "
              "short stubby legs",
         forms=("a tiny chubby baby, only a few dandelion puffs, sitting and smiling",
                "a bigger playful juvenile, a full coat of dandelion puffs crackling with little sparks, one paw raised",
                "a confident adult standing on hind legs, the dandelion puffs on its head forming a crown shaped like lightning bolts, "
                "bright cyan electricity arcing between the puffs")),
    dict(old="eevee", id="alpaca", label="云絮羊驼家族", emoji="✨", ult="星絮回旋",
         names=("绒绒驼", "云絮羊驼", "星光羊驼"),
         desc="毛像云朵一样蓬松的小羊驼，越长大毛里藏的星星越多",
         look="a fluffy cartoon alpaca with cloud-like cream white wool, soft peach-pink cheeks, "
              "lavender-tipped ears, a sweet sleepy smile, tiny golden star sparkles hidden in the wool",
         forms=("a tiny baby alpaca, a round puff of wool with short legs",
                "a taller juvenile alpaca with a long fluffy neck, a few more golden stars twinkling in its wool",
                "a graceful adult alpaca with a flowing cloud mane and a long cloud tail full of glowing golden stars, "
                "a small star-shaped tuft on its forehead")),
    dict(old="bulbasaur", id="leafkoala", label="叶耳熊家族", emoji="🍃", ult="万叶旋舞",
         names=("叶团团", "藤叶熊", "森冠熊"),
         desc="耳朵是两片大叶子的小考拉，抱着树枝长大，最后头顶长成一片小森林",
         look="a cute grey-green koala whose two big round ears are large fresh green leaves, "
              "a dark brown oval nose, a light mint belly, round friendly eyes",
         forms=("a tiny baby koala hugging a small twig, big leaf ears",
                "a juvenile koala with thin green vines curling around its arms and small flowers on the vines",
                "a strong adult koala standing upright, a crown of leafy branches and blossoms growing from its head, "
                "vines wrapped around its arms like bracers")),
    dict(old="charmander", id="emberham", label="火芯鼠家族", emoji="🔥", ult="烈焰披风",
         names=("火芯仔", "焰团鼠", "炎披鼠王"),
         desc="耳朵尖是两朵小蜡烛火苗的仓鼠，最后披上了火焰披风",
         look="a round orange-and-cream hamster with puffy cheeks, the tips of its two round ears are small "
              "candle flames, a tiny flame on its short tail, warm amber eyes",
         forms=("a tiny baby hamster holding a sunflower seed, small ear flames",
                "a bigger juvenile hamster wearing a short scarf made of flickering fire, ear flames larger",
                "a heroic adult hamster standing tall with a long flowing cape made of flames, "
                "a flame crest on its head, fists raised proudly")),
    dict(old="squirtle", id="narwhee", label="螺角鲸家族", emoji="💧", ult="潮汐螺旋",
         names=("小螺鲸", "涡角鲸", "潮冠角鲸"),
         desc="额头长着一根螺旋小角的独角鲸宝宝，能浮在空中游来游去",
         look="a chubby floating baby narwhal, sky-blue on top and white underneath, a spiral pearl-white horn on its "
              "forehead, tiny flippers, little water droplets swirling around it",
         forms=("a tiny round narwhal calf with a very short spiral horn, floating happily",
                "a bigger juvenile narwhal with a longer glowing spiral horn and a ring of water spinning around its tail",
                "a majestic adult narwhal with a long shining spiral horn, a crown of sea foam, "
                "a big swirling ring of tidal water around its body")),
    dict(old="jigglypuff", id="melopuff", label="音团绒家族", emoji="🎵", ult="甜梦摇篮曲",
         names=("音团团", "乐符绒", "交响绒王"),
         desc="圆滚滚的棉花糖小猫，尾巴是一个音符，一唱歌大家就想睡觉",
         look="a round marshmallow-like kitten with soft pastel pink fur, big sparkling eyes, small cat ears, "
              "its tail is curled into the shape of a musical note, tiny floating music notes around it",
         forms=("a tiny round kitten humming with one small music note floating above",
                "a bigger kitten holding a little microphone, several colorful music notes swirling around",
                "an elegant adult cat with a fluffy ruffled collar like a concert dress, a long note-shaped tail, "
                "a ring of glowing musical notes orbiting around it")),
    dict(old="gastly", id="umbrellaspirit", label="伞灵家族", emoji="👻", ult="幽伞夜雨",
         names=("伞宝灵", "油纸伞灵", "千伞幽灵"),
         desc="一把会飘的油纸伞成了精，害羞地躲在伞下，晚上会发出紫色的光",
         look="a friendly ghost spirit shaped like a small Chinese oil-paper umbrella with a violet canopy painted "
              "with pale plum blossoms, one big curious cute eye in the middle of the canopy, a soft glowing purple mist "
              "body under it instead of legs, two little ribbon arms",
         forms=("a tiny shy umbrella spirit peeking out, canopy half closed",
                "a bigger umbrella spirit with the canopy open, twirling, little purple wisps around it",
                "a grand umbrella spirit with a large open canopy edged with glowing lanterns, three smaller umbrellas "
                "floating around it like companions, purple mist trailing")),
    dict(old="dratini", id="candydrake", label="糖画龙家族", emoji="🐉", ult="金糖龙息",
         names=("糖糖龙", "糖画龙", "金糖龙王"),
         desc="像街边糖画一样晶莹的金色小龙，越长越大，龙鳞闪着焦糖光",
         look="a cute small dragon whose whole body looks like translucent golden amber caramel candy, "
              "glossy shine, round head with two short candy horns, big warm brown eyes, a happy face",
         forms=("a tiny round baby dragon curled up, short stubby tail",
                "a longer juvenile dragon with small caramel wings and swirly candy patterns on its body",
                "a magnificent adult dragon with flowing golden candy mane, big shining caramel wings, "
                "swirling sugar patterns along its long body")),
    dict(old="machop", id="boxaroo", label="拳袋鼠家族", emoji="🥊", ult="冠军连环拳",
         names=("拳仔袋", "擂台袋鼠", "袋鼠拳王"),
         desc="戴着红色拳套的小袋鼠，每天练拳，最后拿到了冠军金腰带",
         look="a cheerful light-brown kangaroo with a cream belly and pouch, long ears, "
              "bright red boxing gloves, a determined friendly face",
         forms=("a tiny baby kangaroo with oversized red gloves, bouncing",
                "a juvenile kangaroo in boxing shorts and a sweatband, throwing a punch",
                "a muscular champion kangaroo wearing a shiny golden championship belt and a red cape, "
                "gloves raised in victory")),
    dict(old="abra", id="mindslug", label="念力海蛞蝓家族", emoji="🔮", ult="星念涟漪",
         names=("念念蝓", "星念蝓", "灵光蝓仙"),
         desc="会飘在空中的粉紫色海蛞蝓，触角一亮就能用念力把东西浮起来",
         look="a soft cute sea slug (nudibranch) floating in the air, pastel lavender and pink body with frilly "
              "rainbow-edged fins along its back, two glowing antennae tipped with little crystal orbs, gentle eyes",
         forms=("a tiny round sea slug baby with short antennae, floating in a bubble of light",
                "a longer sea slug with wavy frills, its antennae glowing, small pebbles floating around by telekinesis",
                "a graceful elegant sea slug spirit with long flowing iridescent frills like a gown, "
                "a halo of floating crystals and soft psychic ripples around it")),
    dict(old="geodude", id="pebbadillo", label="卵石犰狳家族", emoji="🪨", ult="滚石轰隆",
         names=("石豆犰", "岩甲犰", "山岳犰王"),
         desc="背着鹅卵石甲壳的小犰狳，缩成一团就能滚着撞过去",
         look="a cute armadillo whose shell bands are made of smooth grey and sand-colored river pebbles, "
              "a pinkish-tan face, round ears, small claws",
         forms=("a tiny baby armadillo half curled into a ball",
                "a bigger juvenile armadillo with thicker stone bands and small moss patches",
                "a huge adult armadillo with a mountain-like rocky shell, crystal ridges along the top, "
                "standing firmly like a boulder fortress")),
    dict(old="vulpix", id="blazekat", label="焰尾獴家族", emoji="🔥", ult="日冕爆炎",
         names=("火獴仔", "焰尾獴", "日冕獴王"),
         desc="站岗放哨的小獴，尾巴是一簇火苗，最后头顶出现太阳一样的光环",
         look="a meerkat with warm sandy-orange fur, dark eye patches, a cream belly, standing upright on its hind legs, "
              "the tip of its long tail is a bright flame",
         forms=("a tiny baby meerkat standing on tiptoe, a small tail flame",
                "a juvenile meerkat on lookout with flame markings on its shoulders and a bigger tail flame",
                "a regal adult meerkat with a ring of fire behind its head like a sun corona, flame-patterned fur, "
                "a long blazing tail")),
    dict(old="growlithe", id="liondog", label="醒狮家族", emoji="🔥", ult="醒狮烈焰",
         names=("醒狮仔", "焰鬃狮", "瑞火狮王"),
         desc="像过年舞的醒狮一样的小狮子，鬃毛是火做的，会守护大家",
         look="a lion cub inspired by Chinese lion dance costumes, bright red and gold fur, a big fluffy mane with "
              "fiery orange tips, a small golden horn-like bump on its forehead, big round expressive eyes, a joyful grin",
         forms=("a tiny playful lion cub with a small fiery mane, wagging a pom-pom tail",
                "a juvenile lion with a fuller blazing mane and gold trim patterns on its legs, leaping",
                "a majestic guardian lion with a huge flaming mane, golden ornaments and bells, a proud powerful stance")),
    dict(old="magikarp", id="surfduck", label="浪羽鸭家族", emoji="💧", ult="潮光羽浪",
         names=("灰绒鸭", "浪羽鸭", "潮光天鹅"),
         desc="灰扑扑的小鸭子总被笑话，努力冲浪长大后变成了闪着水光的白天鹅",
         look="a water bird with soft feathers and a bright orange beak, kind dark eyes, water splashes around",
         forms=("a fluffy grey ugly-duckling chick with messy down feathers, sitting on a little wave",
                "a sleeker blue-grey juvenile duck riding a wave on a leaf surfboard, feathers turning white at the tips",
                "a beautiful elegant white swan with shimmering aqua-blue wing tips and a crown of water droplets, "
                "wings spread over a glowing wave")),
    dict(old="oddish", id="potsprout", label="盆栽精家族", emoji="🍃", ult="百花盛放",
         names=("盆芽芽", "花盆灵", "百花盆王"),
         desc="一只会走路的小花盆，头上的嫩芽慢慢开成了一大片花",
         look="a cute walking terracotta flower pot creature with a smiling face painted on the pot, "
              "two tiny root feet and two leaf arms",
         forms=("a tiny clay pot with one small green sprout on top",
                "a bigger pot with a pink tulip blooming on top and leafy arms waving",
                "a large decorated pot with a lush bouquet of many colorful flowers on top, vines hanging down, "
                "butterflies around it")),
    dict(old="poliwag", id="bubbleoct", label="泡泡章家族", emoji="💧", ult="漩涡泡泡阵",
         names=("泡泡章", "涡泡章", "深海章王"),
         desc="爱吹泡泡的小章鱼，泡泡越吹越大，最后能用漩涡把对手卷起来",
         look="a cute octopus with smooth coral-orange skin, eight short curly tentacles with light-pink suckers, "
              "big round eyes, it blows shiny soap-like bubbles",
         forms=("a tiny baby octopus blowing one small bubble",
                "a bigger octopus juggling several bubbles with its tentacles",
                "a powerful adult octopus wearing a little captain's hat made of seashell, tentacles swirling a whirlpool "
                "of water and big bubbles")),
    dict(old="caterpie", id="silkmoth", label="蚕蛾家族", emoji="🐛", ult="银丝月光",
         names=("蚕宝宝", "银茧蚕", "月光蚕蛾"),
         desc="爱吃桑叶的蚕宝宝，吐丝结茧，最后变成翅膀带月光的白蚕蛾",
         look="a creature in the silkworm family, soft milky-white color with silver shimmer, gentle black eyes",
         forms=("a chubby cute white silkworm caterpillar munching a green mulberry leaf",
                "a silkworm half wrapped in a shiny silver silk cocoon, peeking out happily",
                "a fluffy white silk moth with big feathery antennae and broad wings patterned with pale silver crescent moons, "
                "fuzzy body, glittering silver threads around it")),
    # ---------------- 第 2 段 ----------------
    dict(old="weedle", id="honeybee", label="蜜囊蜂家族", emoji="🐝", ult="蜂巢针雨",
         names=("蜜豆蜂", "巢卫蜂", "蜂巢骑士"),
         desc="圆滚滚的小蜜蜂，背着一罐蜂蜜，长大后成了守护蜂巢的骑士",
         look="a round fuzzy bee with soft yellow and chocolate-brown stripes, tiny translucent wings, "
              "short antennae with little honey-drop tips, rosy cheeks",
         forms=("a tiny chubby bee larva-like baby with stubby wings, holding a honey drop",
                "a juvenile bee carrying a small clay honey pot on its back, buzzing",
                "a brave knight bee wearing hexagon honeycomb armor plates, a small stinger lance, sparkling wings")),
    dict(old="bellsprout", id="pitcherplant", label="瓶子草家族", emoji="🍃", ult="露珠鞭击",
         names=("小瓶草", "露瓶草", "瓶草女王"),
         desc="像小水瓶一样的瓶子草，盖子一开一合在说话，藤蔓能当鞭子",
         look="a cute pitcher plant creature with a lime-green tube-shaped body striped with soft red veins, "
              "a lid on top like a hat, a smiley face on the pitcher, thin vine arms",
         forms=("a tiny single pitcher sprout with a little lid, two leaf feet",
                "a taller pitcher with dew drops on its rim and long curling vine arms",
                "a large regal pitcher plant with a flower-shaped lid like a crown, several smaller pitchers growing "
                "around its base, long whip-like vines")),
    dict(old="horsea", id="axolotl", label="六角螈家族", emoji="💧", ult="珊瑚漩流",
         names=("萌螈宝", "珊鳃螈", "珊瑚螈王"),
         desc="头上有六根粉色羽鳃的小蝾螈，一直在笑，最后鳃长成了珊瑚",
         look="a happy pink-and-white axolotl with three fluffy pink feathery gills on each side of its head, "
              "a wide smile, small dark eyes, soft little legs",
         forms=("a tiny baby axolotl with small gills, swimming in a bubble",
                "a longer juvenile axolotl with bigger gills and a light-blue fin along its back and tail",
                "a big majestic axolotl whose gills have become branching coral, pearls on its fin, "
                "a swirl of water around it")),
    dict(old="larvitar", id="geocub", label="晶洞兽家族", emoji="🪨", ult="水晶山崩",
         names=("晶豆兽", "晶洞兽", "紫晶山君"),
         desc="背上裂开就是一个闪光晶洞的小石兽，越长背上的紫水晶越大",
         look="a sturdy little rock beast with a grey stone body like a geode, cracks on its back revealing "
              "sparkling purple amethyst crystals inside, round eyes, short thick legs and tail",
         forms=("a tiny round stone baby with one small amethyst crystal poking out",
                "a bigger juvenile with a row of purple crystal spikes along its back",
                "a huge powerful beast with towering amethyst crystal clusters on its shoulders and back, "
                "a stone crest on its head, glowing purple cracks")),
    dict(old="ralts", id="lanternfairy", label="灯笼仙家族", emoji="🔮", ult="千灯祈愿",
         names=("灯芯灵", "灯笼仙", "千灯仙子"),
         desc="提着小灯笼的仙子精灵，灯光能照见别人的心情",
         look="a small fairy-like spirit with a soft white body, short dark-teal hair, rosy cheeks, "
              "holding a glowing round red Chinese paper lantern, gentle smile",
         forms=("a tiny spirit with a candle flame on its head instead of a lantern",
                "a small fairy holding a round red lantern, translucent butterfly wings",
                "a graceful fairy in a flowing dress like layered lantern paper, several floating glowing lanterns "
                "around her, long translucent wings")),
    dict(old="chikorita", id="lotuscalf", label="莲叶鹿家族", emoji="🍃", ult="清荷落雨",
         names=("荷芽鹿", "莲叶鹿", "千荷鹿神"),
         desc="头上顶着一片荷叶的小鹿，走过的地方都会开出莲花",
         look="a cute fawn deer with soft light-green fur and white spots, a lotus leaf growing on its head like a hat, "
              "gentle big eyes",
         forms=("a tiny baby fawn with a small round lotus leaf on its head, lying down",
                "a juvenile deer with lotus-bud antlers and lotus leaves around its neck like a collar",
                "a graceful adult deer with antlers made of blooming pink lotus flowers, a flowing lotus-leaf mane, "
                "water droplets sparkling")),
    dict(old="cyndaquil", id="flamepanda", label="焰熊猫家族", emoji="🔥", ult="竹火冲天",
         names=("火团团", "焰纹熊猫", "火竹熊猫王"),
         desc="毛色是火红和奶白的小熊猫，抱着一根着火的竹子当魔杖",
         look="a red-panda-like chubby creature with fiery red and cream fur, flame-shaped stripes on its ringed tail, "
              "cute round ears, sleepy happy eyes",
         forms=("a tiny cub holding a small bamboo sprout with a candle flame on top",
                "a juvenile with flame stripes glowing on its tail, waving a burning bamboo stick",
                "a heroic adult on its hind legs holding a tall bamboo staff blazing with fire at the top, "
                "a fire-trimmed vest")),
    dict(old="totodile", id="otterwave", label="浪花獭家族", emoji="💧", ult="浪花连环掌",
         names=("浪花獭", "冲浪獭", "海潮獭王"),
         desc="抱着贝壳的小水獭，喜欢冲浪，长大后能召唤海浪",
         look="a playful otter with glossy chestnut-brown fur, a cream face and chest, whiskers, small round ears, "
              "webbed paws",
         forms=("a tiny baby otter floating on its back hugging a seashell",
                "a juvenile otter riding a small surfboard on a wave",
                "a strong adult otter standing on a big curling wave, wearing a seashell sash, foam around its paws")),
    dict(old="treecko", id="chameleaf", label="变色龙家族", emoji="🍃", ult="千叶隐身斩",
         names=("叶纹蜥", "藤卷变色龙", "森影变色龙"),
         desc="尾巴卷成蚊香一样的小变色龙，身上能变出叶子的花纹藏起来",
         look="a cute chameleon with lime and emerald green skin, big round rotating eyes, a long curly spiral tail, "
              "small leaf-patterned spots",
         forms=("a tiny baby chameleon sitting on a leaf, tail curled",
                "a juvenile chameleon with leaf-shaped crests on its head and back, partially turning invisible with leaf patterns",
                "a sleek adult chameleon with a crest of sharp leaf blades on its head and arms, a big spiral tail, "
                "ninja-like pose")),
    dict(old="torchic", id="sunrooster", label="朝阳鸡家族", emoji="🔥", ult="破晓金焰",
         names=("朝阳雏", "啼晓鸡", "金乌鸡神"),
         desc="每天第一个叫醒太阳的小鸡，越长大羽毛越像燃烧的朝霞",
         look="a fluffy bird with bright golden-yellow and sunrise-orange feathers, a little red comb, "
              "a small orange beak, cheerful eyes",
         forms=("a tiny round fluffy chick with a tiny red comb, a sun-shaped spot on its chest",
                "a juvenile rooster with flame-like tail feathers, crowing",
                "a majestic sun rooster with a huge fan of flaming golden tail feathers, a radiant sun disk behind it, "
                "a tall glowing comb")),
    dict(old="mudkip", id="mudhippo", label="泥潭河马家族", emoji="💧", ult="泥浪大翻滚",
         names=("泥豆马", "泥潭河马", "沼泽河马王"),
         desc="爱在泥坑里打滚的小河马，长大后一个翻身就能掀起泥浪",
         look="a round cute hippo with lavender-grey skin, a big smiling mouth, small round ears, "
              "pinkish cheeks, splashes of mud",
         forms=("a tiny baby hippo sitting in a puddle, mud on its nose",
                "a juvenile hippo with lily pads on its head, splashing water",
                "a huge strong hippo with mossy patterns on its back and a crown of reeds, a wave of mud and water behind it")),
    dict(old="bagon", id="cloudkite", label="风筝龙家族", emoji="🐉", ult="万丈风筝阵",
         names=("纸鸢龙", "风筝龙", "云霄龙王"),
         desc="像一只会飞的风筝的小龙，尾巴是彩色飘带，最后能飞上九霄",
         look="a dragon whose body is like a traditional Chinese dragon kite, bright red and gold patterns, "
              "round cute face, two small horns, long colorful ribbon tail streamers",
         forms=("a tiny chubby baby dragon with tiny kite-like wings, ribbon tail",
                "a longer juvenile dragon with diamond-shaped kite wings painted with clouds",
                "a magnificent sky dragon with huge kite-sail wings, a long flowing body with golden patterns, "
                "many ribbons streaming in the wind")),
    dict(old="beldum", id="clockbot", label="发条机兽家族", emoji="⚙️", ult="齿轮星爆拳",
         names=("发条仔", "齿轮兽", "钟塔机神"),
         desc="背上插着发条钥匙的小机器兽，越转越快，最后变成会走的钟塔",
         look="a friendly robot creature made of polished brass and silver steel, a round clock face on its chest, "
              "a wind-up key on its back, glowing blue eyes",
         forms=("a tiny round wind-up toy robot with stubby legs and a big key",
                "a medium robot beast with gear-shaped shoulders and pistons on its arms",
                "a large powerful mechanical guardian shaped like a walking clock tower, big gear fists, "
                "a glowing clock face")),
    dict(old="gible", id="dunewhale", label="沙海鲸家族", emoji="🐉", ult="沙海龙卷",
         names=("沙鲸仔", "沙鳍龙", "沙海龙鲸"),
         desc="在沙漠里游泳的小鲸龙，鳍像船帆，能在沙子里潜行",
         look="a creature that swims through sand like a whale-dragon, sandy beige and deep-blue body, "
              "a sail-like dorsal fin, small horns, a friendly grin",
         forms=("a tiny baby with its head popping out of sand, small fin",
                "a juvenile leaping out of a sand dune with sail fins on its back and arms",
                "a huge majestic sand dragon-whale bursting from a swirling sand storm, big sail fins, "
                "golden patterns along its body")),
    dict(old="snivy", id="bambooweasel", label="竹叶貂家族", emoji="🍃", ult="千竹破土",
         names=("竹芽貂", "竹叶貂", "青竹貂君"),
         desc="披着竹叶斗篷的小貂，动作很快，召唤竹子从地里长出来",
         look="a slender cute weasel with jade-green and cream fur, long bamboo-leaf ears, "
              "a long bushy tail tipped with bamboo leaves",
         forms=("a tiny baby weasel peeking out from a bamboo tube",
                "a juvenile weasel wearing a cloak of bamboo leaves, quick pose",
                "an elegant adult weasel with a flowing bamboo-leaf cape, holding a bamboo staff, "
                "bamboo shoots rising from the ground around it")),
    dict(old="tepig", id="lavaboar", label="熔岩野猪家族", emoji="🔥", ult="熔岩冲撞",
         names=("火炭猪", "熔岩猪", "火山猪王"),
         desc="背上有熔岩纹的小野猪，鼻子一喷就冒火星",
         look="a sturdy little boar with charcoal-black and ember-red fur, glowing orange lava cracks on its back, "
              "small curved tusks, a round snout puffing sparks",
         forms=("a tiny piglet with small glowing lava spots, puffing a spark",
                "a juvenile boar with a ridge of glowing lava along its back, charging",
                "a massive boar with a small volcano-like crest erupting on its back, big tusks, molten lava armor")),
    dict(old="oshawott", id="shellpenguin", label="贝甲企鹅家族", emoji="💧", ult="贝刃回旋",
         names=("贝贝鹅", "贝刃企鹅", "海螺企鹅帝"),
         desc="背着扇贝当小盾牌的企鹅宝宝，长大后挥着贝壳刀保护大家",
         look="a cute penguin with navy-blue and white feathers, a yellow beak, round eyes, "
              "carrying a pink scallop shell",
         forms=("a tiny fluffy penguin chick holding a small scallop shell like a shield",
                "a juvenile penguin with scallop shells on its flippers like blades",
                "a noble emperor penguin wearing a conch shell helmet and a cape of seaweed, holding a shining shell sword")),
    # ---------------- 第 3 段 ----------------

    dict(old="rowlet", id="acornsquirrel", label="橡果松鼠家族", emoji="🌰", ult="松果箭雨",
         names=("橡果鼠", "松果射手", "森林神射手"),
         desc="戴着橡果帽的小松鼠，练成了用松果和树叶当箭的神射手",
         look="a cute squirrel with warm russet-brown fur, a big fluffy curled tail, a cream belly, "
              "wearing a little acorn-cap hat, bright eyes",
         forms=("a tiny baby squirrel hugging a big acorn, acorn cap on its head",
                "a juvenile squirrel with a small bow made of a twig and a quiver of pine cones",
                "a skilled archer squirrel with a leaf-woven hood and cape, drawing a wooden bow with a glowing leaf arrow")),
    dict(old="litten", id="firetanuki", label="火狸家族", emoji="🔥", ult="烈火战鼓",
         names=("火狸仔", "鼓焰狸", "烈鼓狸王"),
         desc="拍着肚皮打鼓的小狸猫，鼓声越响火越旺",
         look="a chubby raccoon-dog (tanuki) with orange-brown fur, dark mask markings around the eyes, "
              "a round belly, a striped bushy tail with flame tips",
         forms=("a tiny baby tanuki patting its round belly, little sparks flying",
                "a juvenile tanuki beating a small red festival drum with flaming drumsticks",
                "a powerful adult tanuki with a big flaming festival drum on its back, a fire headband, "
                "drumsticks blazing")),
    dict(old="popplio", id="jellyfish", label="彩纱水母家族", emoji="🪼", ult="极光水母舞",
         names=("泡泡母", "彩纱水母", "极光水母后"),
         desc="像一朵会发光的小伞在海里跳舞的水母，最后能放出极光",
         look="a cute floating jellyfish with a translucent bell-shaped head in pastel aqua and pink, "
              "a happy face on the bell, flowing ribbon-like tentacles, soft glow",
         forms=("a tiny round jellyfish with short tentacles, inside a bubble",
                "a bigger jellyfish with long frilly rainbow-tinted tentacles, dancing",
                "a regal jellyfish queen with a crown-like bell edged with pearls, very long shimmering aurora-colored "
                "tentacles flowing like a ballgown")),
    dict(old="mareep", id="voltaeel", label="霓虹电鳗家族", emoji="⚡", ult="霓虹雷暴",
         names=("电鳗宝", "霓虹鳗", "雷霆鳗龙"),
         desc="身上亮着霓虹灯条纹的小电鳗，可以在空中游动、放出闪电",
         look="a friendly eel that floats in the air, dark navy body with bright glowing yellow and cyan neon stripes, "
              "round cute face, small fins, little crackling sparks",
         forms=("a tiny short baby eel curled into a spiral, glowing faintly",
                "a longer juvenile eel with brighter neon stripes and fin-like whiskers, sparks crackling",
                "a long majestic eel dragon with flowing fins, glowing neon patterns, lightning bolts arcing around it")),
    dict(old="swinub", id="snowleopard", label="雪豹家族", emoji="❄️", ult="冰川暴雪",
         names=("雪团豹", "霜纹豹", "冰川豹王"),
         desc="住在雪山上的小雪豹，尾巴又长又粗，最后身上结出了冰晶铠甲",
         look="a snow leopard with soft white and pale-grey fur covered in dark rosette spots, ice-blue eyes, "
              "a very long thick fluffy tail",
         forms=("a tiny fluffy cub hugging its own thick tail, snowflakes falling",
                "a juvenile snow leopard prowling, frost patterns on its paws, icy breath",
                "a majestic snow leopard with clear blue ice crystal armor on its shoulders and a frosty mane, "
                "a swirling blizzard around it")),
    dict(old="deino", id="shadowcat", label="夜影猫家族", emoji="🌑", ult="月蚀暗光",
         names=("影喵", "夜影猫", "月蚀猫王"),
         desc="额头有一弯月牙的小黑猫，能躲进影子里，最后召唤月蚀",
         look="a sleek black cat with deep indigo shading, a glowing silver crescent moon mark on its forehead, "
              "big golden eyes, a long tail with a wispy shadow tip",
         forms=("a tiny black kitten sitting in a small pool of shadow, tiny crescent mark",
                "a juvenile cat with smoky shadow wisps trailing from its paws and tail",
                "an elegant dark panther-sized cat with a flowing shadow mane, a full glowing crescent moon halo behind it, "
                "violet starry patterns in its fur")),
    dict(old="nidoran", id="dartfrog", label="彩毒蛙家族", emoji="☠️", ult="七彩毒雾",
         names=("彩毒蛙", "毒雾蛙", "剧彩蛙王"),
         desc="颜色越鲜艳越厉害的小毒蛙，警告大家别靠近，最后能喷出七彩毒雾",
         look="a tiny cute poison dart frog with glossy vivid purple skin and bright lime and orange spots, "
              "big round eyes, sticky toe pads",
         forms=("a tiny frog sitting on a mushroom",
                "a bigger frog puffing purple mist bubbles from its cheeks",
                "a large proud frog king with a mushroom-cap crown, rainbow poison patterns glowing, "
                "a swirl of colorful mist around it")),
    dict(old="trapinch", id="digmole", label="掘地鼹家族", emoji="🏜️", ult="大地震裂",
         names=("土豆鼹", "矿灯鼹", "大地鼹王"),
         desc="戴着矿工帽的小鼹鼠，挖遍地下的宝石，最后一跺脚就地震",
         look="a cute mole with velvety dark-grey fur, a pink star-shaped nose, big pink digging claws, "
              "small squinting eyes behind round goggles",
         forms=("a tiny baby mole popping out of a dirt hole",
                "a juvenile mole wearing a yellow miner's helmet with a lamp, holding a gemstone",
                "a strong adult mole in miner overalls with huge claws, stomping and cracking the ground, gems flying")),
    dict(old="sandile", id="dunecamel", label="沙丘骆驼家族", emoji="🐫", ult="沙丘风暴",
         names=("沙驼仔", "沙丘骆驼", "沙漠驼王"),
         desc="背着两个驼峰的小骆驼，走过沙漠时脚下会卷起沙尘",
         look="a cute two-humped camel with sandy-golden fur, long eyelashes, a gentle smile, "
              "colorful woven tassels",
         forms=("a tiny baby camel with two small humps, sitting on a sand dune",
                "a juvenile camel carrying a little woven saddle bag, sand swirling at its feet",
                "a mighty desert camel king with a jeweled headdress and tassels, a towering sandstorm rising behind it")),
    dict(old="zubat", id="swallow", label="剪尾燕家族", emoji="🐦", ult="剪风斩",
         names=("春燕仔", "剪尾燕", "疾风燕王"),
         desc="尾巴像剪刀的小燕子，飞得最快，翅膀一挥就是一道风刃",
         look="a cute swallow bird with glossy dark-blue back feathers, a white belly, a rusty-red face patch, "
              "a long forked scissor-like tail",
         forms=("a fluffy baby swallow in a little mud nest, beak open",
                "a juvenile swallow in a fast diving flight pose, wind lines around it",
                "a sleek adult swallow with long blade-like wings and tail streamers, a crescent of wind slicing around it")),
    dict(old="starly", id="hummingbird", label="翠羽蜂鸟家族", emoji="🕊️", ult="虹光俯冲",
         names=("蜂鸟仔", "翠羽蜂鸟", "虹光蜂鸟"),
         desc="最小的鸟，翅膀扇得看不清，长大后羽毛像彩虹一样发光",
         look="a tiny hummingbird with iridescent emerald-green and turquoise feathers, a long thin beak, "
              "a ruby-red throat, blurred fast wings",
         forms=("a round tiny baby hummingbird sipping from a flower",
                "a juvenile hummingbird hovering, its feathers shimmering",
                "a dazzling adult hummingbird with long rainbow tail plumes and glowing iridescent wings, diving with a trail of light")),
    dict(old="rookidee", id="ironrhino", label="钢甲犀家族", emoji="⚙️", ult="钢角冲锋",
         names=("铁角犀", "钢甲犀", "钢铁犀王"),
         desc="角是闪亮钢铁做的小犀牛，长大后全身披上钢甲",
         look="a sturdy cute rhinoceros with blue-grey skin, a shiny polished steel horn, small ears, determined eyes",
         forms=("a tiny baby rhino with a small steel horn bump",
                "a juvenile rhino with steel armor plates on its back and shoulders",
                "a massive rhino in full riveted silver steel armor with a large gleaming horn and a smaller second horn, charging")),
    dict(old="froakie", id="seahorse", label="潮剑海马家族", emoji="💧", ult="潮流剑舞",
         names=("小海马", "潮剑海马", "海马骑士"),
         desc="卷着尾巴的小海马，用水流练剑，最后成了守护珊瑚礁的骑士",
         look="a cute seahorse with coral-orange and gold scales, a curled tail, a small snout, big friendly eyes, "
              "a fin crest on its head",
         forms=("a tiny baby seahorse holding onto seaweed with its tail",
                "a juvenile seahorse holding a sword made of flowing water",
                "a noble seahorse knight in shell armor with a coral crest helmet, wielding a glowing water sword")),
    dict(old="fennekin", id="flamingo", label="焰舞烈鸟家族", emoji="🔥", ult="烈焰芭蕾",
         names=("粉焰雏", "焰羽烈鸟", "焰舞烈鸟"),
         desc="单脚站着跳芭蕾的火烈鸟，跳起来羽毛会变成火焰",
         look="a graceful flamingo with bright pink-coral feathers, a curved black-tipped beak, long thin legs, "
              "standing elegantly on one leg",
         forms=("a fluffy pale-pink baby flamingo chick",
                "a juvenile flamingo spinning on one leg like a ballerina, flame-tipped wing feathers",
                "a dazzling adult flamingo dancer with wings of fire spread wide, a flame crest, swirls of fire like ribbons")),
    dict(old="chespin", id="cactus", label="仙人掌家族", emoji="🌵", ult="千刺重锤",
         names=("仙人球", "掌刺拳手", "沙漠掌王"),
         desc="头上开着小花的仙人球，长大后成了戴拳套的仙人掌拳手",
         look="a cute round cactus creature, green with soft cream-colored spines, a pink flower on its head, "
              "a cheerful face, stubby arms",
         forms=("a tiny round cactus ball in a small pot, one pink flower",
                "a taller cactus with cactus-pad arms wearing small boxing gloves",
                "a large tough cactus champion with spiky arms, several blooming flowers on its head, a sandy belt")),
    dict(old="pidgey", id="flyingsquirrel", label="滑翔鼯鼠家族", emoji="🌬️", ult="狂风滑翔",
         names=("飞鼠仔", "滑翔鼯鼠", "风翼鼯鼠王"),
         desc="张开身上的皮膜就能滑翔的小鼯鼠，飞过之处刮起大风",
         look="a cute flying squirrel with soft brown-grey fur, a white belly, huge round dark eyes, "
              "a furry gliding membrane between its front and back legs, a flat fluffy tail",
         forms=("a tiny baby flying squirrel curled in a tree hollow",
                "a juvenile spreading its membrane in a glide, leaves swirling",
                "an adult flying squirrel gliding on a strong gust of wind with wide wing-like membranes and wind swirls")),
    dict(old="onix", id="terracotta", label="陶俑家族", emoji="🪨", ult="陶石炮",
         names=("陶俑仔", "陶甲俑", "石甲将军"),
         desc="陶土捏成的小士兵活了过来，守护着古老的宝藏",
         look="a cute small golem made of reddish terracotta clay, simple round face with friendly eyes, "
              "clay armor plates, chubby limbs",
         forms=("a tiny round clay figure holding a small clay shield",
                "a juvenile clay warrior with layered terracotta armor and a small spear",
                "a big powerful stone general golem with heavy carved armor, a tall helmet, glowing amber cracks, "
                "holding a stone cannon")),
    dict(old="scyther", id="dragonfly", label="翠翼蜻蜓家族", emoji="🪽", ult="疾风剪翼",
         names=("小蜻蜓", "翠翼蜻蜓", "疾翼蜻蜓王"),
         desc="停在荷叶上的小蜻蜓，翅膀像玻璃，飞得又快又稳",
         look="a cute dragonfly with a slender turquoise body, four clear glass-like veined wings, "
              "huge shiny green eyes, a friendly face",
         forms=("a tiny baby dragonfly resting on a lily pad",
                "a juvenile dragonfly darting with blurred wings",
                "a large elegant dragonfly with long shimmering emerald wings edged like blades, cutting through the air")),
    # ---------------- 第 4 段 · 普通收尾 + 传说 ----------------

    dict(old="riolu", id="goldmonkey", label="金丝猴家族", emoji="🥊", ult="云海拳风",
         names=("金丝猴仔", "拳法金猴", "齐云拳圣"),
         desc="毛色金灿灿的小猴子，每天在山顶练拳，最后拳风能吹开云海",
         look="a golden snub-nosed monkey with fluffy bright golden-orange fur, a pale blue face, a tiny upturned nose, "
              "a long tail, big expressive eyes",
         forms=("a tiny baby monkey hanging from a branch by its tail",
                "a juvenile monkey in a red martial arts sash doing a kung fu stance",
                "a heroic adult monkey master with a flowing golden mane, a red-and-gold martial arts robe, "
                "punching with swirling cloud energy")),
    dict(old="munchlax", id="sloth", label="树懒家族", emoji="🦥", ult="慢慢大压制",
         names=("懒懒宝", "抱树懒", "树懒长老"),
         desc="动作超慢、一直在笑的小树懒，看起来懒，压下来却力气超大",
         look="a cute sloth with shaggy light-brown and cream fur, dark eye stripes, a permanent sleepy smile, "
              "long arms with curved claws",
         forms=("a tiny baby sloth hugging a small branch, eyes half closed",
                "a juvenile sloth hanging upside down holding a leaf snack",
                "a big wise elder sloth with a mossy green fur coat, small flowers in its fur, a gentle smile, "
                "sitting on a thick tree branch")),
    dict(old="magnemite", id="magnetcrab", label="磁钳蟹家族", emoji="🧲", ult="电磁钳炮",
         names=("磁钳蟹", "磁甲蟹", "磁暴蟹王"),
         desc="两只钳子是马蹄形磁铁的小螃蟹，一靠近铁东西就吸过来",
         look="a cute crab with a silver metal shell, its two claws are red-and-silver horseshoe magnets, "
              "eyes on short stalks, little blue electric sparks between the magnet tips",
         forms=("a tiny baby crab with small magnet claws, scuttling sideways",
                "a juvenile crab with bigger magnet claws and steel bolts on its shell",
                "a large armored crab king with huge glowing magnet claws, a crown of metal spikes, "
                "crackling magnetic fields around it")),
    dict(old="tauros", id="yak", label="牦牛家族", emoji="🐂", ult="雪原狂奔",
         names=("小牦牛", "冲锋牦牛", "雪原牦牛王"),
         desc="披着长长厚毛的高原小牦牛，冲起来像一座会跑的小山",
         look="a cute yak with very long shaggy dark-brown fur, curved cream-colored horns, a white patch on its "
              "forehead, a fluffy tail, colorful prayer-flag tassels",
         forms=("a tiny fluffy baby yak with small horn nubs",
                "a juvenile yak charging, snow flying from its hooves",
                "a huge mighty yak king with grand curved horns, a decorated woven saddle blanket, charging through snow")),
    dict(old="doduo", id="peacock", label="孔雀家族", emoji="🦚", ult="百羽开屏",
         names=("孔雀雏", "开屏孔雀", "百羽孔雀王"),
         desc="小时候毛茸茸的孔雀宝宝，长大一开屏，羽毛上全是会发光的眼睛花纹",
         look="a peacock with glossy royal-blue neck feathers, a small crown of feather tufts on its head, "
              "a kind face",
         forms=("a fluffy brownish baby peachick with a tiny head crest",
                "a juvenile peacock with a short green tail beginning to fan out",
                "a magnificent peacock king with a huge fanned-out tail of shimmering green and gold eye-spot feathers, "
                "glowing patterns")),
    dict(old="pinsir", id="ladybug", label="七星瓢虫家族", emoji="🐞", ult="七星连撞",
         names=("瓢虫宝", "七星瓢虫", "七星甲士"),
         desc="背上有七颗黑点的小瓢虫，长大后穿上红色甲胄成了七星甲士",
         look="a round cute ladybug with a glossy red shell with seven black spots, a black head with white cheek "
              "spots, short antennae, big friendly eyes",
         forms=("a tiny round ladybug sitting on a leaf",
                "a juvenile ladybug flying with its shell open and clear wings showing",
                "a brave ladybug warrior standing upright in shiny red armor with seven glowing star spots, "
                "holding a small leaf shield")),
    dict(old="tropius", id="mosssnail", label="苔壳蜗牛家族", emoji="🐌", ult="苔藓风暴",
         names=("苔壳蜗", "花园蜗牛", "森林蜗牛王"),
         desc="背着长满青苔小花园的蜗牛，走得慢，壳上的花园越长越大",
         look="a cute snail with a soft mint-green body, two long eye stalks, and a spiral shell covered "
              "in green moss and tiny plants",
         forms=("a tiny baby snail with a small mossy shell and one little sprout",
                "a bigger snail whose shell carries a small garden of mushrooms and flowers",
                "a large wise snail king carrying a lush miniature forest with little trees and a waterfall on its shell")),
    # ---- 准传说(累计学 5000 词) ----
    dict(old="articuno", id="baize", label="白泽", emoji="❄️", ult="玄冰千里",
         names=("白泽", "觉醒白泽", "究极白泽"),
         desc="准传说 · 雪山深处的神兽白泽，懂得世间万物的名字",
         look="a mythical Chinese white beast Baize, a lion-like body with snow-white fur, a pair of curved "
              "ice-crystal horns, a wise gentle face with a short beard, pale blue cloud patterns on its legs, "
              "ice-blue eyes, an aura of falling snow",
         forms=("standing calmly on a snowy rock, small ice crystals floating around",
                "awakened, its fur glowing with frosty light, ice crystals forming wings of frost behind it",
                "ultimate form, enormous majestic glowing white beast with tall branching ice horns, a swirling blizzard "
                "and shining aurora behind it")),
    dict(old="zapdos", id="thunderkui", label="雷鼓夔", emoji="⚡", ult="夔鼓雷鸣",
         names=("雷鼓夔", "觉醒雷鼓夔", "究极雷鼓夔"),
         desc="准传说 · 传说中只有一条腿的雷兽夔，一跺脚就像擂响了天鼓",
         look="the mythical one-legged thunder beast Kui from Chinese legend, a friendly ox-like beast with dark "
              "slate-blue skin, a single strong leg, no horns, glowing golden lightning patterns on its body, "
              "a big round thunder drum floating beside it",
         forms=("standing on its single leg beside a small thunder drum, little sparks",
                "awakened, several thunder drums floating around it in a ring, bright lightning crackling",
                "ultimate form, huge thunder beast surrounded by a ring of twelve glowing drums, golden lightning storm, "
                "dark storm clouds behind")),
    dict(old="moltres", id="vermilion", label="朱雀", emoji="🔥", ult="南明离火",
         names=("朱雀", "觉醒朱雀", "究极朱雀"),
         desc="准传说 · 守护南方的神鸟朱雀，飞过的地方天空都被染红",
         look="the Chinese mythical Vermilion Bird, an elegant crimson-and-gold bird with a long flowing tail of "
              "ribbon-like flame feathers, a small golden crest, ornate cloud patterns on its wings",
         forms=("perched gracefully, wings folded, soft embers",
                "awakened, wings spread with flames curling like silk ribbons",
                "ultimate form, a gigantic radiant phoenix-like bird of pure fire with a halo of sun flames, "
                "tail feathers trailing across the sky")),
    dict(old="suicune", id="kun", label="北冥鲲", emoji="💧", ult="鲲鹏扶摇",
         names=("北冥鲲", "觉醒北冥鲲", "究极北冥鲲"),
         desc="准传说 · 庄子写过的大鱼，北海里的鲲，传说能化身为鹏飞上九万里",
         look="the giant mythical fish Kun from Chinese legend, a gentle whale-like fish with deep sapphire-blue "
              "body, silver cloud-wave patterns, long flowing fins like silk, a calm wise eye",
         forms=("swimming through clouds and waves, fins flowing",
                "awakened, its fins beginning to transform into feathered wings, water spiraling around it",
                "ultimate form, a colossal whale-fish with huge feathered wings like a great roc, rising from a tidal "
                "wave into the sky")),
    # ---- 顶级传说(累计学 8000 词) ----
    dict(old="mew", id="jaderabbit", label="玉兔", emoji="🌙", ult="广寒月光",
         names=("玉兔", "觉醒玉兔", "究极玉兔"),
         desc="顶级传说 · 住在月亮上捣药的玉兔，能听懂所有人的心愿",
         look="the jade rabbit of the moon from Chinese legend, a small white rabbit with silky fur that has a "
              "faint jade-green shimmer, long ears with pink insides, ruby eyes, holding a tiny jade mortar and pestle",
         forms=("floating on a small crescent moon",
                "awakened, a full glowing moon halo behind it, sparkling stardust and floating osmanthus flowers",
                "ultimate form, a radiant celestial rabbit in flowing moonlight silk ribbons, a huge full moon behind it, "
                "constellations around")),
    dict(old="mewtwo", id="ninecolordeer", label="九色鹿", emoji="🦌", ult="九色神光",
         names=("九色鹿", "觉醒九色鹿", "究极九色鹿"),
         desc="顶级传说 · 敦煌壁画里的九色鹿，身上的九种颜色是九种力量",
         look="the Nine-Colored Deer from Dunhuang murals, a graceful slender deer with white fur and soft rainbow "
              "patches of nine colors, elegant branching golden antlers, kind wise eyes, Dunhuang-style cloud ribbons",
         forms=("standing gracefully on a cloud",
                "awakened, nine colors glowing brightly, flying silk ribbons and lotus petals around it",
                "ultimate form, a majestic glowing celestial deer with huge radiant antlers, a nine-colored halo, "
                "Dunhuang flying ribbons swirling")),
    dict(old="rayquaza", id="yinglong", label="应龙", emoji="🐉", ult="画龙点睛",
         names=("应龙", "觉醒应龙", "究极应龙"),
         desc="顶级传说 · 长着翅膀的神龙应龙，能呼风唤雨、帮大禹治水",
         look="the winged Chinese dragon Yinglong, a long serpentine Chinese dragon with golden-amber scales, "
              "deer-like antlers, flowing whiskers, a pair of large feathered wings, a glowing pearl in its claw",
         forms=("coiled on a cloud holding a pearl",
                "awakened, flying with wings spread, rain clouds and lightning around it",
                "ultimate form, a colossal golden dragon soaring with enormous feathered wings, swirling storm clouds "
                "and rainbow light")),
    dict(old="arceus", id="qilin", label="麒麟", emoji="✨", ult="祥瑞之光",
         names=("麒麟", "觉醒麒麟", "究极麒麟"),
         desc="顶级传说 · 只在太平盛世出现的瑞兽麒麟，被称为百兽之首",
         look="the Chinese mythical Qilin, a noble deer-like beast with shimmering golden-jade scales, a single soft "
              "antler-horn, a flowing flame-like mane in emerald and gold, hooves wreathed in auspicious clouds",
         forms=("standing proudly on auspicious clouds",
                "awakened, its mane blazing with golden light, floating jade ornaments around it",
                "ultimate form, a gigantic radiant qilin with a halo of auspicious clouds and golden rays, "
                "the whole body glowing like jade")),
]
