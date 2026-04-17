# 错题集统一练习模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把错题集三种练习模式（选择题/填空/拼写）合并为一个统一练习页面，消除学生选择焦虑。

**Architecture:** 新建 `MistakePractice.tsx` 页面，按 `index % 3` 循环分配题型（quiz→fillblank→spelling），并行调用 AI 接口分别生成选择题和填空题，拼写题直接用单词。MistakeBook 删除模式选择 UI，单一按钮跳转新页面。

**Tech Stack:** React 18, TypeScript, Framer Motion, Axios, React Router v7, Tailwind CSS

---

## 文件变动清单

| 文件 | 操作 |
|---|---|
| `frontend/src/pages/MistakePractice.tsx` | **新建** — 统一练习主页面 |
| `frontend/src/App.tsx` | **修改** — 添加 `/student/mistake-practice` 路由 |
| `frontend/src/pages/MistakeBook.tsx` | **修改** — 删除模式选择 UI，改为单一跳转按钮 |

---

## Task 1: MistakeBook.tsx — 删除模式选择，改为单一按钮

**Files:**
- Modify: `frontend/src/pages/MistakeBook.tsx`

- [ ] **Step 1: 删除 selectedMode state 和模式选择 UI**

在 `MistakeBook.tsx` 中：

删除这行 state：
```typescript
// 删除这行
const [selectedMode, setSelectedMode] = useState<string>('quiz');
```

删除整个"快速开始练习"区域中的模式选择按钮（三个 mode card）：
```tsx
// 删除这段（mode grid 区域）
<div className="grid grid-cols-3 gap-4 mb-4">
  {[
    { id: 'quiz', name: '选择题', icon: '✅' },
    { id: 'spelling', name: '拼写', icon: '✏️' },
    { id: 'fillblank', name: '填空', icon: '📝' },
  ].map((mode) => (
    <button
      key={mode.id}
      onClick={() => setSelectedMode(mode.id)}
      ...
    >
      ...
    </button>
  ))}
</div>
```

- [ ] **Step 2: 简化 handleStartPractice，改为跳转统一练习页**

将原来的 `handleStartPractice` 函数替换为：

```typescript
const handleStartPractice = async () => {
  try {
    const response = await startMistakePractice({
      learning_mode: 'quiz',  // 仅用于API参数，不影响实际练习模式
      limit: 20,
      only_unresolved: true,
    });

    if (response.practice_words.length === 0) {
      toast.info(response.message);
      return;
    }

    sessionStorage.setItem('mistake_practice_words', JSON.stringify(response.practice_words));
    sessionStorage.setItem('is_mistake_practice', 'true');
    navigate('/student/mistake-practice');
  } catch (error) {
    console.error('开始练习失败:', error);
    toast.error('开始练习失败,请重试');
  }
};
```

- [ ] **Step 3: 简化开始练习按钮**

将原来的开始练习按钮替换为：

```tsx
<button
  onClick={handleStartPractice}
  disabled={!stats || stats.unresolved_mistakes === 0}
  className="w-full py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
>
  {stats && stats.unresolved_mistakes > 0
    ? `🚀 开始练习（${stats.unresolved_mistakes}个待攻克）`
    : '暂无待练习错题'}
</button>
```

- [ ] **Step 4: 验证文件编译无报错**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep MistakeBook
```
预期：无输出（无报错）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MistakeBook.tsx
git commit -m "feat: 错题集练习入口改为统一模式，删除模式选择UI"
```

---

## Task 2: App.tsx — 添加新路由

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 找到现有学生路由区域**

在 App.tsx 中搜索 `mistake` 相关路由：
```bash
grep -n "mistake\|MistakeBook\|MistakeChallenge" frontend/src/App.tsx
```

- [ ] **Step 2: 添加懒加载 import**

在 App.tsx 中，找到 MistakeBook 的 lazy import 行，在其后添加：

```typescript
const MistakePractice = lazy(() => import('./pages/MistakePractice'));
```

- [ ] **Step 3: 添加路由**

在 MistakeBook 或 MistakeChallenge 路由附近添加：

```tsx
<Route path="/student/mistake-practice" element={<MistakePractice />} />
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: 添加统一错题练习路由 /student/mistake-practice"
```

---

## Task 3: MistakePractice.tsx — 新建统一练习页面

**Files:**
- Create: `frontend/src/pages/MistakePractice.tsx`

### Step 1: 定义类型和辅助函数

- [ ] **创建文件，写类型定义和 API 调用函数**

```typescript
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import AnswerFeedback from '../components/practice/AnswerFeedback';
import ColoredPhonetic from '../components/ColoredPhonetic';
import { useAudio } from '../hooks/useAudio';

type QuestionType = 'quiz' | 'fillblank' | 'spelling';

interface MixedQuestion {
  type: QuestionType;
  word_id: number;
  word: string;
  phonetic?: string;
  meaning?: string;
  question?: string;       // quiz/fillblank 题干
  options?: string[];      // quiz/fillblank 选项
  correct_answer: string;  // quiz/fillblank 正确答案 | spelling 正确单词
}

const TYPE_LABELS: Record<QuestionType, string> = {
  quiz: '选择题',
  fillblank: '填空',
  spelling: '拼写',
};

const TYPE_COLORS: Record<QuestionType, string> = {
  quiz: 'bg-blue-100 text-blue-700',
  fillblank: 'bg-purple-100 text-purple-700',
  spelling: 'bg-orange-100 text-orange-700',
};
```

- [ ] **写 loadQuestions 函数（并行请求 AI 题目）**

```typescript
async function loadQuestions(): Promise<MixedQuestion[]> {
  const wordsJson = sessionStorage.getItem('mistake_practice_words');
  if (!wordsJson) throw new Error('错题数据丢失');
  const words: any[] = JSON.parse(wordsJson);

  const quizWords  = words.filter((_, i) => i % 3 === 0);
  const fillWords  = words.filter((_, i) => i % 3 === 1);

  const call = (wds: any[], type: string) =>
    wds.length === 0
      ? Promise.resolve([])
      : axios
          .post(`${API_BASE_URL}/ai/generate-quiz-from-words`, {
            word_ids: wds.map(w => w.word_id),
            question_count: wds.length,
            question_type: type,
          })
          .then(r => r.data.questions as any[]);

  const [quizQs, fillQs] = await Promise.all([
    call(quizWords, 'choice'),
    call(fillWords, 'fillblank'),
  ]);

  const quizMap = new Map(quizQs.map((q: any) => [q.word_id, q]));
  const fillMap = new Map(fillQs.map((q: any) => [q.word_id, q]));

  return words.map((w, i): MixedQuestion => {
    const type: QuestionType = i % 3 === 0 ? 'quiz' : i % 3 === 1 ? 'fillblank' : 'spelling';
    if (type === 'quiz') {
      const q = quizMap.get(w.word_id) as any;
      return {
        type, word_id: w.word_id,
        word: q?.word || w.word,
        phonetic: q?.phonetic || w.phonetic,
        meaning: q?.meaning || w.meaning,
        question: q?.question,
        options: q?.options,
        correct_answer: q?.correct_answer || w.word,
      };
    }
    if (type === 'fillblank') {
      const q = fillMap.get(w.word_id) as any;
      return {
        type, word_id: w.word_id,
        word: q?.word || w.word,
        phonetic: q?.phonetic || w.phonetic,
        meaning: q?.meaning || w.meaning,
        question: q?.question,
        options: q?.options,
        correct_answer: q?.correct_answer || w.word,
      };
    }
    // spelling: 直接用单词，无需 AI
    return {
      type, word_id: w.word_id, word: w.word,
      phonetic: w.phonetic, meaning: w.meaning,
      correct_answer: w.word,
    };
  });
}
```

### Step 2: 主组件 state 和 useEffect

- [ ] **写组件主体（state + 加载逻辑）**

```typescript
const MistakePractice = () => {
  const navigate = useNavigate();
  const { playAudio } = useAudio();
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const [questions, setQuestions] = useState<MixedQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);

  // 共用答题状态
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  // 拼写专用状态
  const [userInput, setUserInput] = useState('');
  const [letterResults, setLetterResults] = useState<string[]>([]);
  const [revealedLetters, setRevealedLetters] = useState<Set<number>>(new Set());
  const [attemptCount, setAttemptCount] = useState(0);
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);

  useEffect(() => {
    loadQuestions()
      .then(qs => { setQuestions(qs); setLoading(false); })
      .catch(() => { alert('加载题目失败，请重试'); navigate(-1); });
  }, []);

  const resetState = () => {
    setSelectedAnswer('');
    setIsChecking(false);
    setIsCorrect(false);
    setUserInput('');
    setLetterResults([]);
    setRevealedLetters(new Set());
    setAttemptCount(0);
    setShowCorrectAnswer(false);
  };

  const recordAnswer = (correct: boolean) => {
    setIsCorrect(correct);
    setIsChecking(true);
    setResults(prev => [...prev, correct]);
  };

  const handleNext = () => {
    if (currentIndex >= questions.length - 1) {
      setShowResult(true);
    } else {
      setCurrentIndex(i => i + 1);
      resetState();
    }
  };
```

### Step 3: 选择题渲染

- [ ] **写 renderQuiz 函数**

```typescript
  const renderQuiz = (q: MixedQuestion) => (
    <>
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-6">{q.question}</h2>
        <div className="space-y-3">
          {q.options?.map((option, idx) => {
            const isSelected = selectedAnswer === option;
            const isCorrectOpt = option === q.correct_answer;
            let style = 'bg-gray-50 border-gray-200 hover:border-orange-300 hover:bg-orange-50';
            if (isChecking) {
              if (isCorrectOpt) style = 'bg-green-50 border-green-400 text-green-800';
              else if (isSelected && !isCorrect) style = 'bg-red-50 border-red-400 text-red-800';
              else style = 'bg-gray-50 border-gray-200 opacity-50';
            } else if (isSelected) style = 'bg-orange-50 border-orange-400';
            return (
              <motion.button
                key={idx}
                onClick={() => {
                  if (isChecking) return;
                  setSelectedAnswer(option);
                  recordAnswer(option === q.correct_answer);
                }}
                disabled={isChecking}
                animate={isChecking && isSelected && !isCorrect ? { x: [0, -8, 8, -8, 8, 0] } : {}}
                transition={{ duration: 0.4 }}
                className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${style}`}
              >
                <span className="font-medium">{String.fromCharCode(65 + idx)}. {option}</span>
                {isChecking && isCorrectOpt && <span className="float-right text-green-500">✓</span>}
                {isChecking && isSelected && !isCorrect && !isCorrectOpt && <span className="float-right text-red-500">✗</span>}
              </motion.button>
            );
          })}
        </div>
      </div>
    </>
  );
```

### Step 4: 填空题渲染

- [ ] **写 renderFillblank 函数**

```typescript
  const renderSentence = (question: string) => {
    const sentence = question.replace('选择正确的单词填空:\n', '');
    const parts = sentence.split('______');
    if (parts.length < 2) return <span>{sentence}</span>;
    return (
      <>
        {parts.map((part, i) => (
          <span key={i}>
            {part}
            {i < parts.length - 1 && (
              <span className="inline-block mx-1 min-w-[80px] relative">
                {isChecking && selectedAnswer ? (
                  <motion.span
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`font-bold px-2 py-0.5 rounded ${isCorrect ? 'text-green-600 bg-green-100' : 'text-red-600 bg-red-100'}`}
                  >
                    {selectedAnswer}
                  </motion.span>
                ) : (
                  <span className="border-b-3 border-orange-400 px-4 py-0.5 inline-block">
                    <span className="animate-pulse text-orange-400">|</span>
                  </span>
                )}
              </span>
            )}
          </span>
        ))}
      </>
    );
  };

  const renderFillblank = (q: MixedQuestion) => (
    <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
      <div className="bg-gradient-to-r from-orange-50 to-yellow-50 rounded-xl p-5 mb-6 border border-orange-200">
        <p className="text-xl text-gray-800 leading-relaxed">
          {q.question && renderSentence(q.question)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {q.options?.map((option, idx) => {
          const isSelected = selectedAnswer === option;
          const isCorrectOpt = option === q.correct_answer;
          let style = 'bg-white border-gray-200 hover:border-orange-300 hover:shadow-md';
          if (isChecking) {
            if (isCorrectOpt) style = 'bg-green-50 border-green-400 text-green-800';
            else if (isSelected && !isCorrect) style = 'bg-red-50 border-red-400 text-red-800';
            else style = 'bg-gray-50 border-gray-200 opacity-50';
          }
          return (
            <motion.button
              key={idx}
              onClick={() => {
                if (isChecking) return;
                setSelectedAnswer(option);
                recordAnswer(option === q.correct_answer);
              }}
              disabled={isChecking}
              whileHover={!isChecking ? { scale: 1.03 } : {}}
              whileTap={!isChecking ? { scale: 0.97 } : {}}
              className={`p-4 rounded-xl border-2 font-bold text-center text-lg shadow-sm transition-colors ${style}`}
            >
              {option}
              {isChecking && isCorrectOpt && <span className="ml-1">✓</span>}
              {isChecking && isSelected && !isCorrect && !isCorrectOpt && <span className="ml-1">✗</span>}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
```

### Step 5: 拼写题渲染

- [ ] **写 renderSpelling 函数**

```typescript
  const handleHint = (answer: string) => {
    for (let i = 0; i < answer.length; i++) {
      if (answer[i] === ' ') continue;
      if (!revealedLetters.has(i)) {
        setRevealedLetters(prev => new Set(prev).add(i));
        break;
      }
    }
  };

  const handleCheck = (q: MixedQuestion) => {
    const answer = q.correct_answer.trim();
    const input = userInput.trim();
    const correct = input === answer;
    const compareResults: string[] = [];
    for (let i = 0; i < answer.length; i++) {
      if (i < input.length) compareResults.push(input[i] === answer[i] ? 'correct' : 'wrong');
      else compareResults.push('missing');
    }
    setLetterResults(compareResults);
    if (correct) {
      recordAnswer(true);
    } else {
      const newCount = attemptCount + 1;
      setAttemptCount(newCount);
      if (newCount >= 3) {
        setShowCorrectAnswer(true);
        recordAnswer(false);
      }
    }
  };

  const renderSpelling = (q: MixedQuestion) => {
    const answer = q.correct_answer;
    const letters = answer.split('');
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
        {/* 发音提示 */}
        <div className="text-center mb-6">
          <button
            onClick={() => playAudio(q.word)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition mb-2"
          >
            🔊 {q.word}
            {q.phonetic && <ColoredPhonetic phonetic={q.phonetic} className="text-sm" />}
          </button>
          <p className="text-gray-500 text-sm">{q.meaning}</p>
        </div>

        {/* 字母格 */}
        <div
          className="flex flex-wrap gap-1 justify-center mb-6"
          onClick={() => hiddenInputRef.current?.focus()}
        >
          {letters.map((letter, i) => {
            if (letter === ' ') return <div key={i} className="w-3" />;
            const typed = userInput[i] || '';
            const result = letterResults[i];
            const isRevealed = revealedLetters.has(i);
            let bg = 'bg-gray-100 border-gray-300';
            if (result === 'correct') bg = 'bg-green-100 border-green-400 text-green-700';
            else if (result === 'wrong') bg = 'bg-red-100 border-red-400 text-red-700';
            else if (result === 'missing') bg = 'bg-gray-50 border-red-200';
            else if (isRevealed) bg = 'bg-yellow-100 border-yellow-400 text-yellow-700';
            return (
              <div key={i} className={`w-9 h-10 border-2 rounded-lg flex items-center justify-center font-bold text-lg ${bg}`}>
                {isRevealed ? letter : (typed || '')}
              </div>
            );
          })}
        </div>

        <input
          ref={hiddenInputRef}
          value={userInput}
          onChange={e => {
            if (!isChecking) {
              const val = e.target.value.slice(0, answer.replace(/ /g, '').length + answer.split(' ').length - 1);
              setUserInput(val);
              setLetterResults([]);
            }
          }}
          onKeyDown={e => { if (e.key === 'Enter' && !isChecking && userInput.trim()) handleCheck(q); }}
          className="opacity-0 absolute w-0 h-0"
          disabled={isChecking}
          autoFocus
        />

        {showCorrectAnswer && (
          <p className="text-center text-gray-500 mb-4">正确答案：<span className="font-bold text-green-600">{answer}</span></p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => handleHint(answer)}
            disabled={isChecking}
            className="flex-1 flex items-center justify-center gap-1 py-3 bg-yellow-50 text-yellow-700 rounded-xl border border-yellow-200 hover:bg-yellow-100 transition disabled:opacity-50"
          >
            <Lightbulb className="w-4 h-4" /> 提示
          </button>
          <button
            onClick={() => handleCheck(q)}
            disabled={isChecking || !userInput.trim()}
            className="flex-2 flex-1 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition disabled:opacity-50"
          >
            {attemptCount > 0 ? `再试 (${3 - attemptCount}次)` : '检查'}
          </button>
        </div>
      </div>
    );
  };
```

### Step 6: 结果页和主 JSX

- [ ] **写结果页和主 render**

```typescript
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4" />
          <p className="text-gray-500">生成混合题目中...</p>
        </div>
      </div>
    );
  }

  if (showResult) {
    const correctCount = results.filter(Boolean).length;
    const wrongWords = questions.filter((_, i) => !results[i]);
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 p-4">
        <div className="max-w-lg mx-auto pt-12">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white rounded-3xl shadow-xl p-8 text-center">
            <div className="text-6xl mb-4">{correctCount / questions.length >= 0.8 ? '🎉' : '💪'}</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">练习完成！</h2>
            <p className="text-4xl font-bold text-primary mb-1">{correctCount}/{questions.length}</p>
            <p className="text-gray-500 mb-6">正确率 {Math.round(correctCount / questions.length * 100)}%</p>
            {wrongWords.length > 0 && (
              <div className="text-left bg-red-50 rounded-xl p-4 mb-6">
                <p className="font-bold text-red-700 mb-2">需要加强的词：</p>
                {wrongWords.map(w => (
                  <div key={w.word_id} className="flex justify-between text-sm py-1 border-b border-red-100 last:border-0">
                    <span className="font-medium text-gray-800">{w.word}</span>
                    <span className="text-gray-500">{w.meaning}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { resetState(); setCurrentIndex(0); setResults([]); setShowResult(false); }}
                className="flex-1 py-3 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition"
              >
                再练一次
              </button>
              <button
                onClick={() => navigate('/student/mistake-book')}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition"
              >
                返回错题集
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex];
  const pct = Math.round((currentIndex / questions.length) * 100);

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">错题练习</span>
              <span className="text-sm text-gray-500">{currentIndex + 1} / {questions.length}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-primary to-yellow-400 rounded-full"
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${TYPE_COLORS[currentQ.type]}`}>
            {TYPE_LABELS[currentQ.type]}
          </span>
        </div>
      </nav>

      {/* 题目区 */}
      <div className="max-w-lg mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
          >
            {currentQ.type === 'quiz' && renderQuiz(currentQ)}
            {currentQ.type === 'fillblank' && renderFillblank(currentQ)}
            {currentQ.type === 'spelling' && renderSpelling(currentQ)}
          </motion.div>
        </AnimatePresence>

        {/* 答题后反馈（quiz/fillblank 用，spelling 有自己的逻辑） */}
        <AnimatePresence>
          {isChecking && currentQ.type !== 'spelling' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <AnswerFeedback
                isCorrect={isCorrect}
                word={currentQ.word}
                phonetic={currentQ.phonetic}
                meaning={currentQ.meaning}
                correctAnswer={currentQ.correct_answer}
                userAnswer={!isCorrect ? selectedAnswer : undefined}
                onNext={handleNext}
                isLast={currentIndex >= questions.length - 1}
              />
            </motion.div>
          )}
          {isChecking && currentQ.type === 'spelling' && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <AnswerFeedback
                isCorrect={isCorrect}
                word={currentQ.word}
                phonetic={currentQ.phonetic}
                meaning={currentQ.meaning}
                correctAnswer={currentQ.correct_answer}
                userAnswer={!isCorrect ? userInput : undefined}
                onNext={handleNext}
                isLast={currentIndex >= questions.length - 1}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default MistakePractice;
```

- [ ] **Step 7: 构建验证**

```bash
cd frontend && npm run build 2>&1 | grep -E 'error|Error|built in'
```
预期：`✓ built in X.XXs`

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/MistakePractice.tsx
git commit -m "feat: 新建统一错题练习页面 MistakePractice，循环分配选择/填空/拼写题型"
```

---

## Task 4: 部署到远端服务器

**Files:** 无代码修改，仅部署步骤

- [ ] **Step 1: 推送代码**

```bash
git push origin main && git push gitee main
```

- [ ] **Step 2: 服务器拉取并部署前端**

```bash
sshpass -p 'X9Th2vDUK@uGuw6M' ssh -o StrictHostKeyChecking=no root@42.193.250.250 "
  cd /www/wwwroot/english-helper && git pull origin main
"
cd frontend && sshpass -p 'X9Th2vDUK@uGuw6M' rsync -az --delete dist/ root@42.193.250.250:/www/wwwroot/english-helper/frontend/dist/
```

- [ ] **Step 3: 验证**

```bash
curl -s -o /dev/null -w '%{http_code}' https://es.feiyingsteam.com
```
预期：`200`

---

## 自检

- [x] **MistakeBook 改动**：删除 selectedMode、3 个模式按钮，handleStartPractice 改跳转 ✅
- [x] **App.tsx**：lazy import + 路由 ✅
- [x] **MistakePractice.tsx**：loadQuestions 并行 API、quiz/fillblank/spelling 三种渲染、resetState、handleNext、结果页 ✅
- [x] **后端零改动** ✅
- [x] **AnswerFeedback 复用** ✅
- [x] **拼写题 3 次机会逻辑复用** ✅
- [x] **无 TBD/TODO 占位符** ✅
