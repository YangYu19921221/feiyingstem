import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ChevronRight, X } from 'lucide-react';
import { getMyPet, createPet, feedPet, getPetEvents, getPetLeaderboard, type Pet, type PetEvent, type PetLeaderboardEntry } from '../api/pet';
import { quickMatchBattle } from '../api/petBattle';
import {
  PET_SPECIES,
  getPetDefinition,
  getPetImage,
  getPetStage,
  getPetStageImage,
  getNextPetStage,
  type PetStage,
} from '../config/petSpecies';

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
  book_fox:    [{ emoji: '😢', text: '小狐饿了，书都翻不动…' }, { emoji: '🦊', text: '嗯，今天状态不错' }, { emoji: '📚', text: '知识满满，一起看书吧！' }],
  paper_owl:   [{ emoji: '😢', text: '咕…羽毛有点蔫了' }, { emoji: '🦉', text: '咕咕，继续用功' }, { emoji: '🎓', text: '满腹经纶，带你一起学！' }],
  word_turtle: [{ emoji: '😢', text: '慢吞吞…有点饿了' }, { emoji: '🐢', text: '稳稳前行，状态可以' }, { emoji: '📖', text: '一步一字，厚积薄发' }],
};

function getPetEmoji(species: string, stage: number): string {
  return stage === 0 ? '🥚' : getPetDefinition(species).emoji;
}

function getPetMood(species: string, happiness: number, hunger: number) {
  const definition = getPetDefinition(species);
  const moods = PET_MOODS[species] || [
    { emoji: '😢', text: `${definition.stages[1].name}有点没精神` },
    { emoji: definition.emoji, text: '状态不错，继续成长' },
    { emoji: definition.emoji, text: '活力满满，准备出发！' },
  ];
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
  const previewDefinition = getPetDefinition(previewSpecies);
  const previewImg = previewDefinition.stages[1].image;

  return (
    <div className="min-h-screen bg-paper">
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-gray-800">领养宠物</h1>
        </div>
      </nav>

      {/* Hero 横幅 */}
      <div className="relative overflow-hidden" style={{ height: 140 }}>
        <img src="/hero-pet.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-purple-900/60 via-purple-800/30 to-transparent" />
        <div className="relative z-10 h-full flex items-center px-4 max-w-5xl mx-auto">
          <div className="text-white">
            <h2 className="text-3xl font-bold drop-shadow">🐾 领养宠物</h2>
            <p className="text-sm opacity-80 mt-1 drop-shadow">选择你的学习伙伴，一起成长✨</p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 pb-28 md:pb-8">
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
            <div className="mt-4 w-full max-w-md text-center">
              <div className="font-bold text-gray-800">{previewDefinition.label}</div>
              <p className="mt-1 text-sm text-gray-500">{previewDefinition.description}</p>
              <div className="mt-4 flex items-center justify-center gap-1 overflow-x-auto pb-2">
                {previewDefinition.stages.slice(1).map((form, index) => (
                  <React.Fragment key={form.name}>
                    <div className="w-20 shrink-0">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-gray-100">
                        <img src={form.image!} alt={form.name} className="h-12 w-12 object-contain" />
                      </div>
                      <div className="mt-1 truncate text-xs font-medium text-gray-700">{form.name}</div>
                      <div className="text-[11px] text-gray-400">Lv.{form.unlockLevel}</div>
                    </div>
                    {index < 2 && <ChevronRight className="h-4 w-4 shrink-0 text-orange-300" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧: 选择 */}
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">选择你的伙伴</h2>
            <p className="text-gray-500 mb-6">认真学习就能让它成长进化哦！</p>

            <div className="mb-6 grid grid-cols-2 gap-2 pr-1 sm:grid-cols-3 sm:gap-3 md:max-h-[480px] md:overflow-y-auto">
              {PET_SPECIES.map((s) => (
                <motion.div
                  key={s.id}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onHoverStart={() => setHoveredSpecies(s.id)}
                  onHoverEnd={() => setHoveredSpecies(null)}
                  onClick={() => setSelected(s.id)}
                  className={`min-w-0 cursor-pointer rounded-xl border-2 p-3 text-center transition-colors sm:p-4 ${
                    selected === s.id
                      ? 'border-orange-400 bg-orange-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-orange-200'
                  }`}
                >
                  <img
                    src={s.stages[1].image!}
                    alt={s.label}
                    loading="lazy"
                    decoding="async"
                    className="mx-auto mb-2 h-16 w-16 object-contain"
                  />
                  <div className="break-words text-sm font-medium leading-5 text-gray-800">{s.label}</div>
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
  const [evolutionReveal, setEvolutionReveal] = useState<{ from: PetStage; to: PetStage } | null>(null);

  const feedMutation = useMutation({
    mutationFn: feedPet,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['myPet'] });
      setFeedMsg(data.message);
      if (data.evolved && data.new_stage !== null) {
        setEvolutionReveal({
          from: getPetStage(pet.species, pet.evolution_stage),
          to: getPetStage(pet.species, data.new_stage),
        });
      }
      setTimeout(() => setFeedMsg(''), 3000);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail || '喂食失败';
      setFeedMsg(msg);
      setTimeout(() => setFeedMsg(''), 3000);
    },
  });

  const quickMatchMutation = useMutation({
    mutationFn: quickMatchBattle,
    onSuccess: (battle) => {
      console.log('快速对战成功，battle:', battle);
      console.log('准备跳转到:', `/student/pet/battle/${battle.id}`);
      // 使用window.location直接跳转，确保刷新
      window.location.href = `/student/pet/battle/${battle.id}`;
    },
    onError: (err: any) => {
      console.error('快速对战失败:', err);
      const msg = err?.response?.data?.detail || '匹配失败';
      setFeedMsg(msg);
      setTimeout(() => setFeedMsg(''), 3000);
    },
  });

  const handleQuickBattle = () => {
    quickMatchMutation.mutate();
  };

  const { data: events } = useQuery<PetEvent[]>({
    queryKey: ['petEvents'],
    queryFn: getPetEvents,
  });

  const definition = getPetDefinition(pet.species);
  const emoji = getPetEmoji(pet.species, pet.evolution_stage);
  const petImage = getPetStageImage(pet.species, pet.evolution_stage);
  const currentStage = getPetStage(pet.species, pet.evolution_stage);
  const nextStage = getNextPetStage(pet.species, pet.evolution_stage);
  const mood = getPetMood(pet.species, pet.happiness, pet.hunger);
  const stageStartLevel = currentStage.unlockLevel;
  const evolutionProgress = nextStage
    ? Math.min(100, Math.max(0, ((pet.level - stageStartLevel) / (nextStage.unlockLevel - stageStartLevel)) * 100))
    : 100;

  // 距离升到下一级还需喂食多少次
  const xpPerFeed = pet.xp_per_feed || 8;
  const xpRemaining = Math.max(0, pet.xp_to_next_level - pet.experience);
  const feedsToNextLevel = Math.ceil(xpRemaining / xpPerFeed);
  // 宠物最大HP（与后端 calculate_max_hp 一致）
  const maxHp = 100 + pet.level * 5 + pet.evolution_stage * 20;
  // 每题回血 = 最大HP的10%（至少5），与后端 heal_amount_for 一致
  const healPerQuestion = Math.max(5, Math.round(maxHp * 0.1));

  const handlePetTap = () => {
    setPetTaps(prev => prev + 1);
    setShowHearts(true);
    setTimeout(() => setShowHearts(false), 1000);
  };

  return (
    <div className="min-h-screen bg-paper">
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors flex items-center gap-2">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
            <span className="text-gray-600 font-medium hidden sm:inline">返回</span>
          </button>
          <h1 className="hidden text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-yellow-500 min-[480px]:block">
            🐾 我的宠物
          </h1>
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <button
              onClick={handleQuickBattle}
              disabled={quickMatchMutation.isPending}
              className="whitespace-nowrap rounded-lg bg-purple-50 px-2 py-1.5 text-xs font-bold text-purple-600 transition-colors hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 sm:text-sm"
            >
              {quickMatchMutation.isPending ? '匹配中...' : '⚔️ 对战'}
            </button>
            <button
              onClick={() => navigate('/student/pet/battle-hall')}
              className="whitespace-nowrap rounded-lg bg-blue-50 px-2 py-1.5 text-xs font-bold text-blue-600 transition-colors hover:bg-blue-100 sm:px-3 sm:text-sm"
            >
              👥 好友
            </button>
            <button
              onClick={onShowLeaderboard}
              className="hidden whitespace-nowrap rounded-lg bg-yellow-50 px-2 py-1.5 text-xs font-bold text-yellow-600 transition-colors hover:bg-yellow-100 min-[390px]:block sm:px-3 sm:text-sm"
            >
              🏆 排行榜
            </button>
            <div className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-orange-50 px-2 py-1.5 text-xs font-bold text-orange-500 sm:px-3 sm:text-sm">
              🦴 {pet.food_balance}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero 横幅 */}
      <div className="relative overflow-hidden" style={{ height: 140 }}>
        <img src="/hero-pet.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-purple-900/60 via-purple-800/30 to-transparent" />
        <div className="relative z-10 h-full flex items-center px-4 max-w-5xl mx-auto">
          <div className="text-white">
            <h2 className="text-3xl font-bold drop-shadow">🐾 我的宠物</h2>
            <p className="text-sm opacity-80 mt-1 drop-shadow">学习越多，宠物成长越快✨</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* 受伤状态提示 */}
        {pet.is_injured && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border-2 border-red-200 rounded-3xl p-6 mb-6 shadow-lg"
          >
            <div className="text-center">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="text-6xl mb-3"
              >
                💔
              </motion.div>
              <h3 className="text-2xl font-bold text-red-600 mb-2">宠物受伤了！</h3>
              <p className="text-gray-700 mb-1">
                当前HP: <span className="font-bold text-red-500">{pet.current_hp || 0}</span> / {100 + pet.level * 5 + pet.evolution_stage * 20}
              </p>
              <p className="text-gray-600 mb-4">
                学习单词可以治疗它，每答对1题恢复 {healPerQuestion} HP
              </p>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => navigate('/student/pet/heal')}
                className="px-8 py-3 bg-gradient-to-r from-green-400 to-emerald-500 text-white font-bold text-lg rounded-xl shadow-lg inline-flex items-center gap-2"
              >
                💊 立即治疗
                <span className="text-sm opacity-90">
                  (需答对约 {Math.max(0, Math.ceil((maxHp * 0.8 - (pet.current_hp ?? 0)) / healPerQuestion))} 题)
                </span>
              </motion.button>
            </div>
          </motion.div>
        )}

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
                <span className="px-2 py-0.5 bg-purple-100 text-purple-600 text-xs font-medium rounded-full">{currentStage.name}</span>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Bar value={pet.happiness} max={100} color="bg-yellow-400" label="😊 心情" />
                <Bar value={pet.hunger} max={100} color="bg-green-400" label="🍖 饱食度" />
                <Bar value={pet.current_hp ?? maxHp} max={maxHp} color={pet.is_injured ? 'bg-red-400' : 'bg-rose-400'} label="❤️ 生命值 HP" />
                <Bar value={pet.experience} max={pet.xp_to_next_level} color="bg-blue-400" label="⭐ 经验值" />
              </div>
              {/* 距下一级还需喂食 */}
              <div className="mt-4 flex items-center justify-between bg-blue-50 rounded-xl px-4 py-2.5">
                <span className="text-sm text-gray-600">
                  距 <span className="font-bold text-blue-600">Lv.{pet.level + 1}</span> 还差 {xpRemaining} 经验
                </span>
                <span className="text-sm font-bold text-blue-600">
                  🍖 约需喂食 {feedsToNextLevel} 次
                </span>
              </div>
            </div>

            {/* 进化进度 */}
            <div className="rounded-2xl border border-orange-100 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">🌟 {definition.label}进化之路</h3>
                  <p className="mt-1 text-xs text-gray-400">升级达到节点后自动进化</p>
                </div>
                <span className="shrink-0 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-600">
                  {pet.evolution_stage + 1}/4
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 sm:gap-3">
                {definition.stages.map((form, index) => {
                  const isCurrent = index === pet.evolution_stage;
                  const isUnlocked = index <= pet.evolution_stage;
                  return (
                    <motion.div
                      key={`${form.name}-${index}`}
                      className="min-w-0 text-center"
                      animate={isCurrent ? { y: [0, -4, 0] } : {}}
                      transition={{ repeat: Infinity, duration: 2 }}
                    >
                      <div className={`relative mx-auto flex aspect-square w-full max-w-[88px] items-center justify-center rounded-xl border-2 p-1.5 sm:p-2 ${
                        isCurrent
                          ? 'border-orange-400 bg-orange-50 shadow-md'
                          : isUnlocked
                            ? 'border-green-200 bg-green-50'
                            : 'border-gray-100 bg-gray-50 grayscale'
                      }`}>
                        {form.image ? (
                          <img src={form.image} alt={form.name} className="h-full w-full object-contain" />
                        ) : (
                          <span className="text-3xl sm:text-4xl">🥚</span>
                        )}
                        {isUnlocked && !isCurrent && (
                          <span className="absolute right-0.5 top-0.5 text-[10px] text-green-600">✓</span>
                        )}
                      </div>
                      <div className={`mt-1 truncate text-[11px] font-bold sm:text-xs ${isUnlocked ? 'text-gray-700' : 'text-gray-400'}`}>
                        {form.name}
                      </div>
                      <div className="text-[10px] text-gray-400 sm:text-[11px]">Lv.{form.unlockLevel}</div>
                    </motion.div>
                  );
                })}
              </div>
              <div className="mt-4 rounded-xl bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-gray-600">
                    {nextStage ? `下一形态：${nextStage.name}` : '已解锁最终形态'}
                  </span>
                  <span className="shrink-0 font-bold text-orange-600">
                    {nextStage ? `还差 ${Math.max(0, nextStage.unlockLevel - pet.level)} 级` : '进化完成'}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-orange-400 to-yellow-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${evolutionProgress}%` }}
                    transition={{ duration: 0.7 }}
                  />
                </div>
              </div>
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

      <AnimatePresence>
        {evolutionReveal && (
          <motion.div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/70 px-4 py-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setEvolutionReveal(null)}
          >
            <motion.div
              className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white p-5 text-center shadow-2xl sm:p-7"
              initial={{ opacity: 0, scale: 0.75, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="关闭进化提示"
                onClick={() => setEvolutionReveal(null)}
                className="absolute right-3 top-3 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
              <motion.div
                className="text-4xl"
                animate={{ rotate: [0, 12, -12, 0], scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 1.8 }}
              >
                ✨
              </motion.div>
              <h2 className="mt-2 text-2xl font-black text-gray-900">进化成功</h2>
              <p className="mt-1 text-sm text-gray-500">{pet.name} 解锁了新的形态</p>
              <div className="mt-6 flex items-center justify-center gap-2 sm:gap-4">
                <div className="w-28 min-w-0 sm:w-32">
                  <div className="flex aspect-square items-center justify-center rounded-xl bg-gray-50 p-3 grayscale">
                    {evolutionReveal.from.image ? (
                      <img src={evolutionReveal.from.image} alt={evolutionReveal.from.name} className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-6xl">🥚</span>
                    )}
                  </div>
                  <div className="mt-2 truncate text-xs text-gray-500">{evolutionReveal.from.name}</div>
                </div>
                <ChevronRight className="h-7 w-7 shrink-0 text-orange-400" />
                <motion.div className="w-28 min-w-0 sm:w-32" animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
                  <div className="flex aspect-square items-center justify-center rounded-xl bg-orange-50 p-3 ring-2 ring-orange-300">
                    <img src={evolutionReveal.to.image!} alt={evolutionReveal.to.name} className="h-full w-full object-contain" />
                  </div>
                  <div className="mt-2 truncate text-sm font-bold text-orange-600">{evolutionReveal.to.name}</div>
                </motion.div>
              </div>
              <button
                type="button"
                onClick={() => setEvolutionReveal(null)}
                className="mt-6 w-full rounded-xl bg-orange-500 py-3 font-bold text-white transition-colors hover:bg-orange-600"
              >
                开始新阶段
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ========== 排行榜界面 ==========
function LeaderboardView({ onBack }: { onBack: () => void }) {
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
    <div className="min-h-screen bg-paper">
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
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
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
    return <LeaderboardView onBack={() => setView('nurture')} />;
  }

  return <NurtureView pet={pet} onShowLeaderboard={() => setView('leaderboard')} />;
}
