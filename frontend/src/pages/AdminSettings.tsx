import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { toast } from '../components/Toast';
import { BellRing, RotateCcw, Rocket, Save, Settings, Sparkles } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

const DEFAULT_SETTINGS = {
  siteName: '英语学习助手',
  allowRegistration: true,
  requireEmailVerification: false,
  enableAI: true,
  aiProvider: 'openai',
  maxUploadSize: 10,
  sessionTimeout: 30,
  enableNotifications: true,
  enableBackup: true,
  backupInterval: 24,
};

const AdminSettings: React.FC = () => {
  // 系统设置状态(从后端加载)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsState, setSettingsState] = useState<'loading' | 'ready' | 'error'>('loading');

  // 加载已保存的设置
  const loadSettings = async () => {
    setSettingsState('loading');
    try {
      const data = await api.get('/admin/settings');
      if (data && typeof data === 'object') setSettings({ ...DEFAULT_SETTINGS, ...data });
      setSettingsState('ready');
    } catch {
      setSettingsState('error');
      toast.error('设置加载失败，请重试，当前未允许保存默认值');
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleSave = async () => {
    if (settingsState !== 'ready') {
      toast.warning('设置尚未成功加载，暂不能保存');
      return;
    }
    setSaving(true);
    try {
      await api.put('/admin/settings', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '保存失败,请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (confirm('确定要重置为默认设置吗?')) {
      setSettings(DEFAULT_SETTINGS);
    }
  };

  return (
    <div className="admin-legacy-page min-h-screen">
      <StaffWorkspaceHeader role="admin" title="系统设置" subtitle="配置系统参数和功能选项" />

      <main className="admin-workspace-main">

        {settingsState === 'error' && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            <span>无法读取当前设置，修复连接后再保存，避免覆盖线上配置。</span>
            <button type="button" onClick={() => void loadSettings()} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-100">重新加载</button>
          </div>
        )}

        <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900" role="note">
          <span className="mt-0.5 shrink-0 font-bold">提示</span>
          <p className="leading-6">这些选项当前由系统保存，部分开关（邮箱验证、会话超时、通知、自动备份）还没有接入运行逻辑；保存后会作为后续版本配置，不会立即改变线上行为。</p>
        </div>

        {saved && (
          <div className="mb-6 p-4 bg-green-100 border border-green-300 text-green-800 rounded-xl flex items-center gap-2">
            <span className="text-xl">✓</span>
            <span>设置已保存!</span>
          </div>
        )}

        <fieldset disabled={settingsState !== 'ready'} className="contents">
        {/* 基本设置 */}
        <div className="admin-panel mb-5 rounded-2xl p-5 sm:p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e8edf8] text-[#4f6ea7]"><Settings className="h-4 w-4" /></span> 基本设置
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                网站名称
              </label>
              <input
                type="text"
                value={settings.siteName}
                onChange={(e) => setSettings({ ...settings, siteName: e.target.value })}
                disabled={settingsState !== 'ready'}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30 focus:border-[#3976a9]"
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">允许用户注册</div>
                <div className="text-sm text-gray-500">保存为后续版本的注册策略配置</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.allowRegistration}
                  onChange={(e) => setSettings({ ...settings, allowRegistration: e.target.checked })}
                  disabled={settingsState !== 'ready'}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#3976a9]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3976a9]"></div>
              </label>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">邮箱验证</div>
                <div className="text-sm text-gray-500">当前版本暂未接入，保存为后续配置</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.requireEmailVerification}
                  onChange={(e) => setSettings({ ...settings, requireEmailVerification: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#3976a9]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3976a9]"></div>
              </label>
            </div>
          </div>
        </div>

        {/* AI设置 */}
        <div className="admin-panel mb-5 rounded-2xl p-5 sm:p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eeeafa] text-[#7259a6]"><Sparkles className="h-4 w-4" /></span> AI功能设置
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">启用AI功能</div>
                <div className="text-sm text-gray-500">保存 AI 功能开关，具体服务由 AI 配置页控制</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableAI}
                  onChange={(e) => setSettings({ ...settings, enableAI: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#3976a9]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3976a9]"></div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                AI服务提供商
              </label>
              <select
                value={settings.aiProvider}
                onChange={(e) => setSettings({ ...settings, aiProvider: e.target.value })}
                disabled={!settings.enableAI}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30 focus:border-[#3976a9] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="openai">OpenAI (GPT-4)</option>
                <option value="claude">Anthropic (Claude)</option>
              </select>
            </div>
          </div>
        </div>

        {/* 系统参数 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 sm:p-6 mb-5">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span>⚡</span> 系统参数
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                最大上传文件大小 (MB)
              </label>
              <input
                type="number"
                value={settings.maxUploadSize}
                onChange={(e) => setSettings({ ...settings, maxUploadSize: Number.parseInt(e.target.value, 10) || 1 })}
                min="1"
                max="100"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30 focus:border-[#3976a9]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                会话超时时间 (分钟)
              </label>
              <input
                type="number"
                value={settings.sessionTimeout}
                onChange={(e) => setSettings({ ...settings, sessionTimeout: Number.parseInt(e.target.value, 10) || 5 })}
                min="5"
                max="1440"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30 focus:border-[#3976a9]"
              />
            </div>
          </div>
        </div>

        {/* 通知和备份 */}
        <div className="admin-panel mb-5 rounded-2xl p-5 sm:p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e4f3f5] text-[#2f8791]"><BellRing className="h-4 w-4" /></span> 通知和备份
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">启用系统通知</div>
                <div className="text-sm text-gray-500">当前版本暂未接入通知调度</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableNotifications}
                  onChange={(e) => setSettings({ ...settings, enableNotifications: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#3976a9]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3976a9]"></div>
              </label>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-100 rounded-lg">
              <div>
                <div className="font-medium text-gray-800">自动备份</div>
                <div className="text-sm text-gray-500">当前版本暂未接入自动备份调度</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enableBackup}
                  onChange={(e) => setSettings({ ...settings, enableBackup: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#3976a9]/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3976a9]"></div>
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                备份间隔 (小时)
              </label>
              <input
                type="number"
                value={settings.backupInterval}
                onChange={(e) => setSettings({ ...settings, backupInterval: Number.parseInt(e.target.value, 10) || 1 })}
                disabled={!settings.enableBackup}
                min="1"
                max="168"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30 focus:border-[#3976a9] disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        </fieldset>

        {/* 系统更新 */}
        <SystemUpdatePanel />

        {/* 操作按钮 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <button
            onClick={handleSave}
            disabled={saving || settingsState !== 'ready'}
            className="admin-primary admin-focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold transition disabled:opacity-50"
          >
            <Save className="h-4 w-4" />{saving ? '保存中...' : '保存设置'}
          </button>
          <button
            onClick={handleReset}
            disabled={settingsState !== 'ready'}
            className="admin-secondary-light admin-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold transition"
          >
            <RotateCcw className="h-4 w-4" />重置为默认
          </button>
        </div>
      </main>
    </div>
  );
};

// 系统更新面板
const SystemUpdatePanel: React.FC = () => {
  const [version, setVersion] = useState<any>(null);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<any>(null);

  useEffect(() => {
    api.get('/admin/system/version').then(setVersion).catch(() => {});
    // 自动检查更新
    api.get('/admin/system/check-update').then(setUpdateInfo).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateInfo(null);
    try {
      const data = await api.get('/admin/system/check-update');
      setUpdateInfo(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '检查更新失败');
    } finally {
      setChecking(false);
    }
  };

  const handleUpdate = async () => {
    if (!confirm('确定要更新系统吗？更新过程中服务会短暂中断。')) return;
    setUpdating(true);
    setUpdateResult(null);
    try {
      const data = await api.post('/admin/system/update');
      setUpdateResult(data);
      if (data.success) {
        setTimeout(() => window.location.reload(), 5000);
      }
    } catch (err: any) {
      // 网络错误通常是因为后端重启导致连接断开，实际更新已成功
      if (!err?.response) {
        setUpdateResult({ success: true, message: '系统正在重启中，请稍候...' });
        setTimeout(() => window.location.reload(), 6000);
      } else {
        setUpdateResult({ success: false, message: err?.response?.data?.detail || '更新失败' });
      }
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="admin-panel mb-5 rounded-2xl p-5 sm:p-6">
      <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fff3d9] text-[#9a6a1f]"><Rocket className="h-4 w-4" /></span> 系统更新
      </h2>

      {/* 当前版本 */}
      <div className="p-4 bg-slate-50 border border-slate-100 rounded-lg mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-gray-500">当前版本</div>
            <div className="flex items-center gap-3">
              <span className={`text-2xl font-bold ${updateInfo?.has_update ? 'text-[#b4532f] animate-pulse' : 'text-gray-800'}`}>v{version?.version || '...'}</span>
              <span className="text-xs text-gray-400 font-mono">{version?.commit?.slice(0, 7) || ''}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {updateInfo?.has_update && !checking && (
              <span className="px-3 py-1 bg-red-100 text-red-600 rounded-full text-sm font-medium animate-pulse">
                有新版本 v{updateInfo.remote_version}
              </span>
            )}
            <button
              onClick={handleCheckUpdate}
              disabled={checking}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition disabled:opacity-50 font-medium"
            >
              {checking ? '检查中...' : '检查更新'}
            </button>
          </div>
        </div>
      </div>

      {/* 更新信息 */}
      {updateInfo && (
        <div className={`p-4 rounded-lg mb-4 ${updateInfo.has_update ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200'}`}>
          {updateInfo.has_update ? (
            <>
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-bold text-orange-700">发现新版本!</div>
                  <div className="text-sm text-orange-600">
                    v{updateInfo.local_version} → v{updateInfo.remote_version}
                  </div>
                </div>
                <button
                  onClick={handleUpdate}
                  disabled={updating}
                  className="px-6 py-2 bg-[#3976a9] hover:bg-[#2e628f] text-white rounded-lg transition disabled:opacity-50 font-semibold"
                >
                  {updating ? '更新中...' : '立即更新'}
                </button>
              </div>
              {updateInfo.changelog && (
                <div className="mt-2 p-3 bg-white rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">更新内容：</div>
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap">{updateInfo.changelog}</pre>
                </div>
              )}
            </>
          ) : (
            <div className="text-green-700 font-medium">已是最新版本</div>
          )}
        </div>
      )}

      {/* 更新进度 */}
      {updating && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent"></div>
            <span className="text-blue-700 font-medium">正在更新系统，请勿关闭页面...</span>
          </div>
        </div>
      )}

      {/* 更新结果 */}
      {updateResult && (
        <div className={`p-4 rounded-lg mb-4 ${updateResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className={`font-bold mb-2 ${updateResult.success ? 'text-green-700' : 'text-red-700'}`}>
            {updateResult.success ? '更新成功!' : '更新失败'}
          </div>
          <p className="text-sm text-gray-600 mb-2">{updateResult.message}</p>
          {updateResult.steps && (
            <div className="space-y-1">
              {updateResult.steps.map((step: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span>{step.success ? '✅' : '❌'}</span>
                  <span className="text-gray-700">{step.step}</span>
                </div>
              ))}
            </div>
          )}
          {updateResult.success && (
            <p className="text-sm text-green-600 mt-2">页面将在 3 秒后自动刷新...</p>
          )}
        </div>
      )}

      {/* 更新历史 */}
      {version?.update_history?.length > 0 && (
        <div className="mt-4">
          <div className="text-sm font-medium text-gray-500 mb-2">更新历史</div>
          <div className="space-y-1">
            {version.update_history.slice(-5).reverse().map((log: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-sm p-2 bg-gray-50 rounded">
                <span>{log.success ? '✅' : '❌'}</span>
                <span className="font-mono text-gray-600">{log.commit}</span>
                <span className="text-gray-400">{log.duration}</span>
                <span className="text-gray-400 ml-auto">{new Date(log.time).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminSettings;
