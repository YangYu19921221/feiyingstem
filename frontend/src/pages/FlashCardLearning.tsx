import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Volume2, X } from 'lucide-react';
import { startLearning, updateProgress } from '../api/progress';
import { checkPronunciationConfig, type PronunciationScore } from '../api/pronunciation';
import PronunciationPanel from '../components/PronunciationPanel';
import type { StartLearningResponse, WordData } from '../api/progress';
import {
  createLearningRecords,
  createStudySession,
  updateStudySession,
  getWordMastery,
  getWeakWords,
  type WordAnswerCreate,
  type StudySessionResponse,
  type WordMasteryResponse,
} from '../api/learningRecords';
import { submitReviewRecords } from '../api/memoryCurve';
import { API_BASE_URL } from '../config/env';
import { edgeTtsUrl } from '../hooks/useAudio';
import ColoredPhonetic from '../components/ColoredPhonetic';
import ColoredWord from '../components/ColoredWord';

const FlashCardLearning = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();

  // 从URL路径中推断学习模式,默认为flashcard
  const mode = window.location.pathname.includes('/spelling') ? 'spelling' :
               window.location.pathname.includes('/quiz') ? 'quiz' :
               window.location.pathname.includes('/fillblank') ? 'fillblank' :
               'flashcard';

  const [learningData, setLearningData] = useState<StartLearningResponse | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showExitDialog, setShowExitDialog] = useState(false);

  // 学习记录相关状态
  const [studySession, setStudySession] = useState<StudySessionResponse | null>(null);
  const [wordAnswers, setWordAnswers] = useState<WordAnswerCreate[]>([]);
  const [wordStartTime, setWordStartTime] = useState<number>(0);
  const [currentWordMastery, setCurrentWordMastery] = useState<WordMasteryResponse | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [showWeakWordsReminder, setShowWeakWordsReminder] = useState(false);
  const [weakWordsCount, setWeakWordsCount] = useState(0);
  const [emptyUnit, setEmptyUnit] = useState(false);
  const [emptyMessage, setEmptyMessage] = useState('');
  const [pronunciationEnabled, setPronunciationEnabled] = useState(false);
  const [practiceMode, setPracticeMode] = useState<'normal' | 'mistake' | 'review'>('normal');

  // 防划水功能状态
  const [combo, setCombo] = useState(0);  // 连击数
  const [comboBonus, setComboBonus] = useState(0);  // 连击奖励积分
  const [showComboPopup, setShowComboPopup] = useState<{combo: number, bonus: number} | null>(null);  // 连击弹窗
  const [pendingReview, setPendingReview] = useState<Map<number, {word: WordData, countdown: number}>>(new Map());  // 错误循环队列
  const [reviewQueue, setReviewQueue] = useState<WordData[]>([]);  // 待插入的复习单词
  const [isReviewWord, setIsReviewWord] = useState(false);  // 当前是否为复习单词
  const [reviewSuccessCount, setReviewSuccessCount] = useState<Map<number, number>>(new Map());  // 复习单词连续正确次数

  // 🆕 三关卡学习状态
  const [gateStatus, setGateStatus] = useState({ translationPassed: false, spellingPassed: false, pronunciationPassed: false });
  const [currentGate, setCurrentGate] = useState<1 | 2 | 3>(1);
  const [pronunciationScore, setPronunciationScore] = useState<PronunciationScore | null>(null);
  const PRONUNCIATION_THRESHOLD = 60;
  const quizMode = currentGate === 1 ? 'word_to_meaning' : 'meaning_to_word';  // 从 currentGate 派生
  const [userAnswer, setUserAnswer] = useState('');  // 用户输入的答案
  const [answerSubmitted, setAnswerSubmitted] = useState(false);  // 是否已提交答案
  const [isAnswerCorrect, setIsAnswerCorrect] = useState<boolean | null>(null);  // 答案是否正确
  const [showPreview, setShowPreview] = useState(true);  // 新词预览阶段

  useEffect(() => {
    if (unitId) {
      initLearning(parseInt(unitId), mode);
    }
  }, [unitId]);

  useEffect(() => {
    checkPronunciationConfig().then(setPronunciationEnabled).catch(() => {});
  }, []);

  const initLearning = async (id: number, learningMode: string) => {
    try {
      setLoading(true);

      // 检查是否为特殊练习模式
      const isMistakePractice = sessionStorage.getItem('is_mistake_practice') === 'true';
      const isReviewPractice = sessionStorage.getItem('is_review_practice') === 'true';
      const isSpecialPractice = isMistakePractice || isReviewPractice;

      if (isMistakePractice) setPracticeMode('mistake');
      else if (isReviewPractice) setPracticeMode('review');
      else setPracticeMode('normal');

      let data: StartLearningResponse;

      if (isMistakePractice && id === 0) {
        // 错题练习模式:从sessionStorage获取单词列表
        const mistakeWordsJson = sessionStorage.getItem('mistake_practice_words');
        if (!mistakeWordsJson) {
          setEmptyUnit(true);
          setEmptyMessage('错题数据丢失,请重新进入错题集');
          setLoading(false);
          return;
        }

        const mistakeWords = JSON.parse(mistakeWordsJson);

        // 构造与正常学习相同的数据结构
        data = {
          has_existing_progress: false,
          current_word_index: 0,
          completed_words: 0,
          total_words: mistakeWords.length,
          progress_percentage: 0,
          message: '错题集练习模式',
          unit_info: {
            id: 0,
            unit_number: 0,
            name: '错题集练习',
            description: '针对性练习错题',
            book_id: 0,
            grade_level: null,
          },
          words: mistakeWords.map((w: any) => ({
            id: w.word_id,
            word: w.word,
            phonetic: w.phonetic,
            meaning: w.meaning,
            part_of_speech: w.part_of_speech,
            example_sentence: null,
            example_translation: null,
            difficulty: 1,
            audio_url: null,
            image_url: null,
            order_index: 0,
          })),
        };

        // 清除错题练习标记(仅使用一次)
        sessionStorage.removeItem('is_mistake_practice');
      } else if (isReviewPractice && id === 0) {
        // 记忆曲线复习模式:从sessionStorage获取单词列表
        const reviewWordsJson = sessionStorage.getItem('review_practice_words');
        if (!reviewWordsJson) {
          setEmptyUnit(true);
          setEmptyMessage('复习数据丢失,请重新进入记忆曲线');
          setLoading(false);
          return;
        }

        const reviewWordsData = JSON.parse(reviewWordsJson);

        data = {
          has_existing_progress: false,
          current_word_index: 0,
          completed_words: 0,
          total_words: reviewWordsData.length,
          progress_percentage: 0,
          message: '记忆曲线复习模式',
          unit_info: {
            id: 0,
            unit_number: 0,
            name: '记忆曲线复习',
            description: '基于艾宾浩斯遗忘曲线的智能复习',
            book_id: 0,
            grade_level: null,
          },
          words: reviewWordsData,
        };

        sessionStorage.removeItem('is_review_practice');
        sessionStorage.removeItem('review_practice_words');
      } else {
        // 正常学习模式
        data = await startLearning({
          unit_id: id,
          learning_mode: learningMode,
        });
      }

      // 检查是否有单词
      if (data.words.length === 0) {
        // 单元没有单词,显示友好提示
        setEmptyUnit(true);
        setEmptyMessage(data.message || '该单元暂时没有单词,请联系老师添加单词后再开始学习');
        setLoading(false);
        return;
      }

      setLearningData(data);
      const safeIndex = data.current_word_index < data.words.length ? data.current_word_index : 0;
      setCurrentIndex(safeIndex); // 断点续学:从保存的位置开始

      // 创建学习会话(仅非特殊练习模式)
      if (!isSpecialPractice || id !== 0) {
        try {
          const session = await createStudySession({
            unit_id: id,
            learning_mode: learningMode,
            total_words: data.words.length,
          });
          setStudySession(session);
        } catch (err) {
          console.error('创建学习会话失败:', err);
          // 不影响主流程
        }
      }

      // 开始计时
      setWordStartTime(Date.now());

      // 加载第一个单词的掌握度
      if (data.words.length > 0) {
        loadWordMastery(data.words[safeIndex].id);
      }

      // 加载薄弱单词提醒(仅非特殊练习模式)
      if (!isSpecialPractice || id !== 0) {
        loadWeakWordsReminder(id);
      }
    } catch (error: any) {
      console.error('开始学习失败:', error);

      // 提取错误信息
      let errorMessage = '开始学习失败,请重试';
      if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      } else if (error.message) {
        errorMessage = error.message;
      }

      alert(errorMessage);
      navigate(-1);
    } finally {
      setLoading(false);
    }
  };

  // 加载单词掌握度
  const loadWordMastery = async (wordId: number) => {
    try {
      const mastery = await getWordMastery(wordId);
      setCurrentWordMastery(mastery);
    } catch (err) {
      // 如果单词还没有掌握度记录,API会返回404,这是正常的
      setCurrentWordMastery(null);
    }
  };

  // 加载薄弱单词提醒
  const loadWeakWordsReminder = async (unitId: number) => {
    try {
      const weakWords = await getWeakWords(unitId);
      if (weakWords.length > 0) {
        setWeakWordsCount(weakWords.length);
        setShowWeakWordsReminder(true);
        // 5秒后自动隐藏提醒
        setTimeout(() => setShowWeakWordsReminder(false), 5000);
      }
    } catch (err) {
      console.error('加载薄弱单词失败:', err);
      // 不影响主流程
    }
  };

  const handlePlayAudio = async () => {
    if (!learningData || isPlaying) return;

    const word = learningData.words[currentIndex];
    setIsPlaying(true);

    const url = edgeTtsUrl(word.word);
    const audio = new Audio(url);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    audio.play().catch(() => setIsPlaying(false));
  };

  // 🆕 验证用户答案（关卡1和关卡2）
  const checkAnswer = () => {
    if (!learningData || answerSubmitted) return;

    const currentWord = isReviewWord && reviewQueue.length > 0
      ? reviewQueue[0]
      : learningData.words[currentIndex];

    let isCorrect = false;
    const userInput = userAnswer.trim().toLowerCase();

    if (quizMode === 'word_to_meaning') {
      // 看单词写翻译：检查用户输入的中文意思是否包含关键词
      const correctMeaning = (currentWord.meaning || '').toLowerCase();
      // 简化匹配：用户输入包含在正确答案中，或正确答案包含用户输入
      isCorrect = correctMeaning.includes(userInput) || userInput.includes(correctMeaning.replace(/[;；,，、]/g, '').trim());
      // 或者至少匹配第一个释义
      const firstMeaning = correctMeaning.split(/[;；,，、]/)[0].trim();
      if (userInput === firstMeaning || firstMeaning.includes(userInput) && userInput.length >= 2) {
        isCorrect = true;
      }
    } else {
      // 看翻译写单词：检查用户输入的英文单词是否正确
      const correctWord = currentWord.word.toLowerCase();
      isCorrect = userInput === correctWord;
    }

    setIsAnswerCorrect(isCorrect);
    setAnswerSubmitted(true);
    setIsFlipped(true); // 显示完整答案

    // 答对后自动进入下一关
    if (isCorrect) {
      if (currentGate === 1) {
        // 关卡1通过 → 进入关卡2
        setTimeout(() => {
          setGateStatus(prev => ({ ...prev, translationPassed: true }));
          setCurrentGate(2);
          setUserAnswer('');
          setAnswerSubmitted(false);
          setIsAnswerCorrect(null);
          setIsFlipped(false);
        }, 800);
      } else if (currentGate === 2) {
        // 关卡2通过 → 进入关卡3（发音）
        setTimeout(() => {
          setGateStatus(prev => ({ ...prev, spellingPassed: true }));
          setCurrentGate(3);
          setUserAnswer('');
          setAnswerSubmitted(false);
          setIsAnswerCorrect(null);
          setIsFlipped(false);
        }, 800);
      }
    }
  };

  // 🆕 发音评分回调
  const handlePronunciationScore = (score: PronunciationScore) => {
    setPronunciationScore(score);
    if (score.total_score >= PRONUNCIATION_THRESHOLD) {
      setGateStatus(prev => ({ ...prev, pronunciationPassed: true }));
      setTimeout(() => handleNext('know'), 1000);
    }
  };

  const handleNext = async (wordResult: 'know' | 'dont_know') => {
    if (!learningData) return;

    // 获取当前单词（可能是复习队列中的单词）
    const currentWord = isReviewWord && reviewQueue.length > 0
      ? reviewQueue[0]
      : learningData.words[currentIndex];

    const timeSpent = Date.now() - wordStartTime;

    // 🆕 使用默写验证结果，而不是首字母验证
    const actualIsCorrect = wordResult === 'know' && isAnswerCorrect === true;

    // 连击系统
    if (actualIsCorrect) {
      const newCombo = combo + 1;
      setCombo(newCombo);

      // 计算连击奖励
      let bonus = 0;
      if (newCombo === 5) bonus = 10;
      else if (newCombo === 10) bonus = 25;
      else if (newCombo === 20) bonus = 50;
      else if (newCombo > 20 && newCombo % 10 === 0) bonus = 30;

      if (bonus > 0) {
        setComboBonus(prev => prev + bonus);
        setShowComboPopup({ combo: newCombo, bonus });
        setTimeout(() => setShowComboPopup(null), 2000);
      }
    } else {
      // 答错，连击清零
      if (combo >= 5) {
        setShowComboPopup({ combo: 0, bonus: -1 }); // -1表示断裂
        setTimeout(() => setShowComboPopup(null), 1500);
      }
      setCombo(0);
    }

    // 错误循环重现机制
    if (!actualIsCorrect && !isReviewWord) {
      // 将错误单词加入待复习队列，2个单词后重现
      setPendingReview(prev => {
        const updated = new Map(prev);
        updated.set(currentWord.id, { word: currentWord, countdown: 2 });
        return updated;
      });
    }

    // 如果是复习单词
    if (isReviewWord) {
      if (actualIsCorrect) {
        // 复习正确，增加连续正确次数
        const currentSuccessCount = (reviewSuccessCount.get(currentWord.id) || 0) + 1;
        if (currentSuccessCount >= 2) {
          // 连续正确2次，从复习队列移除
          setReviewSuccessCount(prev => {
            const updated = new Map(prev);
            updated.delete(currentWord.id);
            return updated;
          });
        } else {
          setReviewSuccessCount(prev => {
            const updated = new Map(prev);
            updated.set(currentWord.id, currentSuccessCount);
            return updated;
          });
          // 还需要再正确1次，5个单词后再次出现
          setPendingReview(prev => {
            const updated = new Map(prev);
            updated.set(currentWord.id, { word: currentWord, countdown: 5 });
            return updated;
          });
        }
      } else {
        // 复习答错，重置连续正确次数，2个单词后再次出现
        setReviewSuccessCount(prev => {
          const updated = new Map(prev);
          updated.set(currentWord.id, 0);
          return updated;
        });
        setPendingReview(prev => {
          const updated = new Map(prev);
          updated.set(currentWord.id, { word: currentWord, countdown: 2 });
          return updated;
        });
      }
      // 从复习队列移除当前单词
      setReviewQueue(prev => prev.slice(1));
    }

    // 记录本次答题
    const answer: WordAnswerCreate = {
      word_id: currentWord.id,
      is_correct: actualIsCorrect,
      time_spent: timeSpent,
      learning_mode: mode || 'flashcard',
    };

    const updatedWordAnswers = [...wordAnswers, answer];
    setWordAnswers(updatedWordAnswers);

    // 更新统计
    if (actualIsCorrect) {
      setCorrectCount(correctCount + 1);
    } else {
      setWrongCount(wrongCount + 1);
    }

    // 处理待复习队列倒计时
    setPendingReview(prev => {
      const updated = new Map(prev);
      const toInsert: WordData[] = [];

      updated.forEach((value, key) => {
        if (key === currentWord.id) return; // 跳过当前处理的单词
        if (value.countdown <= 1) {
          toInsert.push(value.word);
          updated.delete(key);
        } else {
          updated.set(key, { ...value, countdown: value.countdown - 1 });
        }
      });

      // 将到期的单词加入复习队列
      if (toInsert.length > 0) {
        setReviewQueue(prev => [...prev, ...toInsert]);
      }

      return updated;
    });

    const nextIndex = currentIndex + 1;
    const isMistakePracticeMode = practiceMode === 'mistake';
    const isReviewPracticeMode = practiceMode === 'review';
    const isSpecialMode = practiceMode !== 'normal';

    // 检查是否有复习单词需要处理
    const hasReviewWords = reviewQueue.length > (isReviewWord ? 1 : 0);

    // 判断是否完成所有单词
    const isLastWord = !isReviewWord && nextIndex >= learningData.words.length && !hasReviewWords && pendingReview.size === 0;

    try {
      // 实时提交单词记录,立即更新掌握度
      if (isReviewPracticeMode) {
        // 记忆曲线复习模式:使用专用的复习记录接口
        await submitReviewRecords([answer]);
      } else if (!isMistakePracticeMode) {
        await createLearningRecords({
          unit_id: learningData.unit_info.id,
          learning_mode: mode || 'flashcard',
          records: [answer],
        });

        // 更新进度（仅当不是复习单词时）
        if (!isReviewWord) {
          await updateProgress({
            unit_id: learningData.unit_info.id,
            learning_mode: mode || 'flashcard',
            current_word_index: nextIndex,
            current_word_id: currentWord.id,
            word_result: actualIsCorrect ? 'know' : 'dont_know',
            is_completed: isLastWord,
          });
        }
      }

      if (isLastWord) {
        // 完成学习 - 更新会话
        if (!isSpecialMode && studySession) {
          const totalTime = Math.floor((Date.now() - new Date(studySession.started_at).getTime()) / 1000);
          await updateStudySession(studySession.id, {
            completed_words: updatedWordAnswers.length,
            correct_count: correctCount + (actualIsCorrect ? 1 : 0),
            wrong_count: wrongCount + (actualIsCorrect ? 0 : 1),
            total_time: totalTime,
          });
        }
        showCompletionDialog();
      } else {
        // 决定下一个单词
        if (hasReviewWords && !isReviewWord) {
          // 优先处理复习队列
          setIsReviewWord(true);
        } else if (isReviewWord && reviewQueue.length <= 1) {
          // 复习队列处理完毕，继续正常学习
          setIsReviewWord(false);
          if (nextIndex < learningData.words.length) {
            setCurrentIndex(nextIndex);
            loadWordMastery(learningData.words[nextIndex].id);
          }
        } else if (!isReviewWord) {
          // 继续下一个正常单词
          setCurrentIndex(nextIndex);
          loadWordMastery(learningData.words[nextIndex].id);
        }

        // 重置状态（三关卡重置）
        setIsFlipped(false);
        setUserAnswer('');
        setAnswerSubmitted(false);
        setIsAnswerCorrect(null);
        setGateStatus({ translationPassed: false, spellingPassed: false, pronunciationPassed: false });
        setCurrentGate(1);
        setPronunciationScore(null);
        setShowPreview(true);  // 新词先预览
        setWordStartTime(Date.now());
      }
    } catch (error) {
      console.error('提交学习记录失败:', error);
    }
  };

  // 提交所有学习记录
  const submitAllRecords = async (allAnswers: WordAnswerCreate[]) => {
    if (!learningData || allAnswers.length === 0) return;

    try {
      // 批量创建学习记录
      await createLearningRecords({
        unit_id: learningData.unit_info.id,
        learning_mode: mode || 'flashcard',
        records: allAnswers,
      });

      // 更新学习会话
      if (studySession) {
        const totalTime = Math.floor((Date.now() - new Date(studySession.started_at).getTime()) / 1000);
        await updateStudySession(studySession.id, {
          completed_words: allAnswers.length,
          correct_count: correctCount + (allAnswers[allAnswers.length - 1]?.is_correct ? 1 : 0),
          wrong_count: wrongCount + (allAnswers[allAnswers.length - 1]?.is_correct ? 0 : 1),
          total_time: totalTime,
        });
      }

      console.log('学习记录提交成功!');
    } catch (error) {
      console.error('提交学习记录失败:', error);
      // 不影响主流程,静默失败
    }
  };

  // 🚫 防划水: 禁用上一个和跳过功能
  // 学生必须完成当前单词的学习才能继续

  const [showReviewPanel, setShowReviewPanel] = useState(false);
  const [reviewingWordIndex, setReviewingWordIndex] = useState<number | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const [showCompletionModal, setShowCompletionModal] = useState(false);

  const showCompletionDialog = () => {
    setShowCompletionModal(true);
  };

  const handleRestart = () => {
    setShowCompletionModal(false);
    setCurrentIndex(0);
    setCurrentGate(1);
    setWordAnswers([]);
    setReviewQueue([]);
    setPendingReview(new Map());
    setIsReviewWord(false);
    setUserAnswer('');
    setWordStartTime(Date.now());
    if (learningData && learningData.words.length > 0) {
      loadWordMastery(learningData.words[0].id);
    }
  };

  const getExitRoute = () => {
    if (practiceMode === 'review') return '/student/memory-curve';
    if (practiceMode === 'mistake') return '/student/mistake-book';
    return `/student/books/${learningData?.unit_info.book_id}/units`;
  };

  const handleBackToUnits = () => {
    setShowCompletionModal(false);
    navigate(getExitRoute());
  };

  const handleExit = () => {
    setShowExitDialog(true);
  };

  const confirmExit = () => {
    navigate(getExitRoute());
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  // 单元为空的提示
  if (emptyUnit) {
    const handleBack = () => {
      navigate(getExitRoute());
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center"
        >
          <div className="text-6xl mb-4">📭</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">
            {emptyMessage.includes('错题') ? '数据丢失' : '单元暂无单词'}
          </h2>
          <p className="text-gray-600 mb-6">{emptyMessage}</p>
          <button
            onClick={handleBack}
            className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-medium hover:shadow-lg transition"
          >
            {emptyMessage.includes('错题') ? '返回错题集' : '返回单元列表'}
          </button>
        </motion.div>
      </div>
    );
  }

  if (!learningData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <p className="text-gray-500">加载失败</p>
      </div>
    );
  }

  const currentWord = isReviewWord && reviewQueue.length > 0
    ? reviewQueue[0]
    : learningData.words[currentIndex];
  const progress = ((currentIndex + 1) / learningData.words.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-blue-50 relative overflow-hidden">
      {/* 装饰性背景元素 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-32 h-32 bg-yellow-200 rounded-full opacity-20 blur-3xl"></div>
        <div className="absolute bottom-20 right-10 w-40 h-40 bg-blue-200 rounded-full opacity-20 blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-pink-200 rounded-full opacity-10 blur-3xl"></div>
      </div>

      {/* 顶部导航栏 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={handleExit}
              className="flex items-center gap-2 px-4 py-2 hover:bg-white rounded-xl transition-all hover:shadow-md"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
              <span className="text-gray-600 font-medium">退出</span>
            </button>

            {currentIndex > 0 && (
              <button
                onClick={() => setShowReviewPanel(true)}
                className="flex items-center gap-1 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl transition-all text-sm font-medium"
              >
                📖 回顾({currentIndex})
              </button>
            )}

            {currentIndex > 0 && (
              <button
                onClick={() => setShowResetConfirm(true)}
                className="flex items-center gap-1 px-3 py-2 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-xl transition-all text-sm font-medium"
              >
                🔄 从头开始
              </button>
            )}

            <div className="flex-1 mx-6">
              <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                <span className="font-medium">{learningData.unit_info.name}</span>
                <span className="font-bold text-primary">
                  🃏 {currentIndex + 1} / {learningData.words.length}
                </span>
              </div>
              <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden shadow-inner">
                <motion.div
                  className="h-full bg-gradient-to-r from-green-400 via-blue-500 to-purple-500 rounded-full shadow-md"
                  initial={{ width: `${(learningData.current_word_index / learningData.words.length) * 100}%` }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </div>

            <div className="bg-gradient-to-br from-primary to-secondary text-white px-4 py-2 rounded-xl shadow-lg">
              <p className="text-2xl font-bold">{progress.toFixed(0)}%</p>
            </div>
          </div>
        </div>
      </nav>

      {/* 断点续学提示 */}
      <AnimatePresence>
        {learningData.has_existing_progress && currentIndex === learningData.current_word_index && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-2xl mx-auto px-4 mt-4 relative z-10"
          >
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4 flex items-center gap-3 shadow-lg">
              <span className="text-3xl">💡</span>
              <p className="text-yellow-800 flex-1 font-medium">{learningData.message}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 薄弱单词提醒 */}
      <AnimatePresence>
        {showWeakWordsReminder && weakWordsCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-2xl mx-auto px-4 mt-4 relative z-10"
          >
            <div className="bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300 rounded-2xl p-4 flex items-center gap-3 shadow-lg">
              <span className="text-3xl">⚠️</span>
              <div className="flex-1">
                <p className="text-red-800 font-bold mb-1">发现薄弱单词!</p>
                <p className="text-red-700 text-sm">
                  当前单元有 <span className="font-bold text-lg">{weakWordsCount}</span> 个单词掌握度较低,需要加强练习哦!
                </p>
              </div>
              <button
                onClick={() => setShowWeakWordsReminder(false)}
                className="text-red-600 hover:text-red-800 transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 卡片区域 - 双栏布局 */}
      <div className="flex flex-col items-center justify-center px-4 py-12 relative z-10">
        <div className="w-full max-w-6xl flex flex-col lg:flex-row gap-6">
          {/* 左栏: 关卡进度 + 卡片 + 输入 */}
          <div className="lg:w-2/3">
          {/* 三关进度条 */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 flex items-center justify-center gap-2"
          >
            {[
              { label: '英译中', done: gateStatus.translationPassed, gate: 1 as const },
              { label: '中译英', done: gateStatus.spellingPassed, gate: 2 as const },
              { label: '发音', done: gateStatus.pronunciationPassed, gate: 3 as const },
            ].map((step, i) => (
              <div key={step.gate} className="flex items-center">
                {i > 0 && (
                  <div className={`w-8 h-1 mx-1 rounded-full transition-all ${
                    step.done || currentGate > step.gate ? 'bg-green-400' : 'bg-gray-200'
                  }`} />
                )}
                <div className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                  step.done
                    ? 'bg-green-100 text-green-700 ring-2 ring-green-300'
                    : currentGate === step.gate
                      ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-400 shadow-md'
                      : 'bg-gray-100 text-gray-400'
                }`}>
                  <span>{step.done ? '✓' : step.gate}</span>
                  <span>{step.label}</span>
                </div>
              </div>
            ))}
          </motion.div>

          {/* 顶部信息栏 */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 flex justify-between items-center"
          >
            {/* 当前关卡提示 */}
            <div className="text-sm text-gray-500 font-medium">
              {currentGate === 1 && '第一关：看单词写翻译'}
              {currentGate === 2 && '第二关：看翻译写单词'}
              {currentGate === 3 && '第三关：朗读发音'}
            </div>

            {/* 进度信息 */}
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span className="font-medium">{currentIndex + 1} / {learningData.words.length}</span>
              <span className="text-xl">{'⭐'.repeat(currentWord.difficulty)}</span>
            </div>

            {/* 单词掌握度显示 */}
            {currentWordMastery && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="inline-flex items-center gap-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white px-6 py-3 rounded-full shadow-lg"
              >
                <span className="text-lg font-medium">掌握度:</span>
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4, 5].map((level) => (
                    <div
                      key={level}
                      className={`w-3 h-3 rounded-full ${
                        level < currentWordMastery.mastery_level
                          ? 'bg-yellow-300'
                          : 'bg-white/30'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-sm font-bold">
                  {currentWordMastery.mastery_level}/5
                </span>
              </motion.div>
            )}
          </motion.div>

          {/* 简洁卡片区域 */}
          <div className="flex items-center justify-center mb-10">
            <motion.div
              className="w-full bg-white rounded-2xl shadow-lg p-12"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              {/* 新词预览阶段 */}
              {showPreview && currentGate === 1 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-400 mb-6">📖 先认识这个单词</p>
                  <h1 className="text-7xl font-bold text-gray-900 mb-4">
                    <ColoredWord word={currentWord.word} syllables={currentWord.syllables} />
                  </h1>
                  {currentWord.phonetic && (
                    <div className="flex items-center justify-center gap-3 mb-6">
                      <ColoredPhonetic phonetic={currentWord.phonetic} size="lg" showLegend />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayAudio();
                        }}
                        disabled={isPlaying}
                        className={`p-2 rounded-full transition-all ${
                          isPlaying ? 'bg-gray-200' : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                      >
                        <Volume2 className="w-5 h-5 text-gray-600" />
                      </button>
                    </div>
                  )}
                  <div className="inline-block bg-amber-50 border border-amber-200 rounded-2xl px-8 py-5 mb-8">
                    {currentWord.part_of_speech && (
                      <p className="text-amber-500 text-sm mb-1">{currentWord.part_of_speech}</p>
                    )}
                    <p className="text-3xl font-bold text-gray-800">{currentWord.meaning}</p>
                  </div>
                  <div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPreview(false);
                        setWordStartTime(Date.now());
                      }}
                      className="px-12 py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all"
                    >
                      我记住了，开始答题 →
                    </button>
                  </div>
                </div>
              ) : (
              /* 题目区域 */
              <div className="mb-12">
                {currentGate === 3 ? (
                  // 关卡3：发音模式
                  <div className="text-center">
                    <p className="text-sm text-gray-500 mb-4">请朗读下面的单词并录音</p>
                    <h1 className="text-7xl font-bold text-gray-900 mb-6">
                      <ColoredWord word={currentWord.word} syllables={currentWord.syllables} />
                    </h1>
                    {currentWord.phonetic && (
                      <div className="flex items-center justify-center gap-3">
                        <ColoredPhonetic phonetic={currentWord.phonetic} size="lg" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayAudio();
                          }}
                          disabled={isPlaying}
                          className={`p-2 rounded-full transition-all ${
                            isPlaying
                              ? 'bg-gray-200'
                              : 'bg-gray-100 hover:bg-gray-200'
                          }`}
                        >
                          <Volume2 className="w-5 h-5 text-gray-600" />
                        </button>
                      </div>
                    )}
                    <div className="mt-8 p-6 bg-blue-50 rounded-xl">
                      <p className="text-blue-600 text-lg">👉 请使用右侧面板的麦克风按钮录音</p>
                      <p className="text-blue-400 text-sm mt-2">发音达到 {PRONUNCIATION_THRESHOLD} 分即可通过</p>
                    </div>
                  </div>
                ) : quizMode === 'word_to_meaning' ? (
                  // 看单词写翻译：显示英文单词
                  <div className="text-center">
                    <p className="text-sm text-gray-500 mb-4">请输入中文意思</p>
                    <h1 className="text-7xl font-bold text-gray-900 mb-6">
                      <ColoredWord word={currentWord.word} syllables={currentWord.syllables} />
                    </h1>
                    {currentWord.phonetic && (
                      <div className="flex items-center justify-center gap-3">
                        <ColoredPhonetic phonetic={currentWord.phonetic} size="lg" />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayAudio();
                          }}
                          disabled={isPlaying}
                          className={`p-2 rounded-full transition-all ${
                            isPlaying
                              ? 'bg-gray-200'
                              : 'bg-gray-100 hover:bg-gray-200'
                          }`}
                        >
                          <Volume2 className="w-5 h-5 text-gray-600" />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  // 看翻译写单词：显示中文意思
                  <div className="text-center">
                    <p className="text-sm text-gray-500 mb-4">请拼写英文单词</p>
                    <div className="inline-block bg-gray-50 rounded-xl px-8 py-6">
                      <p className="text-sm text-gray-600 mb-2">{currentWord.part_of_speech}</p>
                      <h1 className="text-5xl font-bold text-gray-900">
                        {currentWord.meaning}
                      </h1>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* 填字格子输入框 - 关卡3时隐藏, 预览时隐藏 */}
              {!showPreview && currentGate !== 3 && (
              <div className="max-w-4xl mx-auto" onClick={(e) => e.stopPropagation()}>
                <div className="relative">
                  {/* 隐藏的真实输入框 */}
                  <input
                    ref={(el) => el && !answerSubmitted && el.focus()}
                    type="text"
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && userAnswer.trim()) {
                        checkAnswer();
                      }
                    }}
                    className="absolute top-0 left-0 w-full h-full opacity-0 cursor-default"
                    style={{ zIndex: 10 }}
                    autoFocus
                    disabled={answerSubmitted}
                  />

                  {/* 显示的格子 - 固定数量对应答案长度 */}
                  <div className="flex flex-wrap justify-center gap-2 mb-2">
                    {Array.from({
                      length: quizMode === 'word_to_meaning'
                        ? (currentWord.meaning || '').length
                        : currentWord.word.length
                    }).map((_, index) => (
                      <div
                        key={index}
                        className={`w-12 h-16 flex items-center justify-center text-3xl font-bold border-b-4 transition-all ${
                          answerSubmitted
                            ? isAnswerCorrect
                              ? 'border-green-500 text-green-600 bg-green-50'
                              : 'border-red-500 text-red-600 bg-red-50'
                            : index < userAnswer.length
                              ? 'border-blue-500 text-gray-900'
                              : 'border-gray-300 text-gray-400'
                        }`}
                      >
                        {userAnswer[index] || ''}
                      </div>
                    ))}
                  </div>

                  {/* 点击区域提示 */}
                  {!answerSubmitted && (
                    <div
                      className="text-center text-sm text-gray-500 cursor-text"
                      onClick={(e) => {
                        e.stopPropagation();
                        const input = e.currentTarget.parentElement?.querySelector('input');
                        input?.focus();
                      }}
                    >
                      {userAnswer.length === 0 ? '点击这里开始输入' : `已输入 ${userAnswer.length} / ${quizMode === 'word_to_meaning' ? (currentWord.meaning || '').length : currentWord.word.length} 个字符`}
                    </div>
                  )}
                </div>

                {/* 提交按钮 */}
                {!answerSubmitted && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      checkAnswer();
                    }}
                    disabled={!userAnswer.trim()}
                    className={`w-full mt-8 py-4 rounded-xl font-semibold text-lg transition-all ${
                      userAnswer.trim()
                        ? 'bg-blue-500 text-white hover:bg-blue-600'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    确认答案
                  </button>
                )}

                {/* 答案反馈 */}
                {answerSubmitted && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-8"
                  >
                    {/* 结果提示 */}
                    <div className={`text-center mb-6 p-6 rounded-xl ${
                      isAnswerCorrect ? 'bg-green-50' : 'bg-red-50'
                    }`}>
                      <div className="text-5xl mb-3">
                        {isAnswerCorrect ? '✓' : '✗'}
                      </div>
                      <p className={`text-xl font-semibold mb-2 ${
                        isAnswerCorrect ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {isAnswerCorrect ? '回答正确！' : '回答错误'}
                      </p>
                      {!isAnswerCorrect && (
                        <div className="mt-4 text-left">
                          <p className="text-sm text-gray-600 mb-1">你的答案：</p>
                          <p className="text-lg text-red-600 line-through mb-3">{userAnswer}</p>
                          <p className="text-sm text-gray-600 mb-1">正确答案：</p>
                          <p className="text-2xl font-bold text-gray-900">
                            {quizMode === 'word_to_meaning' ? currentWord.meaning : currentWord.word}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* 单词详情（答错时显示） */}
                    {!isAnswerCorrect && (
                      <div className="bg-gray-50 rounded-xl p-6 mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 mb-2"><ColoredWord word={currentWord.word} syllables={currentWord.syllables} /></h3>
                        <ColoredPhonetic phonetic={currentWord.phonetic} size="md" />
                        <p className="text-lg text-gray-800">{currentWord.part_of_speech} {currentWord.meaning}</p>
                      </div>
                    )}

                    {/* 操作按钮 */}
                    {isAnswerCorrect ? (
                      <div className="text-center py-4">
                        <p className="text-green-600 font-semibold text-lg">
                          {currentGate === 1 ? '即将进入第二关：中译英...' : '即将进入第三关：发音...'}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setUserAnswer('');
                            setAnswerSubmitted(false);
                            setIsAnswerCorrect(null);
                            setWordStartTime(Date.now());
                          }}
                          className="w-full py-4 bg-blue-500 text-white rounded-xl font-semibold text-lg hover:bg-blue-600 transition-all"
                        >
                          重新作答
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNext('dont_know');
                          }}
                          className="w-full py-3 bg-gray-200 text-gray-700 rounded-xl font-medium text-base hover:bg-gray-300 transition-all"
                        >
                          跳过这个单词
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
              )}
            </motion.div>
          </div>

          {/* 复习单词提示 */}
          <AnimatePresence>
            {!answerSubmitted && isReviewWord && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex justify-center mt-4"
              >
                <div className="bg-orange-100 border-2 border-orange-400 text-orange-800 px-6 py-3 rounded-xl font-medium flex items-center gap-2 shadow-lg">
                  <span className="text-2xl">🔄</span>
                  <span>复习单词 - 需要连续正确2次才能通过</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          </div>

          {/* 右栏: 发音面板 */}
          {pronunciationEnabled && (
            <div className="lg:w-1/3">
              <PronunciationPanel
                word={currentWord.word}
                phonetic={currentWord.phonetic}
                gateStatus={gateStatus}
                currentGate={currentGate}
                onScoreReceived={handlePronunciationScore}
                threshold={PRONUNCIATION_THRESHOLD}
              />
            </div>
          )}
        </div>
      </div>

      {/* 连击显示 */}
      {combo >= 3 && (
        <motion.div
          key={combo}
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          className="fixed top-24 right-4 z-30"
        >
          <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2">
            <span className="text-2xl">🔥</span>
            <span className="font-bold text-xl">{combo} 连击!</span>
          </div>
        </motion.div>
      )}

      {/* 连击奖励弹窗 */}
      <AnimatePresence>
        {showComboPopup && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: -50 }}
            className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none"
          >
            {showComboPopup.bonus === -1 ? (
              // 连击断裂
              <div className="bg-gradient-to-r from-red-500 to-pink-500 text-white px-8 py-6 rounded-3xl shadow-2xl text-center">
                <div className="text-5xl mb-2">💔</div>
                <div className="text-2xl font-bold">连击中断!</div>
              </div>
            ) : (
              // 连击奖励
              <div className="bg-gradient-to-r from-yellow-400 via-orange-500 to-red-500 text-white px-10 py-8 rounded-3xl shadow-2xl text-center">
                <motion.div
                  animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.5 }}
                  className="text-6xl mb-3"
                >
                  🎉
                </motion.div>
                <div className="text-3xl font-bold mb-2">{showComboPopup.combo} 连击!</div>
                <div className="text-xl">+{showComboPopup.bonus} 奖励积分</div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 退出确认对话框 */}
      <AnimatePresence>
        {showExitDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowExitDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-6">
                <span className="text-5xl mb-4 block">⚠️</span>
                <h3 className="text-xl font-bold text-gray-800 mb-2">确定要退出吗?</h3>
                <p className="text-gray-600">你的学习进度已自动保存</p>
                <p className="text-sm text-gray-500 mt-2">
                  当前进度: {currentIndex + 1}/{learningData.words.length}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowExitDialog(false)}
                  className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                >
                  继续学习
                </button>
                <button
                  onClick={confirmExit}
                  className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition"
                >
                  确定退出
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showCompletionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-6">
                <span className="text-5xl mb-4 block">🎉</span>
                <h3 className="text-xl font-bold text-gray-800 mb-2">
                  {practiceMode === 'review' ? '复习完成!' : practiceMode === 'mistake' ? '错题练习完成!' : '单元学习完成!'}
                </h3>
                <p className="text-gray-600">
                  共学习 {wordAnswers.length} 个单词，正确 {correctCount} 个
                </p>
                <p className="text-sm text-green-600 mt-2 font-medium">
                  正确率: {wordAnswers.length > 0 ? Math.round(correctCount / wordAnswers.length * 100) : 0}%
                </p>
                {practiceMode === 'review' && (
                  <p className="text-sm text-cyan-600 mt-1">坚持复习,记忆更牢固!</p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleRestart}
                  className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-medium transition hover:shadow-lg"
                >
                  重新复习
                </button>
                <button
                  onClick={handleBackToUnits}
                  className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                >
                  {practiceMode === 'review' ? '返回记忆曲线' : practiceMode === 'mistake' ? '返回错题集' : '返回单元列表'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* 回顾已学单词面板 */}
        {showReviewPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => { setShowReviewPanel(false); setReviewingWordIndex(null); }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-800">📖 已学单词回顾</h3>
                <button onClick={() => { setShowReviewPanel(false); setReviewingWordIndex(null); }} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {reviewingWordIndex !== null ? (
                <div className="p-6">
                  <button onClick={() => setReviewingWordIndex(null)} className="text-sm text-blue-600 mb-4 flex items-center gap-1">
                    <ArrowLeft className="w-4 h-4" /> 返回列表
                  </button>
                  {(() => {
                    const w = learningData.words[reviewingWordIndex];
                    return (
                      <div className="text-center">
                        <h2 className="text-4xl font-bold mb-2">
                          <ColoredWord word={w.word} syllables={w.syllables} />
                        </h2>
                        {w.phonetic && <p className="text-gray-500 mb-3">{w.phonetic}</p>}
                        {w.meaning && <p className="text-lg text-gray-800 mb-2">{w.part_of_speech} {w.meaning}</p>}
                        {w.example_sentence && (
                          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-left">
                            <p className="text-sm text-gray-700 italic">{w.example_sentence}</p>
                            {w.example_translation && <p className="text-sm text-gray-500 mt-1">{w.example_translation}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[60vh] p-4 space-y-2">
                  {learningData.words.slice(0, currentIndex).map((w, i) => (
                    <button
                      key={w.id}
                      onClick={() => setReviewingWordIndex(i)}
                      className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-blue-50 rounded-lg transition text-left"
                    >
                      <div>
                        <span className="font-medium text-gray-800">{w.word}</span>
                        {w.meaning && <span className="text-sm text-gray-500 ml-2">{w.meaning}</span>}
                      </div>
                      <span className="text-xs text-gray-400">查看 →</span>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}

        {/* 重置确认弹窗 */}
        {showResetConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowResetConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-2xl p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-6">
                <span className="text-4xl mb-3 block">🔄</span>
                <h3 className="text-lg font-bold text-gray-800 mb-2">确认从头开始?</h3>
                <p className="text-sm text-gray-600">当前学习进度将被重置，从第 1 个单词重新开始</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                >
                  取消
                </button>
                <button
                  onClick={() => { setShowResetConfirm(false); handleRestart(); }}
                  className="flex-1 py-3 px-4 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg font-medium transition hover:shadow-lg"
                >
                  确认重置
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FlashCardLearning;
