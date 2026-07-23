import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, BookOpenText, CalendarDays, ClipboardList, GraduationCap } from 'lucide-react';
import { getMyAssignments } from '../api/assignments';
import type { StudentBookAssignmentResponse } from '../api/assignments';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

const StudentAssignments = () => {
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<StudentBookAssignmentResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAssignments();
  }, []);

  const loadAssignments = async () => {
    try {
      setLoading(true);
      const data = await getMyAssignments();
      setAssignments(data);
    } catch (error: any) {
      console.error('加载作业失败:', error);
      toast.error(getErrorMessage(error, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  // 计算截止日期剩余天数
  const getDaysUntilDeadline = (deadline?: string): number | null => {
    if (!deadline) return null;
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const diffTime = deadlineDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // 格式化日期显示
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // 获取完成状态配置
  const getStatusConfig = (assignment: StudentBookAssignmentResponse) => {
    if (assignment.is_completed) {
      return {
        label: '已完成',
        className: 'bg-emerald-500 text-white',
        emoji: '✅',
      };
    } else if (assignment.progress_percentage > 0) {
      return {
        label: '进行中',
        className: 'bg-cyan-500 text-white',
        emoji: '📚',
      };
    } else {
      return {
        label: '未开始',
        className: 'bg-amber-100 text-amber-800',
        emoji: '🆕',
      };
    }
  };

  // 根据难度获取卡片渐变色
  const getCardGradient = (index: number): string => {
    const gradients = [
      'from-orange-100 via-orange-50 to-yellow-50',
      'from-blue-100 via-blue-50 to-cyan-50',
      'from-pink-100 via-pink-50 to-purple-50',
      'from-green-100 via-green-50 to-teal-50',
      'from-yellow-100 via-yellow-50 to-orange-50',
    ];
    return gradients[index % gradients.length];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部导航 */}
      <div className="border-b border-slate-200/80 bg-white/85 shadow-sm backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center">
          <button
            onClick={() => navigate(-1)}
            className="mr-3 rounded-lg p-2 text-slate-500 transition hover:bg-orange-50 hover:text-orange-600"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-800">我的作业</h1>
              <p className="text-xs text-slate-500">按老师布置的范围完成学习</p>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {assignments.length === 0 ? (
          // 空状态
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-soft rounded-2xl border-dashed py-16"
          >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
              <ClipboardList className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-bold text-slate-700 mb-2">还没有分配的作业</h2>
            <p className="text-sm text-slate-500">老师分配作业后会显示在这里</p>
          </motion.div>
        ) : (
          // 作业卡片网格
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {assignments.map((assignment, index) => {
              const statusConfig = getStatusConfig(assignment);
              const daysUntilDeadline = getDaysUntilDeadline(assignment.deadline);
              const isUrgent = daysUntilDeadline !== null && daysUntilDeadline <= 3 && daysUntilDeadline >= 0;
              const isOverdue = daysUntilDeadline !== null && daysUntilDeadline < 0;

              return (
                <motion.div
                  key={assignment.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`group card-soft bg-gradient-to-br ${getCardGradient(index)} rounded-2xl overflow-hidden hover:shadow-xl transition-shadow`}
                >
                  <div className="relative h-24 overflow-hidden bg-orange-100/60">
                    <img
                      src={`/book-cover-${(assignment.book_id % 4) + 1}.jpeg`}
                      alt=""
                      className="h-full w-full object-cover opacity-85 transition duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
                    <span className="absolute bottom-3 left-5 inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                      <BookOpenText className="h-3.5 w-3.5" /> 学习任务
                    </span>
                  </div>
                  {/* 卡片头部 */}
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-xl font-bold text-gray-800 flex-1">
                        {assignment.book_name}
                      </h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusConfig.className}`}>
                        {statusConfig.emoji} {statusConfig.label}
                      </span>
                    </div>

                    {/* 分配范围徽章:整本 / 单元 / 分组 */}
                    <div className="mb-3">
                      {assignment.scope_type === 'unit' || assignment.scope_type === 'group' ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white/70 text-sm font-semibold text-orange-600 border border-orange-200">
                          📖 Unit {assignment.unit_number ?? '?'}
                          {assignment.unit_name ? ` · ${assignment.unit_name}` : ''}
                          {assignment.scope_type === 'group' && assignment.group_index
                            ? ` · 第 ${assignment.group_index} 组`
                            : ''}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white/70 text-sm font-semibold text-gray-600 border border-gray-200">
                          📕 整本书
                        </span>
                      )}
                    </div>

                    {assignment.book_description && (
                      <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                        {assignment.book_description}
                      </p>
                    )}

                    {/* 教师信息 */}
                    <div className="flex items-center mb-4 text-sm text-gray-700">
                      <GraduationCap className="mr-2 h-4 w-4 text-orange-500" />
                      <span>{assignment.teacher_name}</span>
                    </div>

                    {/* 日期信息 */}
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center text-sm text-gray-600">
                        <CalendarDays className="mr-2 h-4 w-4 text-slate-400" />
                        <span>分配于: {formatDate(assignment.assigned_at)}</span>
                      </div>
                      {assignment.deadline && (
                        <div className={`flex items-center text-sm ${isOverdue ? 'text-error' : isUrgent ? 'text-orange-600 font-semibold' : 'text-gray-600'}`}>
                          <span className="mr-2">{isOverdue ? '⚠️' : isUrgent ? '⏰' : '🗓️'}</span>
                          <span>
                            截止于: {formatDate(assignment.deadline)}
                            {daysUntilDeadline !== null && (
                              <>
                                {isOverdue ? (
                                  <span className="ml-2 text-error font-bold">已逾期</span>
                                ) : isUrgent ? (
                                  <span className="ml-2 text-error font-bold">
                                    (还剩 {daysUntilDeadline} 天!)
                                  </span>
                                ) : (
                                  <span className="ml-2 text-gray-500">
                                    (还剩 {daysUntilDeadline} 天)
                                  </span>
                                )}
                              </>
                            )}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 进度条 */}
                    <div className="mb-4">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-semibold text-gray-700">学习进度</span>
                        <span className="text-sm font-bold text-primary">
                          {assignment.progress_percentage}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${assignment.progress_percentage}%` }}
                          transition={{ duration: 0.8, delay: index * 0.1 + 0.3 }}
                          className="bg-gradient-to-r from-primary to-secondary h-full rounded-full"
                        />
                      </div>
                    </div>

                    {/* 单元和单词统计(按分配范围口径) */}
                    <div className="flex items-center justify-between mb-4 text-sm">
                      <div className="flex items-center text-gray-700">
                        <span className="mr-1">📚</span>
                        <span>
                          {assignment.scope_type === 'unit' || assignment.scope_type === 'group'
                            ? '指定范围'
                            : `${assignment.unit_count} 个单元`}
                        </span>
                      </div>
                      <div className="flex items-center text-gray-700">
                        <span className="mr-1">📝</span>
                        <span>{assignment.word_count} 个单词</span>
                      </div>
                    </div>

                    {/* 开始学习按钮 */}
                    <button
                      onClick={() => navigate(
                        assignment.unit_id
                          ? `/student/books/${assignment.book_id}/units?focus=${assignment.unit_id}`
                          : `/student/books/${assignment.book_id}/units`
                      )}
                      disabled={assignment.is_completed}
                      className={`w-full py-3 rounded-xl font-semibold transition-all transform hover:scale-105 ${
                        assignment.is_completed
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : isUrgent || isOverdue
                          ? 'bg-gradient-to-r from-error to-orange-500 text-white shadow-md hover:shadow-lg'
                          : 'bg-gradient-to-r from-primary to-secondary text-white shadow-md hover:shadow-lg'
                      }`}
                    >
                      {assignment.is_completed ? '✅ 已完成' : isUrgent || isOverdue ? '⚡ 紧急!开始学习' : '🚀 开始学习'}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentAssignments;
