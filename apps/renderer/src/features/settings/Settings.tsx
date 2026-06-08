/**
 * 设置页 (P5 v1 + P7 v1)
 *
 * 全屏模态对话框,包含所有用户偏好设置项。
 * 由 TitleBar 设置按钮或快捷键 Ctrl+, 触发打开。
 *
 * 标签页(P7 v1):
 * - 外观
 * - 文件列表
 * - 操作
 * - 语言
 * - 快捷键
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ACCENT_PRESETS, useThemeStore, type ThemeMode } from '../../stores/theme-store';
import { useSettingsStore, type SortField, type SortDir, type Language } from '../../stores/settings-store';
import { Shortcuts } from './Shortcuts';
import './Settings.css';

const THEME_OPTIONS: { value: ThemeMode; label: string; desc: string }[] = [
  { value: 'light', label: '浅色', desc: '明亮的浅色主题' },
  { value: 'dark', label: '深色', desc: '深色主题,适合夜间使用' },
  { value: 'system', label: '跟随系统', desc: '自动跟随操作系统的外观设置' },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'name', label: '名称' },
  { value: 'size', label: '大小' },
  { value: 'mtime', label: '修改时间' },
  { value: 'type', label: '类型' },
];

const SORT_DIR_OPTIONS: { value: SortDir; label: string }[] = [
  { value: 'asc', label: '升序 ↑' },
  { value: 'desc', label: '降序 ↓' },
];

const LANG_OPTIONS: { value: Language; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

type TabId = 'appearance' | 'filelist' | 'operations' | 'language' | 'shortcuts' | 'extensions' | 'about';

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: 'appearance', label: '外观', icon: '🎨' },
  { id: 'filelist', label: '文件列表', icon: '📄' },
  { id: 'operations', label: '操作', icon: '⚡' },
  { id: 'language', label: '语言', icon: '🌐' },
  { id: 'shortcuts', label: '快捷键', icon: '⌨' },
  { id: 'extensions', label: '扩展', icon: '🔌' },
  { id: 'about', label: '关于', icon: 'ℹ' },
];

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}

function Toggle({ checked, onChange, label, description }: ToggleProps) {
  return (
    <label className="settings-toggle-row">
      <span className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {description && <span className="settings-toggle-desc">{description}</span>}
      </span>
      <button
        className={`settings-toggle ${checked ? 'on' : 'off'}`}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        title={checked ? '点击关闭' : '点击开启'}
      >
        <span className="settings-toggle-thumb" />
      </button>
    </label>
  );
}

interface SelectProps {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
}

function Select({ value, options, onChange, label }: SelectProps) {
  return (
    <div className="settings-select-row">
      <span className="settings-select-label">{label}</span>
      <select
        className="settings-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">{title}</div>
      <div className="settings-section-body">{children}</div>
    </div>
  );
}

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  // 标签页 (P7 v1)
  const [activeTab, setActiveTab] = useState<TabId>('appearance');

  // P7: 取 app version(给"关于"tab 用)
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    void window.tabula.app.version().then(setVersion);
  }, []);

  // theme-store (theme + accent)
  const mode = useThemeStore((s) => s.mode);
  const accentColor = useThemeStore((s) => s.accentColor);
  const themeSetMode = useThemeStore((s) => s.setMode);
  const themeSetAccent = useThemeStore((s) => s.setAccent);

  // settings store
  const showHidden = useSettingsStore((s) => s.showHidden);
  const showExtensions = useSettingsStore((s) => s.showExtensions);
  const sortBy = useSettingsStore((s) => s.sortBy);
  const sortDir = useSettingsStore((s) => s.sortDir);
  const confirmDelete = useSettingsStore((s) => s.confirmDelete);
  const language = useSettingsStore((s) => s.language);
  const setShowHidden = useSettingsStore((s) => s.setShowHidden);
  const setShowExtensions = useSettingsStore((s) => s.setShowExtensions);
  const setSortBy = useSettingsStore((s) => s.setSortBy);
  const setSortDir = useSettingsStore((s) => s.setSortDir);
  const setConfirmDelete = useSettingsStore((s) => s.setConfirmDelete);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setTheme = useSettingsStore((s) => s.setTheme);

  // 同步 theme → themeStore + settingsStore
  const handleThemeChange = useCallback(
    (v: ThemeMode) => {
      themeSetMode(v);
      setTheme(v);
    },
    [themeSetMode, setTheme],
  );

  const handleAccentChange = useCallback(
    (v: string) => {
      themeSetAccent(v);
      useSettingsStore.getState().setAccent(v);
    },
    [themeSetAccent],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Esc 关闭设置
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="settings-overlay" onMouseDown={handleBackdropClick}>
      <div className="settings-panel settings-panel-wide" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-header">
          <span className="settings-title">⚙ 设置</span>
          <button className="settings-close" onClick={onClose} title="关闭 (Esc)">
            ✕
          </button>
        </div>

        {/* Body: 左侧 tab 栏 + 右侧内容 */}
        <div className="settings-layout">
          <nav className="settings-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                className={`settings-tab ${activeTab === t.id ? 'active' : ''}`}
                onClick={() => setActiveTab(t.id)}
              >
                <span className="settings-tab-icon">{t.icon}</span>
                <span className="settings-tab-label">{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {activeTab === 'appearance' && (
              <SettingsSection title="外观">
                <div className="settings-group">
                  <div className="settings-group-label">主题</div>
                  <div className="settings-radio-group">
                    {THEME_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className={`settings-radio ${mode === opt.value ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="theme"
                          value={opt.value}
                          checked={mode === opt.value}
                          onChange={() => handleThemeChange(opt.value)}
                        />
                        <span className="settings-radio-label">{opt.label}</span>
                        <span className="settings-radio-desc">{opt.desc}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="settings-group">
                  <div className="settings-group-label">重点色</div>
                  <div className="settings-accent-row">
                    {ACCENT_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        className={`settings-accent-dot ${
                          accentColor.toLowerCase() === p.value.toLowerCase() ? 'active' : ''
                        }`}
                        style={{ background: p.value }}
                        onClick={() => handleAccentChange(p.value)}
                        title={p.name}
                      />
                    ))}
                  </div>
                </div>
              </SettingsSection>
            )}

            {activeTab === 'filelist' && (
              <SettingsSection title="文件列表">
                <Toggle
                  label="显示隐藏文件"
                  description="显示以 . 开头的文件"
                  checked={showHidden}
                  onChange={setShowHidden}
                />
                <Toggle
                  label="显示文件扩展名"
                  description="在文件列表中显示扩展名"
                  checked={showExtensions}
                  onChange={setShowExtensions}
                />
                <Select
                  label="排序方式"
                  value={sortBy}
                  options={SORT_OPTIONS}
                  onChange={(v) => setSortBy(v as SortField)}
                />
                <Select
                  label="排序方向"
                  value={sortDir}
                  options={SORT_DIR_OPTIONS}
                  onChange={(v) => setSortDir(v as SortDir)}
                />
              </SettingsSection>
            )}

            {activeTab === 'operations' && (
              <SettingsSection title="操作">
                <Toggle
                  label="确认删除"
                  description="删除文件前显示确认对话框"
                  checked={confirmDelete}
                  onChange={setConfirmDelete}
                />
              </SettingsSection>
            )}

            {activeTab === 'language' && (
              <SettingsSection title="语言">
                <Select
                  label="界面语言"
                  value={language}
                  options={LANG_OPTIONS}
                  onChange={(v) => setLanguage(v as Language)}
                />
                <div className="settings-hint">重启应用后生效</div>
              </SettingsSection>
            )}

            {activeTab === 'shortcuts' && <Shortcuts />}

            {activeTab === 'extensions' && (
              <SettingsSection title="扩展">
                <ExtensionManager />
              </SettingsSection>
            )}

            {activeTab === 'about' && (
              <SettingsSection title="关于 & 诊断">
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">Tabula</div>
                    <div className="settings-row-desc">
                      Windows 文件管理器 · 多标签 · 窗格分区 · 插件扩展
                    </div>
                  </div>
                  <div className="settings-row-value">
                    <span className="settings-version-chip">v{version}</span>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">日志目录</div>
                    <div className="settings-row-desc">
                      主进程与渲染进程的运行日志,排查问题时给开发者
                    </div>
                  </div>
                  <div className="settings-row-value">
                    <button
                      className="settings-link-button"
                      onClick={() => {
                        void window.tabula.log.openDir();
                      }}
                    >
                      打开日志目录
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-label">
                    <div className="settings-row-title">检查更新</div>
                    <div className="settings-row-desc">
                      手动触发一次更新检查(开发模式 / 未签名构建将显示"已禁用")
                    </div>
                  </div>
                  <div className="settings-row-value">
                    <button
                      className="settings-link-button"
                      onClick={async () => {
                        const s = await window.tabula.update.check();
                        if (s.state === 'available' && s.available) {
                          alert(`发现新版本 v${s.available.version}`);
                        } else if (s.state === 'not-available') {
                          alert('已是最新版本');
                        } else if (s.state === 'disabled') {
                          alert('当前环境不启用自动更新(开发模式)');
                        } else if (s.state === 'error') {
                          alert(`检查失败: ${s.error ?? '未知错误'}`);
                        }
                      }}
                    >
                      立即检查
                    </button>
                  </div>
                </div>
              </SettingsSection>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** P6 v1:扩展管理组件 */
function ExtensionManager() {
  const [extensions, setExtensions] = useState<
    Array<{ id: string; name: string; displayName: string; version: string; description?: string; builtin: boolean; enabled: boolean }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await window.tabula.extensions.list();
        if (!cancelled) setExtensions(list);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      if (enabled) {
        await window.tabula.extensions.enable(id);
      } else {
        await window.tabula.extensions.disable(id);
      }
      setExtensions((prev) =>
        prev.map((ext) => (ext.id === id ? { ...ext, enabled } : ext)),
      );
    } catch (e) {
      console.warn('[ExtensionManager] toggle failed', e);
    }
  }, []);

  if (loading) return <div className="settings-loading">加载中…</div>;
  if (error) return <div className="settings-error">{error}</div>;
  if (extensions.length === 0) {
    return <div className="settings-empty">暂未安装任何扩展</div>;
  }

  return (
    <div className="settings-extension-list">
      {extensions.map((ext) => (
        <div key={ext.id} className="settings-extension-item">
          <div className="settings-extension-info">
            <div className="settings-extension-name">
              {ext.displayName || ext.name}
              {ext.builtin && <span className="settings-extensionBuiltin">内置</span>}
            </div>
            <div className="settings-extension-desc">{ext.description ?? ext.id}</div>
            <div className="settings-extension-meta">v{ext.version}</div>
          </div>
          <div className="settings-extension-actions">
            <button
              className={`settings-toggle ${ext.enabled ? 'on' : 'off'}`}
              role="switch"
              aria-checked={ext.enabled}
              onClick={() => handleToggle(ext.id, !ext.enabled)}
              title={ext.enabled ? '禁用' : '启用'}
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
