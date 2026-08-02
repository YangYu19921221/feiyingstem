import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { getMyPet, type Pet } from '../api/pet';
import { getPetImage, getPetStage } from '../config/petSpecies';
import PetArtwork from './PetArtwork';

const PET_SAYINGS: Record<string, string[]> = {
  pikachu:    ['皮卡~ 准备好就出发！', '皮卡皮卡...正在充电', '皮卡~ 今天也慢慢来！', '电击！学习充电中！'],
  eevee:      ['布咿~ 一起学习！', '布咿布咿...正在休息', '今天也按自己的节奏来~', '想进化呢~'],
  bulbasaur:  ['种子~ 学习时间到！', '种子种子...晒太阳中', '一起加油吧~', '藤鞭！学习出击！'],
  charmander: ['小火~ 来修炼吧！', '火焰在燃烧...', '今天要变更强！', '喷火！学习之火！'],
  squirtle:   ['杰尼~ 一起学习！', '水枪准备中...', '今天也要加油！', '水之力量！'],
  jigglypuff: ['胖丁~ 来唱歌学习！', '要唱歌给你听~', '今天也要开心哦！', '唱歌中...zzz'],
  cat:    ['喵~ 准备好就学习吧！', '呼噜呼噜...正在晒太阳', '喵呜~ 今天也慢慢来！', '喵~状态不错'],
  dog:    ['汪汪！一起学习！', '尾巴摇摇~ 状态不错', '汪！今天也按节奏来！', '来玩来玩！'],
  rabbit: ['蹦蹦~ 学习时间到！', '嘿嘿，想吃胡萝卜', '一起加油吧~', '蹦蹦跳跳好开心！'],
  dragon: ['吼~ 来修炼吧！', '火焰在燃烧...', '今天要变更强！', '龙之力量觉醒中...'],
  book_fox:    ['小狐准备好书本了~', '翻翻翻…看到新知识啦', '今天学什么呢？', '知识就是力量！'],
  paper_owl:   ['咕咕~学习时间到', '羽毛笔已备好', '博学越多越好', '一起做个小博士吧'],
  word_turtle: ['慢慢来，一步一个字', '壳上又多了一道纹', '稳扎稳打~', '厚积薄发！'],
};

function getMoodColor(happiness: number, hunger: number): string {
  const avg = (happiness + hunger) / 2;
  if (avg < 30) return 'bg-orange-100 text-orange-800';
  if (avg < 70) return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-100 text-emerald-800';
}

function getMoodText(happiness: number, hunger: number): string {
  const avg = (happiness + hunger) / 2;
  if (avg < 30) return '⚡ 正在充电';
  if (avg < 70) return '😊 状态不错';
  return '🤩 超级开心';
}

function ProgressRing({ value, max, size, color }: { value: number; max: number; size: number; color: string }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const r = (size - 4) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={3} />
      <motion.circle
        cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
        strokeLinecap="round"
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        strokeDasharray={circumference}
      />
    </svg>
  );
}

export default function PetWidget() {
  const navigate = useNavigate();
  const [showBubble, setShowBubble] = useState(false);
  const [saying, setSaying] = useState('');
  const [, setTapCount] = useState(0);
  const [showHeart, setShowHeart] = useState(false);

  const { data: pet, isLoading } = useQuery<Pet | null>({
    queryKey: ['myPet'],
    queryFn: getMyPet,
    retry: false,
  });

  const handlePetTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    setTapCount(prev => prev + 1);
    setShowHeart(true);
    setTimeout(() => setShowHeart(false), 600);

    const sayings = PET_SAYINGS[pet?.species || 'pikachu'] || PET_SAYINGS.pikachu;
    setSaying(sayings[Math.floor(Math.random() * sayings.length)]);
    setShowBubble(true);
    setTimeout(() => setShowBubble(false), 2500);
  };

  if (!isLoading && !pet) {
    return (
      <motion.button
        type="button"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => navigate('/student/pet')}
        className="card-soft group relative w-full cursor-pointer overflow-hidden rounded-2xl border-dashed p-5 text-left hover:border-orange-300"
      >
        <div className="flex items-center gap-4">
          <motion.div
            className="w-16 h-16 rounded-full bg-white shadow-inner flex items-center justify-center"
            animate={{ y: [0, -5, 0], rotate: [0, 5, -5, 0] }}
            transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
          >
            <span className="text-3xl">🥚</span>
          </motion.div>
          <div>
            <p className="font-bold text-orange-600 group-hover:text-orange-700">领养一只宠物吧！</p>
            <p className="mt-1 text-xs text-orange-600">完成学习任务，宠物也会一起成长 ✨</p>
          </div>
        </div>
        <div className="absolute -bottom-2 -right-2 text-6xl opacity-10 group-hover:opacity-20 transition-opacity">
          🐾
        </div>
      </motion.button>
    );
  }

  if (isLoading) {
    return (
      <div className="card-soft h-32 animate-pulse rounded-2xl p-5" role="status" aria-label="正在加载宠物信息" />
    );
  }

  const petImage = getPetImage(pet!.species, pet!.evolution_stage);
  const petStage = getPetStage(pet!.species, pet!.evolution_stage);
  const moodColor = getMoodColor(pet!.happiness, pet!.hunger);
  const moodText = getMoodText(pet!.happiness, pet!.hunger);
  const xpPct = Math.round((pet!.experience / pet!.xp_to_next_level) * 100);

  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.01 }}
      className="card-soft relative w-full cursor-pointer overflow-hidden rounded-2xl text-left"
      onClick={() => navigate('/student/pet')}
      aria-label={`查看宠物 ${pet!.name} 的状态`}
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* 宠物头像区 */}
          <div className="relative" onClick={handlePetTap}>
            <motion.div
              className="w-20 h-20 rounded-2xl bg-white shadow-md flex items-center justify-center border-2 border-orange-100 relative"
              animate={{ y: [0, -3, 0] }}
              transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
              whileTap={{ scale: 0.9 }}
            >
              <PetArtwork
                image={petImage}
                stage={petStage}
                alt={pet!.name}
                containerClassName="h-14 w-14"
                imageClassName="h-full w-full"
                eager
              />
              <AnimatePresence>
                {showHeart && (
                  <motion.span
                    className="absolute -top-3 -right-2 text-lg"
                    initial={{ opacity: 1, y: 0, scale: 0.5 }}
                    animate={{ opacity: 0, y: -20, scale: 1.3 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6 }}
                  >
                    ❤️
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
            {/* 等级徽章 */}
            <div className="absolute -bottom-1 -right-1 rounded-full bg-accent-warm px-2 py-0.5 text-xs font-bold text-white shadow">
              Lv.{pet!.level}
            </div>
          </div>

          {/* 信息区 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-gray-800 truncate text-lg">{pet!.name}</span>
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                {getPetStage(pet!.species, pet!.evolution_stage).name}
              </span>
            </div>

            {/* 心情指示 */}
            <div className="flex items-center gap-2 mb-2">
              <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${moodColor}`}>
                {moodText}
              </div>
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold text-orange-600 bg-orange-50">
                🦴 {pet!.food_balance}
              </div>
            </div>

            {/* 属性条 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center">
                <div className="relative">
                  <ProgressRing value={pet!.happiness} max={100} size={36} color="#facc15" />
                  <span className="absolute inset-0 flex items-center justify-center text-xs">😊</span>
                </div>
                <span className="text-xs text-gray-400 mt-0.5">{pet!.happiness}</span>
              </div>
              <div className="flex flex-col items-center">
                <div className="relative">
                  <ProgressRing value={pet!.hunger} max={100} size={36} color="#4ade80" />
                  <span className="absolute inset-0 flex items-center justify-center text-xs">🍖</span>
                </div>
                <span className="text-xs text-gray-400 mt-0.5">{pet!.hunger}</span>
              </div>
              <div className="flex flex-col items-center">
                <div className="relative">
                  <ProgressRing value={pet!.experience} max={pet!.xp_to_next_level} size={36} color="#60a5fa" />
                  <span className="absolute inset-0 flex items-center justify-center text-xs">⭐</span>
                </div>
                <span className="text-xs text-gray-400 mt-0.5">{xpPct}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* 对话气泡 */}
        <AnimatePresence>
          {showBubble && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.9 }}
              role="status"
              aria-live="polite"
              className="mt-3 bg-white rounded-xl px-4 py-2 text-sm text-gray-600 shadow-inner border border-orange-100 text-center"
            >
              💬 {saying}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 底部装饰 */}
      <div className="absolute -bottom-3 -right-3 text-7xl opacity-5 pointer-events-none">🐾</div>
    </motion.button>
  );
}
