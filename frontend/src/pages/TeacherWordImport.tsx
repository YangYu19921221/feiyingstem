import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, Upload, Download, FileSpreadsheet, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { toast } from '../components/Toast';
import * as XLSX from 'xlsx';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';

interface UserData {
  id: number;
  username: string;
  full_name: string;
  role: string;
}

interface WordRow {
  word: string;
  phonetic: string;
  syllables?: string;
  part_of_speech: string;
  meaning: string;
  difficulty: number;
  grade_level: string;
  example_sentence?: string;
  example_translation?: string;
  tags?: string;
}

interface ImportResult {
  success_count: number;
  failed_count: number;
  failed_words: string[];
}

const TeacherWordImport = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<WordRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

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

  // 下载模板
  const handleDownloadTemplate = () => {
    const template = [
      {
        word: 'apple',
        phonetic: '/ˈæpl/',
        syllables: 'ap-ple',
        part_of_speech: 'n.',
        meaning: '苹果',
        difficulty: 1,
        grade_level: '小学',
        example_sentence: 'I eat an apple.',
        example_translation: '我吃一个苹果。',
        tags: '水果,常用'
      },
      {
        word: 'book',
        phonetic: '/bʊk/',
        syllables: 'book',
        part_of_speech: 'n.',
        meaning: '书;书籍',
        difficulty: 1,
        grade_level: '小学',
        example_sentence: 'This is my book.',
        example_translation: '这是我的书。',
        tags: '学习用品,常用'
      },
      {
        word: 'beautiful',
        phonetic: '/ˈbjuːtɪfl/',
        syllables: 'beau-ti-ful',
        part_of_speech: 'adj.',
        meaning: '美丽的;漂亮的',
        difficulty: 3,
        grade_level: '小学',
        example_sentence: 'She is beautiful.',
        example_translation: '她很漂亮。',
        tags: '外貌,常用'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '单词导入模板');
    XLSX.writeFile(wb, '单词导入模板.xlsx');
  };

  // 处理文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // 检查文件类型
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];

    if (!allowedTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.warning('请上传Excel文件(.xlsx, .xls)或CSV文件(.csv)');
      return;
    }

    setFile(selectedFile);
    parseFile(selectedFile);
  };

  // 解析Excel/CSV文件
  const parseFile = (file: File) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json<any>(worksheet);

        // 验证和转换数据
        const validData: WordRow[] = [];
        const errors: string[] = [];

        json.forEach((row, index) => {
          const rowNum = index + 2; // Excel行号(从2开始,因为第1行是标题)

          // 验证必填字段
          if (!row.word || !row.phonetic || !row.part_of_speech || !row.meaning) {
            errors.push(`第${rowNum}行: 缺少必填字段`);
            return;
          }

          if (!row.difficulty || row.difficulty < 1 || row.difficulty > 5) {
            errors.push(`第${rowNum}行: 难度必须是1-5之间的整数`);
            return;
          }

          if (!['小学', '初中', '高中'].includes(row.grade_level)) {
            errors.push(`第${rowNum}行: 年级必须是"小学"、"初中"或"高中"`);
            return;
          }

          validData.push({
            word: String(row.word).trim(),
            phonetic: String(row.phonetic).trim(),
            syllables: row.syllables ? String(row.syllables).trim().replace(/-/g, '#') : undefined,
            part_of_speech: String(row.part_of_speech).trim(),
            meaning: String(row.meaning).trim(),
            difficulty: Number(row.difficulty),
            grade_level: String(row.grade_level).trim(),
            example_sentence: row.example_sentence ? String(row.example_sentence).trim() : undefined,
            example_translation: row.example_translation ? String(row.example_translation).trim() : undefined,
            tags: row.tags ? String(row.tags).trim() : undefined
          });
        });

        if (errors.length > 0) {
          toast.warning(`文件解析发现错误:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...还有${errors.length - 5}个错误` : ''}`);
        }

        if (validData.length === 0) {
          toast.error('没有有效的数据可以导入');
          setFile(null);
          return;
        }

        setParsedData(validData);
        toast.success(`成功解析 ${validData.length} 个单词`);
      } catch (error) {
        console.error('文件解析失败:', error);
        toast.error('文件解析失败,请检查文件格式是否正确');
        setFile(null);
      }
    };

    reader.readAsBinaryString(file);
  };

  // 执行导入
  const handleImport = async () => {
    if (parsedData.length === 0) {
      toast.warning('请先选择并解析文件');
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const token = localStorage.getItem('access_token');

      // 转换数据格式为后端期望的格式
      const words = parsedData.map(row => ({
        word: row.word,
        phonetic: row.phonetic,
        syllables: row.syllables || null,
        difficulty: row.difficulty,
        grade_level: row.grade_level,
        definitions: [
          {
            part_of_speech: row.part_of_speech,
            meaning: row.meaning,
            example_sentence: row.example_sentence || '',
            example_translation: row.example_translation || '',
            is_primary: true
          }
        ],
        tags: row.tags ? row.tags.split(',').map(t => t.trim()).filter(t => t) : []
      }));

      const response = await axios.post(
        `${API_BASE_URL}/words/batch-import`,
        {
          words: words,
          book_id: null // 不指定单词本,只添加到词库
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setImportResult(response.data);
      toast.success(`导入完成!\n成功: ${response.data.success_count} 个\n失败: ${response.data.failed_count} 个`);

      // 清空数据
      setFile(null);
      setParsedData([]);
    } catch (error: any) {
      console.error('导入失败:', error);
      if (error.response?.data?.detail) {
        toast.error(`导入失败: ${error.response.data.detail}`);
      } else {
        toast.error('导入失败,请重试');
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-primary" />
            <h1 className="text-xl font-bold text-gray-800">教师端 - 批量导入单词</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/teacher/words/list')}
              className="text-sm px-3 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-md transition font-medium"
            >
              单词库
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

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* 欢迎横幅 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-orange-600 to-amber-600 rounded-2xl p-6 mb-8 text-white shadow-lg"
        >
          <h2 className="text-2xl font-bold mb-2">
            📤 批量导入单词
          </h2>
          <p className="opacity-90">通过Excel文件快速导入大量单词,提升录入效率</p>
        </motion.div>

        {/* 步骤指引 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 mb-6 shadow-md"
        >
          <h3 className="text-lg font-bold text-gray-800 mb-4">使用步骤</h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-xl">
              <div className="w-12 h-12 bg-blue-500 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">
                1
              </div>
              <h4 className="font-semibold text-gray-800 mb-2">下载模板</h4>
              <p className="text-sm text-gray-600">下载Excel模板文件,了解数据格式</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-xl">
              <div className="w-12 h-12 bg-green-500 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">
                2
              </div>
              <h4 className="font-semibold text-gray-800 mb-2">填写数据</h4>
              <p className="text-sm text-gray-600">按模板格式填写单词数据</p>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-xl">
              <div className="w-12 h-12 bg-orange-500 text-white rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">
                3
              </div>
              <h4 className="font-semibold text-gray-800 mb-2">上传导入</h4>
              <p className="text-sm text-gray-600">上传文件并点击导入按钮</p>
            </div>
          </div>
        </motion.div>

        {/* 下载模板 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-2xl p-6 mb-6 shadow-md"
        >
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Download className="w-5 h-5" />
            第一步: 下载模板
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            点击下载按钮获取Excel模板,模板包含示例数据和格式说明
          </p>
          <button
            onClick={handleDownloadTemplate}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-lg hover:shadow-lg transition font-medium flex items-center gap-2"
          >
            <Download className="w-5 h-5" />
            下载Excel模板
          </button>
        </motion.div>

        {/* 文件上传 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-6 mb-6 shadow-md"
        >
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5" />
            第二步: 上传文件
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            支持 .xlsx, .xls, .csv 格式,文件大小不超过5MB
          </p>

          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-primary transition">
            <input
              type="file"
              id="file-upload"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer"
            >
              <FileSpreadsheet className="w-16 h-16 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600 mb-2">
                {file ? (
                  <>
                    <span className="font-semibold text-primary">{file.name}</span>
                    <br />
                    <span className="text-sm">已选择 {parsedData.length} 个单词</span>
                  </>
                ) : (
                  '点击选择文件或拖拽文件到此处'
                )}
              </p>
              <p className="text-sm text-gray-400">
                支持格式: Excel (.xlsx, .xls) 或 CSV (.csv)
              </p>
            </label>
          </div>

          {file && parsedData.length > 0 && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle className="w-5 h-5" />
                <span className="font-semibold">文件解析成功!</span>
              </div>
              <p className="text-sm text-green-600 mt-1">
                共解析出 {parsedData.length} 个有效单词
              </p>
            </div>
          )}
        </motion.div>

        {/* 开始导入 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-6 mb-6 shadow-md"
        >
          <h3 className="text-lg font-bold text-gray-800 mb-4">
            第三步: 开始导入
          </h3>
          <button
            onClick={handleImport}
            disabled={!file || parsedData.length === 0 || importing}
            className="w-full py-4 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-lg hover:shadow-lg transition font-medium text-lg flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="w-6 h-6" />
            {importing ? '导入中...' : `导入 ${parsedData.length} 个单词到词库`}
          </button>
        </motion.div>

        {/* 导入结果 */}
        <AnimatePresence>
          {importResult && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-2xl p-6 shadow-md"
            >
              <h3 className="text-lg font-bold text-gray-800 mb-4">导入结果</h3>

              <div className="space-y-4">
                {/* 成功统计 */}
                <div className="p-4 bg-green-50 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                    <div>
                      <p className="font-semibold text-green-800">导入成功</p>
                      <p className="text-sm text-green-600">{importResult.success_count} 个单词</p>
                    </div>
                  </div>
                </div>

                {/* 失败统计 */}
                {importResult.failed_count > 0 && (
                  <div className="p-4 bg-red-50 rounded-lg">
                    <div className="flex items-center gap-3 mb-3">
                      <XCircle className="w-8 h-8 text-red-600" />
                      <div>
                        <p className="font-semibold text-red-800">导入失败</p>
                        <p className="text-sm text-red-600">{importResult.failed_count} 个单词</p>
                      </div>
                    </div>

                    {importResult.failed_words.length > 0 && (
                      <div className="mt-3 pl-11">
                        <p className="text-sm font-medium text-gray-700 mb-2">失败详情:</p>
                        <div className="text-sm text-gray-600 space-y-1 max-h-40 overflow-y-auto">
                          {importResult.failed_words.map((err, index) => (
                            <div key={index} className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                              <span>{err}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => navigate('/teacher/words/list')}
                    className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:shadow-lg transition font-medium"
                  >
                    查看单词库
                  </button>
                  <button
                    onClick={() => {
                      setImportResult(null);
                      setFile(null);
                      setParsedData([]);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium"
                  >
                    继续导入
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 注意事项 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-blue-50 rounded-2xl p-6 mt-6"
        >
          <h3 className="text-lg font-bold text-blue-800 mb-3 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            注意事项
          </h3>
          <ul className="text-sm text-blue-700 space-y-2">
            <li>• 必填字段: word(单词)、phonetic(音标)、part_of_speech(词性)、meaning(释义)、difficulty(难度)、grade_level(年级)</li>
            <li>• 可选字段: syllables(音节划分,用-分隔,如 beau-ti-ful)、example_sentence、example_translation、tags</li>
            <li>• 难度范围: 1-5 (1=简单, 5=困难)</li>
            <li>• 年级选项: 小学、初中、高中</li>
            <li>• 词性选项: n.(名词)、v.(动词)、adj.(形容词)、adv.(副词)、prep.(介词)、conj.(连词)、pron.(代词)</li>
            <li>• 如果单词已存在,将跳过该单词</li>
            <li>• 建议每次导入不超过1000个单词</li>
          </ul>
        </motion.div>
      </div>
    </div>
  );
};

export default TeacherWordImport;
