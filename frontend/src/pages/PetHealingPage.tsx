import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Heart, Sparkles } from 'lucide-react';
import {
  getHealingStatus,
  getHealingWords,
  healPet,
  type HealingStatus,
  type HealingWord,
} from '../api/petHealing';
import { getMyPet } from '../api/pet';

// 宠物图片映射
const PET_IMAGES: Record<string, string[]> = {
  pikachu: ['/pets/pichu.png', '/pets/pichu.png', '/pets/pikachu.png', '/pets/raichu.png'],
  eevee: ['/pets/eevee.png', '/pets/eevee.png', '/pets/eevee.png', '/pets/eevee.png'],
  bulbasaur: ['/pets/bulbasaur.png', '/pets/bulbasaur.png', '/pets/ivysaur.png', '/pets/venusaur.png'],
  charmander: ['/pets/charmander.png', '/pets/charmander.png', '/pets/charmeleon.png', '/pets/charizard.png'],
  squirtle: ['/pets/squirtle.png', '/pets/squirtle.png', '/pets/wartortle.png', '/pets/blastoise.png'],
};

function getPetImage(species: string, stage: number): string {
  const images = PET_IMAGES[species] || PET_IMAGES.pikachu;
  return images[Math.min(stage, images.length - 1)];
}

export default function PetHealingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [healedTotal, setHealedTotal] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // 查询治疗状态
  const { data: healingStatus } = useQuery<HealingStatus>({
    queryKey: ['healingStatus'],
    queryFn: getHealingStatus,
  });

  // 查询宠物信息
  const { data: pet } = useQuery({
    queryKey: ['myPet'],
    queryFn: getMyPet,
  });

  // 获取治疗单词
  const { data: words = [] } = useQuery<HealingWord[]>({
    queryKey: ['healingWords'],
    queryFn: () => getHealingWords(20),
  });

  // 治疗mutation
  const healMutation = useMutation({
    mutationFn: ({ wordId, isCorrect }: { wordId: number; isCorrect: boolean }) =>
      healPet(wordId, isCorrect),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['healingStatus'] });
      queryClient.invalidateQueries({ queryKey: ['myPet'] });

      if (data.healed > 0) {
        setHealedTotal((prev) => prev + data.healed);
      }

      // 检查是否恢复健康
      if (data.is_healthy) {
        setShowSuccessModal(true);
        setTimeout(() => {
          navigate('/student/pet');
        }, 3000);
      }
    },
  });

  if (!healingStatus || !pet || !words.length) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-emerald-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4 animate-pulse">💊</div>
          <div className="text-gray-600">加载中...</div>
        </div>
      </div>
    );
  }

  if (!healingStatus.is_injured) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-emerald-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-8xl mb-4">✅</div>
          <div className="text-2xl font-bold text-gray-800 mb-2">宠物很健康！</div>
          <div className="text-gray-600 mb-6">不需要治疗</div>
          <button
            onClick={() => navigate('/student/pet')}
            className="px-6 py-3 bg-gradient-to-r from-orange-400 to-yellow-400 text-white rounded-xl font-bold"
          >
            返回宠物页面
          </button>
        </div>
      </div>
    );
  }

  const currentWord = words[currentQuestionIndex];
  if (!currentWord) {
    return null;
  }

  // 生成干扰项
  const generateOptions = (correctMeaning: string) => {
    const allMeanings = words.map((w) => w.meaning).filter((m) => m !== correctMeaning);
    const shuffled = allMeanings.sort(() => Math.random() - 0.5);
    const distractors = shuffled.slice(0, 3);
    const options = [correctMeaning, ...distractors].sort(() => Math.random() - 0.5);
    return options;
  };

  const options = generateOptions(currentWord.meaning);
  const correctIndex = options.indexOf(currentWord.meaning);

  const handleAnswer = (answer: string, index: number) => {
    if (showResult) return;

    setSelectedAnswer(answer);
    const correct = index === correctIndex;
    setIsCorrect(correct);
    setShowResult(true);
    setAnsweredCount((prev) => prev + 1);

    // 提交治疗
    healMutation.mutate({ wordId: currentWord.id, isCorrect: correct });

    // 2秒后下一题
    setTimeout(() => {
      if (currentQuestionIndex < words.length - 1) {
        setCurrentQuestionIndex((prev) => prev + 1);
        setSelectedAnswer(null);
        setShowResult(false);
      }
    }, 2000);
  };

  const petImage = getPetImage(pet.species, pet.evolution_stage);
  const grayScale = Math.max(0, 1 - healingStatus.hp_percent / 80);

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-emerald-50">
      {/* 顶部导航 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-500 to-emerald-500">
            💊 治疗宠物
          </h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* HP进度 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">💊 治疗中...</span>
            <span className="text-sm font-bold text-green-600">已恢复 {healedTotal} HP</span>
          </div>

          <div className="relative h-6 bg-gray-200 rounded-full overflow-hidden mb-2">
            <motion.div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-green-400 to-emerald-500"
              initial={{ width: `${healingStatus.hp_percent}%` }}
              animate={{ width: `${Math.min(100, healingStatus.hp_percent + (healedTotal / healingStatus.max_hp) * 100)}%` }}
              transition={{ duration: 0.5 }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow">
              {healingStatus.current_hp + healedTotal} / {healingStatus.max_hp}
            </div>
          </div>

          <div className="text-center text-sm text-gray-600">
            还需答对约 {Math.max(0, healingStatus.questions_needed - Math.floor(healedTotal / 5))} 题恢复健康
          </div>
        </div>

        {/* 宠物图片 */}
        <div className="text-center mb-6">
          <motion.img
            src={petImage}
            alt={pet.name}
            className="w-40 h-40 mx-auto"
            style={{
              filter: `grayscale(${grayScale}) brightness(${0.6 + grayScale * 0.4})`,
            }}
            animate={{ y: [0, -5, 0] }}
            transition={{ repeat: Infinity, duration: 2 }}
          />
          <div className="text-gray-600 mt-2">
            {pet.name} {grayScale > 0.5 ? '很虚弱...' : '正在恢复中...'}
          </div>
        </div>

        {/* 题目卡片 */}
        <div className="bg-white rounded-3xl p-6 shadow-lg">
          <div className="text-center mb-6">
            <div className="text-sm text-gray-500 mb-2">
              第 {answeredCount + 1} 题
            </div>
            <div className="text-4xl font-bold text-gray-800 mb-2">{currentWord.word}</div>
            {currentWord.phonetic && (
              <div className="text-sm text-gray-500">{currentWord.phonetic}</div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3">
            {options.map((option, index) => {
              const isSelected = selectedAnswer === option;
              const isCorrectOption = index === correctIndex;
              const showCorrect = showResult && isCorrectOption;
              const showWrong = showResult && isSelected && !isCorrectOption;

              return (
                <motion.button
                  key={index}
                  whileHover={{ scale: showResult ? 1 : 1.02 }}
                  whileTap={{ scale: showResult ? 1 : 0.98 }}
                  disabled={showResult}
                  onClick={() => handleAnswer(option, index)}
                  className={`p-4 rounded-xl text-left font-medium transition-all ${
                    showCorrect
                      ? 'bg-green-500 text-white ring-4 ring-green-300'
                      : showWrong
                      ? 'bg-red-500 text-white ring-4 ring-red-300'
                      : isSelected
                      ? 'bg-blue-100 text-blue-700 border-2 border-blue-400'
                      : 'bg-gray-50 hover:bg-gray-100 border-2 border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{option}</span>
                    {showCorrect && <span className="text-2xl">✓</span>}
                    {showWrong && <span className="text-2xl">✗</span>}
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* 结果提示 */}
          <AnimatePresence>
            {showResult && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`mt-4 p-4 rounded-xl text-center ${
                  isCorrect ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}
              >
                {isCorrect ? (
                  <>
                    <div className="text-3xl mb-2">✨</div>
                    <div className="font-bold">答对了！宠物恢复了 5 HP</div>
                  </>
                ) : (
                  <>
                    <div className="text-3xl mb-2">💔</div>
                    <div className="font-bold">答错了，继续加油！</div>
                    <div className="text-sm mt-1">正确答案：{currentWord.meaning}</div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 鼓励文案 */}
        <div className="text-center mt-6 text-gray-600 text-sm">
          {healedTotal === 0 && '你的宠物需要你！答对题目可以治疗它'}
          {healedTotal > 0 && healedTotal < 25 && '继续加油，宠物感受到了你的关心！'}
          {healedTotal >= 25 && healedTotal < 50 && '做得很好，宠物快要好了！'}
          {healedTotal >= 50 && '太棒了，宠物马上就要恢复健康了！'}
        </div>
      </div>

      {/* 成功模态框 */}
      <AnimatePresence>
        {showSuccessModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full text-center"
            >
              <motion.div
                animate={{ rotate: [0, 360] }}
                transition={{ duration: 1, ease: 'easeInOut' }}
                className="text-8xl mb-4"
              >
                ✨
              </motion.div>
              <h3 className="text-3xl font-bold text-green-600 mb-2">满血复活！</h3>
              <p className="text-gray-600 mb-4">
                你的 {pet.name} 恢复健康了！<br />
                现在可以继续对战了！
              </p>
              <div className="text-sm text-gray-500">正在返回宠物页面...</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
