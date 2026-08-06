import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../../config/env';
import { toast } from '../../components/Toast';
import {
  AlertCircle, Bot, CheckCircle2, Cpu, Globe, KeyRound, Loader2, Mic2,
  Pencil, PenLine, Plus, Sparkles, Trash2, Volume2, X,
} from 'lucide-react';
import StaffWorkspaceHeader from '../../components/staff/StaffWorkspaceHeader';

type TestState = { status: 'testing' | 'ok' | 'error'; message: string };

interface AIProvider {
  id: number;
  provider_name: string;
  display_name: string;
  api_key: string;
  base_url: string;
  model_name: string;
  tts_enabled: boolean;
  tts_model: string | null;
  tts_voice: string | null;
  enabled: boolean;
  is_default: boolean;
  extra_config: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

const AI配置管理 = () => {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestState | null>(null);
  const [cardTesting, setCardTesting] = useState<number | null>(null);
  const [cardTestState, setCardTestState] = useState<Record<number, TestState>>({});

  // 获取token的辅助函数
  const getToken = () => {
    return localStorage.getItem('access_token');
  };

  // 处理401错误
  const handle401 = () => {
    toast.warning('登录已过期,请重新登录');
    localStorage.removeItem('access_token');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // 表单状态
  const [formData, setFormData] = useState({
    provider_name: '',
    display_name: '',
    api_key: '',
    base_url: '',
    model_name: '',
    tts_enabled: false,
    tts_model: '',
    tts_voice: '',
    enabled: true,
    is_default: false,
    ocr_model: '',
    iflytek_app_id: '',
    iflytek_api_secret: '',
  });

  // 加载AI提供商列表
  const loadProviders = async () => {
    try {
      const token = getToken();
      if (!token) {
        handle401();
        return;
      }
      const response = await axios.get(`${API_BASE_URL}/admin/ai/providers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProviders(response.data);
    } catch (error: any) {
      console.error('加载AI配置失败:', error);
      if (error.response?.status === 401) {
        handle401();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  // 测试已保存的配置（用数据库真实密钥）
  const handleCardTest = async (provider: AIProvider) => {
    setCardTesting(provider.id);
    setCardTestState((prev) => ({
      ...prev,
      [provider.id]: { status: 'testing', message: '正在连接模型…' },
    }));
    try {
      const token = getToken();
      if (!token) { handle401(); return; }
      const response = await axios.post(
        `${API_BASE_URL}/admin/ai/providers/${provider.id}/test`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (response.data.success) {
        setCardTestState((prev) => ({
          ...prev,
          [provider.id]: {
            status: 'ok',
            message: `连接成功，响应 ${response.data.response_time} 秒\n模型回复：${response.data.test_output}`,
          },
        }));
      } else {
        setCardTestState((prev) => ({
          ...prev,
          [provider.id]: { status: 'error', message: response.data.message },
        }));
      }
    } catch (error: any) {
      if (error.response?.status === 401) { handle401(); }
      else {
        setCardTestState((prev) => ({
          ...prev,
          [provider.id]: {
            status: 'error',
            message: `测试失败：${error.response?.data?.detail || error.message}`,
          },
        }));
      }
    } finally {
      setCardTesting(null);
    }
  };

  // 测试连接（弹窗内，用表单填写的密钥）
  const handleTest = async (provider?: AIProvider) => {
    setTesting(true);
    setTestResult(null);

    try {
      const token = getToken();
      if (!token) {
        handle401();
        return;
      }
      const testData = provider || formData;

      const response = await axios.post(
        `${API_BASE_URL}/admin/ai/providers/test`,
        {
          provider_name: testData.provider_name,
          api_key: testData.api_key,
          base_url: testData.base_url,
          model_name: testData.model_name,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setTestResult({
          status: 'ok',
          message: `连接成功，响应 ${response.data.response_time} 秒\n模型回复：${response.data.test_output}`,
        });
      } else {
        setTestResult({ status: 'error', message: response.data.message });
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        handle401();
      } else {
        setTestResult({
          status: 'error',
          message: `测试失败：${error.response?.data?.detail || error.message}`,
        });
      }
    } finally {
      setTesting(false);
    }
  };

  // 保存配置
  const handleSave = async () => {
    try {
      const token = getToken();
      if (!token) {
        handle401();
        return;
      }

      let saveData: any = { ...formData };

      // 讯飞ISE特殊处理
      if (formData.provider_name === 'iflytek_ise') {
        saveData.display_name = saveData.display_name || '讯飞语音评测';
        saveData.base_url = 'wss://ise-api.xfyun.cn/v2/open-ise';
        saveData.tts_enabled = false;
        saveData.model_name = saveData.model_name || 'ise';
        saveData.extra_config = {
          app_id: formData.iflytek_app_id,
          api_secret: formData.iflytek_api_secret,
        };
      }

      // 手写批改模型存 extra_config.ocr_model(合并已有键,避免覆盖 iflytek 等配置)
      if (formData.provider_name !== 'iflytek_ise') {
        const mergedExtra: Record<string, any> = { ...(editingProvider?.extra_config || {}) };
        if (formData.ocr_model.trim()) mergedExtra.ocr_model = formData.ocr_model.trim();
        else delete mergedExtra.ocr_model;
        saveData.extra_config = Object.keys(mergedExtra).length > 0 ? mergedExtra : null;
      }

      // 移除前端专用字段
      delete saveData.ocr_model;
      delete saveData.iflytek_app_id;
      delete saveData.iflytek_api_secret;

      if (editingProvider) {
        // 更新
        await axios.put(
          `${API_BASE_URL}/admin/ai/providers/${editingProvider.id}`,
          saveData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } else {
        // 创建
        await axios.post(
          `${API_BASE_URL}/admin/ai/providers`,
          saveData,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      setShowAddModal(false);
      setEditingProvider(null);
      loadProviders();
      toast.success('保存成功!');
    } catch (error: any) {
      if (error.response?.status === 401) {
        handle401();
      } else {
        toast.error(`保存失败: ${error.response?.data?.detail || error.message}`);
      }
    }
  };

  // 删除配置
  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除此配置吗?')) return;

    try {
      const token = getToken();
      if (!token) {
        handle401();
        return;
      }
      await axios.delete(`${API_BASE_URL}/admin/ai/providers/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      loadProviders();
    } catch (error: any) {
      if (error.response?.status === 401) {
        handle401();
      } else {
        toast.error(`删除失败: ${error.response?.data?.detail || error.message}`);
      }
    }
  };

  // 打开编辑对话框
  const handleEdit = (provider: AIProvider) => {
    setEditingProvider(provider);
    setFormData({
      provider_name: provider.provider_name,
      display_name: provider.display_name,
      api_key: '', // 编辑时不显示原密钥
      base_url: provider.base_url,
      model_name: provider.model_name,
      tts_enabled: provider.tts_enabled,
      tts_model: provider.tts_model || '',
      tts_voice: provider.tts_voice || '',
      enabled: provider.enabled,
      is_default: provider.is_default,
      ocr_model: provider.extra_config?.ocr_model || '',
      iflytek_app_id: provider.extra_config?.app_id || '',
      iflytek_api_secret: provider.extra_config?.api_secret || '',
    });
    setShowAddModal(true);
  };

  // 新增配置
  const handleAdd = () => {
    setEditingProvider(null);
    setFormData({
      provider_name: '',
      display_name: '',
      api_key: '',
      base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model_name: 'qwen3-max',
      tts_enabled: true,
      tts_model: 'cosyvoice-v2',
      tts_voice: 'longwan_v2', // 默认英语女声
      enabled: true,
      is_default: false,
      ocr_model: 'qwen3.5-ocr',
      iflytek_app_id: '',
      iflytek_api_secret: '',
    });
    setTestResult(null);
    setShowAddModal(true);
  };

  if (loading) {
    return (
      <div className="app-loading-screen" role="status">
        <div className="app-loading-card"><span className="app-loading-icon"><Sparkles className="h-5 w-5" /></span><span className="app-loading-title">正在加载 AI 服务配置</span></div>
      </div>
    );
  }

  return (
    <div className="admin-legacy-page min-h-screen">
      <StaffWorkspaceHeader role="admin" title="AI 配置管理" subtitle="管理模型、密钥与智能服务" icon={Sparkles} action={<motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={handleAdd} className="admin-primary admin-focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition"><Plus className="h-4 w-4" />添加 AI 服务</motion.button>} />

      <main className="admin-workspace-main">

        {/* 配置卡片列表 */}
        <div className="grid gap-6">
          {providers.map((provider, index) => (
            <motion.div
              key={provider.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="admin-panel rounded-2xl p-4 sm:p-6"
            >
              {/* 头部:标题 + 状态徽章 + 操作。窄屏纵向堆叠,操作按钮独占一行不挤压信息 */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-800 sm:text-xl">
                      {provider.display_name}
                    </h3>
                    {provider.is_default && (
                      <span className="rounded-full bg-[#35658d] px-2.5 py-0.5 text-xs font-semibold text-white">
                        默认
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      provider.enabled
                        ? 'bg-[#e8f6ef] text-[#256b4c]'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {provider.enabled
                        ? <><CheckCircle2 className="h-3 w-3" aria-hidden="true" />已启用</>
                        : <><AlertCircle className="h-3 w-3" aria-hidden="true" />已禁用</>}
                    </span>
                  </div>

                  <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    {[
                      { icon: Cpu, label: '服务商', value: provider.provider_name },
                      { icon: Bot, label: '模型', value: provider.model_name },
                      { icon: KeyRound, label: 'API Key', value: provider.api_key, mono: true },
                      { icon: Globe, label: 'Base URL', value: provider.base_url, mono: true },
                      ...(provider.tts_enabled ? [
                        { icon: Mic2, label: 'TTS 模型', value: provider.tts_model },
                        { icon: Volume2, label: '音色', value: provider.tts_voice },
                      ] : []),
                      ...(provider.extra_config?.ocr_model ? [
                        { icon: PenLine, label: '手写批改', value: provider.extra_config.ocr_model },
                      ] : []),
                    ].map(({ icon: Icon, label, value, mono }) => (
                      <div key={label} className="flex min-w-0 items-baseline gap-2">
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 self-start text-slate-400" aria-hidden="true" />
                        <dt className="shrink-0 text-slate-500">{label}</dt>
                        {/* break-all: 密钥/URL 是长串无空格文本,不断行会把卡片撑出屏幕 */}
                        <dd className={`min-w-0 flex-1 break-all text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>
                          {value || <span className="text-slate-400">未设置</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {/* 手机上三等分铺满(44px 触控高度),桌面回到右上角一排 */}
                <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCardTest(provider)}
                    disabled={cardTesting === provider.id}
                    className="admin-primary admin-focus-ring inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition disabled:opacity-50"
                  >
                    {cardTesting === provider.id
                      ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                    {cardTesting === provider.id ? '测试中' : '测试'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEdit(provider)}
                    className="admin-secondary-light admin-focus-ring inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(provider.id)}
                    aria-label={`删除 ${provider.display_name}`}
                    className="admin-focus-ring inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sm:hidden">删除</span>
                  </button>
                </div>
              </div>

              {/* 测试结果:整卡通栏。此前它是上面 flex 行的第三个子项,
                  桌面端被挤成按钮旁的窄条,长回复完全读不了 */}
              {cardTestState[provider.id] && (
                <div
                  role="status"
                  className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${
                    cardTestState[provider.id].status === 'ok'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : cardTestState[provider.id].status === 'testing'
                      ? 'border-sky-200 bg-sky-50 text-sky-800'
                      : 'border-rose-200 bg-rose-50 text-rose-800'
                  }`}
                >
                  {cardTestState[provider.id].status === 'ok' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : cardTestState[provider.id].status === 'testing' ? (
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-relaxed">
                    {cardTestState[provider.id].message}
                  </p>
                </div>
              )}
            </motion.div>
          ))}

          {providers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 py-14 text-center">
              <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#eeeafa] text-[#7259a6]">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="font-semibold text-slate-700">还没有配置 AI 服务</p>
              <p className="mt-1 text-sm text-slate-500">点击右上角「添加 AI 服务」开始配置</p>
            </div>
          )}
        </div>
      </main>

      {/* 添加/编辑对话框 */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={() => setShowAddModal(false)}
          >
            {/* 手机上贴底当 bottom sheet(拇指可达),桌面回到居中卡片。
                用 dvh 而非 vh:iOS Safari 地址栏收起时 vh 会让底部动作条被顶出视口 */}
            <motion.div
              initial={{ y: '4%', opacity: 0.6 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '3%', opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="ai-provider-modal-title"
              className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:max-h-[88dvh] sm:rounded-2xl"
            >
              {/* 标题栏固定:表单很长,滚动时仍知道自己在编辑什么 */}
              <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 sm:px-7">
                <h2 id="ai-provider-modal-title" className="flex-1 text-lg font-bold text-slate-800 sm:text-xl">
                  {editingProvider ? '编辑 AI 服务' : '添加 AI 服务'}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  aria-label="关闭"
                  className="admin-focus-ring -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
                {/* 服务商选择 */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    服务商 *
                  </label>
                  <select
                    value={formData.provider_name}
                    onChange={(e) => setFormData({ ...formData, provider_name: e.target.value })}
                    disabled={!!editingProvider}
                    className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                  >
                    <option value="">请选择</option>
                    <option value="qwen">通义千问 (Qwen)</option>
                    <option value="openai">OpenAI</option>
                    <option value="claude">Claude</option>
                    <option value="iflytek_ise">讯飞语音评测 (iFlytek ISE)</option>
                  </select>
                </div>

                {/* 显示名称 */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    显示名称 *
                  </label>
                  <input
                    type="text"
                    value={formData.display_name}
                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                    placeholder="如: 通义千问 Qwen-Max"
                    className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    {formData.provider_name === 'iflytek_ise' ? 'APIKey *' : 'API Key *'} {editingProvider && '(留空表示不修改)'}
                  </label>
                  <input
                    type="password"
                    value={formData.api_key}
                    onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                    placeholder={formData.provider_name === 'iflytek_ise' ? '讯飞APIKey' : 'sk-...'}
                    className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 font-mono text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                  />
                </div>

                {/* 讯飞ISE专用字段 */}
                {formData.provider_name === 'iflytek_ise' && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        APPID *
                      </label>
                      <input
                        type="text"
                        value={formData.iflytek_app_id}
                        onChange={(e) => setFormData({ ...formData, iflytek_app_id: e.target.value })}
                        placeholder="如: 8ef38b6c"
                        className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 font-mono text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        APISecret * {editingProvider && '(留空表示不修改)'}
                      </label>
                      <input
                        type="password"
                        value={formData.iflytek_api_secret}
                        onChange={(e) => setFormData({ ...formData, iflytek_api_secret: e.target.value })}
                        placeholder="讯飞APISecret"
                        className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 font-mono text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                      />
                    </div>
                  </>
                )}

                {/* Base URL - 讯飞ISE不显示 */}
                {formData.provider_name !== 'iflytek_ise' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={formData.base_url}
                    onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                    placeholder="https://..."
                    className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                  />
                </div>
                )}

                {/* 模型名称 - 讯飞ISE不显示 */}
                {formData.provider_name !== 'iflytek_ise' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    模型名称 *
                  </label>
                  <input
                    type="text"
                    value={formData.model_name}
                    onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
                    placeholder="qwen-max / gpt-4 / claude-3-sonnet"
                    className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                  />
                </div>
                )}

                {/* 手写批改模型 - 讯飞ISE不显示 */}
                {formData.provider_name !== 'iflytek_ise' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    手写批改模型 (视觉 OCR)
                  </label>
                  <input
                    type="text"
                    value={formData.ocr_model}
                    onChange={(e) => setFormData({ ...formData, ocr_model: e.target.value })}
                    placeholder="qwen3.5-ocr"
                    className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                  />
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    用于「纸笔听写」拍照批改。留空时通义千问自动用 qwen3.5-ocr，其他服务商不参与批改。
                  </p>
                </div>
                )}

                {/* TTS开关 - 讯飞ISE不显示 */}
                {formData.provider_name !== 'iflytek_ise' && (
                <>
                {/* 整行可点(min-h-12):20px 的复选框本身远低于 44px 触控下限 */}
                <label
                  htmlFor="tts_enabled"
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 transition hover:bg-slate-100"
                >
                  <input
                    type="checkbox"
                    id="tts_enabled"
                    checked={formData.tts_enabled}
                    onChange={(e) => setFormData({ ...formData, tts_enabled: e.target.checked })}
                    className="h-5 w-5 shrink-0 accent-[#35658d]"
                  />
                  <span className="text-sm font-semibold text-slate-700">启用语音合成 (TTS)</span>
                </label>

                {/* TTS配置 */}
                {formData.tts_enabled && (
                  <div className="space-y-4 pl-8">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        TTS模型
                      </label>
                      <select
                        value={formData.tts_model}
                        onChange={(e) => setFormData({ ...formData, tts_model: e.target.value })}
                        className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                      >
                        <option value="cosyvoice-v1">CosyVoice V1 (基础版)</option>
                        <option value="cosyvoice-v2">CosyVoice V2 (增强版)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        音色选择
                      </label>
                      <select
                        value={formData.tts_voice}
                        onChange={(e) => setFormData({ ...formData, tts_voice: e.target.value })}
                        className="w-full min-h-12 rounded-lg border border-slate-300 px-4 py-3 text-base focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                      >
                        <optgroup label="🇬🇧 英语女声 (推荐)">
                          <option value="longwan_v2">Wan 婉 - 英语女声 (温柔)</option>
                          <option value="longyue_v2">Yue 悦 - 英语女声 (活泼)</option>
                          <option value="longxiaobai_v2">Bai 白 - 英语女声 (清晰)</option>
                        </optgroup>
                        <optgroup label="🇨🇳 中英双语女声">
                          <option value="longxiaochun_v2">龙小淳 - 双语女声 (甜美)</option>
                          <option value="longxiaoxia_v2">龙小夏 - 双语女声 (知性)</option>
                        </optgroup>
                        <optgroup label="🇨🇳 中文男声">
                          <option value="longlaotie_v2">龙老铁 - 中文男声 (东北味)</option>
                        </optgroup>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        💡 人教版英语建议选择英语女声 (Wan/Yue/Bai)，发音更标准
                      </p>
                    </div>
                  </div>
                )}
                </>
                )}

                {/* 功能开关:窄屏纵向堆叠。此前 flex gap-6 两个开关并排,
                    320px 下「设为默认服务」会挤出容器 */}
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                  {[
                    { id: 'enabled', label: '启用此服务', checked: formData.enabled,
                      onChange: (v: boolean) => setFormData({ ...formData, enabled: v }) },
                    { id: 'is_default', label: '设为默认服务', checked: formData.is_default,
                      onChange: (v: boolean) => setFormData({ ...formData, is_default: v }) },
                  ].map((sw) => (
                    <label
                      key={sw.id}
                      htmlFor={sw.id}
                      className="flex min-h-12 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 transition hover:bg-slate-100"
                    >
                      <input
                        type="checkbox"
                        id={sw.id}
                        checked={sw.checked}
                        onChange={(e) => sw.onChange(e.target.checked)}
                        className="h-5 w-5 shrink-0 accent-[#35658d]"
                      />
                      <span className="text-sm font-semibold text-slate-700">{sw.label}</span>
                    </label>
                  ))}
                </div>

                {/* 测试结果 */}
                {testResult && (
                  <div
                    role="status"
                    className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
                      testResult.status === 'ok'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-rose-200 bg-rose-50 text-rose-800'
                    }`}
                  >
                    {testResult.status === 'ok'
                      ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                    <p className="min-w-0 flex-1 whitespace-pre-wrap break-words leading-relaxed">
                      {testResult.message}
                    </p>
                  </div>
                )}
              </div>

              {/* 动作条固定在底部:表单一屏装不下,此前「保存」跟在表单末尾,
                  手机上必须滚到底才能提交。取消移到标题栏的 ✕,底部只留两个正向动作 */}
              <div
                className="flex gap-3 border-t border-slate-200 bg-white px-5 py-3 sm:px-7 sm:py-4"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
              >
                <button
                  type="button"
                  onClick={() => handleTest()}
                  disabled={testing || !formData.api_key || !formData.model_name}
                  className="admin-secondary-light admin-focus-ring inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {testing
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                  {testing ? '测试中…' : '测试连接'}
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  className="admin-primary admin-focus-ring inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition"
                >
                  保存配置
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AI配置管理;
