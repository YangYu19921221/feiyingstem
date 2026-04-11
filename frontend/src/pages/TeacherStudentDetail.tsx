import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Clock, BookOpen, Target, TrendingDown, Calendar, Sparkles, FileText, Loader2 } from 'lucide-react';
import { toast } from '../components/Toast';
import api from '../api/client';
import { analyzeStudentMistakes, generatePersonalizedExam } from '../api/teacher';
import { getStudentWordTrends } from '../api/analytics';
import WordTrendChart from '../components/WordTrendChart';
import type { StudentMistakeAnalysis } from '../types/exam';

interface StudentStats {
  user_id: number;
  username: string;
  full_name: string;
  total_learning_time: number;
  words_learned: number;
  accuracy_rate: number;
  study_sessions: number;
  last_active: string | null;
  weak_words_count: number;
}

interface WeakPoint {
  word_id: number;
  word: string;
  error_count: number;
  total_attempts: number;
  accuracy_rate: number;
  learning_modes: string[];
  last_error_at: string;
}

const TeacherStudentDetail = () => {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<StudentStats | null>(null);
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([]);
  const [generating, setGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<StudentMistakeAnalysis | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState('');

  useEffect(() => {
    if (studentId) {
      fetchStudentData(parseInt(studentId));
    }
  }, [studentId]);

  const fetchStudentData = async (id: number) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const headers = { Authorization: `Bearer ${token}` };

      const [statsData, weakPointsData] = await Promise.all([
        api.get(`/teacher/analytics/student/${id}/stats`, { headers }),
        api.get(`/teacher/analytics/student/${id}/weak-points`, { headers }),
      ]);

      setStats(statsData.data ?? statsData);
      setWeakPoints(weakPointsData.data ?? weakPointsData);
    } catch (error) {
      console.error('获取学生数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}小时${mins}分钟` : `${mins}分钟`;
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'classify': return '🧠';
      case 'quiz': return '📝';
      case 'spelling': return '✍️';
      case 'fillblank': return '📋';
      default: return '📚';
    }
  };

  const getModeName = (mode: string) => {
    switch (mode) {
      case 'classify': return '分类';
      case 'quiz': return '选择题';
      case 'spelling': return '拼写';
      case 'fillblank': return '填空';
      default: return mode;
    }
  };

  // 分析学生错题
  const handleAnalyzeMistakes = async () => {
    if (!studentId) return;

    try {
      setAnalyzing(true);
      const result = await analyzeStudentMistakes(parseInt(studentId));
      setAnalysis(result);
      setShowAnalysis(true);
    } catch (error: any) {
      console.error('分析错题失败:', error);
      toast.error(error.response?.data?.detail || '分析失败,请稍后重试');
    } finally {
      setAnalyzing(false);
    }
  };

  // AI生成试卷(带进度显示)
  const handleGenerateExam = async () => {
    if (!studentId) return;

    try {
      setGenerating(true);
      setGenerationProgress(0);

      // 模拟生成进度
      const stages = [
        { progress: 15, text: '🔍 正在分析学生薄弱点...', duration: 800 },
        { progress: 30, text: '📊 评估学习数据...', duration: 600 },
        { progress: 45, text: '🎯 确定试题难度...', duration: 500 },
        { progress: 60, text: '🤖 AI生成选择题...', duration: 1200 },
        { progress: 75, text: '✍️ AI生成填空和拼写题...', duration: 1000 },
        { progress: 90, text: '📖 AI生成阅读理解题...', duration: 800 },
        { progress: 95, text: '✅ 整理试卷...', duration: 400 },
      ];

      // 启动进度动画
      let currentStage = 0;
      const updateProgress = () => {
        if (currentStage < stages.length) {
          const stage = stages[currentStage];
          setGenerationProgress(stage.progress);
          setGenerationStage(stage.text);
          currentStage++;
          setTimeout(updateProgress, stage.duration);
        }
      };
      updateProgress();

      // 实际API调用(不指定question_count,使用AI推荐的60题标准分布)
      const result = await generatePersonalizedExam({
        student_id: parseInt(studentId),
      });

      // 完成
      setGenerationProgress(100);
      setGenerationStage('🎉 试卷生成完成!');

      // 短暂延迟后跳转
      setTimeout(() => {
        navigate(`/teacher/exam-preview/${result.id}`);
      }, 500);

    } catch (error: any) {
      console.error('生成试卷失败:', error);
      toast.error(error.response?.data?.detail || '生成失败,请稍后重试');
      setGenerationProgress(0);
      setGenerationStage('');
    } finally {
      setTimeout(() => {
        setGenerating(false);
        setGenerationProgress(0);
        setGenerationStage('');
      }, 1000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">加载学生数据中...</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <span className="text-6xl mb-4 block">😕</span>
          <p className="text-gray-500">未找到学生数据</p>
          <button
            onClick={() => navigate('/teacher/analytics')}
            className="mt-4 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition"
          >
            返回数据分析
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* 顶部导航 */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <button
            onClick={() => navigate('/teacher/analytics')}
            className="flex items-center gap-2 text-gray-600 hover:text-primary transition"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>返回数据分析</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 学生信息卡片 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-primary to-secondary rounded-2xl p-8 text-white shadow-lg mb-8"
        >
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-full bg-white/20 flex items-center justify-center text-4xl font-bold">
              {stats.full_name.charAt(0)}
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold mb-2">{stats.full_name}</h1>
              <p className="text-white/80">@{stats.username}</p>
              {stats.last_active && (
                <p className="text-white/60 text-sm mt-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  最后活动: {new Date(stats.last_active).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* 学习统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
              <div className="text-sm text-gray-600">学习时长</div>
            </div>
            <div className="text-3xl font-bold text-gray-800">{formatTime(stats.total_learning_time)}</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-purple-600" />
              </div>
              <div className="text-sm text-gray-600">已学单词</div>
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.words_learned}</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
                <Target className="w-6 h-6 text-green-600" />
              </div>
              <div className="text-sm text-gray-600">平均准确率</div>
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.accuracy_rate.toFixed(1)}%</div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center">
                <TrendingDown className="w-6 h-6 text-orange-600" />
              </div>
              <div className="text-sm text-gray-600">薄弱单词</div>
            </div>
            <div className="text-3xl font-bold text-gray-800">{stats.weak_words_count}</div>
          </motion.div>
        </div>

        {/* 单词学习趋势（日/月/年） */}
        <WordTrendChart
          fetchData={(period, year, month) =>
            getStudentWordTrends(parseInt(studentId || '0'), period, year, month)
          }
        />

        {/* 薄弱点详情 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-lg"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            📌 学习薄弱点分析
          </h2>

          {weakPoints.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-6xl mb-4 block">🎉</span>
              <p className="text-gray-500">该学生暂无明显薄弱点,继续保持!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {weakPoints.map((weak, index) => (
                <motion.div
                  key={weak.word_id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * index }}
                  className="flex items-center gap-4 p-4 bg-gradient-to-r from-red-50 to-orange-50 rounded-xl border border-red-100"
                >
                  <div className="w-12 h-12 rounded-full bg-red-500 text-white flex items-center justify-center font-bold text-lg">
                    {index + 1}
                  </div>

                  <div className="flex-1">
                    <div className="font-bold text-lg text-gray-800 mb-1">{weak.word}</div>
                    <div className="flex flex-wrap gap-2 text-sm text-gray-600">
                      <span>❌ 错误 {weak.error_count} 次</span>
                      <span>📊 总尝试 {weak.total_attempts} 次</span>
                      <span>📅 最后错误: {new Date(weak.last_error_at).toLocaleDateString('zh-CN')}</span>
                    </div>
                    <div className="flex gap-2 mt-2">
                      {weak.learning_modes && weak.learning_modes.map(mode => (
                        <span
                          key={mode}
                          className="px-2 py-1 bg-white rounded-full text-xs font-medium"
                        >
                          {getModeIcon(mode)} {getModeName(mode)}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`text-2xl font-bold ${
                      weak.accuracy_rate >= 50 ? 'text-orange-600' : 'text-red-600'
                    }`}>
                      {weak.accuracy_rate.toFixed(0)}%
                    </div>
                    <div className="text-xs text-gray-500">准确率</div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {weakPoints.length > 0 && (
            <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-200">
              <p className="text-sm text-blue-800">
                💡 <strong>教学建议:</strong> 针对这些薄弱单词,建议:
              </p>
              <ul className="mt-2 text-sm text-blue-700 space-y-1 ml-6 list-disc">
                <li>增加针对性练习,特别是错误率高的学习模式</li>
                <li>安排复习计划,间隔重复帮助记忆</li>
                <li>提供更多例句和应用场景</li>
                <li>关注学生的学习方法,必要时提供个别辅导</li>
              </ul>
            </div>
          )}

          {/* AI试卷生成按钮 */}
          {weakPoints.length > 0 && (
            <div className="mt-6 flex gap-4">
              <button
                onClick={handleAnalyzeMistakes}
                disabled={analyzing}
                className="flex-1 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white px-6 py-3 rounded-xl font-medium transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    AI分析中...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    AI深度分析
                  </>
                )}
              </button>

              <button
                onClick={handleGenerateExam}
                disabled={generating}
                className="flex-1 bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white px-6 py-3 rounded-xl font-medium transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <FileText className="w-5 h-5" />
                    一键生成试卷
                  </>
                )}
              </button>
            </div>
          )}
        </motion.div>

        {/* AI分析结果弹窗 */}
        <AnimatePresence>
          {showAnalysis && analysis && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              onClick={() => setShowAnalysis(false)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white rounded-2xl p-8 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <Sparkles className="w-6 h-6 text-yellow-500" />
                  AI错题深度分析
                </h2>

                <div className="space-y-6">
                  {/* 整体统计 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl">
                      <div className="text-sm text-blue-600 mb-1">学习单词数</div>
                      <div className="text-3xl font-bold text-blue-700">{analysis.total_words}</div>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-xl">
                      <div className="text-sm text-green-600 mb-1">正确率</div>
                      <div className="text-3xl font-bold text-green-700">{analysis.accuracy_rate.toFixed(1)}%</div>
                    </div>
                  </div>

                  {/* 推荐难度 */}
                  <div className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl">
                    <div className="text-sm text-purple-600 mb-2">推荐难度</div>
                    <div className="text-xl font-bold text-purple-700">
                      {analysis.difficulty_level === 'easy' && '🌱 简单'}
                      {analysis.difficulty_level === 'medium' && '🌿 中等'}
                      {analysis.difficulty_level === 'hard' && '🌳 困难'}
                    </div>
                  </div>

                  {/* 推荐题型分布 */}
                  <div>
                    <h3 className="font-bold text-lg mb-3">推荐题型分布</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-orange-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-orange-700">📝 选择题</span>
                          <span className="font-bold text-orange-800">{analysis.recommended_distribution.choice}题</span>
                        </div>
                      </div>
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-blue-700">📋 填空题</span>
                          <span className="font-bold text-blue-800">{analysis.recommended_distribution.fill_blank}题</span>
                        </div>
                      </div>
                      <div className="p-3 bg-green-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-green-700">✍️ 拼写题</span>
                          <span className="font-bold text-green-800">{analysis.recommended_distribution.spelling}题</span>
                        </div>
                      </div>
                      <div className="p-3 bg-purple-50 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-purple-700">📖 阅读题</span>
                          <span className="font-bold text-purple-800">{analysis.recommended_distribution.reading}题</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 薄弱单词列表 */}
                  {analysis.weak_words.length > 0 && (
                    <div>
                      <h3 className="font-bold text-lg mb-3">薄弱单词 (Top 10)</h3>
                      <div className="space-y-2">
                        {analysis.weak_words.slice(0, 10).map((word, index) => (
                          <div key={index} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                            <div>
                              <span className="font-bold text-gray-800">{word.word}</span>
                              <span className="text-gray-600 ml-2">({word.meaning})</span>
                            </div>
                            <span className="text-red-600 font-medium">错误 {word.wrong_count} 次</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex gap-3 pt-4 border-t">
                    <button
                      onClick={() => setShowAnalysis(false)}
                      className="flex-1 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition"
                    >
                      关闭
                    </button>
                    <button
                      onClick={() => {
                        setShowAnalysis(false);
                        handleGenerateExam();
                      }}
                      disabled={generating}
                      className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 text-white rounded-xl font-medium transition disabled:opacity-50"
                    >
                      立即生成试卷
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* AI生成试卷进度弹窗 */}
        <AnimatePresence>
          {generating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-white rounded-3xl p-8 max-w-md w-full mx-4 shadow-2xl"
              >
                {/* 标题 */}
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mb-4">
                    <FileText className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800">AI智能出题中</h3>
                  <p className="text-gray-500 mt-2">正在为学生生成个性化试卷...</p>
                </div>

                {/* 进度条 */}
                <div className="mb-6">
                  <div className="relative h-3 bg-gray-200 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${generationProgress}%` }}
                      transition={{ duration: 0.5, ease: "easeInOut" }}
                      className="absolute top-0 left-0 h-full bg-gradient-to-r from-orange-500 via-pink-500 to-purple-500 rounded-full"
                    >
                      {/* 光效动画 */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                    </motion.div>
                  </div>

                  {/* 进度百分比 */}
                  <div className="flex justify-between items-center mt-3">
                    <span className="text-sm font-medium text-gray-700">{generationStage}</span>
                    <span className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-pink-500">
                      {generationProgress}%
                    </span>
                  </div>
                </div>

                {/* 提示信息 */}
                <div className="bg-gradient-to-r from-orange-50 to-pink-50 rounded-xl p-4 border border-orange-100">
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-gray-700">
                      <p className="font-medium mb-1">智能分析中</p>
                      <p className="text-gray-600">AI正在根据学生的学习数据和薄弱点,精心设计每一道题目</p>
                    </div>
                  </div>
                </div>

                {/* 装饰性元素 */}
                <div className="absolute -top-2 -right-2 w-20 h-20 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full blur-2xl opacity-20 animate-pulse" />
                <div className="absolute -bottom-2 -left-2 w-24 h-24 bg-gradient-to-br from-pink-400 to-purple-500 rounded-full blur-2xl opacity-20 animate-pulse" style={{ animationDelay: '1s' }} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default TeacherStudentDetail;
