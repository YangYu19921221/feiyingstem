import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CircleAlert, ClipboardList, Home, RotateCcw, Trophy, type LucideIcon } from 'lucide-react';
import { getTutorStatus } from '../../api/tutor';

const visiblePaths = new Set([
  '/dashboard',
  '/student/dashboard',
  '/student/assignments',
  '/student/homework',
  '/student/reading',
  '/student/leaderboard',
  '/student/achievements',
  '/student/phonetics',
  '/student/phonetics/textbook',
  '/student/analytics',
  '/student/memory-curve',
  '/student/mistake-book',
  '/student/sentences',
  '/student/pet',
  '/student/join-class',
  '/subscription/redeem',
]);

type NavItem = { label: string; path: string; icon?: LucideIcon; avatar?: string; active: (path: string) => boolean };

const items: NavItem[] = [
  { label: '首页', path: '/student/dashboard', icon: Home, active: (path: string) => path === '/dashboard' || path === '/student/dashboard' },
  { label: '作业', path: '/student/homework', icon: ClipboardList, active: (path: string) => path === '/student/homework' || path === '/student/assignments' },
  { label: '复习', path: '/student/memory-curve', icon: RotateCcw, active: (path: string) => path === '/student/memory-curve' },
  { label: '错题', path: '/student/mistake-book', icon: CircleAlert, active: (path: string) => path.startsWith('/student/mistake') },
  { label: '排行', path: '/student/leaderboard', icon: Trophy, active: (path: string) => path === '/student/leaderboard' },
];

const TUTOR_ITEM: NavItem = {
  label: '问老师', path: '/student/tutor', avatar: '/tutor-avatar.jpg', active: (path: string) => path === '/student/tutor',
};

export default function StudentMobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  // 「问小鹰老师」只在本校开放时进底栏(学生第一次看到底栏时问一次,之后不再问)
  const [tutorOn, setTutorOn] = useState(false);
  const askedTutor = useRef(false);
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null') as { role?: string } | null;
    } catch {
      return null;
    }
  })();
  const studentSurfaceVisible = user?.role === 'student' && (
    location.pathname === '/dashboard'
    ||
    location.pathname.startsWith('/student')
    || location.pathname.startsWith('/learn')
    || location.pathname.startsWith('/pk')
    || location.pathname === '/subscription/redeem'
  );
  const immersive = location.pathname.startsWith('/student/units/')
    || location.pathname.startsWith('/student/exam/')
    || location.pathname === '/student/competition'
    || location.pathname === '/student/completion'
    || location.pathname === '/student/mistake-practice'
    || location.pathname === '/student/mistake-challenge'
    || location.pathname.startsWith('/student/pet/battle')
    || location.pathname === '/student/pet/heal'
    || location.pathname === '/student/tutor'
    || location.pathname.startsWith('/pk/arena');
  const visible = studentSurfaceVisible && visiblePaths.has(location.pathname);

  useEffect(() => {
    if (!visible || askedTutor.current) return;
    askedTutor.current = true;
    getTutorStatus().then((s) => setTutorOn(s.enabled)).catch(() => setTutorOn(false));
  }, [visible]);

  useLayoutEffect(() => {
    document.body.classList.toggle('student-interface', Boolean(studentSurfaceVisible));
    document.body.classList.toggle('student-immersive', Boolean(studentSurfaceVisible && immersive));
    document.body.classList.toggle('student-mobile-nav-visible', visible);
    return () => {
      document.body.classList.remove('student-interface');
      document.body.classList.remove('student-immersive');
      document.body.classList.remove('student-mobile-nav-visible');
    };
  }, [visible, studentSurfaceVisible, immersive]);

  if (!visible) return null;

  // 小鹰老师放第三格(大拇指最顺手的中间),图标用它的头像,和别的线条图标一眼分得开
  const shown: NavItem[] = tutorOn ? [...items.slice(0, 2), TUTOR_ITEM, ...items.slice(2)] : items;

  return (
    <nav
      className="student-mobile-nav fixed inset-x-0 bottom-0 z-[60] border-t border-gray-200 bg-white/95 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden"
      aria-label="学生端主导航"
    >
      <div className={`mx-auto grid max-w-md ${shown.length === 6 ? 'grid-cols-6' : 'grid-cols-5'}`}>
        {shown.map((item) => {
          const active = item.active(location.pathname);
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg transition ${
                item.avatar
                  ? 'text-sky-700 hover:bg-sky-50'
                  : active ? 'text-accent-warm' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              {item.avatar ? (
                <img src={item.avatar} alt="" className="h-6 w-6 rounded-full object-cover ring-2 ring-sky-300" />
              ) : item.icon ? (
                <item.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
              ) : null}
              <span className="text-xs font-semibold leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
