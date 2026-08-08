import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import {
  getHealingStatus,
  getHealingWords,
  healPet,
  type HealingStatus,
  type HealingWord,
} from '../api/petHealing';
import { getMyPet } from '../api/pet';
import { getPetImage, getPetStage } from '../config/petSpecies';
import PetArtwork from '../components/PetArtwork';
import useGoBack from '../hooks/useGoBack';

export default function PetHealingPage() {
  const navigate = useNavigate();
  const goBack = useGoBack('/student/pet');
  const queryClient = useQueryClient();

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [healedTotal, setHealedTotal] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // 查询治疗状态
  const healingStatusQuery = useQuery<HealingStatus>({
    queryKey: ['healingStatus'],
    queryFn: getHealingStatus,
  });
  const healingStatus = healingStatusQuery.data;

  // 查询宠物信息
  const petQuery = useQuery({
    queryKey: ['myPet'],
    queryFn: getMyPet,
  });
  const pet = petQuery.data;

  // 获取治疗单词
  const wordsQuery = useQuery<HealingWord[]>({
    queryKey: ['healingWords'],
    queryFn: () => getHealingWords(20),
    // 健康状态下后端会返回 400「宠物不需要治疗」；不要把这个正常状态当成网络错误。
    enabled: healingStatus?.is_injured === true,
  });
  const words = wordsQuery.data ?? [];

  const currentWord = words[currentQuestionIndex];
  const options = useMemo(() => {
    if (!currentWord) return [];
    const meanings = Array.from(new Set(words.map((word) => word.meaning).filter((meaning) => meaning !== currentWord.meaning)));
    const distractors = [...meanings].sort(() => Math.random() - 0.5).slice(0, 3);
    return [currentWord.meaning, ...distractors].sort(() => Math.random() - 0.5);
  }, [currentWord, words]);
  const correctIndex = currentWord ? options.indexOf(currentWord.meaning) : -1;

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
        return;
      }

      setTimeout(() => {
        if (currentQuestionIndex < words.length - 1) {
          setCurrentQuestionIndex((prev) => prev + 1);
          setSelectedAnswer(null);
          setShowResult(false);
          healMutation.reset();
        }
      }, 1600);
    },
  });

  const pageLoading = healingStatusQuery.isLoading || petQuery.isLoading || wordsQuery.isLoading;
  const pageError = healingStatusQuery.isError || petQuery.isError
    || (healingStatus?.is_injured === true && wordsQuery.isError);

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-5">
        <div className="text-center" role="status">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-accent-warm" />
          <div className="text-gray-600">正在准备恢复训练...</div>
        </div>
      </div>
    );
  }

  if (pageError || !healingStatus || !pet) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-5">
        <div className="card-soft w-full max-w-md rounded-2xl p-7 text-center" role="alert">
          <div className="text-4xl">🛠️</div>
          <h1 className="mt-3 text-xl font-bold text-ink">恢复训练暂时没准备好</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">请检查网络后再试一次，也可以先返回宠物页面。</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void Promise.all([healingStatusQuery.refetch(), petQuery.refetch(), wordsQuery.refetch()])}
              className="btn-glow min-h-11 rounded-xl px-5 text-sm font-semibold text-white"
            >
              再试一次
            </button>
            <button type="button" onClick={() => navigate('/student/pet')} className="min-h-11 rounded-xl bg-black/[0.05] px-5 text-sm font-semibold text-ink-soft">
              返回宠物页面
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!healingStatus.is_injured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-5">
        <div className="card-soft w-full max-w-md rounded-3xl p-7 text-center sm:p-9">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-4xl">✅</div>
          <h1 className="mt-5 text-2xl font-bold text-ink">伙伴状态很好</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">今天不需要恢复训练，继续完成学习任务就好。</p>
          <button
            type="button"
            onClick={() => navigate('/student/pet')}
            className="btn-glow mt-6 min-h-11 rounded-xl px-6 font-bold text-white"
          >
            返回宠物页面
          </button>
        </div>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-5">
        <div className="card-soft w-full max-w-md rounded-2xl p-7 text-center">
          <div className="text-5xl">📚</div>
          <h1 className="mt-3 text-xl font-bold text-ink">暂时没有恢复题目</h1>
          <p className="mt-2 text-sm text-ink-soft">稍后再来试试，宠物状态不会因此变差。</p>
          <button type="button" onClick={() => navigate('/student/pet')} className="btn-glow mt-5 min-h-11 rounded-xl px-6 font-bold text-white">
            返回宠物页面
          </button>
        </div>
      </div>
    );
  }

  if (!currentWord) {
    return null;
  }

  const handleAnswer = (answer: string, index: number) => {
    if (showResult) return;

    setSelectedAnswer(answer);
    const correct = index === correctIndex;
    setIsCorrect(correct);
    setShowResult(true);
    setAnsweredCount((prev) => prev + 1);

    // 提交治疗
    healMutation.mutate({ wordId: currentWord.id, isCorrect: correct });

  };

  const petImage = getPetImage(pet.species, pet.evolution_stage);
  const petStage = getPetStage(pet.species, pet.evolution_stage);
  const grayScale = Math.max(0, 1 - healingStatus.hp_percent / 80);

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部导航 */}
      <nav className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={goBack}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-gray-100"
            aria-label="返回宠物页面"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-orange-700">
            ❤️‍🩹 恢复训练
          </h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* HP进度 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-gray-600">恢复进度</span>
            <span className="text-sm font-bold text-green-600">已恢复 {healedTotal} HP</span>
          </div>

          {/* HP/进度一律直接用后端值:每次答题后 invalidateQueries 会重新拉到
              **已经包含本次回血**的 current_hp/hp_percent/questions_needed。
              再叠加 healedTotal 就翻倍了(实测 max_hp=100、每题+10、初始30:
              答对1题真实40却显示50,答对3题真实60显示90)。
              上限截断和 80% 解除受伤都在后端算好,前端别自己推。 */}
          <div className="relative h-6 bg-gray-200 rounded-full overflow-hidden mb-2">
            <motion.div
              className="absolute inset-y-0 left-0 bg-emerald-500"
              initial={{ width: `${healingStatus.hp_percent}%` }}
              animate={{ width: `${Math.min(100, healingStatus.hp_percent)}%` }}
              transition={{ duration: 0.5 }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow">
              {healingStatus.current_hp} / {healingStatus.max_hp}
            </div>
          </div>

          <div className="text-center text-sm text-gray-600">
            还需答对约 {Math.max(0, healingStatus.questions_needed)} 题恢复健康
          </div>
        </div>

        {/* 宠物图片 */}
        <div className="text-center mb-6">
          <motion.div
            className="mx-auto h-40 w-40"
            style={{
              filter: `grayscale(${grayScale}) brightness(${0.6 + grayScale * 0.4})`,
            }}
            animate={{ y: [0, -5, 0] }}
            transition={{ repeat: Infinity, duration: 2 }}
          >
            <PetArtwork
              image={petImage}
              stage={petStage}
              alt={pet.name}
              containerClassName="h-full w-full"
              imageClassName="h-full w-full"
              eager
            />
          </motion.div>
          <div className="text-gray-600 mt-2">
            {pet.name} {grayScale > 0.5 ? '正在休息...' : '状态越来越好了'}
          </div>
        </div>

        {/* 题目卡片 */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
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
                  disabled={showResult || healMutation.isPending}
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
                  healMutation.isError ? 'bg-orange-50 text-orange-800' : isCorrect ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                }`}
              >
                {healMutation.isError ? (
                  <>
                    <div className="font-bold">这次记录还没保存</div>
                    <p className="mt-1 text-sm">检查网络后重试，当前题目不会跳过。</p>
                    <button
                      type="button"
                      onClick={() => healMutation.mutate({ wordId: currentWord.id, isCorrect })}
                      className="mt-3 min-h-11 rounded-xl bg-orange-600 px-5 text-sm font-semibold text-white"
                    >
                      重新保存
                    </button>
                  </>
                ) : isCorrect ? (
                  <>
                    <div className="text-3xl mb-2">✨</div>
                    <div className="font-bold">答对了！宠物恢复了 {healingStatus.heal_per_question} HP</div>
                  </>
                ) : (
                  <>
                    <div className="text-3xl mb-2">💡</div>
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
          {healedTotal === 0 && '每答对一题都会增加恢复进度，按自己的节奏来。'}
          {healedTotal > 0 && healedTotal < 25 && '已经有进展了，继续保持自己的节奏。'}
          {healedTotal >= 25 && healedTotal < 50 && '做得很好，恢复进度正在增加。'}
          {healedTotal >= 50 && '太棒了，马上就能完成恢复训练。'}
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
              <h3 className="text-3xl font-bold text-green-600 mb-2">恢复完成！</h3>
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
