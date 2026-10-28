import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  Cog,
  KeyRound,
  LogOut,
  MoreHorizontal,
  PencilLine,
  ShieldCheck,
  Sparkles,
  UserRound,
} from 'lucide-react';
import useGoBack from '../../hooks/useGoBack';
import ChangePasswordModal from '../ChangePasswordModal';
import ChangeUsernameModal from '../ChangeUsernameModal';

type WorkspaceRole = 'teacher' | 'admin' | 'org';

interface NavItem {
  label: string;
  path: string;
}

interface Props {
  role: WorkspaceRole;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  backTo?: string;
}

const navByRole: Record<WorkspaceRole, { primary: NavItem[]; more: NavItem[] }> = {
  teacher: {
    primary: [
      { label: '工作台', path: '/teacher/dashboard' },
      { label: '学生', path: '/teacher/students' },
      { label: '班级', path: '/teacher/classes' },
      { label: '教材', path: '/teacher/books' },
      { label: '作业', path: '/teacher/homework' },
      { label: '数据', path: '/teacher/analytics' },
    ],
    more: [
      { label: '阅读内容', path: '/teacher/reading' },
      { label: '句子背诵', path: '/teacher/sentences' },
      { label: '音标视频', path: '/teacher/phonetics' },
      { label: '音标教材', path: '/teacher/phonetic-books' },
      { label: '单词分配', path: '/teacher/assignments' },
      { label: '测评线索', path: '/teacher/leads' },
      { label: '实时课堂', path: '/teacher/live' },
      // 线上授课(直播)。与上面的「实时课堂」是两件事:那个看学生在线状态,这个是开课直播
      { label: '线上授课', path: '/teacher/livestream' },
      { label: '课件资料', path: '/teacher/materials' },
      { label: '签到记录', path: '/teacher/checkins' },
      { label: '竞赛管理', path: '/teacher/competition' },
      { label: 'PK 晋级赛', path: '/teacher/tournaments' },
      { label: '金币管理', path: '/teacher/coins' },
      { label: '每日陪跑', path: '/teacher/coach' },
      { label: '家长绑定', path: '/teacher/parent-binding' },
      { label: '学习助手次数', path: '/teacher/tutor-quota' },
      { label: '我的助教', path: '/teacher/assistants' },
    ],
  },
  admin: {
    primary: [
      { label: '总览', path: '/admin' },
      { label: '用户', path: '/admin/users' },
      { label: '教师', path: '/admin/teachers' },
      { label: '机构', path: '/admin/organizations' },
      { label: '内容', path: '/admin/content' },
      { label: '数据', path: '/admin/statistics' },
    ],
    more: [
      { label: '班级数据', path: '/admin/classes' },
      { label: '服务器监控', path: '/admin/server-monitor' },
      { label: 'AI 配置', path: '/admin/ai-config' },
      { label: '订阅管理', path: '/admin/subscriptions' },
      { label: '单词比赛', path: '/admin/competition' },
      { label: '系统设置', path: '/admin/settings' },
    ],
  },
  org: {
    primary: [
      { label: '总览', path: '/org' },
      { label: '用户', path: '/admin/users' },
      { label: '教师', path: '/admin/teachers' },
      { label: '班级', path: '/admin/classes' },
      { label: '数据', path: '/admin/statistics' },
    ],
    more: [
      { label: '兑换码', path: '/admin/subscriptions' },
      { label: '词库浏览', path: '/admin/content' },
    ],
  },
};

const isActive = (pathname: string, path: string) =>
  path === '/admin'
    ? pathname === '/admin' || pathname === '/admin/dashboard'
    : pathname === path || pathname.startsWith(`${path}/`);

export default function StaffWorkspaceHeader({ role, title, subtitle, icon: Icon, action, backTo }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const goBack = useGoBack(role === 'admin' ? '/admin' : role === 'org' ? '/org' : '/teacher/dashboard');
  const [moreOpen, setMoreOpen] = useState(false);
  // 移动端账号菜单(设置/退出):桌面右上角那排按钮在 ≤767px 整行隐藏,
  // 没有这个菜单,手机上就无处退出登录(2026-08-05 用户反馈)
  const [accountOpen, setAccountOpen] = useState(false);
  // 桌面右上角的账号菜单(管理端: 改自己的用户名 / 密码)
  const [deskAccountOpen, setDeskAccountOpen] = useState(false);
  const [accountDialog, setAccountDialog] = useState<'username' | 'password' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const deskAccountRef = useRef<HTMLDivElement>(null);
  const baseNav = navByRole[role];
  // 助教账号不给「我的助教」入口(后端也会 403)
  const isAssistant = (() => { try { return !!JSON.parse(localStorage.getItem('user') || 'null')?.owner_teacher_id; } catch { return false; } })();
  const nav = isAssistant ? { ...baseNav, more: baseNav.more.filter((i) => i.path !== '/teacher/assistants') } : baseNav;
  const BrandIcon = role === 'teacher' ? Sparkles : role === 'org' ? Building2 : ShieldCheck;
  const hasMore = nav.more.length > 0;
  const moreActive = nav.more.some((item) => isActive(location.pathname, item.path));

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMoreOpen(false);
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false);
      if (deskAccountRef.current && !deskAccountRef.current.contains(event.target as Node)) setDeskAccountOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMoreOpen(false); setAccountOpen(false); setDeskAccountOpen(false); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // 路由变化时收起菜单(浏览器前进/后退也覆盖)。用 render 期调整而非 effect:
  // 见 react.dev "adjusting state when a prop changes",避免级联渲染
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setMoreOpen(false);
    setAccountOpen(false);
    setDeskAccountOpen(false);
  }

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const roleFallback = role === 'admin' ? '管理员' : role === 'org' ? '机构管理员' : '教师';
  const readStoredUser = () => {
    try { return JSON.parse(localStorage.getItem('user') || 'null') as { full_name?: string; username?: string } | null; } catch { return null; }
  };
  // 登录用的用户名放 state: 改完用户名菜单里要立刻显示新的(ChangeUsernameModal 已写回 localStorage)
  const [loginName, setLoginName] = useState(() => readStoredUser()?.username || '');
  const userName = readStoredUser()?.full_name || loginName || roleFallback;
  // 教师工作台自己在 action 里放了改用户名 / 改密码;机构端走 /org/my-password(多一条校验)。
  // 这里只给平台管理端,别的角色要加先看它们页面里已有的入口
  const canEditAccount = role === 'admin';
  const openAccountDialog = (which: 'username' | 'password') => {
    setDeskAccountOpen(false);
    setAccountOpen(false);
    setAccountDialog(which);
  };
  const settingsPath = role === 'admin' ? '/admin/settings' : role === 'org' ? '/org' : '/teacher/dashboard';
  const settingsLabel = role === 'admin' ? '系统设置' : role === 'org' ? '机构设置' : '工作台';

  return (
    <header className={`staff-workspace-header staff-workspace-header-${role}${action ? ' staff-workspace-header-has-action' : ''}`}>
      <div className="staff-workspace-header-inner">
        <div className="staff-workspace-brand">
          <span className="staff-workspace-brand-mark" aria-hidden="true"><BrandIcon className="h-5 w-5" strokeWidth={2.25} /><span className="staff-workspace-brand-status" /></span>
          <span className="staff-workspace-brand-copy"><span>飞鹰 AI</span><strong>{role === 'admin' ? '管理中心' : role === 'org' ? '机构工作区' : '教师工作区'}</strong></span>
        </div>
        <div className="staff-workspace-page-label"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>

        <nav className="staff-workspace-primary" aria-label={role === 'teacher' ? '教师端主导航' : role === 'org' ? '机构端主导航' : '管理端主导航'}>
          {nav.primary.map((item) => {
            const active = isActive(location.pathname, item.path);
            return <button key={item.path} type="button" onClick={() => { setMoreOpen(false); navigate(item.path); }} className={active ? 'is-active' : ''} aria-current={active ? 'page' : undefined}>{item.label}</button>;
          })}
          {hasMore && <div className="staff-workspace-more" ref={menuRef}>
            <button type="button" className={moreOpen || moreActive ? 'is-active' : ''} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-haspopup="menu" aria-controls={`staff-workspace-more-${role}`}><MoreHorizontal className="h-4 w-4" />更多<ChevronDown className="h-3.5 w-3.5" /></button>
            {moreOpen && <div id={`staff-workspace-more-${role}`} className="staff-workspace-more-menu" role="menu">{nav.more.map((item) => <button key={item.path} type="button" role="menuitem" onClick={() => { setMoreOpen(false); navigate(item.path); }} className={isActive(location.pathname, item.path) ? 'is-active' : ''}>{item.label}</button>)}</div>}
          </div>}
        </nav>

        <div className="staff-workspace-header-right">
          {action && <div className="staff-workspace-action">{action}</div>}
          {canEditAccount ? (
            <div className="staff-workspace-account" ref={deskAccountRef}>
              <button
                type="button"
                className={`staff-workspace-user is-button${deskAccountOpen ? ' is-open' : ''}`}
                onClick={() => setDeskAccountOpen((open) => !open)}
                aria-label={`账号:${userName}`}
                aria-expanded={deskAccountOpen}
                aria-haspopup="menu"
                aria-controls={`staff-workspace-desk-account-${role}`}
                title="我的账号"
              >
                <span className="staff-workspace-status" />
                <UserRound className="staff-workspace-user-icon h-4 w-4" aria-hidden="true" />
                <span className="staff-workspace-user-name">{userName}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </button>
              {deskAccountOpen && (
                <div id={`staff-workspace-desk-account-${role}`} className="staff-workspace-account-menu" role="menu">
                  <div className="staff-workspace-account-who">
                    <strong>{userName}</strong>
                    {loginName && <span>登录用户名 {loginName}</span>}
                  </div>
                  <button type="button" role="menuitem" onClick={() => openAccountDialog('username')}><PencilLine className="h-4 w-4" />修改用户名</button>
                  <button type="button" role="menuitem" onClick={() => openAccountDialog('password')}><KeyRound className="h-4 w-4" />修改密码</button>
                </div>
              )}
            </div>
          ) : (
            <span className="staff-workspace-user"><span className="staff-workspace-status" />{userName}</span>
          )}
          <button type="button" onClick={() => navigate(settingsPath)} className="staff-workspace-icon" aria-label={settingsLabel} title={settingsLabel}><Cog className="h-4 w-4" /></button>
          <button type="button" onClick={logout} className="staff-workspace-icon" aria-label="退出登录" title="退出登录"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="staff-workspace-mobile-title">
        {backTo && <button type="button" onClick={() => navigate(backTo)} className="staff-workspace-back" aria-label="返回"><ArrowLeft className="h-5 w-5" /></button>}
        {!backTo && <button type="button" onClick={() => goBack()} className="staff-workspace-back" aria-label="返回"><ArrowLeft className="h-5 w-5" /></button>}
        {Icon && <Icon className="h-5 w-5 shrink-0 text-[color:var(--staff-accent)]" aria-hidden="true" />}
        <div className="min-w-0 flex-1"><h1 className="truncate">{title}</h1>{subtitle && <p className="truncate">{subtitle}</p>}</div>
        {action && <div className="staff-workspace-mobile-action">{action}</div>}
        {/* 账号菜单:桌面右上角(用户名/设置/退出)在移动端整行隐藏,这里补一个入口 */}
        <div className="staff-workspace-mobile-account" ref={accountRef}>
          <button
            type="button"
            onClick={() => setAccountOpen((open) => !open)}
            aria-label="账号菜单"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            aria-controls={`staff-workspace-account-${role}`}
          >
            <UserRound className="h-5 w-5" />
          </button>
          {accountOpen && (
            <div id={`staff-workspace-account-${role}`} className="staff-workspace-mobile-account-menu" role="menu">
              <p className={`staff-workspace-mobile-account-name${canEditAccount && loginName ? ' has-login' : ''}`}><span className="staff-workspace-status" />{userName}</p>
              {canEditAccount && loginName && <p className="staff-workspace-mobile-account-login">登录用户名 {loginName}</p>}
              {canEditAccount && <>
                <button type="button" role="menuitem" onClick={() => openAccountDialog('username')}>
                  <PencilLine className="h-4 w-4" />修改用户名
                </button>
                <button type="button" role="menuitem" onClick={() => openAccountDialog('password')}>
                  <KeyRound className="h-4 w-4" />修改密码
                </button>
              </>}
              <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); navigate(settingsPath); }}>
                <Cog className="h-4 w-4" />{settingsLabel}
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={logout}>
                <LogOut className="h-4 w-4" />退出登录
              </button>
            </div>
          )}
        </div>
      </div>
      {/* 弹窗挂到 body: 顶栏有 backdrop-filter,fixed 的遮罩放在顶栏里只会盖住顶栏那一条 */}
      {canEditAccount && typeof document !== 'undefined' && createPortal(
        <>
          <ChangeUsernameModal
            isOpen={accountDialog === 'username'}
            onClose={() => setAccountDialog(null)}
            currentUsername={loginName || undefined}
            onSuccess={(name) => setLoginName(name)}
          />
          <ChangePasswordModal isOpen={accountDialog === 'password'} onClose={() => setAccountDialog(null)} />
        </>,
        document.body,
      )}
    </header>
  );
}
