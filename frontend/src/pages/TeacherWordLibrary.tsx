import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Search, Filter, Edit2, Trash2, X, Plus, Sparkles, Upload } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface WordDefinition {
  id: number;
  part_of_speech: string;
  meaning: string;
  example_sentence: string | null;
  example_translation: string | null;
  is_primary: boolean;
}

interface WordItem {
  id: number;
  word: string;
  phonetic: string;
  syllables: string;
  difficulty: number;
  grade_level: string;
  definitions: WordDefinition[];
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface WordListItem {
  id: number;
  word: string;
  phonetic: string | null;
  difficulty: number;
  grade_level: string;
  primary_meaning: string | null;
}

const TeacherWordLibrary = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);
  const [words, setWords] = useState<WordListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingWord, setEditingWord] = useState<WordItem | null>(null);
  const [generatingPhonetic, setGeneratingPhonetic] = useState(false);
  const [selectedWords, setSelectedWords] = useState<number[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
    loadWords();
  }, []);

  const loadWords = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('access_token');
      const params: any = { limit: 100 };

      if (searchKeyword) params.search = searchKeyword;
      if (filterGrade) params.grade_level = filterGrade;
      if (filterDifficulty) params.difficulty = filterDifficulty;

      const response = await axios.get(`${API_BASE_URL}/words/`, {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });
      setWords(response.data);
    } catch (error) {
      console.error('加载单词失败:', error);
      alert('加载单词失败,请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    loadWords();
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleEdit = async (wordId: number) => {
    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/words/${wordId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setEditingWord(response.data);
      setShowEditDialog(true);
    } catch (error) {
      console.error('获取单词详情失败:', error);
      alert('获取单词详情失败');
    }
  };

  const handleDelete = async (wordId: number, word: string) => {
    if (!confirm(`确定要删除单词"${word}"吗?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('access_token');
      await axios.delete(`${API_BASE_URL}/words/${wordId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('删除成功!');
      loadWords();
    } catch (error) {
      console.error('删除单词失败:', error);
      alert('删除单词失败,请重试');
    }
  };

  const handleUpdateWord = async () => {
    if (!editingWord) return;

    if (!editingWord.word.trim()) {
      alert('请输入单词');
      return;
    }
    if (!editingWord.phonetic.trim()) {
      alert('请输入音标');
      return;
    }
    if (!editingWord.definitions[0]?.meaning.trim()) {
      alert('请至少输入一个释义');
      return;
    }

    try {
      const token = localStorage.getItem('access_token');
      await axios.put(`${API_BASE_URL}/words/${editingWord.id}`, editingWord, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('更新成功!');
      setShowEditDialog(false);
      setEditingWord(null);
      loadWords();
    } catch (error: any) {
      console.error('更新单词失败:', error);
      if (error.response?.data?.detail) {
        alert(`更新失败: ${error.response.data.detail}`);
      } else {
        alert('更新单词失败,请重试');
      }
    }
  };

  const handleGeneratePhonetic = async () => {
    if (!editingWord?.word.trim()) {
      alert('请先输入单词');
      return;
    }

    setGeneratingPhonetic(true);
    try {
      const response = await axios.get(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${editingWord.word}`
      );

      if (response.data && response.data[0]?.phonetic) {
        setEditingWord({ ...editingWord, phonetic: response.data[0].phonetic });
        alert('音标生成成功!');
      } else if (response.data && response.data[0]?.phonetics?.[0]?.text) {
        setEditingWord({ ...editingWord, phonetic: response.data[0].phonetics[0].text });
        alert('音标生成成功!');
      } else {
        alert('未找到该单词的音标,请手动输入');
      }
    } catch (error) {
      console.error('生成音标失败:', error);
      alert('音标生成失败,请手动输入');
    } finally {
      setGeneratingPhonetic(false);
    }
  };

  const handleAddDefinition = () => {
    if (!editingWord) return;
    setEditingWord({
      ...editingWord,
      definitions: [
        ...editingWord.definitions,
        {
          id: Date.now(),
          part_of_speech: 'n.',
          meaning: '',
          example_sentence: '',
          example_translation: '',
          is_primary: false
        }
      ]
    });
  };

  const handleRemoveDefinition = (index: number) => {
    if (!editingWord || editingWord.definitions.length <= 1) {
      alert('至少需要保留一个释义');
      return;
    }
    const newDefinitions = editingWord.definitions.filter((_, i) => i !== index);
    setEditingWord({ ...editingWord, definitions: newDefinitions });
  };

  const handleUpdateDefinition = (index: number, field: string, value: any) => {
    if (!editingWord) return;
    const newDefinitions = [...editingWord.definitions];
    (newDefinitions[index] as any)[field] = value;
    setEditingWord({ ...editingWord, definitions: newDefinitions });
  };

  const handleAddTag = (tag: string) => {
    if (!editingWord) return;
    if (tag.trim() && !editingWord.tags.includes(tag.trim())) {
      setEditingWord({ ...editingWord, tags: [...editingWord.tags, tag.trim()] });
    }
  };

  const handleRemoveTag = (tag: string) => {
    if (!editingWord) return;
    setEditingWord({ ...editingWord, tags: editingWord.tags.filter(t => t !== tag) });
  };

  const toggleWordSelection = (wordId: number) => {
    setSelectedWords(prev =>
      prev.includes(wordId)
        ? prev.filter(id => id !== wordId)
        : [...prev, wordId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedWords.length === words.length) {
      setSelectedWords([]);
    } else {
      setSelectedWords(words.map(word => word.id));
    }
  };

  const handleBatchDelete = async () => {
    if (selectedWords.length === 0) {
      alert('请先选择要删除的单词');
      return;
    }

    const confirmMsg = `确定要删除选中的 ${selectedWords.length} 个单词吗?此操作不可恢复!`;
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.post(
        `${API_BASE_URL}/words/batch-delete`,
        selectedWords,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const { deleted_count, failed_count } = response.data;

      if (failed_count > 0) {
        alert(`删除完成!\n成功: ${deleted_count} 个\n失败: ${failed_count} 个`);
      } else {
        alert(`成功删除 ${deleted_count} 个单词!`);
      }

      setSelectedWords([]);
      setIsSelectionMode(false);
      loadWords();
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败,请重试');
    }
  };

  const cancelSelection = () => {
    setSelectedWords([]);
    setIsSelectionMode(false);
  };

  const getDifficultyLabel = (difficulty: number) => {
    const labels = ['', '简单', '较简单', '中等', '较难', '困难'];
    return labels[difficulty] || '';
  };

  const getDifficultyColor = (difficulty: number) => {
    const colors = ['', 'text-green-600 bg-green-100', 'text-blue-600 bg-blue-100', 'text-yellow-600 bg-yellow-100', 'text-orange-600 bg-orange-100', 'text-red-600 bg-red-100'];
    return colors[difficulty] || '';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-teal-50 to-cyan-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-primary" />
            <h1 className="text-xl font-bold text-gray-800">教师端 - 单词库管理</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/teacher/words/import')}
              className="text-sm px-3 py-1 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-md transition font-medium flex items-center gap-1"
            >
              <Upload className="w-4 h-4" />
              批量导入
            </button>
            <button
              onClick={() => navigate('/teacher/words')}
              className="text-sm px-3 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-md transition font-medium flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              录入单词
            </button>
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
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-green-600 to-teal-600 rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            📚 单词库管理
          </h2>
          <p className="opacity-90">查看、编辑和管理您录入的所有单词</p>
        </motion.div>

        {/* 搜索和筛选区域 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 mb-6 shadow-md"
        >
          <div className="grid md:grid-cols-4 gap-4">
            {/* 搜索框 */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                关键词搜索
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="输入单词或音标..."
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                />
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 bg-gradient-to-r from-green-600 to-teal-600 text-white rounded-lg hover:shadow-lg transition flex items-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  搜索
                </button>
              </div>
            </div>

            {/* 年级筛选 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                年级筛选
              </label>
              <select
                value={filterGrade}
                onChange={(e) => {
                  setFilterGrade(e.target.value);
                  setTimeout(loadWords, 100);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
              >
                <option value="">全部年级</option>
                <option value="小学">小学</option>
                <option value="初中">初中</option>
                <option value="高中">高中</option>
              </select>
            </div>

            {/* 难度筛选 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                难度筛选
              </label>
              <select
                value={filterDifficulty}
                onChange={(e) => {
                  setFilterDifficulty(e.target.value);
                  setTimeout(loadWords, 100);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
              >
                <option value="">全部难度</option>
                <option value="1">1 - 简单</option>
                <option value="2">2 - 较简单</option>
                <option value="3">3 - 中等</option>
                <option value="4">4 - 较难</option>
                <option value="5">5 - 困难</option>
              </select>
            </div>
          </div>
        </motion.div>

        {/* 单词列表 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-6 shadow-md"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-bold text-gray-800">
                单词列表 ({words.length})
              </h3>
              <AnimatePresence>
              {isSelectionMode && words.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={toggleSelectAll}
                  className={`text-sm px-3 py-1 rounded-md transition font-medium ${
                    selectedWords.length === words.length
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {selectedWords.length === words.length ? '✓ 取消全选' : '☐ 全选'}
                </motion.button>
              )}
              </AnimatePresence>
              {isSelectionMode && selectedWords.length > 0 && (
                <motion.span
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-blue-600 font-medium"
                >
                  已选择 {selectedWords.length} 项
                </motion.span>
              )}
            </div>
            <div className="flex gap-2">
              <AnimatePresence mode="wait">
              {isSelectionMode ? (
                <motion.div
                  key="selection-actions"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex gap-2"
                >
                  <motion.button
                    onClick={handleBatchDelete}
                    disabled={selectedWords.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-medium shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Trash2 className="w-4 h-4" />
                    删除选中
                    <motion.span
                      key={selectedWords.length}
                      initial={{ scale: 1.5, color: '#fef08a' }}
                      animate={{ scale: 1, color: '#ffffff' }}
                      className="bg-red-700 px-2 py-0.5 rounded-full text-sm"
                    >
                      {selectedWords.length}
                    </motion.span>
                  </motion.button>
                  <motion.button
                    onClick={cancelSelection}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    取消
                  </motion.button>
                </motion.div>
              ) : (
                words.length > 0 && (
                  <motion.button
                    key="batch-delete-btn"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    onClick={() => setIsSelectionMode(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <Trash2 className="w-4 h-4" />
                    批量删除
                  </motion.button>
                )
              )}
              </AnimatePresence>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-gray-500 mt-4">加载中...</p>
            </div>
          ) : words.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500 mb-2">暂无单词</p>
              <p className="text-sm text-gray-400 mb-4">请先录入单词或调整筛选条件</p>
              <button
                onClick={() => navigate('/teacher/words')}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:shadow-lg transition"
              >
                立即录入
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    {isSelectionMode && (
                      <th className="text-left py-3 px-4 font-semibold text-gray-700 w-12">
                        <input
                          type="checkbox"
                          checked={selectedWords.length === words.length && words.length > 0}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                      </th>
                    )}
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">单词</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">音标</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">释义</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">年级</th>
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">难度</th>
                    <th className="text-right py-3 px-4 font-semibold text-gray-700">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                  {words.map((word, index) => (
                    <motion.tr
                      key={word.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        backgroundColor: selectedWords.includes(word.id) ? 'rgb(239 246 255)' : 'transparent',
                      }}
                      exit={{ opacity: 0, x: -100, transition: { duration: 0.3 } }}
                      transition={{
                        delay: 0.02 * Math.min(index, 10),
                        backgroundColor: { duration: 0.2 },
                      }}
                      className={`border-b border-gray-100 hover:bg-gray-50 transition-all ${
                        isSelectionMode ? 'cursor-pointer' : ''
                      } ${
                        selectedWords.includes(word.id) ? 'ring-1 ring-blue-300 ring-inset' : ''
                      }`}
                      onClick={() => isSelectionMode && toggleWordSelection(word.id)}
                    >
                      {isSelectionMode && (
                        <td className="py-3 px-4">
                          <motion.div
                            initial={{ scale: 0, rotate: -180 }}
                            animate={{ scale: 1, rotate: 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          >
                            <motion.input
                              type="checkbox"
                              checked={selectedWords.includes(word.id)}
                              onChange={() => toggleWordSelection(word.id)}
                              onClick={(e) => e.stopPropagation()}
                              whileTap={{ scale: 0.8 }}
                              className="w-5 h-5 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                            />
                          </motion.div>
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <motion.span
                          className="font-medium text-gray-800"
                          animate={{
                            color: selectedWords.includes(word.id) ? 'rgb(37 99 235)' : 'rgb(31 41 55)'
                          }}
                        >
                          {word.word}
                        </motion.span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-gray-600">{word.phonetic || '-'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-gray-600">{word.primary_meaning || '-'}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                          {word.grade_level}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 text-xs rounded-full ${getDifficultyColor(word.difficulty)}`}>
                          {getDifficultyLabel(word.difficulty)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {!isSelectionMode && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleEdit(word.id)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                              title="编辑"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(word.id, word.word)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                        {isSelectionMode && selectedWords.includes(word.id) && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="inline-flex items-center justify-center w-6 h-6 bg-blue-500 text-white rounded-full text-xs font-bold"
                          >
                            ✓
                          </motion.div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>

      {/* 编辑单词对话框 */}
      <AnimatePresence>
        {showEditDialog && editingWord && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto"
            onClick={() => setShowEditDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-3xl w-full shadow-2xl my-8"
            >
              {/* 标题 */}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Edit2 className="w-6 h-6 text-primary" />
                  编辑单词
                </h3>
                <button
                  onClick={() => setShowEditDialog(false)}
                  className="text-gray-400 hover:text-gray-600 transition"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* 表单 */}
              <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                {/* 基本信息 */}
                <div className="grid md:grid-cols-2 gap-4">
                  {/* 单词 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      单词 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editingWord.word}
                      readOnly
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                    />
                  </div>

                  {/* 音标 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      音标 <span className="text-red-500">*</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editingWord.phonetic}
                        onChange={(e) => setEditingWord({ ...editingWord, phonetic: e.target.value })}
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                      />
                      <button
                        onClick={handleGeneratePhonetic}
                        disabled={generatingPhonetic}
                        className="px-3 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:shadow-lg transition text-sm flex items-center gap-1 disabled:opacity-50"
                      >
                        <Sparkles className="w-4 h-4" />
                        AI
                      </button>
                    </div>
                  </div>

                  {/* 划节 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      划节 <span className="text-xs text-gray-400">(用 - 分隔音节，如 coun-try)</span>
                    </label>
                    <input
                      type="text"
                      value={editingWord.syllables || ''}
                      onChange={(e) => setEditingWord({ ...editingWord, syllables: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                      placeholder="如: beau-ti-ful"
                    />
                  </div>

                  {/* 难度 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      难度
                    </label>
                    <select
                      value={editingWord.difficulty}
                      onChange={(e) => setEditingWord({ ...editingWord, difficulty: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                    >
                      <option value={1}>1 - 简单</option>
                      <option value={2}>2 - 较简单</option>
                      <option value={3}>3 - 中等</option>
                      <option value={4}>4 - 较难</option>
                      <option value={5}>5 - 困难</option>
                    </select>
                  </div>

                  {/* 年级 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      年级
                    </label>
                    <select
                      value={editingWord.grade_level}
                      onChange={(e) => setEditingWord({ ...editingWord, grade_level: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                    >
                      <option value="小学">小学</option>
                      <option value="初中">初中</option>
                      <option value="高中">高中</option>
                    </select>
                  </div>
                </div>

                {/* 释义列表 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-gray-700">
                      释义 <span className="text-red-500">*</span>
                    </label>
                    <button
                      onClick={handleAddDefinition}
                      className="text-sm px-3 py-1 bg-primary/10 text-primary hover:bg-primary/20 rounded-md transition flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      添加释义
                    </button>
                  </div>

                  <div className="space-y-3">
                    {editingWord.definitions.map((def, index) => (
                      <div key={index} className="p-3 border-2 border-gray-200 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-700">释义 {index + 1}</span>
                          {editingWord.definitions.length > 1 && (
                            <button
                              onClick={() => handleRemoveDefinition(index)}
                              className="text-red-500 hover:text-red-700 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        <div className="grid md:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">词性</label>
                            <select
                              value={def.part_of_speech}
                              onChange={(e) => handleUpdateDefinition(index, 'part_of_speech', e.target.value)}
                              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                            >
                              <option value="n.">n. 名词</option>
                              <option value="v.">v. 动词</option>
                              <option value="adj.">adj. 形容词</option>
                              <option value="adv.">adv. 副词</option>
                              <option value="prep.">prep. 介词</option>
                              <option value="conj.">conj. 连词</option>
                              <option value="pron.">pron. 代词</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs text-gray-600 mb-1">主要释义</label>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={def.is_primary}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    const newDefs = editingWord.definitions.map((d, i) => ({
                                      ...d,
                                      is_primary: i === index
                                    }));
                                    setEditingWord({ ...editingWord, definitions: newDefs });
                                  } else {
                                    handleUpdateDefinition(index, 'is_primary', false);
                                  }
                                }}
                                className="w-4 h-4"
                              />
                              <span className="text-sm text-gray-600">设为主要</span>
                            </div>
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">中文释义</label>
                            <input
                              type="text"
                              value={def.meaning}
                              onChange={(e) => handleUpdateDefinition(index, 'meaning', e.target.value)}
                              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">例句</label>
                            <input
                              type="text"
                              value={def.example_sentence || ''}
                              onChange={(e) => handleUpdateDefinition(index, 'example_sentence', e.target.value)}
                              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                            />
                          </div>

                          <div className="md:col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">例句翻译</label>
                            <input
                              type="text"
                              value={def.example_translation || ''}
                              onChange={(e) => handleUpdateDefinition(index, 'example_translation', e.target.value)}
                              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 标签 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    标签
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {editingWord.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm flex items-center gap-2"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="hover:text-red-500 transition"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          handleAddTag((e.target as HTMLInputElement).value);
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                      placeholder="输入标签后按Enter"
                      className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* 按钮 */}
              <div className="flex gap-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => setShowEditDialog(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleUpdateWord}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-green-600 to-teal-600 text-white rounded-lg hover:shadow-lg transition font-medium"
                >
                  保存修改
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeacherWordLibrary;
