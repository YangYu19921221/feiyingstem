import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, Plus, Sparkles, Save, Trash2 } from 'lucide-react';
import { toast } from '../components/Toast';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface WordDefinition {
  part_of_speech: string;
  meaning: string;
  example_sentence: string;
  example_translation: string;
  is_primary: boolean;
}

interface NewWord {
  word: string;
  phonetic: string;
  syllables: string;
  difficulty: number;
  grade_level: string;
  definitions: WordDefinition[];
  tags: string[];
}

const TeacherWordEntry = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);
  const [newWord, setNewWord] = useState<NewWord>({
    word: '',
    phonetic: '',
    syllables: '',
    difficulty: 1,
    grade_level: '小学',
    definitions: [
      {
        part_of_speech: 'n.',
        meaning: '',
        example_sentence: '',
        example_translation: '',
        is_primary: true
      }
    ],
    tags: []
  });
  const [generatingMeaning, setGeneratingMeaning] = useState<number | null>(null); // 记录正在生成的index
  const [generatingPhonetic, setGeneratingPhonetic] = useState(false);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // AI一键生成完整信息
  const handleGenerateComplete = async (index: number) => {
    if (!newWord.word.trim()) {
      toast.warning('请先输入单词');
      return;
    }

    setGeneratingMeaning(index);
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');

      // 收集已有的释义,用于避免重复
      const existingMeanings = newWord.definitions
        .filter((def, i) => i !== index && def.meaning.trim())
        .map(def => def.meaning.trim());

      const response = await axios.post(
        `${API_BASE_URL}/ai/generate-complete`,
        {
          word: newWord.word.trim(),
          part_of_speech: newWord.definitions[index].part_of_speech,
          existing_meanings: existingMeanings
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data) {
        const data = response.data;

        // 更新当前释义的所有字段
        const updatedDefs = [...newWord.definitions];
        updatedDefs[index] = {
          ...updatedDefs[index],
          meaning: data.meaning || updatedDefs[index].meaning,
          example_sentence: data.example_sentence || updatedDefs[index].example_sentence,
          example_translation: data.example_translation || updatedDefs[index].example_translation,
        };

        // 同时更新音标(总是更新为最新生成的)
        setNewWord(prev => ({
          ...prev,
          phonetic: data.phonetic || prev.phonetic,
          definitions: updatedDefs
        }));
      } else {
        toast.warning('未能生成完整信息,请手动输入');
      }
    } catch (error: any) {
      console.error('生成失败:', error);
      toast.error('生成失败,请手动输入');
    } finally {
      setGeneratingMeaning(null);
    }
  };

  // 生成释义
  const handleGenerateMeaning = async (index: number) => {
    if (!newWord.word.trim()) {
      toast.warning('请先输入单词');
      return;
    }

    setGeneratingMeaning(index);
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/ai/generate-meaning`,
        {
          word: newWord.word.trim(),
          part_of_speech: newWord.definitions[index].part_of_speech
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data?.meaning) {
        handleUpdateDefinition(index, 'meaning', response.data.meaning);
      } else {
        toast.warning('未能生成释义,请手动输入');
      }
    } catch (error: any) {
      console.error('生成释义失败:', error);
      toast.error('生成释义失败,请手动输入');
    } finally {
      setGeneratingMeaning(null);
    }
  };

  // 自动生成音标
  const handleGeneratePhonetic = async () => {
    if (!newWord.word.trim()) {
      toast.warning('请先输入单词');
      return;
    }

    setGeneratingPhonetic(true);
    try {
      // 使用AI API生成音标
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      const response = await axios.post(
        `${API_BASE_URL}/ai/generate-phonetic`,
        { word: newWord.word.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data?.phonetic) {
        setNewWord({ ...newWord, phonetic: response.data.phonetic });
        toast.success('音标生成成功!');
      } else {
        toast.warning('未能生成音标,请手动输入');
      }
    } catch (error: any) {
      console.error('生成音标失败:', error);

      // 如果AI生成失败,降级到字典API
      try {
        const dictResponse = await axios.get(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${newWord.word}`
        );

        if (dictResponse.data && dictResponse.data[0]?.phonetic) {
          setNewWord({ ...newWord, phonetic: dictResponse.data[0].phonetic });
          toast.success('音标生成成功!(使用字典API)');
        } else if (dictResponse.data && dictResponse.data[0]?.phonetics?.[0]?.text) {
          setNewWord({ ...newWord, phonetic: dictResponse.data[0].phonetics[0].text });
          toast.success('音标生成成功!(使用字典API)');
        } else {
          toast.warning('未找到该单词的音标,请手动输入');
        }
      } catch (fallbackError) {
        console.error('字典API也失败:', fallbackError);
        toast.error('音标生成失败,请手动输入');
      }
    } finally {
      setGeneratingPhonetic(false);
    }
  };

  // 添加释义
  const handleAddDefinition = () => {
    setNewWord({
      ...newWord,
      definitions: [
        ...newWord.definitions,
        {
          part_of_speech: 'n.',
          meaning: '',
          example_sentence: '',
          example_translation: '',
          is_primary: false
        }
      ]
    });
  };

  // 删除释义
  const handleRemoveDefinition = (index: number) => {
    if (newWord.definitions.length <= 1) {
      toast.warning('至少需要保留一个释义');
      return;
    }
    const newDefinitions = newWord.definitions.filter((_, i) => i !== index);
    setNewWord({ ...newWord, definitions: newDefinitions });
  };

  // 更新释义
  const handleUpdateDefinition = (index: number, field: string, value: any) => {
    const newDefinitions = [...newWord.definitions];
    (newDefinitions[index] as any)[field] = value;
    setNewWord({ ...newWord, definitions: newDefinitions });
  };

  // 添加标签
  const handleAddTag = () => {
    if (tagInput.trim() && !newWord.tags.includes(tagInput.trim())) {
      setNewWord({ ...newWord, tags: [...newWord.tags, tagInput.trim()] });
      setTagInput('');
    }
  };

  // 删除标签
  const handleRemoveTag = (tag: string) => {
    setNewWord({ ...newWord, tags: newWord.tags.filter(t => t !== tag) });
  };

  // 提交单词
  const handleSubmit = async () => {
    if (!newWord.word.trim()) {
      toast.warning('请输入单词');
      return;
    }
    if (!newWord.phonetic.trim()) {
      toast.warning('请输入或生成音标');
      return;
    }
    if (!newWord.definitions[0].meaning.trim()) {
      toast.warning('请至少输入一个释义');
      return;
    }

    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      await axios.post(`${API_BASE_URL}/words/`, newWord, {
        headers: { Authorization: `Bearer ${token}` }
      });

      toast.success('单词添加成功!');
      // 重置表单
      setNewWord({
        word: '',
        phonetic: '',
        syllables: '',
        difficulty: 1,
        grade_level: '小学',
        definitions: [
          {
            part_of_speech: 'n.',
            meaning: '',
            example_sentence: '',
            example_translation: '',
            is_primary: true
          }
        ],
        tags: []
      });
    } catch (error: any) {
      console.error('添加单词失败:', error);
      if (error.response?.data?.detail) {
        toast.error(`添加失败: ${error.response.data.detail}`);
      } else {
        toast.error('添加单词失败,请重试');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-primary" />
            <h1 className="text-xl font-bold text-gray-800">教师端 - 单词录入</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/teacher/books')}
              className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md transition"
            >
              返回单词本管理
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

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* 欢迎横幅 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            ✍️ 单词录入
          </h2>
          <p className="opacity-90">手动添加单词到词库,支持AI一键生成音标、释义、例句</p>
        </motion.div>

        {/* 录入表单 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-8 shadow-lg"
        >
          <div className="space-y-6">
            {/* 基本信息 */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* 单词 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  单词 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newWord.word}
                  onChange={(e) => setNewWord({ ...newWord, word: e.target.value })}
                  placeholder="例如: apple"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                />
              </div>

              {/* 音标 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  音标 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newWord.phonetic}
                  onChange={(e) => setNewWord({ ...newWord, phonetic: e.target.value })}
                  placeholder="例如: /ˈæpl/"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                />
              </div>

              {/* 音节划分 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  音节划分
                </label>
                <input
                  type="text"
                  value={newWord.syllables}
                  onChange={(e) => setNewWord({ ...newWord, syllables: e.target.value })}
                  placeholder="例如: ap-ple, 用-分隔音节"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                />
              </div>

              {/* 难度 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  难度等级
                </label>
                <select
                  value={newWord.difficulty}
                  onChange={(e) => setNewWord({ ...newWord, difficulty: parseInt(e.target.value) })}
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
                  适用年级
                </label>
                <select
                  value={newWord.grade_level}
                  onChange={(e) => setNewWord({ ...newWord, grade_level: e.target.value })}
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
              <div className="flex items-center justify-between mb-4">
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

              <div className="space-y-4">
                {newWord.definitions.map((def, index) => (
                  <div key={index} className="p-4 border-2 border-gray-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">释义 {index + 1}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleGenerateComplete(index)}
                          disabled={generatingMeaning === index || !newWord.word.trim()}
                          className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:shadow-lg transition font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Sparkles className="w-4 h-4" />
                          {generatingMeaning === index ? '生成中...' : 'AI一键生成'}
                        </button>
                        {newWord.definitions.length > 1 && (
                          <button
                            onClick={() => handleRemoveDefinition(index)}
                            className="text-red-500 hover:text-red-700 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-3">
                      {/* 词性 */}
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">词性</label>
                        <select
                          value={def.part_of_speech}
                          onChange={(e) => handleUpdateDefinition(index, 'part_of_speech', e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
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

                      {/* 主要释义 */}
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">主要释义</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={def.is_primary}
                            onChange={(e) => {
                              // 如果设为主要释义,取消其他的主要标记
                              if (e.target.checked) {
                                const newDefs = newWord.definitions.map((d, i) => ({
                                  ...d,
                                  is_primary: i === index
                                }));
                                setNewWord({ ...newWord, definitions: newDefs });
                              } else {
                                handleUpdateDefinition(index, 'is_primary', false);
                              }
                            }}
                            className="w-4 h-4"
                          />
                          <span className="text-sm text-gray-600">设为主要释义</span>
                        </div>
                      </div>

                      {/* 释义 */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">中文释义</label>
                        <input
                          type="text"
                          value={def.meaning}
                          onChange={(e) => handleUpdateDefinition(index, 'meaning', e.target.value)}
                          placeholder="例如: 苹果"
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                        />
                      </div>

                      {/* 例句 */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">例句</label>
                        <input
                          type="text"
                          value={def.example_sentence}
                          onChange={(e) => handleUpdateDefinition(index, 'example_sentence', e.target.value)}
                          placeholder="例如: I eat an apple every day."
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                        />
                      </div>

                      {/* 例句翻译 */}
                      <div className="md:col-span-2">
                        <label className="block text-xs text-gray-600 mb-1">例句翻译</label>
                        <input
                          type="text"
                          value={def.example_translation}
                          onChange={(e) => handleUpdateDefinition(index, 'example_translation', e.target.value)}
                          placeholder="例如: 我每天吃一个苹果。"
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
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
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddTag()}
                  placeholder="输入标签后按Enter"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition"
                />
                <button
                  onClick={handleAddTag}
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition"
                >
                  添加
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {newWord.tags.map((tag, index) => (
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
            </div>

            {/* 提交按钮 */}
            <div className="flex gap-4 pt-4">
              <button
                onClick={handleSubmit}
                className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:shadow-lg transition font-medium flex items-center justify-center gap-2"
              >
                <Save className="w-5 h-5" />
                保存单词
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default TeacherWordEntry;
