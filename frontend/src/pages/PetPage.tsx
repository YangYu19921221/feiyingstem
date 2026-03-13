import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { getMyPet, createPet, feedPet, getPetEvents, getPetLeaderboard, type Pet, type PetEvent, type PetLeaderboardEntry } from '../api/pet';

const PET_IMAGES: Record<string, string[]> = {
  pikachu:    ['/pets/pichu.png', '/pets/pichu.png', '/pets/pikachu.png', '/pets/raichu.png'],
  eevee:      ['/pets/eevee.png', '/pets/eevee.png', '/pets/eevee.png', '/pets/eevee.png'],
  bulbasaur:  ['/pets/bulbasaur.png', '/pets/bulbasaur.png', '/pets/ivysaur.png', '/pets/venusaur.png'],
  charmander: ['/pets/charmander.png', '/pets/charmander.png', '/pets/charmeleon.png', '/pets/charizard.png'],
  squirtle:   ['/pets/squirtle.png', '/pets/squirtle.png', '/pets/wartortle.png', '/pets/blastoise.png'],
  jigglypuff: ['/pets/jigglypuff.png', '/pets/jigglypuff.png', '/pets/jigglypuff.png', '/pets/wigglytuff.png'],
  gastly:     ['/pets/gastly.png', '/pets/gastly.png', '/pets/haunter.png', '/pets/gengar.png'],
  dratini:    ['/pets/dratini.png', '/pets/dratini.png', '/pets/dragonair.png', '/pets/dragonite.png'],
  machop:     ['/pets/machop.png', '/pets/machop.png', '/pets/machoke.png', '/pets/machamp.png'],
  abra:       ['/pets/abra.png', '/pets/abra.png', '/pets/kadabra.png', '/pets/alakazam.png'],
  geodude:    ['/pets/geodude.png', '/pets/geodude.png', '/pets/graveler.png', '/pets/golem.png'],
  vulpix:     ['/pets/vulpix.png', '/pets/vulpix.png', '/pets/vulpix.png', '/pets/ninetales.png'],
  growlithe:  ['/pets/growlithe.png', '/pets/growlithe.png', '/pets/growlithe.png', '/pets/arcanine.png'],
  magikarp:   ['/pets/magikarp.png', '/pets/magikarp.png', '/pets/magikarp.png', '/pets/gyarados.png'],
  oddish:     ['/pets/oddish.png', '/pets/oddish.png', '/pets/gloom.png', '/pets/vileplume.png'],
  poliwag:    ['/pets/poliwag.png', '/pets/poliwag.png', '/pets/poliwhirl.png', '/pets/poliwrath.png'],
};

// 保留 emoji 作为后备
const PET_EMOJIS: Record<string, string[]> = {
  pikachu:    ['🥚', '⚡', '⚡', '✨⚡✨'],
  eevee:      ['🥚', '🦊', '🦊', '✨🦊✨'],
  bulbasaur:  ['🥚', '🌱', '🌿', '✨🌳✨'],
  charmander: ['🥚', '🔥', '🔥', '✨🔥✨'],
  squirtle:   ['🥚', '💧', '💧', '✨💧✨'],
  jigglypuff: ['🥚', '🎀', '🎀', '✨🎀✨'],
  gastly:     ['🥚', '👻', '👻', '✨👻✨'],
  dratini:    ['🥚', '🐉', '🐉', '✨🐉✨'],
  machop:     ['🥚', '💪', '💪', '✨💪✨'],
  abra:       ['🥚', '🔮', '🔮', '✨🔮✨'],
  geodude:    ['🥚', '🪨', '🪨', '✨🪨✨'],
  vulpix:     ['🥚', '🦊', '🦊', '✨🦊✨'],
  growlithe:  ['🥚', '🐕', '🐕', '✨🐕✨'],
  magikarp:   ['🥚', '🐟', '🐟', '✨🐟✨'],
  oddish:     ['🥚', '🌱', '🌱', '✨🌸✨'],
  poliwag:    ['🥚', '💧', '💧', '✨💧✨'],
};

const SPECIES_OPTIONS = [
  { id: 'pikachu', img: '/pets/pikachu.png', label: '皮卡丘', desc: '电气鼠，活泼可爱' },
  { id: 'eevee', img: '/pets/eevee.png', label: '伊布', desc: '进化多样，潜力无限' },
  { id: 'bulbasaur', img: '/pets/bulbasaur.png', label: '妙蛙种子', desc: '草系伙伴，温柔可靠' },
  { id: 'charmander', img: '/pets/charmander.png', label: '小火龙', desc: '火焰尾巴，热情勇敢' },
  { id: 'squirtle', img: '/pets/squirtle.png', label: '杰尼龟', desc: '水系萌龟，沉稳聪明' },
  { id: 'jigglypuff', img: '/pets/jigglypuff.png', label: '胖丁', desc: '爱唱歌的粉色精灵' },
  { id: 'gastly', img: '/pets/gastly.png', label: '鬼斯', desc: '幽灵系，神秘莫测' },
  { id: 'dratini', img: '/pets/dratini.png', label: '迷你龙', desc: '龙系传说，优雅高贵' },
  { id: 'machop', img: '/pets/machop.png', label: '腕力', desc: '格斗系，力量惊人' },
  { id: 'abra', img: '/pets/abra.png', label: '凯西', desc: '超能力系，聪明绝顶' },
  { id: 'geodude', img: '/pets/geodude.png', label: '小拳石', desc: '岩石系，坚韧不拔' },
  { id: 'vulpix', img: '/pets/vulpix.png', label: '六尾', desc: '火系狐狸，美丽优雅' },
  { id: 'growlithe', img: '/pets/growlithe.png', label: '卡蒂狗', desc: '忠诚勇敢的火系犬' },
  { id: 'magikarp', img: '/pets/magikarp.png', label: '鲤鱼王', desc: '坚持不懈，终成暴鲤龙' },
  { id: 'oddish', img: '/pets/oddish.png', label: '走路草', desc: '草毒系，安静可爱' },
  { id: 'poliwag', img: '/pets/poliwag.png', label: '蚊香蝌蚪', desc: '水系小蝌蚪，活泼好动' },
];

const EVOLUTION_THRESHOLDS = [5, 15, 30];
const STAGE_NAMES = ['蛋', '基础形态', '一阶进化', '最终进化'];

const PET_MOODS: Record<string, { emoji: string; text: string }[]> = {
  pikachu:    [{ emoji: '😢', text: '皮卡...好饿...' }, { emoji: '⚡', text: '皮卡~还不错' }, { emoji: '⚡', text: '皮卡皮卡！超开心！' }],
  eevee:      [{ emoji: '😢', text: '布...肚子好饿' }, { emoji: '🦊', text: '布咿~心情不错' }, { emoji: '🦊', text: '布咿布咿！太开心了！' }],
  bulbasaur:  [{ emoji: '😢', text: '种子...没力气了' }, { emoji: '🌱', text: '种子~状态还行' }, { emoji: '🌿', text: '种子种子！活力满满！' }],
  charmander: [{ emoji: '😢', text: '火焰...快灭了...' }, { emoji: '🔥', text: '嗯，火焰还旺' }, { emoji: '🔥', text: '火焰全开！超级棒！' }],
  squirtle:   [{ emoji: '😢', text: '杰尼...好渴...' }, { emoji: '💧', text: '杰尼~还可以' }, { emoji: '💧', text: '杰尼杰尼！水力全开！' }],
  jigglypuff: [{ emoji: '😢', text: '胖...唱不动了...' }, { emoji: '🎀', text: '丁~心情还行' }, { emoji: '🎀', text: '胖丁胖丁~要唱歌！' }],
  cat:    [{ emoji: '😿', text: '喵呜...好饿...' }, { emoji: '😺', text: '喵~还不错' }, { emoji: '😸', text: '呼噜呼噜~超开心！' }],
  dog:    [{ emoji: '🐕', text: '汪...肚子咕咕叫' }, { emoji: '🐶', text: '汪汪！心情不错' }, { emoji: '🦮', text: '汪汪汪！超级开心！' }],
  rabbit: [{ emoji: '🐇', text: '...好饿想吃胡萝卜' }, { emoji: '🐰', text: '蹦蹦~还可以' }, { emoji: '🐰', text: '蹦蹦跳跳~太开心了！' }],
  dragon: [{ emoji: '🐲', text: '...力量在消退...' }, { emoji: '🐉', text: '嗯，状态还行' }, { emoji: '🔥', text: '火焰全开！状态极佳！' }],
};

function getPetEmoji(species: string, stage: number): string {
  const emojis = PET_EMOJIS[species] || PET_EMOJIS.pikachu;
  return emojis[Math.min(stage, emojis.length - 1)];
}

function getPetImage(species: string, stage: number): string | null {
  const images = PET_IMAGES[species];
  if (!images) return null;
  return images[Math.min(stage, images.length - 1)];
}

function getPetMood(species: string, happiness: number, hunger: number) {
  const moods = PET_MOODS[species] || PET_MOODS.pikachu;
  const avg = (happiness + hunger) / 2;
  if (avg < 30) return moods[0];
  if (avg < 70) return moods[1];
  return moods[2];
}

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="text-gray-500">{value}/{max}</span>
      </div>
      <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>
    </div>
  );
}

// ========== 领养界面 ==========
function AdoptView({ onAdopted }: { onAdopted: () => void }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('pikachu');
  const [name, setName] = useState('');
  const [hoveredSpecies, setHoveredSpecies] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const adoptMutation = useMutation({
    mutationFn: createPet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myPet'] });
      onAdopted();
    },
  });

  const previewSpecies = hoveredSpecies || selected;
  const previewImg = SPECIES_OPTIONS.find(s => s.id === previewSpecies)?.img;

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-gray-800">领养宠物</h1>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* 左侧: 预览 */}
          <div className="flex flex-col items-center">
            <motion.div
              className="w-48 h-48 md:w-64 md:h-64 bg-white rounded-full shadow-lg flex items-center justify-center border-4 border-orange-100 overflow-hidden"
              animate={{ y: [0, -10, 0] }}
              transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
            >
              {previewImg ? (
                <img src={previewImg} alt={previewSpecies} className="w-40 h-40 md:w-52 md:h-52 object-contain" />
              ) : (
                <span className="text-7xl md:text-8xl">{getPetEmoji(previewSpecies, 0)}</span>
              )}
            </motion.div>
            <p className="text-center text-gray-500 mt-4 text-sm">
              {SPECIES_OPTIONS.find(s => s.id === (hoveredSpecies || selected))?.desc}
            </p>
          </div>

          {/* 右侧: 选择 */}
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">选择你的伙伴</h2>
            <p className="text-gray-500 mb-6">认真学习就能让它成长进化哦！</p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              {SPECIES_OPTIONS.map((s) => (
                <motion.div
                  key={s.id}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onHoverStart={() => setHoveredSpecies(s.id)}
                  onHoverEnd={() => setHoveredSpecies(null)}
                  onClick={() => setSelected(s.id)}
                  className={`p-4 rounded-2xl border-2 cursor-pointer text-center transition-colors ${
                    selected === s.id
                      ? 'border-orange-400 bg-orange-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-orange-200'
                  }`}
                >
                  <img src={s.img} alt={s.label} className="w-16 h-16 mx-auto mb-2 object-contain" />
                  <div className="font-medium text-gray-800 text-sm">{s.label}</div>
                </motion.div>
              ))}
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-600 mb-2">给它取个名字</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="小伙伴"
                maxLength={50}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-orange-400 focus:ring-2 focus:ring-orange-100 outline-none transition-all"
              />
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={adoptMutation.isPending}
              onClick={() => adoptMutation.mutate({ name: name || '小伙伴', species: selected })}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-orange-400 to-yellow-400 text-white font-semibold text-lg shadow-md disabled:opacity-50"
            >
              {adoptMutation.isPending ? '领养中...' : '🎉 领养它！'}
            </motion.button>

            {adoptMutation.isError && (
              <p className="text-red-500 text-sm text-center mt-3">领养失败，请重试</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== 养成界面 ==========
function NurtureView({ pet, onShowLeaderboard }: { pet: Pet; onShowLeaderboard: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [feedMsg, setFeedMsg] = useState('');
  const [showHearts, setShowHearts] = useState(false);
  const [petTaps, setPetTaps] = useState(0);

  const feedMutation = useMutation({
    mutationFn: feedPet,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['myPet'] });
      setFeedMsg(data.message);
      setTimeout(() => setFeedMsg(''), 3000);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || '喂食失败';
      setFeedMsg(msg);
      setTimeout(() => setFeedMsg(''), 3000);
    },
  });

  const { data: events } = useQuery<PetEvent[]>({
    queryKey: ['petEvents'],
    queryFn: getPetEvents,
  });

  const emoji = getPetEmoji(pet.species, pet.evolution_stage);
  const petImage = getPetImage(pet.species, pet.evolution_stage);
  const nextThreshold = EVOLUTION_THRESHOLDS[pet.evolution_stage] || null;
  const mood = getPetMood(pet.species, pet.happiness, pet.hunger);

  const handlePetTap = () => {
    setPetTaps(prev => prev + 1);
    setShowHearts(true);
    setTimeout(() => setShowHearts(false), 1000);
  };

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors flex items-center gap-2">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
            <span className="text-gray-600 font-medium hidden sm:inline">返回</span>
          </button>
          <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-yellow-500">
            🐾 我的宠物
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={onShowLeaderboard}
              className="text-sm font-bold text-yellow-600 bg-yellow-50 px-3 py-1.5 rounded-full hover:bg-yellow-100 transition-colors"
            >
              🏆 排行榜
            </button>
            <div className="flex items-center gap-1 text-sm font-bold text-orange-500 bg-orange-50 px-3 py-1.5 rounded-full">
              🦴 {pet.food_balance}
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 左列: 宠物展示 + 互动 */}
          <div className="lg:col-span-1 space-y-4">
            <motion.div
              className="bg-white rounded-3xl p-6 shadow-sm border border-orange-100 text-center relative overflow-hidden cursor-pointer"
              onClick={handlePetTap}
              whileTap={{ scale: 0.98 }}
            >
              <div className="absolute inset-0 bg-gradient-to-b from-orange-50/50 to-transparent pointer-events-none" />
              <motion.div
                className="mb-3 inline-block relative"
                animate={{ y: [0, -8, 0], rotate: [0, 3, -3, 0] }}
                transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
              >
                {petImage ? (
                  <img src={petImage} alt={pet.name} className="w-28 h-28 md:w-36 md:h-36 object-contain" />
                ) : (
                  <span className="text-7xl md:text-8xl">{emoji}</span>
                )}
                <AnimatePresence>
                  {showHearts && (
                    <motion.span
                      className="absolute -top-4 -right-4 text-2xl"
                      initial={{ opacity: 1, y: 0, scale: 0.5 }}
                      animate={{ opacity: 0, y: -30, scale: 1.2 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.8 }}
                    >
                      ❤️
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
              <h2 className="text-xl font-bold text-gray-800">{pet.name}</h2>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs font-medium rounded-full">Lv.{pet.level}</span>
                <span className="px-2 py-0.5 bg-purple-100 text-purple-600 text-xs font-medium rounded-full">{pet.evolution_stage_name}</span>
              </div>
              <motion.div
                className="mt-3 inline-block px-3 py-1.5 bg-gray-50 rounded-full text-sm text-gray-600"
                key={mood.text}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                {mood.emoji} {mood.text}
              </motion.div>
              {petTaps > 0 && <div className="text-xs text-gray-400 mt-2">已摸头 {petTaps} 次</div>}
            </motion.div>

            <motion.button
              whileHover={{ scale: pet.food_balance >= 5 ? 1.02 : 1 }}
              whileTap={{ scale: pet.food_balance >= 5 ? 0.95 : 1 }}
              disabled={feedMutation.isPending || pet.food_balance < 5}
              onClick={() => feedMutation.mutate()}
              className={`w-full py-3 rounded-xl font-semibold text-lg shadow-md transition-all ${
                pet.food_balance >= 5
                  ? 'bg-gradient-to-r from-orange-400 to-yellow-400 text-white'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {feedMutation.isPending
                ? '喂食中...'
                : pet.food_balance >= 5
                  ? '🍖 喂食宠物 (🦴 5)'
                  : '🦴 粮食不足，去练习赚粮食吧'}
            </motion.button>

            <AnimatePresence>
              {feedMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-center text-sm text-green-600 font-medium bg-green-50 rounded-xl py-2"
                >
                  {feedMsg}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 右列: 属性 + 进化 + 动态 */}
          <div className="lg:col-span-2 space-y-4">
            {/* 属性面板 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">📊 宠物属性</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Bar value={pet.happiness} max={100} color="bg-yellow-400" label="😊 心情" />
                <Bar value={pet.hunger} max={100} color="bg-green-400" label="🍖 饱食度" />
                <Bar value={pet.experience} max={pet.xp_to_next_level} color="bg-blue-400" label="⭐ 经验值" />
              </div>
            </div>

            {/* 进化进度 */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">🌟 进化之路</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {STAGE_NAMES.map((s, i) => (
                  <React.Fragment key={i}>
                    <motion.div
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                        i <= pet.evolution_stage
                          ? 'bg-orange-100 text-orange-600 shadow-sm'
                          : 'bg-gray-100 text-gray-400'
                      } ${i === pet.evolution_stage ? 'ring-2 ring-orange-300' : ''}`}
                      animate={i === pet.evolution_stage ? { scale: [1, 1.05, 1] } : {}}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      {getPetEmoji(pet.species, i)} {s}
                    </motion.div>
                    {i < STAGE_NAMES.length - 1 && (
                      <div className={`flex-1 min-w-[20px] h-0.5 ${i < pet.evolution_stage ? 'bg-orange-300' : 'bg-gray-200'}`} />
                    )}
                  </React.Fragment>
                ))}
              </div>
              {nextThreshold && (
                <div className="mt-3 text-sm text-gray-500">
                  下一阶段需要 Lv.{nextThreshold}（当前 Lv.{pet.level}，还差 {Math.max(0, nextThreshold - pet.level)} 级）
                </div>
              )}
            </div>

            {/* 成长小贴士 */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-5 border border-blue-100">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">💡 成长小贴士</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-lg">📚</span>
                  <div>
                    <div className="font-medium text-gray-700">学习单词</div>
                    <div className="text-gray-500">每学10个词获得经验</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-lg">🎯</span>
                  <div>
                    <div className="font-medium text-gray-700">完成测试</div>
                    <div className="text-gray-500">高正确率获得更多经验</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-lg">🔥</span>
                  <div>
                    <div className="font-medium text-gray-700">连续打卡</div>
                    <div className="text-gray-500">坚持学习提升心情</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 事件历史 */}
            {events && events.length > 0 && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-orange-100">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">📜 最近动态</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {events.slice(0, 15).map((ev) => (
                    <div key={ev.id} className="flex items-start gap-3 text-sm py-1.5 border-b border-gray-50 last:border-0">
                      <span className="text-gray-400 text-xs mt-0.5 shrink-0 w-16">
                        {new Date(ev.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="text-gray-600">{ev.detail || ev.event_type}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== 排行榜界面 ==========
function LeaderboardView({ pet, onBack }: { pet: Pet; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['petLeaderboard'],
    queryFn: getPetLeaderboard,
  });

  const RANK_BADGES: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const PODIUM_COLORS: Record<number, { bg: string; border: string; glow: string }> = {
    1: { bg: 'from-yellow-50 to-amber-50', border: 'border-yellow-300', glow: 'shadow-yellow-200/50' },
    2: { bg: 'from-gray-50 to-slate-50', border: 'border-gray-300', glow: 'shadow-gray-200/50' },
    3: { bg: 'from-orange-50 to-amber-50', border: 'border-orange-300', glow: 'shadow-orange-200/50' },
  };

  const top3 = data?.entries.filter(e => e.rank <= 3) || [];
  const rest = data?.entries.filter(e => e.rank > 3) || [];
  // 领奖台顺序: 第2名 | 第1名 | 第3名
  const podiumOrder = [top3.find(e => e.rank === 2), top3.find(e => e.rank === 1), top3.find(e => e.rank === 3)];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#FFF8F0] to-[#FFF0E0]">
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-xl transition-colors flex items-center gap-2">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
            <span className="text-gray-600 font-medium hidden sm:inline">返回</span>
          </button>
          <h1 className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-orange-500 via-yellow-500 to-orange-500">
            🏆 宠物排行榜
          </h1>
          <div className="w-20" />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {data?.my_rank && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 text-center py-3 px-6 bg-white rounded-2xl shadow-sm border border-orange-100 inline-flex items-center gap-2 mx-auto w-full justify-center"
          >
            <span className="text-gray-500">你的排名</span>
            <span className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-yellow-500">
              第 {data.my_rank} 名
            </span>
          </motion.div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <motion.div className="text-5xl" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>🏆</motion.div>
            <span className="text-gray-400 text-sm">加载排行榜中...</span>
          </div>
        ) : (
          <>
            {/* Top 3 领奖台 */}
            {top3.length > 0 && (
              <div className="flex items-end justify-center gap-3 mb-8 px-2">
                {podiumOrder.map((entry, idx) => {
                  if (!entry) return <div key={idx} className="w-28" />;
                  const colors = PODIUM_COLORS[entry.rank];
                  const img = getPetImage(entry.species, entry.evolution_stage);
                  const isFirst = entry.rank === 1;
                  return (
                    <motion.div
                      key={entry.rank}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.15 }}
                      className={`flex flex-col items-center ${isFirst ? 'w-32' : 'w-28'}`}
                    >
                      <div className="text-2xl mb-1">{RANK_BADGES[entry.rank]}</div>
                      <div className={`w-full rounded-2xl border-2 ${colors.border} bg-gradient-to-b ${colors.bg} shadow-lg ${colors.glow} p-3 flex flex-col items-center gap-2 ${isFirst ? 'pb-5' : 'pb-4'}`}>
                        <div className={`${isFirst ? 'w-16 h-16' : 'w-14 h-14'} rounded-xl bg-white/80 flex items-center justify-center overflow-hidden shadow-sm`}>
                          {img ? (
                            <img src={img} alt={entry.species} className={`${isFirst ? 'w-14 h-14' : 'w-12 h-12'} object-contain`} />
                          ) : (
                            <span className="text-3xl">{getPetEmoji(entry.species, entry.evolution_stage)}</span>
                          )}
                        </div>
                        <div className="text-center w-full">
                          <div className="font-bold text-gray-800 text-sm truncate">{entry.pet_name}</div>
                          <div className="text-[10px] text-gray-400 truncate">{entry.username}</div>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-[10px] font-bold rounded-full">Lv.{entry.level}</span>
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-600 text-[10px] font-bold rounded-full">{entry.evolution_stage_name}</span>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* 第4名及以后的列表 */}
            <div className="space-y-2">
              {rest.map((entry: PetLeaderboardEntry) => {
                const isMe = entry.rank === data?.my_rank;
                const img = getPetImage(entry.species, entry.evolution_stage);

                return (
                  <motion.div
                    key={entry.rank}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: (entry.rank - 3) * 0.03 }}
                    className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
                      isMe
                        ? 'bg-gradient-to-r from-orange-50 to-yellow-50 border-orange-300 ring-2 ring-orange-200 shadow-md'
                        : 'bg-white/80 border-gray-100 hover:shadow-sm hover:border-gray-200'
                    }`}
                  >
                    <div className="w-8 text-center font-bold text-base shrink-0 text-gray-400">
                      {entry.rank}
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center shrink-0 overflow-hidden border border-gray-100">
                      {img ? (
                        <img src={img} alt={entry.species} className="w-10 h-10 object-contain" />
                      ) : (
                        <span className="text-2xl">{getPetEmoji(entry.species, entry.evolution_stage)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-800 truncate text-sm">{entry.pet_name}</div>
                      <div className="text-xs text-gray-400 truncate">主人: {entry.username}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="px-2 py-0.5 bg-orange-50 text-orange-500 text-xs font-semibold rounded-full border border-orange-100">Lv.{entry.level}</span>
                      <span className="px-2 py-0.5 bg-purple-50 text-purple-500 text-xs font-semibold rounded-full border border-purple-100">{entry.evolution_stage_name}</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {data?.entries.length === 0 && (
              <div className="text-center py-20">
                <div className="text-5xl mb-4">🏆</div>
                <div className="text-gray-400">还没有宠物上榜</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ========== 主页面 ==========
export default function PetPage() {
  const [view, setView] = useState<'nurture' | 'leaderboard'>('nurture');
  const { data: pet, isLoading, isError } = useQuery<Pet>({
    queryKey: ['myPet'],
    queryFn: getMyPet,
    retry: false,
  });

  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <motion.div
          className="text-6xl"
          animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          🥚
        </motion.div>
      </div>
    );
  }

  if (isError || !pet) {
    return <AdoptView onAdopted={() => queryClient.invalidateQueries({ queryKey: ['myPet'] })} />;
  }

  if (view === 'leaderboard') {
    return <LeaderboardView pet={pet} onBack={() => setView('nurture')} />;
  }

  return <NurtureView pet={pet} onShowLeaderboard={() => setView('leaderboard')} />;
}
