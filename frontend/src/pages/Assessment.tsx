import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  startAssessment, evaluateWord, generateReport, capturePhone, verifyPhone,
  type AssessmentWord, type WordScore, type BasicReport, type DeepReport,
} from '../api/assessment';
import { useCountdown } from '../hooks/useCountdown';
import { useAudio } from '../hooks/useAudio';

type Phase = 'welcome' | 'recording' | 'report' | 'phone' | 'deep';

const GRADE_OPTIONS = ['小学', '初中', '高中'];

const Assessment = () => {
  const [phase, setPhase] = useState<Phase>('welcome');
  const { playAudio } = useAudio();
  const [grade, setGrade] = useState('小学');
  const [sessionId, setSessionId] = useState('');
  const [words, setWords] = useState<AssessmentWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scores, setScores] = useState<WordScore[]>([]);
  const [report, setReport] = useState<BasicReport | null>(null);
  const [deepReport, setDeepReport] = useState<DeepReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 录音
  const [isRecording, setIsRecording] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [currentScore, setCurrentScore] = useState<WordScore | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理录音资源
  useEffect(() => {
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      if (recorderRef.current?.state === 'recording') {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // 手机号
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const { remaining, isActive, start: startCountdown } = useCountdown(60);

  // 开始测评
  const handleStart = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await startAssessment(grade);
      setSessionId(data.session_id);
      setWords(data.words);
      setCurrentIndex(0);
      setScores([]);
      setPhase('recording');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 录音
  const startRecording = useCallback(async () => {
    try {
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setIsRecording(false);
        setIsEvaluating(true);
        try {
          const word = words[currentIndex];
          const result = await evaluateWord(sessionId, word.word, blob);
          const score: WordScore = {
            word: word.word,
            total_score: result.total_score || 0,
            accuracy: result.accuracy || 0,
            fluency: result.fluency || 0,
            integrity: result.integrity || 0,
          };
          setCurrentScore(score);
          setScores(prev => [...prev, score]);
          if (score.total_score < 60) {
            playAudio(word.word);
          }
        } catch {
          setCurrentScore({ word: words[currentIndex].word, total_score: 0, accuracy: 0, fluency: 0, integrity: 0 });
          setScores(prev => [...prev, { word: words[currentIndex].word, total_score: 0, accuracy: 0, fluency: 0, integrity: 0 }]);
        }
        setIsEvaluating(false);
      };
      recorderRef.current = recorder;
      recorder.start(100);
      setIsRecording(true);
      setCurrentScore(null);
      stopTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 3000);
    } catch {
      setError('无法访问麦克风');
    }
  }, [words, currentIndex, sessionId]);

  const handleNext = async () => {
    if (currentIndex < words.length - 1) {
      setCurrentIndex(i => i + 1);
      setCurrentScore(null);
    } else {
      // 全部完成，生成报告
      setLoading(true);
      try {
        const allScores = [...scores];
        if (currentScore && allScores.length < words.length) {
          allScores.push(currentScore);
        }
        const data = await generateReport(sessionId, allScores);
        setReport(data);
        setPhase('report');
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
  };

  // 发送验证码
  const handleSendCode = async () => {
    if (!/^1[3-9]\d{9}$/.test(phone)) { setError('请输入正确的手机号'); return; }
    setSendingCode(true);
    setError('');
    try {
      await capturePhone(sessionId, phone);
      startCountdown();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSendingCode(false);
    }
  };

  // 验证 + 获取深度报告
  const handleVerify = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await verifyPhone(sessionId, phone, code);
      setDeepReport(data.deep_report);
      setPhase('deep');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const currentWord = words[currentIndex];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* 顶部 */}
      <div className="bg-white/80 backdrop-blur-md shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">🦅</span>
          <h1 className="text-lg font-bold text-gray-800">飞鹰AI英语 · 公益口语体检</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        <AnimatePresence mode="wait">

          {/* 欢迎页 */}
          {phase === 'welcome' && (
            <motion.div key="welcome" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="text-center mb-8 mt-8">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-7xl mb-4">🏥</motion.div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">公益英语口语体检</h2>
                <p className="text-gray-500">3分钟AI智能检测，发现发音薄弱点</p>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2 mb-6 text-center">
                <p className="text-sm text-green-700">🌿 本活动由飞鹰AI英语公益支持 · 完全免费</p>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-md mb-6">
                <p className="text-sm font-medium text-gray-700 mb-3">选择年级</p>
                <div className="flex gap-3">
                  {GRADE_OPTIONS.map(g => (
                    <button
                      key={g}
                      onClick={() => setGrade(g)}
                      className={`flex-1 py-3 rounded-xl font-medium transition ${
                        grade === g ? 'bg-indigo-500 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-md mb-6">
                <p className="text-sm font-bold text-gray-700 mb-3">体检流程</p>
                <div className="space-y-3">
                  {[
                    { icon: '🎯', text: 'AI推荐6个诊断词' },
                    { icon: '🎤', text: '逐词朗读录音（每词3秒）' },
                    { icon: '📊', text: '即时获取发音体检报告' },
                    { icon: '📋', text: '生成口语体检报告' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm text-gray-600">
                      <span className="text-lg">{item.icon}</span>
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-red-500 text-sm text-center mb-4">{error}</p>}

              <motion.button
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                onClick={handleStart}
                disabled={loading}
                className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-2xl font-bold text-lg shadow-lg disabled:opacity-50"
              >
                {loading ? '准备中...' : '开始公益体检'}
              </motion.button>

              <p className="text-center text-xs text-gray-400 mt-4">无需注册 · 公益免费 · 即测即出</p>
            </motion.div>
          )}

          {/* 录音阶段 */}
          {phase === 'recording' && currentWord && (
            <motion.div key="recording" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {/* 进度 */}
              <div className="flex items-center gap-2 mb-6">
                {words.map((_, i) => (
                  <div key={i} className={`flex-1 h-2 rounded-full transition-all ${
                    i < currentIndex ? 'bg-green-400' :
                    i === currentIndex ? 'bg-indigo-500' : 'bg-gray-200'
                  }`} />
                ))}
              </div>
              <p className="text-center text-sm text-gray-500 mb-4">
                第 {currentIndex + 1} / {words.length} 个单词
              </p>

              {/* 单词卡片 */}
              <motion.div
                key={currentWord.word_id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-3xl shadow-xl p-8 text-center mb-6"
              >
                <p className="text-4xl font-bold text-gray-800 mb-2">{currentWord.word}</p>
                {currentWord.phonetic && <p className="text-gray-400 mb-1">{currentWord.phonetic}</p>}
                {currentWord.meaning && <p className="text-gray-500">{currentWord.meaning}</p>}

                {/* 录音/评分状态 */}
                <div className="mt-6">
                  {isRecording ? (
                    <div className="flex flex-col items-center">
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 0.8 }}
                        className="w-20 h-20 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-200 mb-3"
                      >
                        <span className="text-3xl">🎙️</span>
                      </motion.div>
                      <p className="text-red-500 font-medium">正在录音...</p>
                    </div>
                  ) : isEvaluating ? (
                    <div className="flex flex-col items-center">
                      <div className="w-20 h-20 rounded-full bg-indigo-100 flex items-center justify-center mb-3">
                        <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="text-3xl">⏳</motion.span>
                      </div>
                      <p className="text-indigo-500 font-medium">正在评分...</p>
                    </div>
                  ) : currentScore ? (
                    <div className="flex flex-col items-center">
                      {/* 分数环 */}
                      <div className="relative w-24 h-24 mb-3">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                          <circle cx="50" cy="50" r="42" fill="none" stroke="#E5E7EB" strokeWidth="6" />
                          <motion.circle
                            cx="50" cy="50" r="42"
                            fill="none"
                            stroke={currentScore.total_score >= 80 ? '#22C55E' : currentScore.total_score >= 60 ? '#3B82F6' : '#EF4444'}
                            strokeWidth="6" strokeLinecap="round"
                            strokeDasharray={2 * Math.PI * 42}
                            initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                            animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - currentScore.total_score / 100) }}
                            transition={{ duration: 0.8 }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={`text-2xl font-bold ${
                            currentScore.total_score >= 80 ? 'text-green-600' : currentScore.total_score >= 60 ? 'text-blue-600' : 'text-red-500'
                          }`}>
                            {currentScore.total_score.toFixed(0)}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-4 text-xs text-gray-500">
                        <span>准确 {currentScore.accuracy.toFixed(0)}</span>
                        <span>流利 {currentScore.fluency.toFixed(0)}</span>
                      </div>
                      <button
                        onClick={() => playAudio(currentWord.word)}
                        className="mt-3 px-4 py-2 bg-blue-50 text-blue-600 rounded-full text-sm hover:bg-blue-100 transition"
                      >
                        🔊 听标准发音
                      </button>
                      {currentScore.total_score < 60 && (
                        <p className="mt-2 text-xs text-orange-500">发音需要加强，请听标准发音后重试</p>
                      )}
                    </div>
                  ) : (
                    <motion.button
                      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                      onClick={startRecording}
                      className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg mx-auto"
                    >
                      <span className="text-3xl text-white">🎤</span>
                    </motion.button>
                  )}
                </div>
              </motion.div>

              {/* 下一个/完成 */}
              {currentScore && !isEvaluating && (
                <motion.button
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  onClick={handleNext}
                  disabled={loading}
                  className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-2xl font-bold text-lg shadow-lg disabled:opacity-50"
                >
                  {loading ? '生成报告中...' : currentIndex < words.length - 1 ? '下一个 →' : '查看报告'}
                </motion.button>
              )}
            </motion.div>
          )}

          {/* 基础报告 */}
          {phase === 'report' && report && (
            <motion.div key="report" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">{report.grade_label === '优秀' ? '🏆' : report.grade_label === '良好' ? '👍' : '💪'}</div>
                <h2 className="text-2xl font-bold text-gray-800">公益口语体检报告</h2>
              </div>

              {/* 总分 */}
              <div className="bg-white rounded-2xl p-6 shadow-md mb-4 text-center">
                <div className="relative w-32 h-32 mx-auto mb-3">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#E5E7EB" strokeWidth="6" />
                    <motion.circle cx="50" cy="50" r="42" fill="none"
                      stroke={report.avg_score >= 80 ? '#22C55E' : report.avg_score >= 60 ? '#3B82F6' : '#EF4444'}
                      strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 42}
                      initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - report.avg_score / 100) }}
                      transition={{ duration: 1 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-gray-800">{report.avg_score.toFixed(0)}</span>
                    <span className="text-xs text-gray-400">总分</span>
                  </div>
                </div>
                <span className={`px-4 py-1 rounded-full text-sm font-bold ${
                  report.grade_label === '优秀' ? 'bg-green-100 text-green-700' :
                  report.grade_label === '良好' ? 'bg-blue-100 text-blue-700' :
                  report.grade_label === '需提升' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {report.grade_label}
                </span>
                <div className="flex justify-center gap-6 mt-4 text-sm">
                  <div><span className="text-gray-400">准确度</span><p className="font-bold">{report.avg_accuracy.toFixed(0)}</p></div>
                  <div><span className="text-gray-400">流利度</span><p className="font-bold">{report.avg_fluency.toFixed(0)}</p></div>
                </div>
              </div>

              {/* 各词得分 */}
              <div className="bg-white rounded-2xl p-6 shadow-md mb-4">
                <h3 className="font-bold text-gray-700 mb-3">各词得分</h3>
                <div className="space-y-2">
                  {report.scores.map((s, i) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <span className="font-medium text-gray-800">{s.word}</span>
                      <span className={`font-bold ${s.total_score >= 80 ? 'text-green-600' : s.total_score >= 60 ? 'text-blue-600' : 'text-red-500'}`}>
                        {s.total_score.toFixed(0)}分
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 薄弱点 */}
              {report.weak_areas.length > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 mb-6">
                  <h3 className="font-bold text-orange-700 mb-2">需要注意</h3>
                  {report.weak_areas.map((a, i) => (
                    <p key={i} className="text-sm text-orange-600 flex items-start gap-2">
                      <span>⚠️</span>{a}
                    </p>
                  ))}
                </div>
              )}

              {/* CTA: 获取深度报告 */}
              <div className="bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl p-6 text-white text-center shadow-lg">
                <h3 className="text-lg font-bold mb-2">获取完整体检报告</h3>
                <p className="text-white/80 text-sm mb-4">包含个性化学习路径 + 发音纠错建议 + 薄弱点详解</p>
                <button
                  onClick={() => setPhase('phone')}
                  className="w-full py-3 bg-white text-indigo-600 rounded-xl font-bold shadow-md hover:shadow-lg transition"
                >
                  免费获取完整报告 →
                </button>
              </div>
            </motion.div>
          )}

          {/* 手机号捕获 */}
          {phase === 'phone' && (
            <motion.div key="phone" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="text-center mb-6 mt-4">
                <div className="text-5xl mb-3">📋</div>
                <h2 className="text-xl font-bold text-gray-800">获取完整体检报告</h2>
                <p className="text-gray-500 text-sm mt-1">输入手机号，AI为您生成个性化分析</p>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-md mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">手机号</label>
                <div className="flex gap-2">
                  <input
                    type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="请输入手机号" maxLength={11}
                    className="flex-1 px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                  />
                  <button
                    onClick={handleSendCode}
                    disabled={isActive || sendingCode}
                    className={`px-4 py-3 rounded-xl text-sm font-medium whitespace-nowrap ${
                      isActive || sendingCode ? 'bg-gray-100 text-gray-400' : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                    }`}
                  >
                    {sendingCode ? '...' : isActive ? `${remaining}s` : '发送验证码'}
                  </button>
                </div>

                <label className="block text-sm font-medium text-gray-700 mb-2 mt-4">验证码</label>
                <input
                  type="text" value={code} onChange={e => setCode(e.target.value)}
                  placeholder="请输入验证码" maxLength={6}
                  className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
                />
              </div>

              {error && <p className="text-red-500 text-sm text-center mb-4">{error}</p>}

              <button
                onClick={handleVerify}
                disabled={loading || !phone || !code}
                className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-2xl font-bold text-lg shadow-lg disabled:opacity-50"
              >
                {loading ? 'AI分析中...' : '获取完整报告'}
              </button>

              <button onClick={() => setPhase('report')} className="w-full py-3 text-gray-400 text-sm mt-3">
                返回体检报告
              </button>
            </motion.div>
          )}

          {/* 深度报告 */}
          {phase === 'deep' && deepReport && (
            <motion.div key="deep" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">🎓</div>
                <h2 className="text-2xl font-bold text-gray-800">AI深度体检报告</h2>
              </div>

              {/* 总评 */}
              <div className="bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl p-6 text-white mb-4 shadow-lg">
                <p className="text-lg font-medium">{deepReport.summary}</p>
                <div className="flex gap-3 mt-3">
                  <span className="px-3 py-1 bg-white/20 rounded-full text-sm">{report?.grade_label}</span>
                  <span className="px-3 py-1 bg-white/20 rounded-full text-sm">{report?.avg_score.toFixed(0)}分</span>
                </div>
              </div>

              {/* 优势 */}
              {deepReport.strengths?.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-5 mb-4">
                  <h3 className="font-bold text-green-700 mb-2">优势</h3>
                  {deepReport.strengths.map((s, i) => (
                    <p key={i} className="text-sm text-green-600 flex items-start gap-2 mb-1"><span>✅</span>{s}</p>
                  ))}
                </div>
              )}

              {/* 薄弱点 */}
              {deepReport.weaknesses?.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-4">
                  <h3 className="font-bold text-red-700 mb-2">需要改进</h3>
                  {deepReport.weaknesses.map((w, i) => (
                    <p key={i} className="text-sm text-red-600 flex items-start gap-2 mb-1"><span>⚠️</span>{w}</p>
                  ))}
                </div>
              )}

              {/* 建议 */}
              <div className="bg-white rounded-2xl p-5 shadow-md mb-4">
                <h3 className="font-bold text-gray-700 mb-3">个性化建议</h3>
                {deepReport.suggestions?.map((s, i) => (
                  <p key={i} className="text-sm text-gray-600 flex items-start gap-2 mb-2"><span>💡</span>{s}</p>
                ))}
              </div>

              {/* 学习计划 */}
              {deepReport.study_plan && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mb-4">
                  <h3 className="font-bold text-blue-700 mb-2">推荐学习计划</h3>
                  <p className="text-sm text-blue-600">{deepReport.study_plan}</p>
                </div>
              )}

              {/* 重点单词 */}
              {deepReport.focus_words?.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-md mb-6">
                  <h3 className="font-bold text-gray-700 mb-3">重点练习单词</h3>
                  <div className="flex flex-wrap gap-2">
                    {deepReport.focus_words.map((w, i) => (
                      <span key={i} className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">{w}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 教师联系 */}
              <div className="bg-gradient-to-r from-green-400 to-teal-500 rounded-2xl p-6 text-white text-center shadow-lg mb-4">
                <h3 className="text-lg font-bold mb-2">想进一步提升？</h3>
                <p className="text-white/80 text-sm mb-3">添加老师微信，获取专属学习方案</p>
                <div className="bg-white/20 rounded-xl px-4 py-3 inline-block">
                  <p className="text-sm">飞鹰AI英语 · 公益体检活动</p>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
};

export default Assessment;
