import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from '../components/Toast';
import { getTeacherPassageDetail, assignReading, getPassageAssignments } from '../api/reading';
import type { ReadingPassageDetail } from '../api/reading';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface Student {
  id: number;
  username: string;
  full_name: string;
  email: string;
}

const TeacherReadingAssign = () => {
  const { passageId } = useParams<{ passageId: string }>();
  const navigate = useNavigate();

  const [passage, setPassage] = useState<ReadingPassageDetail | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    deadline: '',
    min_score: '',
    max_attempts: 3,
  });

  useEffect(() => {
    loadData();
  }, [passageId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');

      // 加载文章详情
      const passageData = await getTeacherPassageDetail(Number(passageId));
      setPassage(passageData);

      // 加载学生列表
      const studentsRes = await axios.get(`${API_BASE_URL}/auth/students`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStudents(studentsRes.data);

      // 加载已分配的作业
      const assignmentsData = await getPassageAssignments(Number(passageId));
      setAssignments(assignmentsData);
    } catch (error) {
      console.error('加载失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleStudent = (studentId: number) => {
    if (selectedStudents.includes(studentId)) {
      setSelectedStudents(selectedStudents.filter((id) => id !== studentId));
    } else {
      setSelectedStudents([...selectedStudents, studentId]);
    }
  };

  const handleAssign = async () => {
    if (selectedStudents.length === 0) {
      toast.warning('请至少选择一个学生');
      return;
    }

    try {
      setSubmitting(true);
      await assignReading({
        passage_id: Number(passageId),
        student_ids: selectedStudents,
        deadline: formData.deadline || undefined,
        min_score: formData.min_score ? Number(formData.min_score) : undefined,
        max_attempts: formData.max_attempts,
      });

      toast.success('分配成功！');
      setSelectedStudents([]);
      await loadData();
    } catch (error: any) {
      console.error('分配失败:', error);
      toast.error(error.response?.data?.detail || '分配失败');
    } finally {
      setSubmitting(false);
    }
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

  if (!passage) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航 */}
      <nav className="bg-white shadow-sm mb-6">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/teacher/reading')}
              className="text-gray-600 hover:text-gray-800 transition"
            >
              ← 返回
            </button>
            <h1 className="text-2xl font-bold text-gray-800">布置阅读作业</h1>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧:文章信息和设置 */}
          <div>
            {/* 文章信息 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-md p-6 mb-6"
            >
              <h2 className="text-xl font-bold text-gray-800 mb-4">📖 文章信息</h2>
              <div className="space-y-2 text-sm">
                <p><span className="font-medium">标题:</span> {passage.title}</p>
                <p><span className="font-medium">难度:</span> ⭐ {passage.difficulty}</p>
                <p><span className="font-medium">单词数:</span> {passage.word_count} 词</p>
                <p><span className="font-medium">题目数:</span> {passage.questions.length} 题</p>
              </div>
            </motion.div>

            {/* 作业设置 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-2xl shadow-md p-6"
            >
              <h2 className="text-xl font-bold text-gray-800 mb-4">⚙️ 作业设置</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    截止时间 (可选)
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.deadline}
                    onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    最低分要求 (可选)
                  </label>
                  <input
                    type="number"
                    value={formData.min_score}
                    onChange={(e) => setFormData({ ...formData, min_score: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary"
                    placeholder="如: 60"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    最多尝试次数
                  </label>
                  <input
                    type="number"
                    value={formData.max_attempts}
                    onChange={(e) => setFormData({ ...formData, max_attempts: Number(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg outline-none focus:border-primary"
                    min={1}
                  />
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleAssign}
                disabled={submitting}
                className={`w-full mt-6 py-3 rounded-lg font-medium text-white transition ${
                  submitting
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:shadow-lg'
                }`}
              >
                {submitting ? '分配中...' : `📌 分配给 ${selectedStudents.length} 名学生`}
              </motion.button>
            </motion.div>
          </div>

          {/* 右侧:学生列表和已分配情况 */}
          <div>
            {/* 学生选择 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl shadow-md p-6 mb-6"
            >
              <h2 className="text-xl font-bold text-gray-800 mb-4">👥 选择学生</h2>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {students.map((student) => {
                  const isAssigned = assignments.some((a) => a.student_id === student.id);
                  return (
                    <label
                      key={student.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition ${
                        selectedStudents.includes(student.id)
                          ? 'border-primary bg-primary/5'
                          : 'border-gray-200 hover:border-primary/30'
                      } ${isAssigned ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedStudents.includes(student.id)}
                        onChange={() => toggleStudent(student.id)}
                        disabled={isAssigned}
                        className="w-5 h-5 text-primary focus:ring-primary rounded"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{student.full_name}</div>
                        <div className="text-xs text-gray-500">{student.username}</div>
                      </div>
                      {isAssigned && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                          已分配
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </motion.div>

            {/* 已分配列表 */}
            {assignments.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-white rounded-2xl shadow-md p-6"
              >
                <h2 className="text-xl font-bold text-gray-800 mb-4">📊 完成情况</h2>

                <div className="space-y-3">
                  {assignments.map((assignment) => (
                    <div
                      key={assignment.assignment_id}
                      className="border border-gray-200 rounded-lg p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-gray-800">{assignment.student_name}</div>
                        {assignment.is_completed ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                            ✅ 已完成
                          </span>
                        ) : (
                          <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
                            ⏳ 进行中
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 space-y-1">
                        <p>尝试次数: {assignment.attempts_count}/{assignment.max_attempts}</p>
                        {assignment.best_score !== null && (
                          <p>最高分: {assignment.best_score} 分</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TeacherReadingAssign;
