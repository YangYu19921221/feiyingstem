/**
 * 悬浮宠物组件 - 固定右下角，全学生端常驻
 * 响应学习事件、宠物状态、空闲检测
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { getMyPet, type Pet } from '../api/pet';
import { onPetEvent, type PetEventType } from '../utils/petEventBus';

const PET_IMAGES: Record<string, string> = {
  pikachu: '/pets/pikachu.png', eevee: '/pets/eevee.png',
  bulbasaur: '/pets/bulbasaur.png', charmander: '/pets/charmander.png',
  squirtle: '/pets/squirtle.png', jigglypuff: '/pets/jigglypuff.png',
  pikachu_adult: '/pets/pikachu_adult.png',
};

const PET_EMOJIS: Record<string, string[]> = {
  pikachu: ['🥚', '⚡', '⚡', '⚡', '✨⚡✨'],
  eevee: ['🥚', '🦊', '🦊', '🦊', '✨🦊✨'],
  bulbasaur: ['🥚', '🌱', '🌿', '🌳', '✨🌳✨'],
  charmander: ['🥚', '🔥', '🔥', '🔥', '✨🔥✨'],
  squirtle: ['🥚', '💧', '💧', '💧', '✨💧✨'],
  jigglypuff: ['🥚', '🎀', '🎀', '🎀', '✨🎀✨'],
  cat: ['🥚', '🐱', '😺', '😸', '✨🐱✨'],
  dog: ['🥚', '🐶', '🐕', '🦮', '✨🐶✨'],
};

const MESSAGES: Record<PetEventType | 'idle' | 'hungry' | 'unhappy', string[]> = {
  correct:  ['答对了！🎉', '太棒了！⚡', '厉害！继续冲！', '我为你骄傲！✨', '对了对了！加油！'],
  wrong:    ['没关系，再试试！', '错了也没事~', '下次一定行！💪', '继续加油哦~'],
  combo:    ['连击！🔥🔥', '你太厉害了！', '势如破竹！⚡', '停不下来了！'],
  complete: ['完成啦！你最棒！🎊', '今天学了好多！✨', '我也跟着成长了！', '收工！辛苦了！🌟'],
  start:    ['开始学习啦！我陪着你~', '冲冲冲！🔥', '今天也要加油哦！'],
  idle:     ['还在吗？想你了~', '来学习吧！', '陪我玩一会儿嘛', '出来出来~👋', '你去哪了？'],
  hungry:   ['咕噜噜...我饿了...', '快来喂我！>_<', '好饿...能给点吃的吗？'],
  unhappy:  ['多陪陪我嘛~', '我有点难过...', '和我互动一下嘛！'],
};

function pick(arr: string[]) { return arr[Math.floor(Math.random() * arr.length)]; }

type MoodState = 'happy' | 'excited' | 'sad' | 'idle' | 'normal';

export default function FloatingPetWidget() {
  const navigate = useNavigate();
  const location = useLocation();
  // 所有 Hook 必须在条件判断前声明
  const [bubble, setBubble] = useState('');
  const [showBubble, setShowBubble] = useState(false);
  const [mood, setMood] = useState<MoodState>('normal');
  const [expanded, setExpanded] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = useRef(false);

  // 读取上次保存的位置，默认右下角
  const savedPos = (() => {
    try { return JSON.parse(localStorage.getItem('pet_pos') || 'null'); } catch { return null; }
  })();
  const [dragPos] = useState<{ x: number; y: number }>(savedPos ?? { x: 0, y: 0 });

  const { data: pet } = useQuery<Pet | null>({
    queryKey: ['myPet'],
    queryFn: getMyPet,
    retry: false,
    staleTime: 60_000,
    enabled: location.pathname.startsWith('/student'), // 只在学生端请求
  });

  const say = useCallback((msg: string, newMood: MoodState = 'happy', duration = 3000) => {
    setBubble(msg);
    setMood(newMood);
    setShowBubble(true);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => {
      setShowBubble(false);
      setMood('normal');
    }, duration);
  }, []);

  // 重置空闲计时器
  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      say(pick(MESSAGES.idle), 'idle', 4000);
    }, 30_000);
  }, [say]);

  // 监听学习事件
  useEffect(() => {
    const unsub = onPetEvent(({ type, combo }) => {
      resetIdle();
      if (type === 'correct') {
        if (combo && combo >= 5) say(pick(MESSAGES.combo) + ` ×${combo}！`, 'excited', 3500);
        else if (combo && combo >= 3) say(`连击 ×${combo}！🔥`, 'excited');
        else say(pick(MESSAGES.correct), 'happy');
      } else if (type === 'wrong') {
        say(pick(MESSAGES.wrong), 'sad');
      } else if (type === 'complete') {
        say(pick(MESSAGES.complete), 'excited', 4000);
      } else if (type === 'start') {
        say(pick(MESSAGES.start), 'happy');
      }
    });
    return unsub;
  }, [say, resetIdle]);

  // 用户操作重置空闲
  useEffect(() => {
    const events = ['mousemove', 'keydown', 'click', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetIdle, { passive: true }));
    resetIdle();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetIdle));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    };
  }, [resetIdle]);

  // 低状态提醒（每2分钟检查）
  useEffect(() => {
    if (!pet) return;
    const interval = setInterval(() => {
      if (pet.hunger < 30) say(pick(MESSAGES.hungry), 'sad', 4000);
      else if (pet.happiness < 30) say(pick(MESSAGES.unhappy), 'sad', 4000);
    }, 120_000);
    return () => clearInterval(interval);
  }, [pet, say]);

  // 所有 Hook 执行完后再做条件渲染
  if (!location.pathname.startsWith('/student')) return null;
  if (!pet) return null;

  const emoji = (PET_EMOJIS[pet.species] || PET_EMOJIS.pikachu)[Math.min(pet.evolution_stage, 4)];
  const petImg = PET_IMAGES[pet.species];
  const moodAvg = (pet.happiness + pet.hunger) / 2;

  // 宠物动画 by mood
  const petAnim = {
    happy:   { y: [0, -8, 0], transition: { duration: 0.4, repeat: 2 } },
    excited: { y: [0, -12, 0], rotate: [0, 10, -10, 0], transition: { duration: 0.3, repeat: 3 } },
    sad:     { x: [0, -4, 4, 0], transition: { duration: 0.4 } },
    idle:    {},
    normal:  {},
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      initial={dragPos}
      onDragStart={() => { isDragging.current = true; }}
      onDragEnd={(_, info) => {
        setTimeout(() => { isDragging.current = false; }, 100);
        // 保存位置（相对于初始定位的偏移）
        const el = document.querySelector('[data-pet-widget]') as HTMLElement;
        if (el) {
          const rect = el.getBoundingClientRect();
          localStorage.setItem('pet_pos', JSON.stringify({
            x: info.offset.x + dragPos.x,
            y: info.offset.y + dragPos.y,
          }));
        }
      }}
      data-pet-widget
      id="floating-pet-anchor"
      className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none' }}
    >
      {/* 气泡 */}
      <AnimatePresence>
        {showBubble && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            className="pointer-events-none bg-white rounded-2xl rounded-br-sm px-3 py-2 shadow-lg border border-gray-100 max-w-[180px] text-sm text-gray-700 font-medium"
          >
            {bubble}
            <div className="absolute -bottom-1.5 right-3 w-3 h-3 bg-white border-r border-b border-gray-100 rotate-45" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 展开面板 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="pointer-events-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-4 w-48"
          >
            <p className="text-xs font-bold text-gray-700 mb-2">{pet.name} · Lv.{pet.level}</p>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                  <span>😋 饱食度</span><span>{pet.hunger}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full">
                  <div className="h-full bg-orange-400 rounded-full transition-all" style={{ width: `${pet.hunger}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                  <span>💖 快乐度</span><span>{pet.happiness}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full">
                  <div className="h-full bg-pink-400 rounded-full transition-all" style={{ width: `${pet.happiness}%` }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                  <span>⭐ 经验</span><span>{Math.round(pet.experience / pet.xp_to_next_level * 100)}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full">
                  <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${Math.round(pet.experience / pet.xp_to_next_level * 100)}%` }} />
                </div>
              </div>
            </div>
            <button
              onClick={() => navigate('/student/pet')}
              className="mt-3 w-full text-xs text-center py-1.5 bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition"
            >
              查看宠物 →
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 宠物主体 */}
      <motion.button
        className="pointer-events-auto relative w-16 h-16 flex items-center justify-center"
        onClick={() => {
          if (isDragging.current) return; // 拖拽结束不触发点击
          setExpanded(e => !e);
          if (!showBubble) say(pick(MESSAGES.idle.slice(0, 2)), 'happy', 2000);
        }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        title={`${pet.name}（点击查看状态）`}
      >
        {/* 状态圆点 */}
        <span
          className={`absolute top-0 right-0 w-3 h-3 rounded-full border-2 border-white z-10 ${
            moodAvg < 30 ? 'bg-red-400' : moodAvg < 70 ? 'bg-yellow-400' : 'bg-green-400'
          }`}
        />
        {/* 宠物图 */}
        <motion.div
          animate={petAnim[mood]}
          className="w-full h-full drop-shadow-md"
        >
          {petImg ? (
            <img src={petImg} alt={pet.name} className="w-full h-full object-contain" />
          ) : (
            <span className="text-4xl">{emoji}</span>
          )}
        </motion.div>
      </motion.button>
    </motion.div>
  );
}
