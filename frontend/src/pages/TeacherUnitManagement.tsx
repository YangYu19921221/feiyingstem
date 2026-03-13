import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getUnitsByBook,
  createUnit,
  deleteUnit,
  getUnitDetail,
  getAllWords,
  addWordsToUnit,
  removeWordFromUnit
} from '../api/teacher';
import type { UnitResponse, UnitDetailResponse, WordSimple } from '../api/teacher';
import { ArrowLeft, Plus, Trash2, Edit, BookOpen, X, Sparkles, Download } from 'lucide-react';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import * as XLSX from 'xlsx';

const TeacherUnitManagement = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const [units, setUnits] = useState<UnitResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddWordsDialog, setShowAddWordsDialog] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<UnitDetailResponse | null>(null);
  const [availableWords, setAvailableWords] = useState<WordSimple[]>([]);
  const [selectedWordIds, setSelectedWordIds] = useState<number[]>([]);
  const [showNewWordForm, setShowNewWordForm] = useState(false);
  const [newWordData, setNewWordData] = useState({
    word: '',
    phonetic: '',
    syllables: '',
    difficulty: 1,
    grade_level: '小学',
    definitions: [{ part_of_speech: 'n.', meaning: '', example_sentence: '', example_translation: '', is_primary: true }] as Array<{ part_of_speech: string; meaning: string; example_sentence: string; example_translation: string; is_primary: boolean }>,
    tags: [] as string[],
  });
  const [creatingWord, setCreatingWord] = useState(false);
  const [generatingAI, setGeneratingAI] = useState<number | null>(null);
  const [importingExcel, setImportingExcel] = useState(false);
  const [selectedRemoveIds, setSelectedRemoveIds] = useState<number[]>([]);
  const [removingWords, setRemovingWords] = useState(false);

  // 创建单元表单
  const [newUnit, setNewUnit] = useState({
    unit_number: 1,
    name: '',
    description: '',
  });

  useEffect(() => {
    if (bookId) {
      loadUnits();
    }
  }, [bookId]);

  const loadUnits = async () => {
    try {
      setLoading(true);
      const data = await getUnitsByBook(parseInt(bookId!));
      setUnits(data);
    } catch (error) {
      console.error('加载单元失败:', error);
      alert('加载单元失败,请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUnit = async () => {
    if (!newUnit.name.trim()) {
      alert('请输入单元名称');
      return;
    }

    try {
      await createUnit(parseInt(bookId!), {
        unit_number: newUnit.unit_number,
        name: newUnit.name,
        description: newUnit.description || undefined,
        order_index: units.length,
      });

      setShowCreateDialog(false);
      setNewUnit({ unit_number: 1, name: '', description: '' });
      loadUnits();
      alert('创建成功!');
    } catch (error: any) {
      console.error('创建单元失败:', error);
      alert(error.response?.data?.detail || '创建失败,请重试');
    }
  };

  const handleDeleteUnit = async (unitId: number, unitName: string) => {
    if (!confirm(`确定要删除单元"${unitName}"吗?这将同时删除该单元的所有单词关联。`)) {
      return;
    }

    try {
      await deleteUnit(unitId);
      loadUnits();
      alert('删除成功!');
    } catch (error: any) {
      console.error('删除单元失败:', error);
      alert(error.response?.data?.detail || '删除失败,请重试');
    }
  };

  const handleViewUnitWords = async (unitId: number) => {
    try {
      const data = await getUnitDetail(unitId);
      setSelectedUnit(data);
    } catch (error) {
      console.error('加载单元详情失败:', error);
      alert('加载失败,请重试');
    }
  };

  const handleOpenAddWords = async (unit: UnitResponse) => {
    try {
      // 加载单元详情
      const unitDetail = await getUnitDetail(unit.id);
      setSelectedUnit(unitDetail);

      // 加载所有可用单词
      const words = await getAllWords(200);
      setAvailableWords(words);
      setShowAddWordsDialog(true);
      setSelectedWordIds([]);
    } catch (error) {
      console.error('加载单词失败:', error);
      alert('加载失败,请重试');
    }
  };

  const handleAddWords = async () => {
    if (selectedWordIds.length === 0) {
      alert('请至少选择一个单词');
      return;
    }

    try {
      await addWordsToUnit(selectedUnit!.id, selectedWordIds);
      setShowAddWordsDialog(false);
      setSelectedWordIds([]);

      // 刷新单元列表
      loadUnits();

      // 刷新单元详情
      const updatedUnit = await getUnitDetail(selectedUnit!.id);
      setSelectedUnit(updatedUnit);

      alert('添加成功!');
    } catch (error: any) {
      console.error('添加单词失败:', error);
      alert(error.response?.data?.detail || '添加失败,请重试');
    }
  };

  const handleRemoveWord = async (wordId: number, wordText: string) => {
    if (!confirm(`确定要从该单元移除单词"${wordText}"吗?`)) {
      return;
    }

    try {
      await removeWordFromUnit(selectedUnit!.id, wordId);

      // 刷新单元详情
      const updatedUnit = await getUnitDetail(selectedUnit!.id);
      setSelectedUnit(updatedUnit);

      // 刷新单元列表
      loadUnits();

      alert('移除成功!');
    } catch (error: any) {
      console.error('移除单词失败:', error);
      alert(error.response?.data?.detail || '移除失败,请重试');
    }
  };

  const handleBatchRemoveWords = async () => {
    if (selectedRemoveIds.length === 0) return;
    if (!confirm(`确定要从该单元移除选中的 ${selectedRemoveIds.length} 个单词吗?`)) return;

    setRemovingWords(true);
    try {
      for (const wordId of selectedRemoveIds) {
        await removeWordFromUnit(selectedUnit!.id, wordId);
      }
      setSelectedRemoveIds([]);
      const updatedUnit = await getUnitDetail(selectedUnit!.id);
      setSelectedUnit(updatedUnit);
      loadUnits();
      alert(`成功移除 ${selectedRemoveIds.length} 个单词`);
    } catch (error: any) {
      console.error('批量移除失败:', error);
      alert('部分单词移除失败,请重试');
    } finally {
      setRemovingWords(false);
    }
  };

  const toggleRemoveSelection = (wordId: number) => {
    setSelectedRemoveIds(prev =>
      prev.includes(wordId) ? prev.filter(id => id !== wordId) : [...prev, wordId]
    );
  };

  const toggleSelectAllRemove = () => {
    if (!selectedUnit) return;
    if (selectedRemoveIds.length === selectedUnit.words.length) {
      setSelectedRemoveIds([]);
    } else {
      setSelectedRemoveIds(selectedUnit.words.map(w => w.id));
    }
  };

  const toggleWordSelection = (wordId: number) => {
    if (selectedWordIds.includes(wordId)) {
      setSelectedWordIds(selectedWordIds.filter(id => id !== wordId));
    } else {
      setSelectedWordIds([...selectedWordIds, wordId]);
    }
  };

  const handleCreateAndAddWord = async () => {
    if (!newWordData.word.trim()) {
      alert('请输入单词');
      return;
    }
    if (!newWordData.definitions[0].meaning.trim()) {
      alert('请至少输入一个释义');
      return;
    }

    try {
      setCreatingWord(true);
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      const res = await axios.post(`${API_BASE_URL}/words/`, {
        word: newWordData.word.trim(),
        phonetic: newWordData.phonetic.trim() || undefined,
        syllables: newWordData.syllables.trim() || undefined,
        difficulty: newWordData.difficulty,
        grade_level: newWordData.grade_level,
        definitions: newWordData.definitions.map(d => ({
          part_of_speech: d.part_of_speech,
          meaning: d.meaning.trim(),
          example_sentence: d.example_sentence.trim() || undefined,
          example_translation: d.example_translation.trim() || undefined,
          is_primary: d.is_primary,
        })),
        tags: newWordData.tags,
      }, { headers: { Authorization: `Bearer ${token}` } });

      const newWordId = res.data.id;
      await addWordsToUnit(selectedUnit!.id, [newWordId]);

      setNewWordData({
        word: '', phonetic: '', syllables: '', difficulty: 1, grade_level: '小学',
        definitions: [{ part_of_speech: 'n.', meaning: '', example_sentence: '', example_translation: '', is_primary: true }],
        tags: [],
      });

      const words = await getAllWords(200);
      setAvailableWords(words);
      const updatedUnit = await getUnitDetail(selectedUnit!.id);
      setSelectedUnit(updatedUnit);
      loadUnits();

      alert('单词创建并添加成功!');
    } catch (error: any) {
      console.error('创建单词失败:', error);
      alert(error.response?.data?.detail || '创建失败,请重试');
    } finally {
      setCreatingWord(false);
    }
  };

  const handleAIGenerate = async (index: number) => {
    if (!newWordData.word.trim()) {
      alert('请先输入单词');
      return;
    }
    setGeneratingAI(index);
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      const existingMeanings = newWordData.definitions
        .filter((_, i) => i !== index && _.meaning.trim())
        .map(d => d.meaning.trim());

      const res = await axios.post(`${API_BASE_URL}/ai/generate-complete`, {
        word: newWordData.word.trim(),
        part_of_speech: newWordData.definitions[index].part_of_speech,
        existing_meanings: existingMeanings,
      }, { headers: { Authorization: `Bearer ${token}` } });

      if (res.data) {
        const data = res.data;
        const updatedDefs = [...newWordData.definitions];
        updatedDefs[index] = {
          ...updatedDefs[index],
          meaning: data.meaning || updatedDefs[index].meaning,
          example_sentence: data.example_sentence || updatedDefs[index].example_sentence,
          example_translation: data.example_translation || updatedDefs[index].example_translation,
        };
        setNewWordData(prev => ({
          ...prev,
          phonetic: data.phonetic || prev.phonetic,
          definitions: updatedDefs,
        }));
      }
    } catch (error) {
      console.error('AI生成失败:', error);
      alert('AI生成失败,请手动输入');
    } finally {
      setGeneratingAI(null);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      { '单词': 'apple', '音标': '/ˈæp.l/', '音节': 'ap-ple', '词性': 'n.', '释义': '苹果', '例句': 'I like to eat apples.', '例句翻译': '我喜欢吃苹果。' },
      { '单词': 'happy', '音标': '/ˈhæp.i/', '音节': 'hap-py', '词性': 'adj.', '释义': '快乐的', '例句': 'She is very happy today.', '例句翻译': '她今天很开心。' },
    ];
    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '单词导入模板');
    XLSX.writeFile(wb, '单词导入模板.xlsx');
  };

  const handleExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    setImportingExcel(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws);

      if (rows.length === 0) {
        alert('Excel 文件为空');
        return;
      }

      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      const newWordIds: number[] = [];
      const errors: string[] = [];

      for (const row of rows) {
        const word = (row['单词'] || row['word'] || '').toString().trim();
        if (!word) continue;

        const meaning = (row['释义'] || row['meaning'] || '').toString().trim();
        const phonetic = (row['音标'] || row['phonetic'] || '').toString().trim();
        const syllables = (row['音节'] || row['syllables'] || '').toString().trim();
        const pos = (row['词性'] || row['part_of_speech'] || 'n.').toString().trim();
        const example = (row['例句'] || row['example'] || '').toString().trim();
        const exTrans = (row['例句翻译'] || row['translation'] || '').toString().trim();

        try {
          const res = await axios.post(`${API_BASE_URL}/words/`, {
            word: word.toLowerCase(),
            phonetic: phonetic || undefined,
            syllables: syllables || undefined,
            difficulty: 1,
            grade_level: '小学',
            definitions: [{
              part_of_speech: pos,
              meaning: meaning || word,
              example_sentence: example || undefined,
              example_translation: exTrans || undefined,
              is_primary: true,
            }],
            tags: [],
          }, { headers: { Authorization: `Bearer ${token}` } });
          newWordIds.push(res.data.id);
        } catch (err: any) {
          errors.push(`${word}: ${err.response?.data?.detail || '创建失败'}`);
        }
      }

      if (newWordIds.length > 0) {
        await addWordsToUnit(selectedUnit!.id, newWordIds);
        const words = await getAllWords(200);
        setAvailableWords(words);
        const updatedUnit = await getUnitDetail(selectedUnit!.id);
        setSelectedUnit(updatedUnit);
        loadUnits();
      }

      let msg = `成功导入 ${newWordIds.length} 个单词`;
      if (errors.length > 0) {
        msg += `\n失败 ${errors.length} 个:\n${errors.slice(0, 5).join('\n')}`;
      }
      alert(msg);
    } catch (error) {
      console.error('Excel导入失败:', error);
      alert('Excel文件解析失败，请检查格式');
    } finally {
      setImportingExcel(false);
    }
  };

  // 过滤掉已经在单元中的单词
  const filteredAvailableWords = availableWords.filter(
    word => !selectedUnit?.words.some(w => w.id === word.id)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/teacher/books')}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex items-center gap-3 flex-1">
              <BookOpen className="w-6 h-6 text-primary" />
              <div>
                <h1 className="text-xl font-bold text-gray-800">单元管理</h1>
                <p className="text-sm text-gray-500">管理单元和单词</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition font-medium shadow-md"
            >
              <Plus className="w-5 h-5" />
              创建单元
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="text-gray-500 mt-4">加载中...</p>
          </div>
        ) : units.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white rounded-2xl p-12 text-center shadow-md"
          >
            <BookOpen className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 mb-2">还没有创建单元</p>
            <p className="text-sm text-gray-400 mb-4">点击右上角"创建单元"按钮开始</p>
          </motion.div>
        ) : (
          <div className="grid gap-6">
            {units.map((unit, index) => (
              <motion.div
                key={unit.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 * index }}
                className="bg-white rounded-2xl p-6 shadow-md hover:shadow-lg transition"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl">📌</span>
                      <h3 className="text-xl font-bold text-gray-800">
                        Unit {unit.unit_number}: {unit.name}
                      </h3>
                    </div>
                    {unit.description && (
                      <p className="text-sm text-gray-600 ml-11">{unit.description}</p>
                    )}
                    <p className="text-sm text-gray-500 ml-11 mt-1">
                      {unit.word_count} 个单词
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleViewUnitWords(unit.id)}
                      className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg transition"
                      title="查看单词"
                    >
                      <BookOpen className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleOpenAddWords(unit)}
                      className="p-2 hover:bg-green-50 text-green-600 rounded-lg transition"
                      title="添加单词"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteUnit(unit.id, unit.name)}
                      className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition"
                      title="删除单元"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* 创建单元对话框 */}
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
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-gray-800 mb-4">创建新单元</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    单元序号 *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={newUnit.unit_number}
                    onChange={(e) => setNewUnit({ ...newUnit, unit_number: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    单元名称 *
                  </label>
                  <input
                    type="text"
                    value={newUnit.name}
                    onChange={(e) => setNewUnit({ ...newUnit, name: e.target.value })}
                    placeholder="例如: Unit 1: Colors"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    描述 (可选)
                  </label>
                  <textarea
                    value={newUnit.description}
                    onChange={(e) => setNewUnit({ ...newUnit, description: e.target.value })}
                    placeholder="例如: 学习基础颜色单词"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="flex-1 py-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateUnit}
                  className="flex-1 py-2 px-4 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition"
                >
                  创建
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 添加单词对话框 */}
      <AnimatePresence>
        {showAddWordsDialog && selectedUnit && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowAddWordsDialog(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-gray-800 mb-4">
                为"{selectedUnit.name}"添加单词
              </h3>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setShowNewWordForm(false)}
                  className={`px-4 py-2 rounded-lg font-medium transition ${!showNewWordForm ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  从词库选择
                </button>
                <button
                  onClick={() => setShowNewWordForm(true)}
                  className={`flex items-center gap-1 px-4 py-2 rounded-lg font-medium transition ${showNewWordForm ? 'bg-primary text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  <Sparkles className="w-4 h-4" />
                  新建单词
                </button>
                <label className="flex items-center gap-1 px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition cursor-pointer">
                  <BookOpen className="w-4 h-4" />
                  {importingExcel ? '导入中...' : 'Excel导入'}
                  <input type="file" accept=".xlsx,.xls" onChange={handleExcelImport} className="hidden" disabled={importingExcel} />
                </label>
                <button
                  onClick={handleDownloadTemplate}
                  className="flex items-center gap-1 px-4 py-2 rounded-lg font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
                >
                  <Download className="w-4 h-4" />
                  下载模板
                </button>
              </div>

              {showNewWordForm ? (
                <div className="space-y-3 mb-4">
                  {/* 单词和音标 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">单词 *</label>
                      <input type="text" value={newWordData.word}
                        onChange={(e) => setNewWordData({ ...newWordData, word: e.target.value.toLowerCase() })}
                        placeholder="例如: dumpling"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">音标</label>
                      <input type="text" value={newWordData.phonetic}
                        onChange={(e) => setNewWordData({ ...newWordData, phonetic: e.target.value })}
                        placeholder="例如: /ˈdʌm.plɪŋ/"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" />
                    </div>
                  </div>
                  {/* 音节和难度 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">音节划分</label>
                      <input type="text" value={newWordData.syllables}
                        onChange={(e) => setNewWordData({ ...newWordData, syllables: e.target.value })}
                        placeholder="例如: dum-p-ling"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">难度</label>
                      <select value={newWordData.difficulty}
                        onChange={(e) => setNewWordData({ ...newWordData, difficulty: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
                        <option value={1}>1 - 简单</option>
                        <option value={2}>2 - 较简单</option>
                        <option value={3}>3 - 中等</option>
                        <option value={4}>4 - 较难</option>
                        <option value={5}>5 - 困难</option>
                      </select>
                    </div>
                  </div>

                  {/* 释义列表 */}
                  {newWordData.definitions.map((def, idx) => (
                    <div key={idx} className="p-3 border-2 border-gray-200 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">释义 {idx + 1}</span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleAIGenerate(idx)}
                            disabled={generatingAI === idx || !newWordData.word.trim()}
                            className="px-3 py-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg text-sm font-medium flex items-center gap-1 disabled:opacity-50">
                            <Sparkles className="w-3 h-3" />
                            {generatingAI === idx ? '生成中...' : 'AI生成'}
                          </button>
                          {newWordData.definitions.length > 1 && (
                            <button onClick={() => {
                              const defs = newWordData.definitions.filter((_, i) => i !== idx);
                              setNewWordData({ ...newWordData, definitions: defs });
                            }} className="text-red-500 hover:text-red-700">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select value={def.part_of_speech}
                          onChange={(e) => { const d = [...newWordData.definitions]; d[idx] = { ...d[idx], part_of_speech: e.target.value }; setNewWordData({ ...newWordData, definitions: d }); }}
                          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent">
                          <option value="n.">n. 名词</option>
                          <option value="v.">v. 动词</option>
                          <option value="adj.">adj. 形容词</option>
                          <option value="adv.">adv. 副词</option>
                          <option value="prep.">prep. 介词</option>
                          <option value="pron.">pron. 代词</option>
                        </select>
                        <input type="text" value={def.meaning}
                          onChange={(e) => { const d = [...newWordData.definitions]; d[idx] = { ...d[idx], meaning: e.target.value }; setNewWordData({ ...newWordData, definitions: d }); }}
                          placeholder="中文释义 *" className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" />
                      </div>
                      <input type="text" value={def.example_sentence}
                        onChange={(e) => { const d = [...newWordData.definitions]; d[idx] = { ...d[idx], example_sentence: e.target.value }; setNewWordData({ ...newWordData, definitions: d }); }}
                        placeholder="例句" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" />
                      <input type="text" value={def.example_translation}
                        onChange={(e) => { const d = [...newWordData.definitions]; d[idx] = { ...d[idx], example_translation: e.target.value }; setNewWordData({ ...newWordData, definitions: d }); }}
                        placeholder="例句翻译" className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" />
                    </div>
                  ))}

                  <button onClick={() => setNewWordData({ ...newWordData, definitions: [...newWordData.definitions, { part_of_speech: 'n.', meaning: '', example_sentence: '', example_translation: '', is_primary: false }] })}
                    className="w-full py-1.5 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-primary hover:text-primary transition text-sm flex items-center justify-center gap-1">
                    <Plus className="w-4 h-4" /> 添加释义
                  </button>

                  <button onClick={handleCreateAndAddWord} disabled={creatingWord}
                    className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition disabled:opacity-50">
                    {creatingWord ? '创建中...' : '创建并添加到单元'}
                  </button>
                </div>
              ) : (
                <>
                <p className="text-sm text-gray-600 mb-4">
                  已选择 {selectedWordIds.length} 个单词
                </p>

              {filteredAvailableWords.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  所有单词都已添加到该单元
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto mb-4">
                  {filteredAvailableWords.map((word) => (
                    <div
                      key={word.id}
                      onClick={() => toggleWordSelection(word.id)}
                      className={`p-3 border rounded-lg cursor-pointer transition ${
                        selectedWordIds.includes(word.id)
                          ? 'border-primary bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-bold text-gray-800">{word.word}</p>
                          {word.phonetic && (
                            <p className="text-sm text-gray-500">{word.phonetic}</p>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          checked={selectedWordIds.includes(word.id)}
                          onChange={() => {}}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowAddWordsDialog(false)}
                  className="flex-1 py-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                >
                  取消
                </button>
                <button
                  onClick={handleAddWords}
                  disabled={selectedWordIds.length === 0}
                  className="flex-1 py-2 px-4 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  添加 ({selectedWordIds.length})
                </button>
              </div>
              </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 查看单元单词对话框 */}
      <AnimatePresence>
        {selectedUnit && !showAddWordsDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setSelectedUnit(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">
                    {selectedUnit.name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {selectedUnit.word_count} 个单词
                  </p>
                </div>
                <button
                  onClick={() => setSelectedUnit(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {selectedUnit.words.length === 0 ? (
                <p className="text-gray-500 text-center py-8">该单元还没有添加单词</p>
              ) : (
                <div className="space-y-3">
                  {/* 批量操作栏 */}
                  <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedRemoveIds.length === selectedUnit.words.length}
                        onChange={toggleSelectAllRemove}
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <span className="text-sm text-gray-600">
                        {selectedRemoveIds.length > 0 ? `已选 ${selectedRemoveIds.length} 个` : '全选'}
                      </span>
                    </label>
                    {selectedRemoveIds.length > 0 && (
                      <button
                        onClick={handleBatchRemoveWords}
                        disabled={removingWords}
                        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg transition disabled:opacity-50"
                      >
                        {removingWords ? '移除中...' : `批量移除 (${selectedRemoveIds.length})`}
                      </button>
                    )}
                  </div>

                  {selectedUnit.words.map((word, index) => (
                    <div
                      key={word.id}
                      className={`p-4 border rounded-lg hover:border-gray-300 transition ${selectedRemoveIds.includes(word.id) ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <input
                            type="checkbox"
                            checked={selectedRemoveIds.includes(word.id)}
                            onChange={() => toggleRemoveSelection(word.id)}
                            className="w-4 h-4 mt-1 rounded border-gray-300 text-primary focus:ring-primary"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-sm font-medium text-gray-500">
                                #{index + 1}
                              </span>
                              <p className="text-lg font-bold text-gray-800">{word.word}</p>
                              {word.phonetic && (
                                <span className="text-sm text-gray-500">{word.phonetic}</span>
                              )}
                            </div>
                            {word.meaning && (
                              <p className="text-sm text-gray-700 mb-1">
                                {word.part_of_speech && (
                                  <span className="font-medium">{word.part_of_speech} </span>
                                )}
                                {word.meaning}
                              </p>
                            )}
                            {word.example_sentence && (
                              <p className="text-sm text-gray-600 italic mt-2">
                                "{word.example_sentence}"
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveWord(word.id, word.word)}
                          className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition ml-2"
                          title="移除单词"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TeacherUnitManagement;
