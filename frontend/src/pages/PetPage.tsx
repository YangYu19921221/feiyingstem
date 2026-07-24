import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BookOpen, Check, ChevronRight, Gem, LockKeyhole, Plus, RefreshCw, Search, ShieldAlert, Users, X } from 'lucide-react';
import { getMyPet, getPetCollection, createPet, switchPet, feedPet, getPetEvents, getPetLeaderboard, type Pet, type PetCollection, type PetEvent, type PetLeaderboardEntry } from '../api/pet';
import { quickMatchBattle } from '../api/petBattle';
import PetArtwork from '../components/PetArtwork';
import { TYPE_COLORS, TYPE_ICONS, TYPE_NAMES, type PokemonType } from '../utils/typeEffectiveness';
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
  const [speciesQuery, setSpeciesQuery] = useState('');
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
  const availableSpecies = PET_SPECIES.filter((definition) => {
    const keyword = speciesQuery.trim().toLowerCase();
    return !keyword || [definition.label, ...definition.stages.map((form) => form.name)]
      .some((value) => value.toLowerCase().includes(keyword));
  });

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
                        <PetArtwork
                          image={form.image}
                          stage={form}
                          alt={form.name}
                          containerClassName="h-12 w-12"
                          imageClassName="h-full w-full"
                          eager
                        />
                      </div>
                      <div className="mt-1 truncate text-xs font-medium text-gray-700">{form.name}</div>
                      <div className="text-[11px] text-gray-400">Lv.{form.unlockLevel}</div>
                    </div>
                    {index < 3 && <ChevronRight className="h-4 w-4 shrink-0 text-orange-300" />}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧: 选择 */}
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">选择你的伙伴</h2>
            <p className="text-gray-500 mb-6">认真学习就能让它成长进化哦！</p>

            <label className="relative mb-3 block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                value={speciesQuery}
                onChange={(event) => setSpeciesQuery(event.target.value)}
                placeholder={`搜索 ${PET_SPECIES.length} 个宝可梦家族`}
                className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </label>

            <div className="mb-6 grid grid-cols-2 gap-2 pr-1 sm:grid-cols-3 sm:gap-3 md:max-h-[480px] md:overflow-y-auto">
              {availableSpecies.map((s) => (
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

function PetRecoveryView({ collection }: { collection: PetCollection }) {
  const navigate = useNavigate();
  const goal = collection.recovery_goal_words || collection.learned_words + collection.recovery_words_remaining;
  const recoveryStart = Math.max(0, goal - collection.words_per_slot);
  const recoveredWords = Math.max(0, Math.min(
    collection.words_per_slot,
    collection.learned_words - recoveryStart,
  ));
  const progress = Math.round((recoveredWords / collection.words_per_slot) * 100);

  return (
    <div className="min-h-screen bg-paper px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-lg">
        <button
          onClick={() => navigate('/student/dashboard')}
          className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-white"
          aria-label="返回学习中心"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="rounded-2xl border border-red-100 bg-white p-5 text-center shadow-lg sm:p-8">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-xl font-bold text-gray-900 sm:text-2xl">队伍正在重新集结</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600 sm:text-base">
            最后一只伙伴已在对战中被收服。完成新的学习目标后，就能重新选择一只伙伴蛋。
          </p>

          <div className="mt-6 text-left">
            <div className="mb-2 flex items-end justify-between gap-3">
              <span className="text-sm font-semibold text-gray-700">重新领养进度</span>
              <span className="shrink-0 text-sm font-bold text-orange-600">{recoveredWords} / {collection.words_per_slot}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                className="h-full rounded-full bg-orange-500"
              />
            </div>
            <p className="mt-3 text-center text-sm font-medium text-gray-700">
              还需学习 <span className="font-bold text-orange-600">{collection.recovery_words_remaining}</span> 个不同单词
            </p>
          </div>

          <button
            onClick={() => navigate('/student/dashboard')}
            className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 font-bold text-white shadow-sm transition-colors hover:bg-orange-600"
          >
            <BookOpen className="h-5 w-5" />
            去学习单词
          </button>
        </div>
      </div>
    </div>
  );
}

const CATALOG_FILTERS: { id: 'all' | PokemonType | 'other'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'fire', label: '火' },
  { id: 'water', label: '水' },
  { id: 'grass', label: '草' },
  { id: 'electric', label: '电' },
  { id: 'psychic', label: '超能' },
  { id: 'dragon', label: '龙' },
  { id: 'other', label: '其他' },
];

const FEATURED_TYPES = new Set<PokemonType>(['fire', 'water', 'grass', 'electric', 'psychic', 'dragon']);

function CatalogView({
  pet,
  collection,
  onBack,
  onSwitched,
}: {
  pet: Pet;
  collection: PetCollection;
  onBack: () => void;
  onSwitched: () => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | PokemonType | 'other'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [newName, setNewName] = useState('');

  const selected = selectedId ? getPetDefinition(selectedId) : null;
  const ownedBySpecies = new Map(collection.pets.map((ownedPet) => [ownedPet.species, ownedPet]));
  const canAdopt = collection.used_slots < collection.unlocked_slots && collection.used_slots < collection.max_slots;
  const visibleSpecies = PET_SPECIES.filter((definition) => {
    const matchesFilter = filter === 'all'
      || definition.element === filter
      || (filter === 'other' && !FEATURED_TYPES.has(definition.element));
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || [
      definition.label,
      definition.description,
      ...definition.stages.map((form) => form.name),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
    return matchesFilter && matchesQuery;
  });

  const switchMutation = useMutation({
    mutationFn: (petId: number) => switchPet({ pet_id: petId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['myPet'] }),
        queryClient.invalidateQueries({ queryKey: ['petCollection'] }),
        queryClient.invalidateQueries({ queryKey: ['petEvents'] }),
      ]);
      setSelectedId(null);
      setConfirming(false);
      onSwitched();
    },
  });

  const adoptMutation = useMutation({
    mutationFn: createPet,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['myPet'] }),
        queryClient.invalidateQueries({ queryKey: ['petCollection'] }),
        queryClient.invalidateQueries({ queryKey: ['petEvents'] }),
      ]);
      setSelectedId(null);
      setConfirming(false);
      onSwitched();
    },
  });

  const openSpecies = (species: string) => {
    const definition = getPetDefinition(species);
    setSelectedId(species);
    setNewName(definition.stages[1].name);
    setConfirming(false);
    switchMutation.reset();
    adoptMutation.reset();
  };

  return (
    <div className="min-h-screen bg-paper pb-28 md:pb-8">
      <nav className="sticky top-0 z-30 border-b border-gray-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3 py-3 sm:px-4">
          <button onClick={onBack} className="flex items-center gap-2 rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5" />
            <span className="hidden text-sm font-medium sm:inline">返回养成</span>
          </button>
          <div className="text-center">
            <h1 className="font-bold text-gray-900">宝可梦图鉴</h1>
            <p className="text-xs text-gray-400">{PET_SPECIES.length} 个家族</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-cyan-50 px-2.5 py-1.5 text-xs font-bold text-cyan-700">
            <Gem className="h-4 w-4" />
            5 阶段
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <section className="mb-5 border-b border-gray-200 pb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-bold text-gray-900">
                <Users className="h-5 w-5 text-orange-500" />
                我的宝可梦队伍
              </div>
              <p className="mt-1 text-xs text-gray-500">
                已学习 {collection.learned_words.toLocaleString()} 个不同单词 · {collection.used_slots}/{collection.max_slots} 只
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-600">
              已解锁 {collection.unlocked_slots} 格
            </span>
          </div>

          <div className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-3">
            {Array.from({ length: collection.max_slots }, (_, index) => {
              const ownedPet = collection.pets[index];
              const unlocked = index < collection.unlocked_slots;
              const ownedDefinition = ownedPet ? getPetDefinition(ownedPet.species) : null;
              const ownedStage = ownedPet ? getPetStage(ownedPet.species, ownedPet.evolution_stage) : null;
              return (
                <button
                  key={index}
                  type="button"
                  disabled={!ownedPet}
                  onClick={() => ownedPet && openSpecies(ownedPet.species)}
                  className={`relative flex aspect-square min-w-0 items-center justify-center rounded-xl border p-1 transition sm:p-2 ${
                    ownedPet?.is_active
                      ? 'border-orange-400 bg-orange-50 ring-2 ring-orange-100'
                      : ownedPet
                        ? 'border-gray-200 bg-white hover:border-orange-200'
                        : unlocked
                          ? 'border-dashed border-cyan-300 bg-cyan-50'
                          : 'border-gray-200 bg-gray-100'
                  }`}
                >
                  {ownedPet && ownedDefinition && ownedStage ? (
                    <>
                      <PetArtwork
                        image={ownedStage.image}
                        stage={ownedStage}
                        alt={ownedPet.name}
                        containerClassName="h-full w-full"
                        imageClassName="h-full w-full"
                      />
                      <span className="absolute bottom-0.5 right-0.5 rounded bg-gray-900/75 px-1 text-[9px] font-bold text-white sm:text-[10px]">
                        Lv.{ownedPet.level}
                      </span>
                      {ownedPet.is_active && <Check className="absolute left-1 top-1 h-3.5 w-3.5 rounded-full bg-orange-500 p-0.5 text-white" />}
                    </>
                  ) : unlocked ? (
                    <Plus className="h-5 w-5 text-cyan-500 sm:h-6 sm:w-6" />
                  ) : (
                    <LockKeyhole className="h-4 w-4 text-gray-400 sm:h-5 sm:w-5" />
                  )}
                </button>
              );
            })}
          </div>

          {collection.next_slot_words ? (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-500">每学习 2000 个不同单词解锁新名额</span>
                <span className="shrink-0 font-bold text-cyan-700">
                  距下一格还差 {Math.max(0, collection.next_slot_words - collection.learned_words).toLocaleString()} 词
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(0, ((collection.learned_words - (collection.next_slot_words - collection.words_per_slot)) / collection.words_per_slot) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-center text-xs font-bold text-green-700">
              5 个队伍名额已全部解锁
            </div>
          )}
        </section>

        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative block flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索家族或形态"
              className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
            />
          </label>
          <div className="flex max-w-full gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="按属性筛选">
            {CATALOG_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                onClick={() => setFilter(item.id)}
                className={`h-11 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors ${
                  filter === item.id ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-500">找到 {visibleSpecies.length} 个家族</span>
          <span className="text-gray-400">当前伙伴：{getPetDefinition(pet.species).label}</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {visibleSpecies.map((definition) => {
            const isCurrent = definition.id === pet.species;
            const ownedPet = ownedBySpecies.get(definition.id);
            const type = definition.element;
            return (
              <motion.button
                key={definition.id}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => openSpecies(definition.id)}
                className={`relative min-w-0 overflow-hidden rounded-xl border bg-white p-3 text-left transition-shadow hover:shadow-md sm:p-4 ${
                  isCurrent
                    ? 'border-orange-300 ring-2 ring-orange-100'
                    : ownedPet
                      ? 'border-green-300 ring-1 ring-green-100'
                      : 'border-gray-100'
                }`}
              >
                {isCurrent && (
                  <span className="absolute right-2 top-2 z-10 rounded-md bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">当前</span>
                )}
                {!isCurrent && ownedPet && (
                  <span className="absolute right-2 top-2 z-10 rounded-md bg-green-500 px-1.5 py-0.5 text-[10px] font-bold text-white">已拥有</span>
                )}
                <PetArtwork
                  image={definition.stages[1].image}
                  stage={definition.stages[1]}
                  alt={definition.label}
                  containerClassName="mx-auto h-24 w-24 sm:h-28 sm:w-28"
                  imageClassName="h-full w-full"
                />
                <div className="mt-2 truncate text-sm font-bold text-gray-900 sm:text-base">{definition.label}</div>
                <div className="mt-1 flex items-center justify-between gap-1">
                  <span
                    className="truncate rounded-md px-1.5 py-0.5 text-[11px] font-bold"
                    style={{ color: TYPE_COLORS[type], backgroundColor: `${TYPE_COLORS[type]}18` }}
                  >
                    {TYPE_ICONS[type]} {TYPE_NAMES[type]}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400">5 阶段</span>
                </div>
                <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-cyan-600">
                  <Gem className="h-3.5 w-3.5" />
                  {definition.stages[4].name}
                </div>
              </motion.button>
            );
          })}
        </div>

        {visibleSpecies.length === 0 && (
          <div className="py-20 text-center text-sm text-gray-400">没有找到匹配的宝可梦</div>
        )}
      </main>

      <AnimatePresence>
        {selected && (
          <motion.div
            className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-gray-950/65 px-3 py-5 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedId(null)}
          >
            <motion.div
              className="relative my-auto w-full max-w-2xl rounded-2xl bg-white p-4 shadow-2xl sm:p-6"
              initial={{ y: 24, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 16, opacity: 0, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="关闭图鉴详情"
                onClick={() => setSelectedId(null)}
                className="absolute right-3 top-3 z-20 rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="pr-10">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-black text-gray-900">{selected.label}</h2>
                  <span
                    className="rounded-md px-2 py-0.5 text-xs font-bold"
                    style={{ color: TYPE_COLORS[selected.element], backgroundColor: `${TYPE_COLORS[selected.element]}18` }}
                  >
                    {TYPE_ICONS[selected.element]} {TYPE_NAMES[selected.element]}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{selected.description}</p>
              </div>

              <div className="mt-5 grid grid-cols-5 gap-1 sm:gap-3">
                {selected.stages.map((form, index) => (
                  <div key={`${form.name}-${index}`} className="min-w-0 text-center">
                    <div className={`mx-auto aspect-square w-full max-w-[96px] rounded-xl border p-1 ${form.isGem ? 'border-cyan-300 bg-cyan-50' : 'border-gray-100 bg-gray-50'}`}>
                      <PetArtwork
                        image={form.image}
                        stage={form}
                        alt={form.name}
                        containerClassName="h-full w-full"
                        imageClassName="h-full w-full"
                      />
                    </div>
                    <div className={`mt-1 truncate text-[10px] font-bold sm:text-xs ${form.isGem ? 'text-cyan-600' : 'text-gray-700'}`}>{form.name}</div>
                    <div className="text-[10px] text-gray-400">Lv.{form.unlockLevel}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 px-3 py-2.5 text-xs sm:text-sm">
                <span className="text-gray-600">总计 5 个成长阶段</span>
                <span className="text-right font-medium text-gray-600">必杀技：{selected.ultimate.emoji} {selected.ultimate.name}</span>
                <span className="col-span-2 flex items-center justify-end gap-1 font-bold text-cyan-600"><Gem className="h-4 w-4" />Lv.45 晶耀进化</span>
              </div>

              {selected.id === pet.species ? (
                <div className="mt-5 rounded-xl bg-orange-50 py-3 text-center text-sm font-bold text-orange-600">这是你当前的伙伴</div>
              ) : ownedBySpecies.has(selected.id) ? (
                <div className="mt-5">
                  <div className="rounded-xl bg-green-50 px-3 py-2.5 text-sm text-green-700">
                    已培养至 Lv.{ownedBySpecies.get(selected.id)!.level} · {ownedBySpecies.get(selected.id)!.evolution_stage_name}，切换不会丢失进度。
                  </div>
                  {switchMutation.isError && (
                    <p className="mt-2 text-sm text-red-600">{(switchMutation.error as any)?.response?.data?.detail || '切换失败，请重试'}</p>
                  )}
                  <button
                    type="button"
                    disabled={switchMutation.isPending}
                    onClick={() => switchMutation.mutate(ownedBySpecies.get(selected.id)!.id)}
                    className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 font-bold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
                  >
                    <RefreshCw className="h-5 w-5" />
                    {switchMutation.isPending ? '切换中...' : '切换为当前伙伴'}
                  </button>
                </div>
              ) : !canAdopt ? (
                <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3 text-center text-sm text-gray-600">
                  <LockKeyhole className="mx-auto mb-1.5 h-5 w-5 text-gray-400" />
                  {collection.used_slots >= collection.max_slots
                    ? '队伍已满，最多可以拥有 5 只宝可梦'
                    : `下一个名额需累计学习 ${collection.next_slot_words?.toLocaleString()} 个不同单词`}
                </div>
              ) : confirming ? (
                <div className="mt-5">
                  <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-800">
                    新领养的伙伴从 Lv.1 伙伴蛋开始培养；其他宝可梦的等级、进化和属性都会保留。
                  </div>
                  <label className="mt-3 block text-sm font-medium text-gray-700">
                    新伙伴名字
                    <input
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      maxLength={50}
                      className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 px-3 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100"
                    />
                  </label>
                  {adoptMutation.isError && (
                    <p className="mt-2 text-sm text-red-600">{(adoptMutation.error as any)?.response?.data?.detail || '领养失败，请重试'}</p>
                  )}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setConfirming(false)} className="h-11 rounded-xl bg-gray-100 font-bold text-gray-600 hover:bg-gray-200">取消</button>
                    <button
                      type="button"
                      disabled={!newName.trim() || adoptMutation.isPending}
                      onClick={() => adoptMutation.mutate({ species: selected.id, name: newName.trim() })}
                      className="h-11 rounded-xl bg-cyan-600 font-bold text-white hover:bg-cyan-700 disabled:opacity-50"
                    >
                      {adoptMutation.isPending ? '领养中...' : '确认领养'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 font-bold text-white transition-colors hover:bg-cyan-700"
                >
                  <Plus className="h-5 w-5" />
                  领养到我的队伍
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ========== 养成界面 ==========
function NurtureView({
  pet,
  onShowLeaderboard,
  onShowCatalog,
}: {
  pet: Pet;
  onShowLeaderboard: () => void;
  onShowCatalog: () => void;
}) {
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
              onClick={onShowCatalog}
              className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-cyan-50 px-2 py-1.5 text-xs font-bold text-cyan-700 transition-colors hover:bg-cyan-100 sm:px-3 sm:text-sm"
              title="宝可梦队伍与图鉴"
            >
              <Users className="h-4 w-4" />
              队伍
            </button>
            <button
              onClick={onShowLeaderboard}
              className="hidden whitespace-nowrap rounded-lg bg-yellow-50 px-2 py-1.5 text-xs font-bold text-yellow-600 transition-colors hover:bg-yellow-100 sm:block sm:px-3 sm:text-sm"
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
                <PetArtwork
                  image={petImage}
                  stage={currentStage}
                  alt={pet.name}
                  containerClassName="h-28 w-28 md:h-36 md:w-36"
                  imageClassName="h-full w-full"
                  eager
                />
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
                  {pet.evolution_stage + 1}/5
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1 sm:gap-3">
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
                        <PetArtwork
                          image={form.image}
                          stage={form}
                          alt={form.name}
                          containerClassName="h-full w-full"
                          imageClassName="h-full w-full"
                        />
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
                    <PetArtwork
                      image={evolutionReveal.from.image}
                      stage={evolutionReveal.from}
                      alt={evolutionReveal.from.name}
                      containerClassName="h-full w-full"
                      imageClassName="h-full w-full"
                    />
                  </div>
                  <div className="mt-2 truncate text-xs text-gray-500">{evolutionReveal.from.name}</div>
                </div>
                <ChevronRight className="h-7 w-7 shrink-0 text-orange-400" />
                <motion.div className="w-28 min-w-0 sm:w-32" animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
                  <div className="flex aspect-square items-center justify-center rounded-xl bg-orange-50 p-3 ring-2 ring-orange-300">
                    <PetArtwork
                      image={evolutionReveal.to.image}
                      stage={evolutionReveal.to}
                      alt={evolutionReveal.to.name}
                      containerClassName="h-full w-full"
                      imageClassName="h-full w-full"
                    />
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
  const [view, setView] = useState<'nurture' | 'catalog' | 'leaderboard'>('nurture');
  const { data: pet, isLoading, isError } = useQuery<Pet>({
    queryKey: ['myPet'],
    queryFn: getMyPet,
    retry: false,
  });
  const { data: collection, isLoading: isCollectionLoading } = useQuery<PetCollection>({
    queryKey: ['petCollection'],
    queryFn: getPetCollection,
    retry: false,
  });

  const queryClient = useQueryClient();

  if (isLoading || isCollectionLoading) {
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

  if (!pet && collection && collection.recovery_words_remaining > 0) {
    return <PetRecoveryView collection={collection} />;
  }

  if (isError || !pet) {
    return <AdoptView onAdopted={() => {
      queryClient.invalidateQueries({ queryKey: ['myPet'] });
      queryClient.invalidateQueries({ queryKey: ['petCollection'] });
    }} />;
  }

  if (view === 'leaderboard') {
    return <LeaderboardView onBack={() => setView('nurture')} />;
  }

  if (view === 'catalog' && collection) {
    return <CatalogView pet={pet} collection={collection} onBack={() => setView('nurture')} onSwitched={() => setView('nurture')} />;
  }

  return (
    <NurtureView
      pet={pet}
      onShowLeaderboard={() => setView('leaderboard')}
      onShowCatalog={() => setView('catalog')}
    />
  );
}
