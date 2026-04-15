/**
 * 单词分类记忆学习模式 - 主页面
 * 管理5个阶段的流转：分类 → 语音校验 → 听写 → 过关检测 → 总结
 * 支持分组学习：小学每组10个，初中/高中每组20个
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { startLearning, updateProgress } from '../api/progress';
import {
  createLearningRecords,
  createStudySession,
  updateStudySession,
  type WordAnswerCreate,
  type StudySessionResponse,
} from '../api/learningRecords';
import type { StartLearningResponse, WordData } from '../api/progress';
import ClassificationPhase, { type WordCategory } from '../components/classify/ClassificationPhase';
import SpeechVerifyCard from '../components/classify/SpeechVerifyCard';
import DictationPhase, { type DictationResult } from '../components/classify/DictationPhase';
import ClassifySummary from '../components/classify/ClassifySummary';
import { edgeTtsUrl, useAudio, preloadAudio } from '../hooks/useAudio';
import useIdleDetector from '../hooks/useIdleDetector';
import GroupExamPhase from '../components/classify/GroupExamPhase';

type Phase = 'classify' | 'speechVerify' | 'dictation' | 'exam' | 'summary';

function getGroupSize(gradeLevel: string | null, customGroupSize?: number): number {
  if (customGroupSize && customGroupSize > 0) return customGroupSize;
  return gradeLevel?.includes('小学') ? 10 : 20;
}

/** 根据年级将单词数组分组 */
function splitIntoGroups(words: WordData[], gradeLevel: string | null, customGroupSize?: number): WordData[][] {
  const groupSize = getGroupSize(gradeLevel, customGroupSize);
  const groups: WordData[][] = [];
  for (let i = 0; i < words.length; i += groupSize) {
    groups.push(words.slice(i, i + groupSize));
  }
  return groups;
}

/** 每组的学习结果 */
interface GroupResult {
  classifyResults: Map<number, WordCategory>;
  dictationResults: DictationResult[];
  words: WordData[];
}

const WordClassifyLearning = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();

  const [learningData, setLearningData] = useState<StartLearningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const isReviewRef = useRef(false);

  const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
  const [allGroupResults, setAllGroupResults] = useState<GroupResult[]>([]);

  const [phase, setPhase] = useState<Phase>('classify');
  const [classifyResults, setClassifyResults] = useState<Map<number, WordCategory>>(new Map());
  const [dictationResults, setDictationResults] = useState<DictationResult[]>([]);

  const [speechVerifyIndex, setSpeechVerifyIndex] = useState(0);
  const [speechRoundWords, setSpeechRoundWords] = useState<WordData[]>([]);
  const [speechSkippedWords, setSpeechSkippedWords] = useState<WordData[]>([]);
  const [speechRound, setSpeechRound] = useState(1);
  const [showSpeechRoundSummary, setShowSpeechRoundSummary] = useState(false);
  const [examAttempt, setExamAttempt] = useState(0);
  const [speechRoundDone, setSpeechRoundDone] = useState(false);

  const [studySession, setStudySession] = useState<StudySessionResponse | null>(null);
  const [startTime, setStartTime] = useState(Date.now());
  // 空闲检测：无操作60秒 或 标签页隐藏 → 暂停计时
  const isIdle = useIdleDetector();
  const idleStartRef = useRef(0);
  useEffect(() => {
    if (isIdle) {
      idleStartRef.current = Date.now();
    } else if (idleStartRef.current > 0) {
      const idleTime = Date.now() - idleStartRef.current;
      setStartTime(prev => prev + idleTime);
      idleStartRef.current = 0;
    }
  }, [isIdle]);

  const [showExitDialog, setShowExitDialog] = useState(false);

  // 组内进度存档 key
  const progressKey = unitId ? `classify_progress_${unitId}` : '';

  // 保存组内进度到 localStorage（仅数据加载后生效）
  const saveLocalProgress = useCallback(() => {
    if (!progressKey || phase === 'summary' || !learningData) return;
    localStorage.setItem(progressKey, JSON.stringify({
      groupIndex: currentGroupIndex,
      phase,
      timestamp: Date.now(),
    }));
  }, [progressKey, currentGroupIndex, phase, learningData]);

  // phase 变化时自动保存
  useEffect(() => {
    saveLocalProgress();
  }, [phase, currentGroupIndex, saveLocalProgress]);

  // 清除存档（一组完成或全部完成时）
  const clearLocalProgress = useCallback(() => {
    if (progressKey) localStorage.removeItem(progressKey);
  }, [progressKey]);

  // 从 learningData 派生分组（不存储在 state 中）
  const groups = useMemo(
    () => learningData ? splitIntoGroups(learningData.words, learningData.unit_info.grade_level, learningData.unit_info.group_size) : [],
    [learningData]
  );
  const currentGroupWords = groups[currentGroupIndex] || [];
  const totalGroups = groups.length;
  const isLastGroup = currentGroupIndex >= totalGroups - 1;
  const initRef = useRef(false);

  useEffect(() => {
    if (unitId && !initRef.current) {
      initRef.current = true;
      initLearning(parseInt(unitId));
    }
  }, [unitId]);

  const initLearning = async (id: number) => {
    try {
      setLoading(true);

      const isReviewPractice = sessionStorage.getItem('is_review_practice') === 'true';
      const isMistakePractice = sessionStorage.getItem('is_mistake_practice') === 'true';
      if (isReviewPractice) isReviewRef.current = true;

      let data: StartLearningResponse;

      if ((isReviewPractice || isMistakePractice) && id === 0) {
        // 复习模式或错题模式：从 sessionStorage 读取单词
        const storageKey = isReviewPractice ? 'review_practice_words' : 'mistake_practice_words';
        const label = isReviewPractice ? '记忆曲线复习' : '错题练习';
        const wordsJson = sessionStorage.getItem(storageKey);

        sessionStorage.removeItem('is_review_practice');
        sessionStorage.removeItem('is_mistake_practice');

        if (!wordsJson) {
          setError(`${label}数据丢失，请返回重试`);
          setLoading(false);
          return;
        }

        const words = JSON.parse(wordsJson);
        data = {
          has_existing_progress: false,
          current_word_index: 0,
          completed_words: 0,
          total_words: words.length,
          progress_percentage: 0,
          message: label,
          unit_info: {
            id: 0,
            unit_number: 0,
            name: label,
            description: null,
            book_id: 0,
            grade_level: null,
            group_size: 0,
          },
          words,
        };
      } else {
        data = await startLearning({ unit_id: id, learning_mode: 'classify' });
      }

      if (!data.words || data.words.length === 0) {
        setError('该单元没有单词');
        setLoading(false);
        return;
      }

      setLearningData(data);

      // 检查 localStorage 是否有组内进度存档
      const savedKey = `classify_progress_${id}`;
      const savedJson = localStorage.getItem(savedKey);
      let resumedFromLocal = false;

      if (savedJson) {
        try {
          const saved = JSON.parse(savedJson);
          // 存档不超过24小时才恢复
          if (saved.timestamp && Date.now() - saved.timestamp < 24 * 3600 * 1000) {
            const groupSize = getGroupSize(data.unit_info.grade_level, data.unit_info.group_size);
            const totalGroups = Math.ceil(data.words.length / groupSize);
            if (saved.groupIndex < totalGroups) {
              setCurrentGroupIndex(saved.groupIndex);
              // 只恢复组位置，阶段始终从classify开始（中间阶段的数据没有持久化）
              setPhase('classify');
              resumedFromLocal = true;
            }
          }
        } catch { /* ignore */ }
      }

      if (!resumedFromLocal) {
        // 根据后端返回的进度计算起始组
        if (data.has_existing_progress && data.current_word_index > 0) {
          const groupSize = getGroupSize(data.unit_info.grade_level, data.unit_info.group_size);
          const resumeGroup = Math.floor((data.current_word_index + 1) / groupSize);
          const totalGroups = Math.ceil(data.words.length / groupSize);
          setCurrentGroupIndex(Math.min(resumeGroup, totalGroups - 1));
        } else {
          setCurrentGroupIndex(0);
        }
      }

      // 创建学习会话（复习/错题模式跳过）
      if (id !== 0) {
        try {
          const session = await createStudySession({
            unit_id: id,
            learning_mode: 'classify',
            total_words: data.words.length,
          });
          setStudySession(session);
        } catch (e) {
          console.error('创建学习会话失败:', e);
        }
      }
    } catch (e) {
      console.error('初始化学习失败:', e);
      setError('加载失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 音频播放：使用改进的 hook（预加载、缓存、重试、fallback）
  const { playAudio } = useAudio();

  const playAudioSlow = useCallback((word: string) => {
    playAudio(word, 0.75);
  }, [playAudio]);

  // 进入新一组时预加载该组所有单词的发音
  useEffect(() => {
    if (currentGroupWords.length > 0) {
      preloadAudio(currentGroupWords.map(w => w.word));
    }
  }, [currentGroupWords]);


  // 实时提交错题到后端（不等整组结束）
  const submitMistakesRealtime = useCallback((records: WordAnswerCreate[]) => {
    const wrongRecords = records.filter(r => !r.is_correct);
    if (wrongRecords.length === 0 || !unitId) return;
    // 填入实际用时
    const elapsed = Math.round((Date.now() - startTime) / wrongRecords.length);
    const withTime = wrongRecords.map(r => ({ ...r, time_spent: elapsed }));
    createLearningRecords({
      unit_id: parseInt(unitId),
      learning_mode: withTime[0].learning_mode,
      records: withTime,
    }).catch(() => {});
  }, [unitId, startTime]);

  // 阶段1完成：分类结束 → 跳过语音校验，直接进入听写
  const handleClassifyComplete = (results: Map<number, WordCategory>) => {
    setClassifyResults(results);
    setPhase('dictation');
  };

  const handleSpeechVerifyNext = () => {
    goToNextSpeechWord();
  };

  const handleSpeechSkip = () => {
    const currentWord = speechRoundWords[speechVerifyIndex];
    if (currentWord) {
      setSpeechSkippedWords(prev => [...prev, currentWord]);
    }
    goToNextSpeechWord();
  };

  const goToNextSpeechWord = () => {
    if (speechVerifyIndex + 1 < speechRoundWords.length) {
      setSpeechVerifyIndex(speechVerifyIndex + 1);
    } else {
      setSpeechRoundDone(true);
    }
  };

  useEffect(() => {
    if (!speechRoundDone || phase !== 'speechVerify') return;
    setSpeechRoundDone(false);

    // 全部通过 → 直接进入听写
    if (speechSkippedWords.length === 0) {
      setPhase('dictation');
      return;
    }

    // 有跳过的 → 显示轮次总结，让用户选择
    setShowSpeechRoundSummary(true);
  }, [speechRoundDone, phase, speechSkippedWords]);

  // 用户选择「重读」
  const handleSpeechRetry = () => {
    setSpeechRound(prev => prev + 1);
    setSpeechRoundWords([...speechSkippedWords]);
    setSpeechSkippedWords([]);
    setSpeechVerifyIndex(0);
    setShowSpeechRoundSummary(false);
  };

  // 用户选择「跳过语音，进入听写」
  const handleSkipSpeechPhase = () => {
    setShowSpeechRoundSummary(false);
    setPhase('dictation');
  };

  // 听写完成 → 过关检测
  const handleDictationComplete = (results: DictationResult[]) => {
    setDictationResults(results);
    setPhase('exam');

    // 实时记录听写错题
    const mistakes = results
      .filter(r => !r.isCorrect)
      .map(r => ({ word_id: r.wordId, is_correct: false, time_spent: 0, learning_mode: 'spelling' as string }));
    submitMistakesRealtime(mistakes);

    // 保存当前组进度
    saveGroupProgress(results);
  };

  // 过关检测通过 → 组内总结
  const handleExamPass = (correct: number, total: number) => {
    setPhase('summary');
    clearLocalProgress();
    // 复习模式完成 → 标记强制复习已完成
    if (isReviewRef.current) {
      sessionStorage.setItem('forced_review_done', 'true');
    }
  };

  // 过关检测重考
  const handleExamRetry = () => {
    setExamAttempt(a => a + 1);
    setPhase('exam');
  };

  // 过关检测重学 → 回到分类
  const handleExamRelearn = () => {
    setPhase('classify');
  };

  // 保存当前组的进度到后端
  const saveGroupProgress = async (dictResults: DictationResult[]) => {
    if (!learningData || !unitId) return;

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    const avgTime = Math.round(totalTime * 1000 / learningData.words.length);

    // 只提交正确记录（错题已在各阶段实时提交过，避免重复）
    const records: WordAnswerCreate[] = [];
    const dictMap = new Map(dictResults.map(r => [r.wordId, r]));

    for (const w of currentGroupWords) {
      const category = classifyResults.get(w.id) || 'unknown';

      const dictResult = dictMap.get(w.id);
      if (dictResult?.isCorrect) {
        records.push({ word_id: w.id, is_correct: true, time_spent: avgTime, learning_mode: 'spelling' });
      }

      if (category === 'familiar' && !dictResult) {
        records.push({ word_id: w.id, is_correct: true, time_spent: avgTime, learning_mode: 'classify' });
      }
    }

    try {
      await createLearningRecords({
        unit_id: parseInt(unitId),
        learning_mode: 'classify',
        records,
      });
    } catch (e) {
      console.error('提交学习记录失败:', e);
    }

    // 计算当前组在全局的最后一个单词索引
    let globalEndIndex = 0;
    for (let i = 0; i <= currentGroupIndex; i++) {
      globalEndIndex += groups[i].length;
    }

    // 更新进度
    try {
      await updateProgress({
        unit_id: parseInt(unitId),
        learning_mode: 'classify',
        current_word_index: globalEndIndex - 1,
        is_completed: isLastGroup,
      });
    } catch (e) {
      console.error('更新进度失败:', e);
    }

    // 最后一组时更新会话
    if (isLastGroup && studySession) {
      const allResults = buildAllResults();
      const allRecords = allResults.flatMap(gr =>
        gr.words.map(w => {
          const category = gr.classifyResults.get(w.id) || 'unknown';
          const dictResult = gr.dictationResults.find(r => r.wordId === w.id);
          return dictResult ? dictResult.isCorrect : category === 'familiar';
        })
      );
      const correctCount = allRecords.filter(Boolean).length;
      try {
        await updateStudySession(studySession.id, {
          completed_words: learningData.words.length,
          correct_count: correctCount,
          wrong_count: learningData.words.length - correctCount,
          total_time: totalTime,
        });
      } catch (e) {
        console.error('更新会话失败:', e);
      }
    }
  };

  // 进入下一组
  const handleNextGroup = () => {
    // 保存当前组结果
    setAllGroupResults(prev => [
      ...prev,
      {
        classifyResults,
        dictationResults,
        words: currentGroupWords,
      },
    ]);

    // 重置当前组的阶段状态
    setCurrentGroupIndex(prev => prev + 1);
    setPhase('classify');
    setClassifyResults(new Map());
    setDictationResults([]);
    setSpeechVerifyIndex(0);
    setSpeechRoundWords([]);
    setSpeechSkippedWords([]);
    setSpeechRound(1);
    setSpeechRoundDone(false);
    setShowSpeechRoundSummary(false);
  };

  const handleBack = () => {
    if (phase === 'summary' && isLastGroup) {
      clearLocalProgress();
      navigate(-1);
    } else {
      saveLocalProgress();
      setShowExitDialog(true);
    }
  };

  /** 汇总所有组结果（含当前组），用于最终总结页 */
  const buildAllResults = useCallback((): GroupResult[] => [
    ...allGroupResults,
    { classifyResults, dictationResults, words: currentGroupWords },
  ], [allGroupResults, classifyResults, dictationResults, currentGroupWords]);

  // 最终总结页的汇总数据
  const finalSummaryData = useMemo(() => {
    if (phase !== 'summary' || !isLastGroup) return null;
    const all = buildAllResults();
    return {
      allDictation: all.flatMap(gr => gr.dictationResults),
      totalWords: all.reduce((sum, gr) => sum + gr.words.length, 0),
    };
  }, [phase, isLastGroup, buildAllResults]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  if (error || !learningData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <span className="text-6xl mb-4 block">😞</span>
          <p className="text-gray-500">{error || '加载失败'}</p>
          <button onClick={() => navigate(-1)} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg">
            返回
          </button>
        </div>
      </div>
    );
  }

  const phaseLabels: Record<Phase, string> = {
    classify: '分类阶段',
    speechVerify: '语音校验',
    dictation: '听写阶段',
    exam: '过关检测',
    summary: '学习总结',
  };

  const currentSpeechWord = speechRoundWords[speechVerifyIndex];

  // 导航栏副标题
  const navSubtitle = totalGroups > 1
    ? `${learningData.unit_info.name} · 第${currentGroupIndex + 1}/${totalGroups}组 · ${phaseLabels[phase]}`
    : `${learningData.unit_info.name} · ${phaseLabels[phase]}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <button onClick={handleBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-800">
              🧠 分类记忆法
            </h1>
            <p className="text-xs text-gray-500">
              {navSubtitle}
            </p>
          </div>
          {/* 阶段指示器 */}
          <div className="flex gap-1">
            {(['classify', 'dictation', 'exam', 'summary'] as Phase[]).map((p, i) => (
              <div
                key={p}
                className={`w-2 h-2 rounded-full transition ${
                  p === phase ? 'bg-primary scale-125' : i < ['classify', 'dictation', 'exam', 'summary'].indexOf(phase) ? 'bg-green-400' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>
        {/* 分组进度条（多组时显示） */}
        {totalGroups > 1 && (
          <div className="h-1 bg-gray-100">
            <motion.div
              className="h-full bg-gradient-to-r from-primary to-yellow-400"
              animate={{ width: `${((currentGroupIndex + (phase === 'summary' ? 1 : 0)) / totalGroups) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        )}
      </nav>

      {/* 主内容 */}
      <div className="max-w-3xl mx-auto py-6">
        <AnimatePresence mode="wait">
          {/* 阶段1：分类 */}
          {phase === 'classify' && (
            <motion.div key={`classify-${currentGroupIndex}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ClassificationPhase
                words={currentGroupWords}
                onComplete={handleClassifyComplete}
                onRoundMistakes={(wordIds) => {
                  submitMistakesRealtime(
                    wordIds.map(id => ({ word_id: id, is_correct: false, time_spent: 0, learning_mode: 'classify' }))
                  );
                }}
                playAudio={playAudio}
              />
            </motion.div>
          )}

          {/* 阶段2：语音校验 */}
          {phase === 'speechVerify' && showSpeechRoundSummary && (
            <motion.div key="speech-summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col min-h-[calc(100vh-64px)] items-center justify-center px-4"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
              >
                <div className="text-5xl mb-4">🔄</div>
                <h3 className="text-xl font-bold text-gray-800 mb-2">语音第 {speechRound} 轮完成</h3>
                <div className="flex justify-center gap-6 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-500">{speechRoundWords.length - speechSkippedWords.length}</div>
                    <div className="text-xs text-gray-400">✅ 已通过</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-500">{speechSkippedWords.length}</div>
                    <div className="text-xs text-gray-400">需重读</div>
                  </div>
                </div>
                <p className="text-gray-500 text-sm mb-6">
                  还有 <span className="font-bold text-red-500">{speechSkippedWords.length}</span> 个词未通过语音校验
                </p>
                <div className="flex flex-col gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSpeechRetry}
                    className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition"
                  >
                    🎙️ 重新朗读这些词
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSkipSpeechPhase}
                    className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-medium transition"
                  >
                    跳过，进入听写 →
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
          {phase === 'speechVerify' && !showSpeechRoundSummary && currentSpeechWord && (
            <motion.div key={`speech-${speechRound}-${currentSpeechWord.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col min-h-[calc(100vh-64px)]"
            >
              <div className="flex-1 flex flex-col items-center justify-center px-4 pb-4">
                <div className="mb-4 text-center">
                  {speechRound > 1 && (
                    <span className="text-xs text-orange-500 font-medium mr-2">第{speechRound}轮</span>
                  )}
                  <span className="text-sm text-gray-400 font-medium">
                    🎙️ {speechVerifyIndex + 1} / {speechRoundWords.length}
                  </span>
                </div>

                <SpeechVerifyCard
                  key={`${speechRound}-${currentSpeechWord.id}`}
                  word={currentSpeechWord}
                  onNext={handleSpeechVerifyNext}
                  onSkip={handleSpeechSkip}
                  playAudio={playAudio}
                />
              </div>
            </motion.div>
          )}

          {/* 阶段3：听写 */}
          {phase === 'dictation' && (
            <motion.div key={`dictation-${currentGroupIndex}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <DictationPhase
                words={currentGroupWords}
                onComplete={handleDictationComplete}
                playAudioSlow={playAudioSlow}
              />
            </motion.div>
          )}

          {/* 阶段4：过关检测 */}
          {phase === 'exam' && (
            <motion.div key={`exam-${currentGroupIndex}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <GroupExamPhase
                key={`exam-${currentGroupIndex}-${examAttempt}`}
                words={currentGroupWords}
                onPass={handleExamPass}
                onRetry={handleExamRetry}
                onRelearn={handleExamRelearn}
              />
            </motion.div>
          )}

          {/* 阶段6：总结 */}
          {phase === 'summary' && !isLastGroup && (
            <motion.div key={`group-summary-${currentGroupIndex}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ClassifySummary
                dictationResults={dictationResults}
                fillBlankResults={[]}
                totalWords={currentGroupWords.length}
                startTime={startTime}
                onBack={() => navigate(-1)}
                mode="groupSummary"
                groupIndex={currentGroupIndex}
                totalGroups={totalGroups}
                onNextGroup={handleNextGroup}
              />
            </motion.div>
          )}
          {phase === 'summary' && isLastGroup && finalSummaryData && (
            <motion.div key="final-summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ClassifySummary
                dictationResults={finalSummaryData.allDictation}
                fillBlankResults={[]}
                totalWords={finalSummaryData.totalWords}
                startTime={startTime}
                onBack={() => navigate(-1)}
                mode="finalSummary"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 退出确认对话框 */}
      <AnimatePresence>
        {showExitDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
            onClick={() => setShowExitDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-sm w-full"
            >
              <h3 className="text-lg font-bold text-gray-800 mb-2">确认退出？</h3>
              <p className="text-gray-500 text-sm mb-4">进度已保存，下次进入将从当前位置继续</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExitDialog(false)}
                  className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium"
                >
                  继续学习
                </button>
                <button
                  onClick={() => navigate(-1)}
                  className="flex-1 py-2 rounded-xl bg-red-500 text-white font-medium"
                >
                  退出
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default WordClassifyLearning;
