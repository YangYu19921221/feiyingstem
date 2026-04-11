import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Download, Printer, Share2, CheckCircle } from 'lucide-react';
import { getExamDetail } from '../api/teacher';
import type { ExamPaper, ExamQuestion } from '../types/exam';
import html2pdf from 'html2pdf.js';
import { toast } from '../components/Toast';

const TeacherExamPreview = () => {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [exam, setExam] = useState<ExamPaper | null>(null);
  const [showAnswers, setShowAnswers] = useState(true); // 是否显示答案
  const [generating, setGenerating] = useState(false); // PDF生成中
  const pdfContentRef = useRef<HTMLDivElement>(null);
  const [examInfo, setExamInfo] = useState({
    school: '',
    grade: '',
    className: '',
    studentName: '',
    examTime: '60分钟'
  });

  useEffect(() => {
    if (examId) {
      fetchExamDetail(parseInt(examId));
    }
  }, [examId]);

  const fetchExamDetail = async (id: number) => {
    try {
      setLoading(true);
      const data = await getExamDetail(id);
      setExam(data);
    } catch (error) {
      console.error('获取试卷失败:', error);
      toast.error('获取试卷失败,请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const getQuestionTypeIcon = (type: string) => {
    switch (type) {
      case 'choice': return '📝';
      case 'cloze_test': return '📄';
      case 'fill_blank': return '📋';
      case 'spelling': return '✍️';
      case 'reading': return '📖';
      case 'judgment': return '✔️';
      default: return '📚';
    }
  };

  const getQuestionTypeName = (type: string) => {
    switch (type) {
      case 'choice': return '选择题';
      case 'cloze_test': return '完形填空';
      case 'fill_blank': return '填空题';
      case 'spelling': return '拼写题';
      case 'reading': return '阅读理解';
      case 'judgment': return '判断题';
      default: return type;
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!pdfContentRef.current || !exam) return;

    try {
      setGenerating(true);

      // 临时显示答案页
      const answerPages = pdfContentRef.current.querySelectorAll('.pdf-show');
      answerPages.forEach(el => {
        (el as HTMLElement).style.display = 'block';
      });

      // 临时隐藏在线预览专用元素
      const onlineOnly = pdfContentRef.current.querySelectorAll('.print\\:hidden');
      onlineOnly.forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });

      // PDF配置选项
      const options = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename: `${exam.title}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.95 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          scrollY: 0,
          scrollX: 0,
          windowWidth: 1000,
        },
        jsPDF: {
          unit: 'mm' as const,
          format: 'a4' as const,
          orientation: 'portrait' as const,
          compress: true
        },
        pagebreak: {
          mode: ['avoid-all', 'css', 'legacy'],
          before: '.page-break-before',
          avoid: '.print\\:break-inside-avoid'
        }
      };

      // 生成PDF
      await html2pdf().set(options).from(pdfContentRef.current).save();

      // 恢复原始显示状态
      answerPages.forEach(el => {
        (el as HTMLElement).style.display = 'none';
      });
      onlineOnly.forEach(el => {
        (el as HTMLElement).style.display = '';
      });

    } catch (error) {
      console.error('生成PDF失败:', error);
      toast.error('生成PDF失败,请稍后重试');

      // 确保恢复显示状态
      if (pdfContentRef.current) {
        const answerPages = pdfContentRef.current.querySelectorAll('.pdf-show');
        answerPages.forEach(el => {
          (el as HTMLElement).style.display = 'none';
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadTXT = () => {
    // TXT下载功能
    const content = generateTextContent();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exam?.title}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 按题型分组题目
  const groupQuestionsByType = () => {
    if (!exam) return {};

    const grouped: Record<string, ExamQuestion[]> = {};
    exam.questions.forEach(q => {
      if (!grouped[q.question_type]) {
        grouped[q.question_type] = [];
      }
      grouped[q.question_type].push(q);
    });

    // 按指定顺序排序(符合标准试卷格式)
    const typeOrder = ['choice', 'cloze_test', 'fill_blank', 'spelling', 'reading', 'judgment'];
    const sorted: Record<string, ExamQuestion[]> = {};
    typeOrder.forEach(type => {
      if (grouped[type]) {
        sorted[type] = grouped[type];
      }
    });

    return sorted;
  };

  const generateTextContent = () => {
    if (!exam) return '';

    const grouped = groupQuestionsByType();
    let content = `==========================================\n`;
    content += `           ${exam.title}\n`;
    content += `==========================================\n\n`;
    content += `学校:__________  年级:______  班级:______\n`;
    content += `姓名:__________  学号:______  得分:______\n`;
    content += `考试时间:60分钟  总分:${exam.total_score}分\n\n`;
    content += `------------------------------------------\n\n`;

    let questionNum = 1;
    Object.entries(grouped).forEach(([type, questions]) => {
      const typeName = getQuestionTypeName(type);
      const totalScore = questions.reduce((sum, q) => sum + q.score, 0);

      content += `${Object.keys(grouped).indexOf(type) + 1}. ${typeName}(共${questions.length}题,每题${questions[0].score}分,共${totalScore}分)\n\n`;

      questions.forEach((q) => {
        content += `${questionNum}. ${q.content}\n`;

        if (q.passage) {
          content += `   ${q.passage}\n`;
        }

        if (q.options && q.options.length > 0) {
          q.options.forEach(opt => {
            content += `   ${opt.key}. ${opt.text}\n`;
          });
        }

        content += `\n`;
        questionNum++;
      });

      content += `\n`;
    });

    // 答案部分
    content += `\n==========================================\n`;
    content += `                 参考答案\n`;
    content += `==========================================\n\n`;

    questionNum = 1;
    Object.entries(grouped).forEach(([type, questions]) => {
      content += `${getQuestionTypeName(type)}:\n`;
      questions.forEach((q) => {
        content += `${questionNum}. ${q.correct_answer}`;
        if (q.explanation) {
          content += ` (${q.explanation})`;
        }
        content += `\n`;
        questionNum++;
      });
      content += `\n`;
    });

    return content;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">加载试卷中...</p>
        </div>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <span className="text-6xl mb-4 block">😕</span>
          <p className="text-gray-500">未找到试卷</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* 顶部工具栏 */}
      <div className="bg-white shadow-sm sticky top-0 z-10 print:hidden">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-gray-600 hover:text-primary transition"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>返回</span>
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowAnswers(!showAnswers)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition ${
                  showAnswers
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                }`}
              >
                <CheckCircle className="w-4 h-4" />
                {showAnswers ? '隐藏答案' : '显示答案'}
              </button>
              <button
                onClick={handleDownloadPDF}
                disabled={generating}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                {generating ? '生成中...' : '下载PDF'}
              </button>
              <button
                onClick={handleDownloadTXT}
                className="flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition"
              >
                <Download className="w-4 h-4" />
                下载TXT
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition"
              >
                <Printer className="w-4 h-4" />
                打印
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* PDF内容容器 */}
      <div ref={pdfContentRef} className="max-w-5xl mx-auto px-4 py-8">
        {/* 标准试卷头部 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-8 shadow-lg mb-8 print:shadow-none print:rounded-none"
        >
          {/* 试卷标题 */}
          <div className="text-center border-b-2 border-gray-800 pb-4 mb-6">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">{exam.title}</h1>
            {exam.description && (
              <p className="text-gray-600 text-sm">{exam.description}</p>
            )}
          </div>

          {/* 考试信息栏 */}
          <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">学校:</span>
                <span className="flex-1 border-b border-dotted border-gray-400 pb-1">_______________</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">班级:</span>
                <span className="flex-1 border-b border-dotted border-gray-400 pb-1">_______________</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">姓名:</span>
                <span className="flex-1 border-b border-dotted border-gray-400 pb-1">_______________</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">年级:</span>
                <span className="flex-1 border-b border-dotted border-gray-400 pb-1">_______________</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">学号:</span>
                <span className="flex-1 border-b border-dotted border-gray-400 pb-1">_______________</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">得分:</span>
                <span className="flex-1 border-b border-dotted border-gray-400 pb-1">_______________</span>
              </div>
            </div>
          </div>

          {/* 考试说明 */}
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">考试时间:</span>
                <span className="text-gray-900">60分钟</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">满分:</span>
                <span className="text-gray-900 font-bold">{exam.total_score}分</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">题目总数:</span>
                <span className="text-gray-900">{exam.questions.length}题</span>
              </div>
            </div>
          </div>

          {/* 题型说明 (不打印显示) */}
          <div className="print:hidden mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-700">题型分布:</h3>
              {exam.generated_by_ai && (
                <span className="flex items-center gap-1 text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded">
                  <CheckCircle className="w-3 h-3" />
                  AI智能生成
                </span>
              )}
            </div>
            <div className="grid grid-cols-5 gap-3">
              {Object.entries(groupQuestionsByType()).map(([type, questions]) => {
                const totalScore = questions.reduce((sum, q) => sum + q.score, 0);
                return (
                  <div key={type} className="text-center p-3 bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg border border-blue-100">
                    <div className="text-2xl mb-1">{getQuestionTypeIcon(type)}</div>
                    <div className="text-xs text-gray-600 mb-1">{getQuestionTypeName(type)}</div>
                    <div className="text-sm font-bold text-gray-800">{questions.length}题 · {totalScore}分</div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        {/* 按题型分组显示题目 */}
        <div className="space-y-8">
          {Object.entries(groupQuestionsByType()).map(([type, questions], sectionIndex) => {
            const totalScore = questions.reduce((sum, q) => sum + q.score, 0);
            const sectionNumber = sectionIndex + 1;

            // 完形填空特殊处理:只显示一次短文
            if (type === 'cloze_test' && questions.length > 0 && questions[0].blanks) {
              const clozeQuestion = questions[0];
              return (
                <motion.div
                  key={type}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * sectionIndex }}
                  className="bg-white rounded-2xl p-8 shadow-lg print:shadow-none print:rounded-none print:break-inside-avoid"
                >
                  {/* 题型标题 */}
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b-2 border-gray-800">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-gray-900">{sectionNumber}.</span>
                      <span className="text-xl">{getQuestionTypeIcon(type)}</span>
                      <h2 className="text-2xl font-bold text-gray-900">{getQuestionTypeName(type)}</h2>
                    </div>
                    <span className="text-sm text-gray-600">
                      (共{clozeQuestion.blanks.length}题,每题{clozeQuestion.blanks[0].score}分,共{totalScore}分)
                    </span>
                  </div>

                  {/* 完形填空短文 */}
                  <div className="mb-6 p-6 bg-amber-50 rounded-lg border border-amber-200 print:bg-transparent print:border print:border-gray-400">
                    <div className="text-sm font-medium text-amber-700 mb-3 print:text-gray-900">
                      📄 阅读下面短文,从每题所给的选项中选出最佳答案:
                    </div>
                    <div className="text-gray-800 leading-loose text-base whitespace-pre-wrap">
                      {clozeQuestion.passage}
                    </div>
                  </div>

                  {/* 完形填空题目列表 */}
                  <div className="space-y-4">
                    {clozeQuestion.blanks.map((blank, index) => (
                      <div key={index} className="print:break-inside-avoid">
                        <div className="flex gap-3">
                          <span className="font-bold text-gray-900 flex-shrink-0">
                            {clozeQuestion.question_number + index}.
                          </span>
                          <div className="flex-1">
                            <div className="text-base text-gray-900 mb-3">
                              空 {blank.blank_number}
                            </div>

                            {/* 选项 */}
                            <div className="space-y-2 ml-4">
                              {blank.options.map((option, optIndex) => (
                                <div key={optIndex} className="flex items-start gap-2">
                                  <span className="font-medium text-gray-700">{option.key}.</span>
                                  <span className="text-gray-800">{option.text}</span>
                                </div>
                              ))}
                            </div>

                            {/* 答案和解析 */}
                            {showAnswers && (
                              <div className="mt-3 pt-3 border-t border-gray-200 print:hidden">
                                <div className="flex items-start gap-6 text-sm">
                                  <div>
                                    <span className="font-bold text-green-700">✓ 答案:</span>
                                    <span className="ml-2 text-gray-900 font-medium">{blank.correct_answer}</span>
                                  </div>
                                  {blank.explanation && (
                                    <div className="flex-1">
                                      <span className="font-bold text-blue-700">💡 解析:</span>
                                      <span className="ml-2 text-gray-600">{blank.explanation}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              );
            }

            // 阅读理解特殊处理:按passage_id分组
            if (type === 'reading') {
              const passageGroups: Record<string, typeof questions> = {};
              questions.forEach(q => {
                const pid = q.passage_id || 'default';
                if (!passageGroups[pid]) {
                  passageGroups[pid] = [];
                }
                passageGroups[pid].push(q);
              });

              return (
                <motion.div
                  key={type}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * sectionIndex }}
                  className="bg-white rounded-2xl p-8 shadow-lg print:shadow-none print:rounded-none print:break-inside-avoid"
                >
                  {/* 题型标题 */}
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b-2 border-gray-800">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-gray-900">{sectionNumber}.</span>
                      <span className="text-xl">{getQuestionTypeIcon(type)}</span>
                      <h2 className="text-2xl font-bold text-gray-900">{getQuestionTypeName(type)}</h2>
                    </div>
                    <span className="text-sm text-gray-600">
                      (共{questions.length}题,每题{questions[0].score}分,共{totalScore}分)
                    </span>
                  </div>

                  {/* 按文章分组显示 */}
                  <div className="space-y-8">
                    {Object.entries(passageGroups).map(([passageId, passageQuestions], pIndex) => {
                      const firstQuestion = passageQuestions[0];
                      return (
                        <div key={passageId} className="print:break-inside-avoid">
                          {/* 文章标题和内容 */}
                          {firstQuestion.passage && (
                            <div className="mb-4 p-6 bg-blue-50 rounded-lg border border-blue-200 print:bg-transparent print:border print:border-gray-400">
                              {firstQuestion.passage_title && (
                                <div className="text-lg font-bold text-blue-900 mb-3 print:text-gray-900">
                                  📖 {firstQuestion.passage_title}
                                </div>
                              )}
                              <div className="text-gray-800 leading-relaxed text-base whitespace-pre-wrap">
                                {firstQuestion.passage}
                              </div>
                            </div>
                          )}

                          {/* 该文章的问题列表 */}
                          <div className="space-y-4 ml-4">
                            {passageQuestions.map((question, qIndex) => (
                              <div key={qIndex} className="print:break-inside-avoid">
                                <div className="flex gap-3">
                                  <span className="font-bold text-gray-900 flex-shrink-0">
                                    {question.question_number}.
                                  </span>
                                  <div className="flex-1">
                                    {/* 题干 */}
                                    <div className="text-base text-gray-900 mb-3 leading-relaxed">
                                      {question.content}
                                    </div>

                                    {/* 选项 */}
                                    {question.options && question.options.length > 0 && (
                                      <div className="space-y-2 ml-4">
                                        {question.options.map((option, optIndex) => (
                                          <div key={optIndex} className="flex items-start gap-2">
                                            <span className="font-medium text-gray-700">{option.key}.</span>
                                            <span className="text-gray-800">{option.text}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* 答案和解析 */}
                                    {showAnswers && (
                                      <div className="mt-3 pt-3 border-t border-gray-200 print:hidden">
                                        <div className="flex items-start gap-6 text-sm">
                                          <div>
                                            <span className="font-bold text-green-700">✓ 答案:</span>
                                            <span className="ml-2 text-gray-900 font-medium">{question.correct_answer}</span>
                                          </div>
                                          {question.explanation && (
                                            <div className="flex-1">
                                              <span className="font-bold text-blue-700">💡 解析:</span>
                                              <span className="ml-2 text-gray-600">{question.explanation}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              );
            }

            // 其他题型:常规显示
            return (
              <motion.div
                key={type}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * sectionIndex }}
                className="bg-white rounded-2xl p-8 shadow-lg print:shadow-none print:rounded-none print:break-inside-avoid"
              >
                {/* 题型标题 */}
                <div className="flex items-center gap-3 mb-6 pb-4 border-b-2 border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-gray-900">{sectionNumber}.</span>
                    <span className="text-xl">{getQuestionTypeIcon(type)}</span>
                    <h2 className="text-2xl font-bold text-gray-900">{getQuestionTypeName(type)}</h2>
                  </div>
                  <span className="text-sm text-gray-600">
                    (共{questions.length}题,每题{questions[0].score}分,共{totalScore}分)
                  </span>
                </div>

                {/* 题目列表 */}
                <div className="space-y-6">
                  {questions.map((question, qIndex) => (
                    <div key={qIndex} className="print:break-inside-avoid">
                      {/* 题号和题干 */}
                      <div className="flex gap-3">
                        <span className="font-bold text-gray-900 flex-shrink-0">
                          {question.question_number}.
                        </span>
                        <div className="flex-1">
                          {/* 题干 */}
                          <div className="text-base text-gray-900 mb-3 leading-relaxed">
                            {question.content}
                          </div>

                          {/* 选项 */}
                          {question.options && question.options.length > 0 && (
                            <div className="space-y-2 ml-4">
                              {question.options.map((option, optIndex) => (
                                <div key={optIndex} className="flex items-start gap-2">
                                  <span className="font-medium text-gray-700">{option.key}.</span>
                                  <span className="text-gray-800">{option.text}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* 答题区域 (填空和拼写题) */}
                          {(type === 'fill_blank' || type === 'spelling') && !showAnswers && (
                            <div className="mt-3 ml-4">
                              <span className="text-gray-600">答:</span>
                              <span className="inline-block border-b-2 border-gray-400 ml-2 min-w-[200px]"></span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 答案和解析 (可切换显示) */}
                      {showAnswers && (
                        <div className="mt-3 ml-6 pt-3 border-t border-gray-200 print:hidden">
                          <div className="flex items-start gap-6 text-sm">
                            <div>
                              <span className="font-bold text-green-700">✓ 答案:</span>
                              <span className="ml-2 text-gray-900 font-medium">{question.correct_answer}</span>
                            </div>
                            {question.explanation && (
                              <div className="flex-1">
                                <span className="font-bold text-blue-700">💡 解析:</span>
                                <span className="ml-2 text-gray-600">{question.explanation}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* 参考答案页 (PDF和打印时显示) */}
        <div className="pdf-show print:block mt-16 page-break-before" style={{ display: 'none' }}>
          <div className="bg-white p-8">
            <div className="text-center border-b-2 border-gray-800 pb-4 mb-8">
              <h2 className="text-3xl font-bold text-gray-900">参考答案</h2>
              <p className="text-sm text-gray-600 mt-2">{exam.title}</p>
            </div>

            <div className="space-y-6">
              {Object.entries(groupQuestionsByType()).map(([type, questions], index) => (
                <div key={type} className="mb-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-300">
                    {index + 1}. {getQuestionTypeName(type)}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {questions.map((question) => (
                      <div key={question.question_number} className="flex items-start gap-2">
                        <span className="font-medium text-gray-700">{question.question_number}.</span>
                        <div className="flex-1">
                          <span className="text-gray-900 font-medium">{question.correct_answer}</span>
                          {question.explanation && (
                            <span className="text-gray-600 text-sm ml-2">({question.explanation})</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 底部提示 (不打印) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 p-6 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-2xl border border-yellow-200 print:hidden"
        >
          <p className="text-sm text-yellow-800">
            💡 <strong>温馨提示:</strong> 本试卷由AI根据学生的学习薄弱点智能生成,建议根据学生实际情况适当调整难度和题量。点击"下载PDF"可生成完整试卷(含答案页)。
          </p>
        </motion.div>
      </div>

      {/* PDF生成进度提示 */}
      {generating && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 mb-4">
                <Download className="w-8 h-8 text-white animate-bounce" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">正在生成PDF</h3>
              <p className="text-gray-600 mb-4">请稍候,正在将试卷转换为PDF格式...</p>

              {/* 加载动画 */}
              <div className="flex items-center justify-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-3 h-3 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>

              <div className="mt-6 text-sm text-gray-500">
                <p>✓ 正在渲染试卷内容</p>
                <p>✓ 正在生成答案页</p>
                <p>✓ 正在优化PDF格式</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 打印和PDF样式 */}
      <style>{`
        @media print {
          body {
            background: white !important;
          }
          .page-break-before {
            page-break-before: always;
          }
          .pdf-show {
            display: block !important;
          }
          @page {
            margin: 2cm;
            size: A4;
          }
        }

        /* PDF生成时的样式 */
        .pdf-content {
          background: white;
        }
        .pdf-content .pdf-show {
          display: block !important;
        }
      `}</style>
    </div>
  );
};

export default TeacherExamPreview;
