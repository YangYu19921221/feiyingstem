import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface ContentStats {
  word_books: {
    total: number;
    public: number;
    private: number;
  };
  words: number;
  units: number;
  reading_passages: number;
}

interface WordBook {
  id: number;
  name: string;
  description: string;
  grade_level: string;
  is_public: boolean;
  cover_color: string;
  created_by: number;
  created_at: string;
}

interface Word {
  id: number;
  word: string;
  phonetic: string | null;
  audio_url: string | null;
  image_url: string | null;
  difficulty: number;
  grade_level: string | null;
  created_at: string;
  definitions: Array<{
    part_of_speech: string;
    meaning: string;
    example_sentence: string | null;
    example_translation: string | null;
    is_primary: boolean;
  }>;
}

interface ReadingPassage {
  id: number;
  title: string;
  difficulty: string;
  word_count: number;
  created_by: number;
  created_at: string;
}

const AdminContentManagement: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'wordbooks' | 'words' | 'passages'>('wordbooks');
  const [stats, setStats] = useState<ContentStats | null>(null);

  // Word Books state
  const [wordBooks, setWordBooks] = useState<WordBook[]>([]);
  const [bookPage, setBookPage] = useState(1);
  const [bookTotal, setBookTotal] = useState(0);
  const [bookSearch, setBookSearch] = useState('');
  const [bookPublicFilter, setBookPublicFilter] = useState<boolean | null>(null);

  // Words state
  const [words, setWords] = useState<Word[]>([]);
  const [wordPage, setWordPage] = useState(1);
  const [wordTotal, setWordTotal] = useState(0);
  const [wordSearch, setWordSearch] = useState('');

  // Reading Passages state
  const [passages, setPassages] = useState<ReadingPassage[]>([]);
  const [passagePage, setPassagePage] = useState(1);
  const [passageTotal, setPassageTotal] = useState(0);
  const [passageSearch, setPassageSearch] = useState('');
  const [passageDifficulty, setPassageDifficulty] = useState('');

  const [loading, setLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const pageSize = 20;

  useEffect(() => {
    loadStats();
    loadContent();
  }, [activeTab, bookPage, bookSearch, bookPublicFilter, wordPage, wordSearch, passagePage, passageSearch, passageDifficulty]);

  const loadStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_BASE_URL}/admin/content/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('加载统计信息失败:', error);
    }
  };

  const loadContent = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');

      if (activeTab === 'wordbooks') {
        const params: any = { page: bookPage, page_size: pageSize };
        if (bookSearch) params.search = bookSearch;
        if (bookPublicFilter !== null) params.is_public = bookPublicFilter;

        const response = await axios.get(`${API_BASE_URL}/admin/content/word-books`, {
          headers: { Authorization: `Bearer ${token}` },
          params
        });
        setWordBooks(response.data.books);
        setBookTotal(response.data.total);
      } else if (activeTab === 'words') {
        const params: any = { page: wordPage, page_size: pageSize };
        if (wordSearch) params.search = wordSearch;

        const response = await axios.get(`${API_BASE_URL}/admin/content/words`, {
          headers: { Authorization: `Bearer ${token}` },
          params
        });
        setWords(response.data.words);
        setWordTotal(response.data.total);
      } else if (activeTab === 'passages') {
        const params: any = { page: passagePage, page_size: pageSize };
        if (passageSearch) params.search = passageSearch;
        if (passageDifficulty) params.difficulty = passageDifficulty;

        const response = await axios.get(`${API_BASE_URL}/admin/content/reading-passages`, {
          headers: { Authorization: `Bearer ${token}` },
          params
        });
        setPassages(response.data.passages);
        setPassageTotal(response.data.total);
      }
    } catch (error) {
      console.error('加载内容失败:', error);
      alert('加载内容失败');
    } finally {
      setLoading(false);
    }
  };

  const deleteWordBook = async (bookId: number, bookName: string) => {
    if (!confirm(`确定要删除单词本「${bookName}」吗?这将同时删除单词本下的所有单元和单词关联。`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE_URL}/admin/content/word-books/${bookId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('删除成功');
      loadStats();
      loadContent();
    } catch (error) {
      console.error('删除单词本失败:', error);
      alert('删除失败');
    }
  };

  const deleteWord = async (wordId: number, word: string) => {
    if (!confirm(`确定要删除单词「${word}」吗?这将同时删除该单词的所有释义和学习记录。`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE_URL}/admin/content/words/${wordId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('删除成功');
      loadStats();
      loadContent();
    } catch (error) {
      console.error('删除单词失败:', error);
      alert('删除失败');
    }
  };

  const deletePassage = async (passageId: number, title: string) => {
    if (!confirm(`确定要删除阅读文章「${title}」吗?这将同时删除该文章的所有题目和学习记录。`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE_URL}/admin/content/reading-passages/${passageId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('删除成功');
      loadStats();
      loadContent();
    } catch (error) {
      console.error('删除阅读文章失败:', error);
      alert('删除失败');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  const getDifficultyText = (difficulty: string) => {
    const map: Record<string, string> = {
      'easy': '简单',
      'medium': '中等',
      'hard': '困难'
    };
    return map[difficulty] || difficulty;
  };

  const getGradeLevelText = (level: string) => {
    const map: Record<string, string> = {
      'primary': '小学',
      'junior': '初中',
      'senior': '高中'
    };
    return map[level] || level;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const validTypes = [
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      ];
      if (!validTypes.includes(file.type) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.csv')) {
        alert('请上传Excel文件(.xlsx, .xls)或CSV文件');
        return;
      }
      setUploadFile(file);
    }
  };

  const downloadTemplate = () => {
    const csvContent = `单词,音标,释义,词性,例句,例句翻译,难度,年级
apple,/ˈæp.əl/,苹果,n.,I like to eat an apple every day.,我喜欢每天吃一个苹果。,2,primary
book,/bʊk/,书,n.,She is reading a book in the library.,她在图书馆读书。,1,primary
computer,/kəmˈpjuː.tər/,计算机,n.,I use my computer for work and study.,我用电脑工作和学习。,3,junior
beautiful,/ˈbjuː.tɪ.fəl/,美丽的,adj.,The garden is very beautiful in spring.,春天的花园非常美丽。,2,primary
study,/ˈstʌd.i/,学习,v.,We study English every morning.,我们每天早上学英语。,2,primary`;

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '批量上传单词模板.csv';
    link.click();
  };

  const handleBatchUpload = async () => {
    if (!uploadFile) {
      alert('请先选择文件');
      return;
    }

    setUploading(true);
    try {
      // 使用 FileReader 读取文件
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const text = e.target?.result as string;
          const lines = text.split('\n').filter(line => line.trim());

          if (lines.length === 0) {
            alert('文件内容为空');
            setUploading(false);
            return;
          }

          // 解析CSV/Excel (假设格式: word, phonetic, meaning, part_of_speech)
          const words = [];
          for (let i = 1; i < lines.length; i++) { // 跳过第一行标题
            const parts = lines[i].split(/[,\t]/).map(p => p.trim().replace(/^"|"$/g, ''));
            if (parts.length >= 3) {
              words.push({
                word: parts[0],
                phonetic: parts[1] || null,
                definitions: [{
                  meaning: parts[2],
                  part_of_speech: parts[3] || 'n.',
                  example_sentence: parts[4] || null,
                  example_translation: parts[5] || null,
                  is_primary: true
                }],
                difficulty: parseInt(parts[6]) || 3,
                grade_level: parts[7] || null
              });
            }
          }

          if (words.length === 0) {
            alert('未能解析到有效的单词数据');
            setUploading(false);
            return;
          }

          // 调用后端API
          const token = localStorage.getItem('token');
          const response = await axios.post(
            `${API_BASE_URL}/words/batch-import`,
            { words },
            { headers: { Authorization: `Bearer ${token}` } }
          );

          alert(`批量导入完成!\n成功: ${response.data.success_count} 个\n失败: ${response.data.failed_count} 个`);
          setShowUploadModal(false);
          setUploadFile(null);
          loadStats();
          loadContent();
        } catch (error: any) {
          console.error('批量导入失败:', error);
          alert('批量导入失败: ' + (error.response?.data?.detail || error.message));
        } finally {
          setUploading(false);
        }
      };

      reader.readAsText(uploadFile);
    } catch (error) {
      console.error('读取文件失败:', error);
      alert('读取文件失败');
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-800 mb-2">📚 内容管理</h1>
            <p className="text-gray-600">管理系统中的所有学习内容</p>
          </div>
          <button
            onClick={() => navigate('/admin')}
            className="px-6 py-2 bg-white rounded-xl shadow-md hover:shadow-lg transition-all"
          >
            ← 返回管理中心
          </button>
        </div>

        {/* Statistics */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-2xl shadow-md p-6">
              <div className="text-3xl mb-2">📖</div>
              <div className="text-2xl font-bold text-gray-800">{stats.word_books.total}</div>
              <div className="text-sm text-gray-600">单词本总数</div>
              <div className="text-xs text-gray-500 mt-2">
                公开:{stats.word_books.public} | 私有:{stats.word_books.private}
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-md p-6">
              <div className="text-3xl mb-2">📝</div>
              <div className="text-2xl font-bold text-gray-800">{stats.words}</div>
              <div className="text-sm text-gray-600">单词总数</div>
            </div>
            <div className="bg-white rounded-2xl shadow-md p-6">
              <div className="text-3xl mb-2">📦</div>
              <div className="text-2xl font-bold text-gray-800">{stats.units}</div>
              <div className="text-sm text-gray-600">单元总数</div>
            </div>
            <div className="bg-white rounded-2xl shadow-md p-6">
              <div className="text-3xl mb-2">📰</div>
              <div className="text-2xl font-bold text-gray-800">{stats.reading_passages}</div>
              <div className="text-sm text-gray-600">阅读文章</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-md mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('wordbooks')}
              className={`flex-1 py-4 px-6 font-medium transition-colors ${
                activeTab === 'wordbooks'
                  ? 'text-[#FF6B35] border-b-2 border-[#FF6B35]'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📖 单词本
            </button>
            <button
              onClick={() => setActiveTab('words')}
              className={`flex-1 py-4 px-6 font-medium transition-colors ${
                activeTab === 'words'
                  ? 'text-[#FF6B35] border-b-2 border-[#FF6B35]'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📝 单词
            </button>
            <button
              onClick={() => setActiveTab('passages')}
              className={`flex-1 py-4 px-6 font-medium transition-colors ${
                activeTab === 'passages'
                  ? 'text-[#FF6B35] border-b-2 border-[#FF6B35]'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📰 阅读文章
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="bg-white rounded-2xl shadow-md p-6">
          {/* Word Books Tab */}
          {activeTab === 'wordbooks' && (
            <>
              {/* Filters */}
              <div className="flex gap-4 mb-6">
                <input
                  type="text"
                  placeholder="搜索单词本名称或描述..."
                  value={bookSearch}
                  onChange={(e) => {
                    setBookSearch(e.target.value);
                    setBookPage(1);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                />
                <select
                  value={bookPublicFilter === null ? '' : bookPublicFilter.toString()}
                  onChange={(e) => {
                    setBookPublicFilter(e.target.value === '' ? null : e.target.value === 'true');
                    setBookPage(1);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                >
                  <option value="">全部类型</option>
                  <option value="true">公开</option>
                  <option value="false">私有</option>
                </select>
              </div>

              {/* Word Books Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">名称</th>
                      <th className="text-left py-3 px-4">描述</th>
                      <th className="text-left py-3 px-4">年级</th>
                      <th className="text-left py-3 px-4">类型</th>
                      <th className="text-left py-3 px-4">创建时间</th>
                      <th className="text-right py-3 px-4">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-500">
                          加载中...
                        </td>
                      </tr>
                    ) : wordBooks.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-gray-500">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      wordBooks.map((book) => (
                        <tr key={book.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ backgroundColor: book.cover_color || '#FF6B35' }}
                              ></div>
                              <span className="font-medium">{book.name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-600 max-w-xs truncate">
                            {book.description}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                              {getGradeLevelText(book.grade_level)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${
                                book.is_public
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {book.is_public ? '公开' : '私有'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {formatDate(book.created_at)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => deleteWordBook(book.id, book.name)}
                              className="px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {bookTotal > pageSize && (
                <div className="flex justify-center items-center gap-4 mt-6">
                  <button
                    onClick={() => setBookPage(Math.max(1, bookPage - 1))}
                    disabled={bookPage === 1}
                    className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    上一页
                  </button>
                  <span className="text-gray-600">
                    第 {bookPage} / {Math.ceil(bookTotal / pageSize)} 页 (共 {bookTotal} 条)
                  </span>
                  <button
                    onClick={() => setBookPage(Math.min(Math.ceil(bookTotal / pageSize), bookPage + 1))}
                    disabled={bookPage >= Math.ceil(bookTotal / pageSize)}
                    className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}

          {/* Words Tab */}
          {activeTab === 'words' && (
            <>
              {/* Filters and Actions */}
              <div className="flex gap-4 mb-6">
                <input
                  type="text"
                  placeholder="搜索单词或音标..."
                  value={wordSearch}
                  onChange={(e) => {
                    setWordSearch(e.target.value);
                    setWordPage(1);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                />
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="px-6 py-2 bg-gradient-to-r from-[#FF6B35] to-[#FFD23F] text-white rounded-lg hover:shadow-lg transition-all font-medium"
                >
                  📤 批量上传
                </button>
              </div>

              {/* Words Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">单词</th>
                      <th className="text-left py-3 px-4">音标</th>
                      <th className="text-left py-3 px-4">释义</th>
                      <th className="text-left py-3 px-4">创建时间</th>
                      <th className="text-right py-3 px-4">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-500">
                          加载中...
                        </td>
                      </tr>
                    ) : words.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-500">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      words.map((word) => (
                        <tr key={word.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">
                            <span className="font-bold text-lg">{word.word}</span>
                          </td>
                          <td className="py-3 px-4 text-gray-600">
                            <div className="text-sm">
                              {word.phonetic && <div>{word.phonetic}</div>}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="space-y-1">
                              {word.definitions.slice(0, 2).map((def, idx) => (
                                <div key={idx} className="text-sm">
                                  <span className="text-blue-600 font-medium">{def.part_of_speech}</span>
                                  {' '}
                                  <span className="text-gray-700">{def.meaning}</span>
                                </div>
                              ))}
                              {word.definitions.length > 2 && (
                                <div className="text-xs text-gray-500">
                                  +{word.definitions.length - 2} 个释义
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {formatDate(word.created_at)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => deleteWord(word.id, word.word)}
                              className="px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {wordTotal > pageSize && (
                <div className="flex justify-center items-center gap-4 mt-6">
                  <button
                    onClick={() => setWordPage(Math.max(1, wordPage - 1))}
                    disabled={wordPage === 1}
                    className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    上一页
                  </button>
                  <span className="text-gray-600">
                    第 {wordPage} / {Math.ceil(wordTotal / pageSize)} 页 (共 {wordTotal} 条)
                  </span>
                  <button
                    onClick={() => setWordPage(Math.min(Math.ceil(wordTotal / pageSize), wordPage + 1))}
                    disabled={wordPage >= Math.ceil(wordTotal / pageSize)}
                    className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}

          {/* Reading Passages Tab */}
          {activeTab === 'passages' && (
            <>
              {/* Filters */}
              <div className="flex gap-4 mb-6">
                <input
                  type="text"
                  placeholder="搜索文章标题或内容..."
                  value={passageSearch}
                  onChange={(e) => {
                    setPassageSearch(e.target.value);
                    setPassagePage(1);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                />
                <select
                  value={passageDifficulty}
                  onChange={(e) => {
                    setPassageDifficulty(e.target.value);
                    setPassagePage(1);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
                >
                  <option value="">全部难度</option>
                  <option value="easy">简单</option>
                  <option value="medium">中等</option>
                  <option value="hard">困难</option>
                </select>
              </div>

              {/* Reading Passages Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">标题</th>
                      <th className="text-left py-3 px-4">难度</th>
                      <th className="text-left py-3 px-4">字数</th>
                      <th className="text-left py-3 px-4">创建时间</th>
                      <th className="text-right py-3 px-4">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-500">
                          加载中...
                        </td>
                      </tr>
                    ) : passages.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-500">
                          暂无数据
                        </td>
                      </tr>
                    ) : (
                      passages.map((passage) => (
                        <tr key={passage.id} className="border-b hover:bg-gray-50">
                          <td className="py-3 px-4">
                            <span className="font-medium">{passage.title}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-1 rounded-full text-xs ${
                                passage.difficulty === 'easy'
                                  ? 'bg-green-100 text-green-800'
                                  : passage.difficulty === 'medium'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {getDifficultyText(passage.difficulty)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-600">
                            {passage.word_count} 词
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-600">
                            {formatDate(passage.created_at)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => deletePassage(passage.id, passage.title)}
                              className="px-3 py-1 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {passageTotal > pageSize && (
                <div className="flex justify-center items-center gap-4 mt-6">
                  <button
                    onClick={() => setPassagePage(Math.max(1, passagePage - 1))}
                    disabled={passagePage === 1}
                    className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    上一页
                  </button>
                  <span className="text-gray-600">
                    第 {passagePage} / {Math.ceil(passageTotal / pageSize)} 页 (共 {passageTotal} 条)
                  </span>
                  <button
                    onClick={() => setPassagePage(Math.min(Math.ceil(passageTotal / pageSize), passagePage + 1))}
                    disabled={passagePage >= Math.ceil(passageTotal / pageSize)}
                    className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Upload Modal */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full mx-4">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">📤 批量上传单词</h2>
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setUploadFile(null);
                  }}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-medium text-blue-900">📋 文件格式说明</h3>
                  <button
                    onClick={downloadTemplate}
                    className="px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-all"
                  >
                    📥 下载模板
                  </button>
                </div>
                <p className="text-sm text-blue-800 mb-2">
                  请上传CSV或Excel文件,每行一个单词,按以下顺序排列:
                </p>
                <code className="block text-xs bg-white p-3 rounded border border-blue-200 text-gray-800">
                  单词, 音标, 释义, 词性, 例句, 例句翻译, 难度(1-5), 年级(primary/junior/senior)
                </code>
                <p className="text-xs text-blue-700 mt-2">
                  * 第一行为标题行(将被跳过)<br />
                  * 必填: 单词、释义<br />
                  * 选填: 其他字段可为空
                </p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择文件
                </label>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#FF6B35] file:text-white hover:file:bg-[#ff5520] transition-all"
                />
                {uploadFile && (
                  <p className="mt-2 text-sm text-green-600">
                    ✓ 已选择: {uploadFile.name}
                  </p>
                )}
              </div>

              <div className="flex gap-4">
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setUploadFile(null);
                  }}
                  disabled={uploading}
                  className="flex-1 px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchUpload}
                  disabled={!uploadFile || uploading}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-[#FF6B35] to-[#FFD23F] text-white rounded-lg hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {uploading ? '上传中...' : '开始上传'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminContentManagement;
