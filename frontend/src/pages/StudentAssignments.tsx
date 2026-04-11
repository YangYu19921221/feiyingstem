import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getMyAssignments } from '../api/assignments';
import type { StudentBookAssignmentResponse } from '../api/assignments';
import { toast } from '../components/Toast';

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
      toast.error(error.response?.data?.detail || '加载失败');
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
        className: 'bg-success text-white',
        emoji: '✅',
      };
    } else if (assignment.progress_percentage > 0) {
      return {
        label: '进行中',
        className: 'bg-accent text-white',
        emoji: '📚',
      };
    } else {
      return {
        label: '未开始',
        className: 'bg-secondary text-gray-800',
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
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <div className="bg-white shadow-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors mr-3"
          >
            <svg
              className="w-6 h-6 text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h1 className="text-2xl font-bold text-gray-800">📋 我的作业</h1>
        </div>
      </div>

      {/* 主内容区 */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {assignments.length === 0 ? (
          // 空状态
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16"
          >
            <div className="text-8xl mb-6">📭</div>
            <h2 className="text-2xl font-bold text-gray-700 mb-2">还没有分配的作业</h2>
            <p className="text-gray-500">老师分配作业后会显示在这里</p>
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
                  className={`bg-gradient-to-br ${getCardGradient(index)} rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-shadow`}
                >
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

                    {assignment.book_description && (
                      <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                        {assignment.book_description}
                      </p>
                    )}

                    {/* 教师信息 */}
                    <div className="flex items-center mb-4 text-sm text-gray-700">
                      <span className="mr-2">👨‍🏫</span>
                      <span>{assignment.teacher_name}</span>
                    </div>

                    {/* 日期信息 */}
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center text-sm text-gray-600">
                        <span className="mr-2">📅</span>
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

                    {/* 单元和单词统计 */}
                    <div className="flex items-center justify-between mb-4 text-sm">
                      <div className="flex items-center text-gray-700">
                        <span className="mr-1">📚</span>
                        <span>{assignment.unit_count} 个单元</span>
                      </div>
                      <div className="flex items-center text-gray-700">
                        <span className="mr-1">📝</span>
                        <span>{assignment.word_count} 个单词</span>
                      </div>
                    </div>

                    {/* 开始学习按钮 */}
                    <button
                      onClick={() => navigate(`/student/books/${assignment.book_id}/units`)}
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
