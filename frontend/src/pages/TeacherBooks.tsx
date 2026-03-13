import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getTeacherWordBooks } from '../api/teacher';
import type { TeacherWordBook } from '../api/teacher';
import { BookOpen, Plus, Settings, X, Trash2 } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface NewBookForm {
  name: string;
  description: string;
  grade_level: string;
  cover_color: string;
}

const TeacherBooks = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);
  const [books, setBooks] = useState<TeacherWordBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<number[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [newBook, setNewBook] = useState<NewBookForm>({
    name: '',
    description: '',
    grade_level: '小学',
    cover_color: '#FF6B35'
  });
  const hasLoadedOnce = useRef(false); // 使用ref避免触发重新渲染

  const coverColors = [
    { name: '橙色', color: '#FF6B35' },
    { name: '蓝色', color: '#4ECDC4' },
    { name: '紫色', color: '#9B59B6' },
    { name: '绿色', color: '#2ECC71' },
    { name: '红色', color: '#E74C3C' },
    { name: '黄色', color: '#F39C12' },
  ];

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }

    loadBooks();
  }, []);

  const loadBooks = async () => {
    try {
      setLoading(true);
      const data = await getTeacherWordBooks();
      setBooks(data);
    } catch (error) {
      console.error('加载单词本失败:', error);
      alert('加载单词本失败,请重试');
    } finally {
      setLoading(false);
      hasLoadedOnce.current = true; // 标记已加载,不触发渲染
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleManageUnits = (bookId: number) => {
    navigate(`/teacher/books/${bookId}/units`);
  };

  const handleCreateBook = async () => {
    if (!newBook.name.trim()) {
      alert('请输入单词本名称');
      return;
    }

    try {
      const token = localStorage.getItem('access_token');
      await axios.post(
        `${API_BASE_URL}/words/books`,
        {
          name: newBook.name,
          description: newBook.description || null,
          grade_level: newBook.grade_level,
          is_public: true,
          cover_color: newBook.cover_color,
          word_ids: [] // 创建空单词本,后续添加单词
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      alert('单词本创建成功!');
      setShowCreateDialog(false);
      setNewBook({
        name: '',
        description: '',
        grade_level: '小学',
        cover_color: '#FF6B35'
      });
      loadBooks(); // 重新加载单词本列表
    } catch (error) {
      console.error('创建单词本失败:', error);
      alert('创建单词本失败,请重试');
    }
  };

  const toggleBookSelection = (bookId: number) => {
    setSelectedBooks(prev =>
      prev.includes(bookId)
        ? prev.filter(id => id !== bookId)
        : [...prev, bookId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedBooks.length === books.length) {
      setSelectedBooks([]);
    } else {
      setSelectedBooks(books.map(book => book.id));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedBooks.length === 0) {
      alert('请先选择要删除的单词本');
      return;
    }

    const confirmMsg = `确定要删除选中的 ${selectedBooks.length} 个单词本吗?此操作不可恢复!`;
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.post(
        `${API_BASE_URL}/words/books/batch-delete`,
        selectedBooks,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const { deleted_count, failed_count } = response.data;

      if (failed_count > 0) {
        alert(`删除完成!\n成功: ${deleted_count} 个\n失败: ${failed_count} 个`);
      } else {
        alert(`成功删除 ${deleted_count} 个单词本!`);
      }

      setSelectedBooks([]);
      setIsSelectionMode(false);
      loadBooks();
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败,请重试');
    }
  };

  const cancelSelection = () => {
    setSelectedBooks([]);
    setIsSelectionMode(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-primary" />
            <h1 className="text-xl font-bold text-gray-800">教师端 - 单词本管理</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/teacher/dashboard')}
              className="text-sm px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-md transition font-medium"
            >
              返回首页
            </button>
            <span className="text-sm text-gray-600">
              👨‍🏫 {user?.full_name || '教师'}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md transition"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 欢迎横幅 */}
        <motion.div
          initial={!hasLoadedOnce.current ? { opacity: 0, y: -20 } : false}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            👋 欢迎, {user?.full_name}!
          </h2>
          <p className="opacity-90">管理您的单词本和单元,为学生创建优质的学习内容</p>
        </motion.div>

        {/* 单词本列表 */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <BookOpen className="w-5 h-5" />
                我的单词本
              </h3>
              {isSelectionMode && books.length > 0 && (
                <button
                  onClick={toggleSelectAll}
                  className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition"
                >
                  {selectedBooks.length === books.length ? '取消全选' : '全选'}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {isSelectionMode ? (
                <>
                  <button
                    onClick={handleBatchDelete}
                    disabled={selectedBooks.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-5 h-5" />
                    删除选中 ({selectedBooks.length})
                  </button>
                  <button
                    onClick={cancelSelection}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium"
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  {books.length > 0 && (
                    <button
                      onClick={() => setIsSelectionMode(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium"
                    >
                      <Trash2 className="w-5 h-5" />
                      批量管理
                    </button>
                  )}
                  <button
                    onClick={() => setShowCreateDialog(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition font-medium shadow-md"
                  >
                    <Plus className="w-5 h-5" />
                    创建单词本
                  </button>
                </>
              )}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : books.length === 0 ? (
            <motion.div
              initial={!hasLoadedOnce.current ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              className="bg-white rounded-2xl p-12 text-center shadow-md"
            >
              <BookOpen className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-2">还没有创建单词本</p>
              <p className="text-sm text-gray-400 mb-4">点击上方"创建单词本"按钮开始</p>
            </motion.div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {books.map((book, index) => (
                <motion.div
                  key={book.id}
                  initial={!hasLoadedOnce.current ? { opacity: 0, y: 20 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={!hasLoadedOnce.current ? { delay: 0.1 * index } : {}}
                  className={`bg-white rounded-2xl p-6 shadow-md hover:shadow-lg transition group relative ${
                    isSelectionMode ? 'cursor-pointer' : 'cursor-pointer'
                  } ${
                    selectedBooks.includes(book.id) ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => {
                    if (isSelectionMode) {
                      toggleBookSelection(book.id);
                    } else {
                      handleManageUnits(book.id);
                    }
                  }}
                >
                  {/* 选择框 */}
                  {isSelectionMode && (
                    <div className="absolute top-4 right-4 z-10">
                      <input
                        type="checkbox"
                        checked={selectedBooks.includes(book.id)}
                        onChange={() => toggleBookSelection(book.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                      />
                    </div>
                  )}

                  {/* 封面色块 */}
                  <div
                    className="w-full h-32 rounded-xl mb-4 flex items-center justify-center text-white text-4xl relative"
                    style={{ background: book.cover_color }}
                  >
                    📖
                  </div>

                  {/* 单词本信息 */}
                  <h4 className="text-lg font-bold text-gray-800 mb-2 group-hover:text-primary transition">
                    {book.name}
                  </h4>

                  {book.description && (
                    <p className="text-sm text-gray-500 mb-3 line-clamp-2">{book.description}</p>
                  )}

                  {/* 标签 */}
                  {book.grade_level && (
                    <div className="flex items-center gap-2 mb-4">
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                        {book.grade_level}
                      </span>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  {!isSelectionMode && (
                    <div className="flex gap-2 pt-4 border-t">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleManageUnits(book.id);
                        }}
                        className="flex-1 py-2 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:shadow-md transition font-medium flex items-center justify-center gap-2"
                      >
                        <Settings className="w-4 h-4" />
                        管理单元
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* 快捷操作区 */}
        <motion.div
          initial={!hasLoadedOnce.current ? { opacity: 0, y: 20 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={!hasLoadedOnce.current ? { delay: 0.3 } : {}}
          className="bg-white rounded-2xl p-6 shadow-md"
        >
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>⚡</span> 快捷操作
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: '📖', title: '创建单词本', desc: '新建单词本', action: 'create' },
              { icon: '📝', title: '单词库', desc: '管理单词', route: '/teacher/words/list' },
              { icon: '👥', title: '学生管理', desc: '分配单词本', route: '/teacher/students' },
              { icon: '📊', title: '学习报告', desc: '查看统计', route: '/teacher/reports' },
            ].map((action, index) => (
              <motion.button
                key={action.title}
                initial={!hasLoadedOnce.current ? { opacity: 0, scale: 0.8 } : false}
                animate={{ opacity: 1, scale: 1 }}
                transition={!hasLoadedOnce.current ? { delay: 0.4 + 0.05 * index } : {}}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  if (action.action === 'create') {
                    setShowCreateDialog(true);
                  } else if (action.route) {
                    navigate(action.route);
                  }
                }}
                className="bg-gray-50 hover:bg-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition text-center"
              >
                <div className="text-3xl mb-2">{action.icon}</div>
                <h4 className="font-bold text-gray-800 text-sm mb-1">{action.title}</h4>
                <p className="text-xs text-gray-500">{action.desc}</p>
              </motion.button>
            ))}
          </div>
        </motion.div>
      </div>

      {/* 创建单词本对话框 */}
      <AnimatePresence>
        {showCreateDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowCreateDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl"
            >
              {/* 标题 */}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <BookOpen className="w-6 h-6 text-primary" />
                  创建单词本
                </h3>
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="text-gray-400 hover:text-gray-600 transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* 表单 */}
              <div className="space-y-4">
                {/* 单词本名称 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    单词本名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newBook.name}
                    onChange={(e) => setNewBook({ ...newBook, name: e.target.value })}
                    placeholder="例如: 小学英语词汇"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  />
                </div>

                {/* 描述 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    描述
                  </label>
                  <textarea
                    value={newBook.description}
                    onChange={(e) => setNewBook({ ...newBook, description: e.target.value })}
                    placeholder="描述这个单词本的内容..."
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition resize-none"
                  />
                </div>

                {/* 年级 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    年级
                  </label>
                  <select
                    value={newBook.grade_level}
                    onChange={(e) => setNewBook({ ...newBook, grade_level: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  >
                    <option value="小学">小学</option>
                    <option value="初中">初中</option>
                    <option value="高中">高中</option>
                  </select>
                </div>

                {/* 封面颜色 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    封面颜色
                  </label>
                  <div className="grid grid-cols-6 gap-2">
                    {coverColors.map((item) => (
                      <button
                        key={item.color}
                        onClick={() => setNewBook({ ...newBook, cover_color: item.color })}
                        className={`w-full h-10 rounded-lg transition ${
                          newBook.cover_color === item.color
                            ? 'ring-2 ring-offset-2 ring-primary scale-110'
                            : 'hover:scale-105'
                        }`}
                        style={{ backgroundColor: item.color }}
                        title={item.name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* 按钮 */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateBook}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:shadow-lg transition font-medium"
                >
                  创建
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeacherBooks;
