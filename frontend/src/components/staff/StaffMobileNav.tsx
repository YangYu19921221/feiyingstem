import { useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BookOpenText,
  Building2,
  GraduationCap,
  Home,
  Settings,
  Users,
} from 'lucide-react';

const teacherItems = [
  { label: '工作台', path: '/teacher/dashboard', icon: Home },
  { label: '学生', path: '/teacher/students', icon: GraduationCap },
  { label: '班级', path: '/teacher/classes', icon: Users },
  { label: '教材', path: '/teacher/books', icon: BookOpenText },
  { label: '数据', path: '/teacher/analytics', icon: BarChart3 },
];

const adminItems = [
  { label: '总览', path: '/admin', icon: Home },
  { label: '用户', path: '/admin/users', icon: Users },
  { label: '教师', path: '/admin/teachers', icon: GraduationCap },
  { label: '机构', path: '/admin/organizations', icon: Building2 },
  { label: '设置', path: '/admin/settings', icon: Settings },
];

const orgItems = [
  { label: '总览', path: '/org', icon: Home },
  { label: '用户', path: '/admin/users', icon: Users },
  { label: '教师', path: '/admin/teachers', icon: GraduationCap },
  { label: '班级', path: '/admin/classes', icon: Users },
  { label: '统计', path: '/admin/statistics', icon: BarChart3 },
];

export default function StaffMobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const userRole = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null')?.role as string | undefined; } catch { return undefined; } })();
  const genericDashboard = location.pathname === '/dashboard';
  const isTeacher = location.pathname.startsWith('/teacher') || (genericDashboard && userRole === 'teacher');
  const isAdmin = location.pathname.startsWith('/admin') || location.pathname === '/org' || (genericDashboard && (userRole === 'admin' || userRole === 'org_admin'));
  const isOrgAdmin = userRole === 'org_admin';
  const visible = isTeacher || isAdmin;
  // 沉浸页隐藏底部导航。**用精确匹配而非 startsWith('/teacher/live')** ——
  // 后者会连带吞掉 /teacher/livestream 下的课件管理页,那页需要导航
  const immersive = location.pathname.startsWith('/teacher/bigscreen')
    || location.pathname === '/teacher/live'
    || location.pathname === '/teacher/livestream';
  const navVisible = visible && !immersive;
  const items = isTeacher ? teacherItems : isOrgAdmin ? orgItems : adminItems;

  useLayoutEffect(() => {
    document.body.classList.toggle('staff-interface', visible);
    document.body.classList.toggle('staff-teacher', visible && isTeacher);
    document.body.classList.toggle('staff-admin', visible && isAdmin && !isTeacher);
    document.body.classList.toggle('staff-immersive', visible && immersive);
    document.body.classList.toggle('staff-mobile-nav-visible', navVisible);
    return () => {
      document.body.classList.remove('staff-interface');
      document.body.classList.remove('staff-teacher');
      document.body.classList.remove('staff-admin');
      document.body.classList.remove('staff-immersive');
      document.body.classList.remove('staff-mobile-nav-visible');
    };
  }, [visible, isTeacher, isAdmin, isOrgAdmin, immersive, navVisible]);

  if (!navVisible) return null;

  return (
    <nav className="staff-mobile-nav fixed inset-x-0 bottom-0 z-[70] border-t border-slate-200 bg-white/95 px-2 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden" aria-label={isTeacher ? '教师端主导航' : isOrgAdmin ? '机构端主导航' : '管理端主导航'}>
      <div className="mx-auto grid max-w-md grid-cols-5">
        {items.map((item) => {
          const active = item.path === '/admin' || item.path === '/org'
            ? (item.path === '/org' ? location.pathname === '/org' : location.pathname === '/admin' || location.pathname === '/admin/dashboard')
            : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg transition ${active ? 'text-[color:var(--staff-accent)]' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
              <span className="text-[10px] font-semibold leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
