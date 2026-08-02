import { useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { usePreventCopy } from '../hooks/usePreventCopy';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Lightbulb, PencilLine, Volume2 } from 'lucide-react';
import PracticeLayout from '../components/practice/PracticeLayout';
import PracticeLoadError from '../components/practice/PracticeLoadError';
import AnswerFeedback from '../components/practice/AnswerFeedback';
import { usePracticeState } from '../hooks/usePracticeState';
import { usePracticeQuestions } from '../hooks/usePracticeQuestions';
import { useAudio } from '../hooks/useAudio';
import { imeSafeInputProps } from '../utils/noSuggestInput';

const SpellingPractice = () => {
  usePreventCopy();  // 防划走答案:禁右键/复制/选中(输入框内放行)
  const { unitId } = useParams<{ unitId: string }>();
  const { playAudio } = useAudio();
  const reduceMotion = useReducedMotion();
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const firstWrongInputRef = useRef<string>('');  // 本题首次错误输入(抄写3遍后随记录上报)

  const { questions, unitInfo, unitWords, loading, error, retry } = usePracticeQuestions({
    unitId,
    questionType: 'spelling',
    questionCount: 10,
  });

  const {
    currentIndex, isChecking, isCorrect,
    timeSpent, results, accuracy, formatTime,
    recordAnswer, goToNext,
  } = usePracticeState({
    mode: 'spelling',
    modeName: '拼写练习',
    unitId,
    questions,
    unitName: unitInfo?.name,
    totalUnitWords: unitWords.length || undefined,
  });

  const [userInput, setUserInput] = useState('');
  const [hintsUsed, setHintsUsed] = useState(0);
  const [revealedLetters, setRevealedLetters] = useState<Set<number>>(new Set());
  const [letterResults, setLetterResults] = useState<string[]>([]);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);
  // 错答后进入"抄写模式"：需连续 3 次完整正确输入才能继续
  const [copyMode, setCopyMode] = useState(false);
  const [copyDoneCount, setCopyDoneCount] = useState(0);
  const COPY_REQUIRED = 3;

  const handleHint = () => {
    const answer = questions[currentIndex].correct_answer;
    for (let i = 0; i < answer.length; i++) {
      // 跳过空格位置
      if (answer[i] === ' ') continue;
      if (!revealedLetters.has(i)) {
        setRevealedLetters(prev => new Set(prev).add(i));
        setHintsUsed(h => h + 1);
        break;
      }
    }
  };

  const handleCheck = () => {
    const currentQuestion = questions[currentIndex];
    const answer = currentQuestion.correct_answer.trim();
    const input = userInput.trim();
    const correct = input === answer;

    // 抄写模式下：只判断是否完整正确，正确则计数；不再调 recordAnswer
    if (copyMode) {
      const compareResults: string[] = [];
      for (let i = 0; i < answer.length; i++) {
        if (i < input.length) {
          compareResults.push(input[i] === answer[i] ? 'correct' : 'wrong');
        } else {
          compareResults.push('missing');
        }
      }
      setLetterResults(compareResults);

      if (correct) {
        const nextDone = copyDoneCount + 1;
        setCopyDoneCount(nextDone);
        if (nextDone >= COPY_REQUIRED) {
          // 抄完三遍 → 真正进入"已答完"状态，让 PracticeLayout 的反馈卡出现并允许下一题
          recordAnswer(false, firstWrongInputRef.current || undefined);
        } else {
          // 还差几遍：清空输入、保持答案可见，重新让用户写
          setTimeout(() => {
            setUserInput('');
            setLetterResults([]);
            hiddenInputRef.current?.focus();
          }, 350);
        }
      }
      // 抄写时输错不计数，也不影响成绩 — 提示用户重写当前这遍
      return;
    }

    // 正常首答
    const compareResults: string[] = [];
    for (let i = 0; i < answer.length; i++) {
      if (i < input.length) {
        compareResults.push(input[i] === answer[i] ? 'correct' : 'wrong');
      } else {
        compareResults.push('missing');
      }
    }
    setLetterResults(compareResults);

    if (correct) {
      setShowCorrectAnswer(false);
      recordAnswer(true);
    } else {
      // 错一次就进抄写模式，亮答案、清输入、要求抄 3 遍
      firstWrongInputRef.current = input;  // 记住首次错误输入(拼写诊断数据源)
      setShowCorrectAnswer(true);
      setCopyMode(true);
      setCopyDoneCount(0);
      setTimeout(() => {
        setUserInput('');
        setLetterResults([]);
        hiddenInputRef.current?.focus();
      }, 700);
    }
  };

  const handleNext = () => {
    goToNext(() => {
      setUserInput('');
      setLetterResults([]);
      setRevealedLetters(new Set());
      setShowCorrectAnswer(false);
      setCopyMode(false);
      setCopyDoneCount(0);
    });
  };

  const focusInput = () => hiddenInputRef.current?.focus();
  const currentQuestion = questions[currentIndex];
  const answerLength = currentQuestion?.correct_answer.length || 0;
  const questionWords = questions.map(q => q.word);

  if (error) {
    return (
      <PracticeLoadError
        title="拼写题暂时没准备好"
        message={error}
        onRetry={retry}
      />
    );
  }

  return (
    <PracticeLayout
      loading={loading || questions.length === 0}
      loadingText="生成拼写题中..."
      unitName={unitInfo?.name}
      totalWords={unitWords.length || undefined}
      accuracy={accuracy}
      timeSpent={timeSpent}
      formatTime={formatTime}
      total={questions.length}
      results={results}
      currentIndex={currentIndex}
      currentWord={currentQuestion?.word || ''}
      currentPhonetic={currentQuestion?.phonetic}
      currentMeaning={currentQuestion?.meaning}
      unitWords={unitWords}
      questionWords={questionWords}
      hideAnswer
    >
      {/* 题目卡片 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={reduceMotion ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, x: -24 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="card-soft mb-6 rounded-2xl p-4 sm:p-6"
        >
          <div className="mb-2 font-numeric text-sm text-ink-mute">
            第 {currentIndex + 1} / {questions.length} 题
          </div>

          {/* 题目文字 + 发音 */}
          <div className="text-center mb-6">
            <h2 className="mb-3 text-balance text-xl font-bold leading-8 text-ink">
              {currentQuestion?.question}
            </h2>
            <button
              type="button"
              onClick={() => currentQuestion && playAudio(currentQuestion.word)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-orange-50 px-5 text-sm font-semibold text-accent-warm transition hover:bg-orange-100"
            >
              <Volume2 className="h-4 w-4" aria-hidden="true" />
              播放发音
            </button>
            <p id="spelling-length-help" className="mt-2 text-sm text-ink-mute">
              共 {answerLength} 个字符{currentQuestion?.correct_answer.includes(' ') ? '（含空格）' : ''}
            </p>
            {/* 抄写模式：显示正确答案让学生照着抄 */}
            {copyMode && currentQuestion && (
              <div className="mt-4 inline-block rounded-xl border border-amber-300 bg-amber-50 px-5 py-3">
                <p className="text-xs text-amber-700 mb-1">正确拼写</p>
                <p className="text-3xl font-bold text-amber-700 tracking-wider font-mono">
                  {currentQuestion.correct_answer}
                </p>
              </div>
            )}
          </div>

          {/* 隐藏输入框 */}
          <input
            {...imeSafeInputProps({ visible: false })}
            ref={hiddenInputRef}
            value={userInput}
            onChange={(e) => {
              if (!isChecking) {
                const val = e.target.value.replace(/[^a-zA-Z '\-!?.,！？，。…]/g, '');
                const cap = Math.max(answerLength + 4, Math.ceil(answerLength * 1.5));
                setUserInput(val.slice(0, cap));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isChecking && userInput.trim()) handleCheck();
            }}
            className="opacity-0 absolute -z-10"
            aria-label="输入拼写答案"
            aria-describedby="spelling-length-help"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={isChecking}
          />

          {/* Wordle 风格字母格子 */}
          <div
            className="custom-scrollbar mb-6 flex justify-start gap-1 overflow-x-auto pb-2 min-[360px]:gap-2 sm:justify-center"
            style={{ flexWrap: 'nowrap' }}
            onClick={focusInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                focusInput();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="点击或按回车开始输入拼写答案"
          >
            {currentQuestion && Array.from({ length: answerLength }).map((_, i) => {
              const answer = currentQuestion.correct_answer;
              const isSpace = answer[i] === ' ';

              // 空格位置固定显示为间隔标记
              if (isSpace) {
                return (
                  <motion.div
                    key={i}
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className="flex h-11 w-3 shrink-0 items-center justify-center text-xs text-gray-300 min-[360px]:h-12 min-[360px]:w-5 min-[360px]:text-sm sm:h-14 sm:w-6"
                  >
                    ␣
                  </motion.div>
                );
              }

              let bgColor = 'bg-gray-100 border-gray-300';
              let textColor = 'text-gray-800';
              let letter = '';

              if (isChecking && letterResults[i]) {
                if (letterResults[i] === 'correct') {
                  bgColor = 'bg-green-100 border-green-400';
                  textColor = 'text-green-700';
                } else if (letterResults[i] === 'wrong') {
                  bgColor = 'bg-red-100 border-red-400';
                  textColor = 'text-red-700';
                } else {
                  bgColor = 'bg-gray-200 border-gray-400';
                  textColor = 'text-gray-400';
                }
                letter = i < userInput.length ? userInput[i] : '';
              } else if (revealedLetters.has(i)) {
                letter = answer[i];
                bgColor = 'bg-yellow-50 border-yellow-400';
                textColor = 'text-yellow-700';
              } else if (i < userInput.length) {
                letter = userInput[i];
                bgColor = 'bg-orange-50 border-orange-400';
              } else if (i === 0 && !userInput) {
                letter = answer[0];
                bgColor = 'bg-orange-50 border-orange-200';
                textColor = 'text-orange-300';
              }

              const isCurrent = i === userInput.length && !isChecking;

              return (
                <motion.div
                  key={i}
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className={`flex h-11 w-8 shrink-0 items-center justify-center rounded-lg border-2 text-lg font-bold min-[360px]:h-12 min-[360px]:w-10 min-[360px]:rounded-xl min-[360px]:text-xl sm:h-14 sm:w-12 sm:text-2xl ${bgColor} ${textColor} ${
                    isCurrent ? 'ring-2 ring-orange-400 animate-pulse' : ''
                  }`}
                >
                  {letter}
                </motion.div>
              );
            })}
          </div>
          {answerLength > 7 && (
            <p className="-mt-4 mb-5 text-center text-xs text-ink-mute">
              字母较多，可左右滑动查看全部
            </p>
          )}

          {/* 提示按钮（抄写模式下隐藏：答案已经亮在上面） */}
          {!isChecking && !copyMode && (
            <div className="text-center mb-6">
              <button
                type="button"
                onClick={handleHint}
                disabled={revealedLetters.size >= answerLength - 1}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-yellow-100 px-4 text-sm font-medium text-yellow-800 transition hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Lightbulb size={16} />
                提示一个字母 ({revealedLetters.size}/{answerLength - 1})
              </button>
            </div>
          )}

          {/* 抄写模式提示 */}
          {copyMode && !isChecking && (
            <div className="text-center mb-4">
              <p className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-amber-800">
                <PencilLine className="h-4 w-4 shrink-0" aria-hidden="true" />
                拼错了，请照着上方答案抄写 {COPY_REQUIRED} 遍（已完成 {copyDoneCount} / {COPY_REQUIRED}）
              </p>
            </div>
          )}

          {/* 检查按钮 */}
          {!isChecking && (
            <button
              type="button"
              onClick={handleCheck}
              disabled={!userInput.trim()}
              className="btn-glow inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Check className="h-5 w-5" aria-hidden="true" />
              {copyMode
                ? `提交本遍（${copyDoneCount + 1} / ${COPY_REQUIRED}）`
                : '检查拼写'}
            </button>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 答题后反馈 */}
      <AnimatePresence>
        {isChecking && currentQuestion && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -14 }}
            transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <AnswerFeedback
              isCorrect={isCorrect!}
              word={currentQuestion.word}
              phonetic={currentQuestion.phonetic}
              meaning={currentQuestion.meaning}
              correctAnswer={currentQuestion.correct_answer}
              userAnswer={!isCorrect ? userInput : undefined}
              onNext={handleNext}
              isLast={currentIndex >= questions.length - 1}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </PracticeLayout>
  );
};

export default SpellingPractice;
