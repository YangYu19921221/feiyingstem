import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getTeacherWordBooks } from '../api/teacher';
import type { TeacherWordBook } from '../api/teacher';
import { BookOpen, Settings, Trash2, Search, ChevronDown, LayoutGrid, List, Pencil } from 'lucide-react';
import api from '../api/client';
import { toast } from '../components/Toast';

const GRADE_OPTIONS = [
  '一年级', '二年级', '三年级', '四年级', '五年级', '六年级',
  '七年级', '八年级', '九年级', '高一', '高二', '高三',
];
const VOLUME_OPTIONS = ['上册', '下册', '全册'];

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

const TeacherBooks = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);
  const [books, setBooks] = useState<TeacherWordBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBooks, setSelectedBooks] = useState<number[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => (localStorage.getItem('teacherBooksView') as 'list' | 'grid') || 'list');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    localStorage.setItem('teacherBooksView', viewMode);
  }, [viewMode]);

  // 按搜索过滤
  const filteredBooks = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return books;
    return books.filter(b =>
      (b.name || '').toLowerCase().includes(kw)
      || (b.description || '').toLowerCase().includes(kw)
      || (b.grade_level || '').toLowerCase().includes(kw)
      || (b.volume || '').toLowerCase().includes(kw)
    );
  }, [books, searchKeyword]);

  // 按年级阶段分组
  const groupedBooks = useMemo(() => {
    const groups = new Map<string, TeacherWordBook[]>();
    const stageOf = (g: string | null): string => {
      if (!g) return '其他';
      if (g.includes('小学') || /[一二三四五六]年级/.test(g)) return '小学';
      if (g.includes('初中') || /[七八九]年级/.test(g)) return '初中';
      if (g.includes('高中') || /高[一二三]/.test(g)) return '高中';
      return g;
    };
    for (const b of filteredBooks) {
      const stage = stageOf(b.grade_level);
      if (!groups.has(stage)) groups.set(stage, []);
      groups.get(stage)!.push(b);
    }
    // 排序：小学 → 初中 → 高中 → 其他
    const order = ['小学', '初中', '高中'];
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, 'zh');
    });
  }, [filteredBooks]);

  const toggleGroup = (stage: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };
  const hasLoadedOnce = useRef(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBook, setNewBook] = useState({ name: '', description: '', grade_level: '', volume: '', cover_color: '#FF6B6B' });
  const [renameTarget, setRenameTarget] = useState<TeacherWordBook | null>(null);
  const [renameForm, setRenameForm] = useState<{ name: string; grade_level: string; volume: string; cover_url: string | null }>({ name: '', grade_level: '', volume: '', cover_url: null });
  const [renaming, setRenaming] = useState(false);
  const [coverBusy, setCoverBusy] = useState<null | 'upload' | 'generate'>(null);
  const coverFileRef = (window as any).__coverFileRef || ((window as any).__coverFileRef = { current: null });

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
      toast.error('加载单词本失败,请重试');
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

  const openRename = (book: TeacherWordBook) => {
    setRenameForm({
      name: book.name,
      grade_level: book.grade_level || '',
      volume: book.volume || '',
      cover_url: book.cover_url || null,
    });
    setRenameTarget(book);
  };

  const onPickCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !renameTarget) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('图片不能超过 5MB'); return; }
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) { toast.error('仅支持 png/jpg/webp'); return; }
    setCoverBusy('upload');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(`/words/books/${renameTarget.id}/cover/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setRenameForm(f => ({ ...f, cover_url: res.data.cover_url }));
      toast.success('封面已更新');
    } catch (err) {
      console.error('封面上传失败:', err);
      toast.error('上传失败');
    } finally {
      setCoverBusy(null);
    }
  };

  const onGenerateCover = async () => {
    if (!renameTarget) return;
    setCoverBusy('generate');
    try {
      const res = await api.post(`/words/books/${renameTarget.id}/cover/generate`, {});
      const url = res.data.cover_url;
      if (url && url !== renameForm.cover_url) {
        setRenameForm(f => ({ ...f, cover_url: url }));
        toast.success('AI 封面生成成功');
      } else {
        toast('AI 服务暂时繁忙,可手动上传或稍后重试', 'warning');
      }
    } catch (err) {
      console.error('AI 生成失败:', err);
      toast.error('生成失败');
    } finally {
      setCoverBusy(null);
    }
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const name = renameForm.name.trim();
    if (!name) {
      toast.warning('名称不能为空');
      return;
    }
    setRenaming(true);
    try {
      await api.patch(`/words/books/${renameTarget.id}`, {
        name,
        grade_level: renameForm.grade_level.trim() || null,
        volume: renameForm.volume.trim() || null,
        cover_url: renameForm.cover_url,
      });
      toast.success('已保存');
      setRenameTarget(null);
      loadBooks();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '保存失败');
    } finally {
      setRenaming(false);
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
    const visibleIds = filteredBooks.map(b => b.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedBooks.includes(id));
    if (allVisibleSelected) {
      setSelectedBooks(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedBooks(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const isAllVisibleSelected = filteredBooks.length > 0 && filteredBooks.every(b => selectedBooks.includes(b.id));

  const handleBatchDelete = async () => {
    if (selectedBooks.length === 0) {
      toast.warning('请先选择要删除的单词本');
      return;
    }

    const confirmMsg = `确定要删除选中的 ${selectedBooks.length} 个单词本吗?此操作不可恢复!`;
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      const response: any = await api.post('/words/books/batch-delete', selectedBooks);

      const { deleted_count, failed_count } = response.data;

      if (failed_count > 0) {
        toast.warning(`删除完成! 成功: ${deleted_count} 个, 失败: ${failed_count} 个`);
      } else {
        toast.success(`成功删除 ${deleted_count} 个单词本!`);
      }

      setSelectedBooks([]);
      setIsSelectionMode(false);
      loadBooks();
    } catch (error) {
      console.error('批量删除失败:', error);
      toast.error('批量删除失败,请重试');
    }
  };

  const cancelSelection = () => {
    setSelectedBooks([]);
    setIsSelectionMode(false);
  };

  const handleCreateBook = async () => {
    if (!newBook.name.trim()) return;
    try {
      await api.post('/words/books', {
        name: newBook.name,
        description: newBook.description || null,
        grade_level: newBook.grade_level || null,
        volume: newBook.volume || null,
        cover_color: newBook.cover_color,
        is_public: true,
        word_ids: [],
      });
      setShowCreateModal(false);
      setNewBook({ name: '', description: '', grade_level: '', volume: '', cover_color: '#FF6B6B' });
      loadBooks();
    } catch (error) {
      console.error('创建单词本失败:', error);
      toast.error('创建失败，请重试');
    }
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
                  {isAllVisibleSelected ? '取消全选' : '全选'}
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
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium shadow-md"
                  >
                    + 新建单词本
                  </button>
                </>
              )}
            </div>
          </div>

          {/* 搜索 + 视图切换 — 即使加载中也显示，不闪烁 */}
          {books.length > 0 && (
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchKeyword}
                  onChange={e => setSearchKeyword(e.target.value)}
                  placeholder="搜索单词本名称、年级、册次..."
                  className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-lg outline-none focus:border-blue-400 text-sm"
                />
                {searchKeyword && (
                  <button
                    onClick={() => setSearchKeyword('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label="清空"
                  >
                    ×
                  </button>
                )}
              </div>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                共 <span className="font-semibold text-gray-700">{filteredBooks.length}</span> 本
                {searchKeyword && filteredBooks.length !== books.length && (
                  <span className="text-gray-400">（总 {books.length}）</span>
                )}
              </span>
              <div className="inline-flex rounded-lg overflow-hidden border border-gray-200">
                <button
                  onClick={() => setViewMode('list')}
                  title="列表视图"
                  className={`p-2 ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  title="网格视图"
                  className={`p-2 border-l border-gray-200 ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

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
              <p className="text-gray-500 mb-2">暂无单词本</p>
              <p className="text-sm text-gray-400 mb-4">请联系管理员添加单词本</p>
            </motion.div>
          ) : filteredBooks.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center shadow-sm">
              <Search className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">没有匹配「{searchKeyword}」的单词本</p>
              <button onClick={() => setSearchKeyword('')} className="mt-4 text-sm text-blue-600 hover:underline">
                清空搜索
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedBooks.map(([stage, groupBooks]) => {
                const collapsed = collapsedGroups.has(stage);
                return (
                  <div key={stage} className="bg-white rounded-xl shadow-sm overflow-hidden">
                    {/* 分组标题（可折叠）*/}
                    <button
                      onClick={() => toggleGroup(stage)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition border-b border-gray-100"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                        />
                        <span className="font-semibold text-gray-800">{stage}</span>
                        <span className="text-xs text-gray-500 font-normal">· {groupBooks.length} 本</span>
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {!collapsed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          {viewMode === 'list' ? (
                            <ul className="divide-y divide-gray-100">
                              {groupBooks.map(book => (
                                <li
                                  key={book.id}
                                  onClick={() => isSelectionMode ? toggleBookSelection(book.id) : handleManageUnits(book.id)}
                                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition ${
                                    selectedBooks.includes(book.id) ? 'bg-blue-50' : ''
                                  }`}
                                >
                                  {isSelectionMode && (
                                    <input
                                      type="checkbox"
                                      checked={selectedBooks.includes(book.id)}
                                      onChange={() => toggleBookSelection(book.id)}
                                      onClick={e => e.stopPropagation()}
                                      className="w-4 h-4 rounded border-gray-300 text-primary cursor-pointer shrink-0"
                                    />
                                  )}
                                  {/* 小封面/色块 */}
                                  {book.cover_url ? (
                                    <img
                                      src={book.cover_url}
                                      alt=""
                                      loading="lazy"
                                      className="w-10 h-10 rounded-md object-cover shrink-0 bg-gray-100"
                                    />
                                  ) : (
                                    <div
                                      className="w-10 h-10 rounded-md flex items-center justify-center text-white text-base shrink-0"
                                      style={{ background: book.cover_color }}
                                    >
                                      📖
                                    </div>
                                  )}
                                  {/* 名字 + 标签 同行 */}
                                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-gray-800 truncate">{book.name}</span>
                                    {book.grade_level && (
                                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded shrink-0">
                                        {book.grade_level}
                                      </span>
                                    )}
                                    {book.volume && (
                                      <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 text-[10px] rounded shrink-0">
                                        {book.volume}
                                      </span>
                                    )}
                                  </div>
                                  {/* 操作按钮 */}
                                  {!isSelectionMode && (
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        onClick={e => { e.stopPropagation(); openRename(book); }}
                                        className="px-2.5 py-1.5 border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 rounded-md text-xs font-medium flex items-center gap-1"
                                        title="重命名"
                                      >
                                        <Pencil className="w-3 h-3" />
                                        重命名
                                      </button>
                                      <button
                                        onClick={e => { e.stopPropagation(); handleManageUnits(book.id); }}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium flex items-center gap-1"
                                      >
                                        <Settings className="w-3 h-3" />
                                        管理
                                      </button>
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
                              {groupBooks.map(book => (
                                <div
                                  key={book.id}
                                  onClick={() => isSelectionMode ? toggleBookSelection(book.id) : handleManageUnits(book.id)}
                                  className={`bg-white rounded-xl p-3 border border-gray-100 hover:border-blue-300 hover:shadow-md transition group cursor-pointer relative ${
                                    selectedBooks.includes(book.id) ? 'ring-2 ring-primary' : ''
                                  }`}
                                >
                                  {isSelectionMode && (
                                    <div className="absolute top-2 right-2 z-10">
                                      <input
                                        type="checkbox"
                                        checked={selectedBooks.includes(book.id)}
                                        onChange={() => toggleBookSelection(book.id)}
                                        onClick={e => e.stopPropagation()}
                                        className="w-4 h-4 rounded border-gray-300 text-primary cursor-pointer"
                                      />
                                    </div>
                                  )}
                                  {book.cover_url ? (
                                    <div className="w-full aspect-[4/3] rounded-lg mb-2 overflow-hidden bg-gray-100">
                                      <img
                                        src={book.cover_url}
                                        alt={book.name}
                                        loading="lazy"
                                        onError={e => { e.currentTarget.style.display = 'none'; }}
                                        className="w-full h-full object-cover"
                                      />
                                    </div>
                                  ) : (
                                    <div
                                      className="w-full aspect-[4/3] rounded-lg mb-2 flex items-center justify-center text-white text-2xl"
                                      style={{ background: book.cover_color }}
                                    >
                                      📖
                                    </div>
                                  )}
                                  <h4 className="text-sm font-semibold text-gray-800 mb-1 group-hover:text-primary transition line-clamp-2 leading-snug min-h-[2.5em]">
                                    {book.name}
                                  </h4>
                                  {(book.grade_level || book.volume) && (
                                    <div className="flex items-center gap-1 mb-2 flex-wrap">
                                      {book.grade_level && (
                                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded">
                                          {book.grade_level}
                                        </span>
                                      )}
                                      {book.volume && (
                                        <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 text-[10px] rounded">
                                          {book.volume}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {!isSelectionMode && (
                                    <div className="mt-1 flex items-center gap-1.5">
                                      <button
                                        onClick={e => { e.stopPropagation(); openRename(book); }}
                                        className="px-2 py-1.5 border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600 rounded-md text-xs font-medium flex items-center justify-center"
                                        title="重命名"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={e => { e.stopPropagation(); handleManageUnits(book.id); }}
                                        className="flex-1 py-1.5 px-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-md text-xs font-medium flex items-center justify-center gap-1 hover:shadow-md transition"
                                      >
                                        <Settings className="w-3 h-3" />
                                        管理单元
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
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
                  if (action.route) {
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

      {/* 重命名单词本弹窗 */}
      {renameTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => !renaming && setRenameTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-4">编辑单词本</h3>
            <label className="block mb-3">
              <span className="text-xs text-gray-600 block mb-1">名称<span className="text-red-500">*</span></span>
              <input
                value={renameForm.name}
                onChange={e => setRenameForm({ ...renameForm, name: e.target.value })}
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-blue-400"
                placeholder="例如：人教版七年级上册"
              />
            </label>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="block">
                <span className="text-xs text-gray-600 block mb-1">年级</span>
                <input
                  value={renameForm.grade_level}
                  onChange={e => setRenameForm({ ...renameForm, grade_level: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-blue-400"
                  placeholder="七年级"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-600 block mb-1">册次</span>
                <input
                  value={renameForm.volume}
                  onChange={e => setRenameForm({ ...renameForm, volume: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-blue-400"
                  placeholder="上册"
                />
              </label>
            </div>

            <div className="mb-4">
              <span className="text-xs text-gray-600 block mb-2">封面</span>
              <div className="flex items-center gap-3">
                <div className="w-20 h-24 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex items-center justify-center flex-shrink-0">
                  {renameForm.cover_url ? (
                    <img src={renameForm.cover_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl">📘</span>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input
                    ref={el => { coverFileRef.current = el; }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={onPickCoverFile}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={coverBusy !== null}
                    onClick={() => coverFileRef.current?.click()}
                    className="w-full px-3 py-1.5 text-xs rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {coverBusy === 'upload' ? '上传中…' : '上传图片'}
                  </button>
                  <button
                    type="button"
                    disabled={coverBusy !== null}
                    onClick={onGenerateCover}
                    className="w-full px-3 py-1.5 text-xs rounded-md bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50"
                  >
                    {coverBusy === 'generate' ? 'AI 生成中…' : '✨ AI 生成'}
                  </button>
                  {renameForm.cover_url && (
                    <button
                      type="button"
                      onClick={() => setRenameForm(f => ({ ...f, cover_url: null }))}
                      className="w-full px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                    >
                      清除封面
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setRenameTarget(null)}
                disabled={renaming}
                className="flex-1 py-2 border border-gray-300 text-gray-600 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
              >取消</button>
              <button
                onClick={submitRename}
                disabled={renaming}
                className="flex-1 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >{renaming ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 新建单词本模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => setShowCreateModal(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">新建单词本</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">名称 *</label>
                <input
                  type="text"
                  value={newBook.name}
                  onChange={e => setNewBook({...newBook, name: e.target.value})}
                  placeholder="如：PEP小学英语"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">年级（可选）</label>
                  <select
                    value={newBook.grade_level}
                    onChange={e => setNewBook({...newBook, grade_level: e.target.value})}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">课外书/不限</option>
                    {GRADE_OPTIONS.filter(g => g).map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">册次（可选）</label>
                  <select
                    value={newBook.volume}
                    onChange={e => setNewBook({...newBook, volume: e.target.value})}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">不限</option>
                    {VOLUME_OPTIONS.filter(v => v).map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">描述（可选）</label>
                <input
                  type="text"
                  value={newBook.description}
                  onChange={e => setNewBook({...newBook, description: e.target.value})}
                  placeholder="简要描述"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">封面颜色</label>
                <div className="flex gap-2">
                  {['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#FF6B35'].map(c => (
                    <button
                      key={c}
                      onClick={() => setNewBook({...newBook, cover_color: c})}
                      className={`w-8 h-8 rounded-full border-2 ${newBook.cover_color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium"
              >
                取消
              </button>
              <button
                onClick={handleCreateBook}
                disabled={!newBook.name.trim()}
                className="flex-1 py-2 rounded-xl bg-blue-600 text-white font-medium disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherBooks;
