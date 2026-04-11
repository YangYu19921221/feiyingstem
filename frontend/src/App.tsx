import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect, Suspense, lazy } from 'react';
import ErrorBoundary from './components/ErrorBoundary';

// 路由懒加载 — 按需拆包,减少首屏 bundle
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Assessment = lazy(() => import('./pages/Assessment'));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard_New'));
const TeacherDashboard = lazy(() => import('./pages/TeacherDashboard'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const Learn = lazy(() => import('./pages/Learn'));
const UnitSelector = lazy(() => import('./pages/UnitSelector'));
const TeacherBooks = lazy(() => import('./pages/TeacherBooks'));
const TeacherUnitManagement = lazy(() => import('./pages/TeacherUnitManagement'));
const TeacherStudents = lazy(() => import('./pages/TeacherStudents'));
const TeacherClassManagement = lazy(() => import('./pages/TeacherClassManagement'));
const TeacherLeads = lazy(() => import('./pages/TeacherLeads'));
const SpellingPractice = lazy(() => import('./pages/SpellingPractice'));
const FillBlankPractice = lazy(() => import('./pages/FillBlankPractice'));
const QuizPractice = lazy(() => import('./pages/QuizPractice'));
const CompetitionLearning = lazy(() => import('./pages/CompetitionLearning'));
const CompletionScreen = lazy(() => import('./pages/CompletionScreen'));
const AchievementsPage = lazy(() => import('./pages/AchievementsPage'));
const LearningAnalytics = lazy(() => import('./pages/LearningAnalytics'));
const TeacherCompetitionManager = lazy(() => import('./pages/TeacherCompetitionManager'));
const TeacherAnalytics = lazy(() => import('./pages/TeacherAnalytics'));
const TeacherStudentDetail = lazy(() => import('./pages/TeacherStudentDetail'));
const MistakeBook = lazy(() => import('./pages/MistakeBook'));
const MistakeChallenge = lazy(() => import('./pages/MistakeChallenge'));
const BookProgressDetail = lazy(() => import('./pages/BookProgressDetail'));
const StudentReadingList = lazy(() => import('./pages/StudentReadingList'));
const StudentReadingPractice = lazy(() => import('./pages/StudentReadingPractice'));
const TeacherReadingList = lazy(() => import('./pages/TeacherReadingList'));
const TeacherReadingEditor = lazy(() => import('./pages/TeacherReadingEditor'));
const TeacherReadingAssign = lazy(() => import('./pages/TeacherReadingAssign'));
const TeacherBookAssignment = lazy(() => import('./pages/TeacherBookAssignment'));
const StudentAssignments = lazy(() => import('./pages/StudentAssignments'));
const TeacherHomework = lazy(() => import('./pages/TeacherHomework'));
const StudentHomework = lazy(() => import('./pages/StudentHomework'));
const AdminUserManagement = lazy(() => import('./pages/AdminUserManagement'));
const AdminContentManagement = lazy(() => import('./pages/AdminContentManagement'));
const AdminStatistics = lazy(() => import('./pages/AdminStatistics'));
const AdminSettings = lazy(() => import('./pages/AdminSettings'));
const AIConfig = lazy(() => import('./pages/Admin/AIConfig'));
const TeacherExamPreview = lazy(() => import('./pages/TeacherExamPreview'));
const RedeemSubscription = lazy(() => import('./pages/RedeemSubscription'));
const AdminSubscriptions = lazy(() => import('./pages/AdminSubscriptions'));
const PetPage = lazy(() => import('./pages/PetPage'));
const WordClassifyLearning = lazy(() => import('./pages/WordClassifyLearning'));
const MemoryCurve = lazy(() => import('./pages/MemoryCurve'));
const UnitExam = lazy(() => import('./pages/UnitExam'));
const UnitExamResult = lazy(() => import('./pages/UnitExamResult'));
const DictationPractice = lazy(() => import('./pages/DictationPractice'));
const SentenceFillPractice = lazy(() => import('./pages/SentenceFillPractice'));

// 路由级 loading 占位
const PageLoading = () => (
  <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent mx-auto mb-4"></div>
      <p className="text-gray-600">加载中...</p>
    </div>
  </div>
);

// 路由保护组件
const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const userStr = localStorage.getItem('user');

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        setUserRole(user.role);
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
      }
    } else {
      setIsAuthenticated(false);
    }
    setIsLoading(false);
  }, []);

  // 显示加载状态,避免闪烁
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-orange-500 border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // 如果指定了允许的角色,检查用户角色
  if (allowedRoles && userRole && !allowedRoles.includes(userRole)) {
    // 如果角色不匹配,重定向到对应的仪表盘
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

// 根据用户角色重定向到对应的仪表盘
const DashboardRedirect = () => {
  const userStr = localStorage.getItem('user');

  if (!userStr) {
    return <Navigate to="/login" replace />;
  }

  const user = JSON.parse(userStr);

  switch (user.role) {
    case 'admin':
      return <AdminDashboard />;
    case 'teacher':
      return <TeacherDashboard />;
    case 'student':
    default:
      return <StudentDashboard />;
  }
};

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Suspense fallback={<PageLoading />}>
          <Routes>
        {/* 登录页面 */}
        <Route path="/login" element={<Login />} />

        {/* 注册页面 */}
        <Route path="/register" element={<Register />} />

        {/* 忘记密码 */}
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* 匿名测评（公开，无需登录） */}
        <Route path="/assessment" element={<Assessment />} />

        {/* 根据角色显示不同的仪表盘 */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardRedirect />
            </ProtectedRoute>
          }
        />

        {/* 学生端路由 */}
        <Route
          path="/student/dashboard"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentDashboard />
            </ProtectedRoute>
          }
        />

        {/* 教师端路由 */}
        <Route
          path="/teacher/dashboard"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherDashboard />
            </ProtectedRoute>
          }
        />

        {/* 管理员路由 */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* 学习页面 - 所有已登录用户可访问 */}
        <Route
          path="/learn"
          element={
            <ProtectedRoute>
              <Learn />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 单元选择页 */}
        <Route
          path="/student/books/:bookId/units"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <UnitSelector />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 拼写练习页 */}
        <Route
          path="/student/units/:unitId/spelling"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <SpellingPractice />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 填空练习页 */}
        <Route
          path="/student/units/:unitId/fillblank"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <FillBlankPractice />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 选择题测试页 */}
        <Route
          path="/student/units/:unitId/quiz"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <QuizPractice />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 分类记忆学习页 */}
        <Route
          path="/student/units/:unitId/classify"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <WordClassifyLearning />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 独立听写 */}
        <Route
          path="/student/units/:unitId/dictation"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <DictationPractice />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 独立句子填空 */}
        <Route
          path="/student/units/:unitId/sentencefill"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <SentenceFillPractice />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 单元考试 */}
        <Route
          path="/student/units/:unitId/exam"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <UnitExam />
            </ProtectedRoute>
          }
        />

        <Route
          path="/student/exam/result/:paperId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <UnitExamResult />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 竞赛模式学习页 */}
        <Route
          path="/student/competition"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <CompetitionLearning />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 学习完成页 */}
        <Route
          path="/student/completion"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <CompletionScreen />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 成就页面 */}
        <Route
          path="/student/achievements"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <AchievementsPage />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 学习数据分析 */}
        <Route
          path="/student/analytics"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <LearningAnalytics />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 记忆曲线 */}
        <Route
          path="/student/memory-curve"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <MemoryCurve />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 错题集 */}
        <Route
          path="/student/mistake-book"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <MistakeBook />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 错题闯关 */}
        <Route
          path="/student/mistake-challenge"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <MistakeChallenge />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 单词本进度详情 */}
        <Route
          path="/student/books/:bookId/progress"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <BookProgressDetail />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 阅读理解列表 */}
        <Route
          path="/student/reading"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentReadingList />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 阅读理解答题 */}
        <Route
          path="/student/reading/:passageId"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentReadingPractice />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 单词本管理 */}
        <Route
          path="/teacher/books"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherBooks />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 单元管理 */}
        <Route
          path="/teacher/books/:bookId/units"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherUnitManagement />
            </ProtectedRoute>
          }
        />


        {/* 教师端 - 学生管理 */}
        <Route
          path="/teacher/students"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherStudents />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 班级管理 */}
        <Route
          path="/teacher/classes"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherClassManagement />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 测评线索管理 */}
        <Route
          path="/teacher/leads"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherLeads />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 竞赛题库管理 */}
        <Route
          path="/teacher/competition"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherCompetitionManager />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 数据分析 */}
        <Route
          path="/teacher/analytics"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherAnalytics />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 学生详情 */}
        <Route
          path="/teacher/students/:studentId"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherStudentDetail />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 试卷预览 */}
        <Route
          path="/teacher/exam-preview/:examId"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherExamPreview />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 阅读理解列表 */}
        <Route
          path="/teacher/reading"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherReadingList />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 创建阅读文章 */}
        <Route
          path="/teacher/reading/create"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherReadingEditor />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 编辑阅读文章 */}
        <Route
          path="/teacher/reading/:passageId/edit"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherReadingEditor />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 分配阅读作业 */}
        <Route
          path="/teacher/reading/:passageId/assign"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherReadingAssign />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 单词本分配 */}
        <Route
          path="/teacher/assignments"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherBookAssignment />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 我的作业 */}
        <Route
          path="/student/assignments"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentAssignments />
            </ProtectedRoute>
          }
        />

        {/* 教师端 - 作业管理 */}
        <Route
          path="/teacher/homework"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherHomework />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 我的作业任务 */}
        <Route
          path="/student/homework"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <StudentHomework />
            </ProtectedRoute>
          }
        />

        {/* 管理员 - 用户管理 */}
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminUserManagement />
            </ProtectedRoute>
          }
        />

        {/* 管理员 - 内容管理 */}
        <Route
          path="/admin/content"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminContentManagement />
            </ProtectedRoute>
          }
        />

        {/* 管理员 - 数据统计 */}
        <Route
          path="/admin/statistics"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminStatistics />
            </ProtectedRoute>
          }
        />

        {/* 管理员 - 系统设置 */}
        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminSettings />
            </ProtectedRoute>
          }
        />

        {/* 管理员 - AI配置 */}
        <Route
          path="/admin/ai-config"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AIConfig />
            </ProtectedRoute>
          }
        />

        {/* 管理员 - 订阅管理 */}
        <Route
          path="/admin/subscriptions"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <AdminSubscriptions />
            </ProtectedRoute>
          }
        />

        {/* 订阅兑换页（学生） */}
        <Route
          path="/subscription/redeem"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <RedeemSubscription />
            </ProtectedRoute>
          }
        />

        {/* 学生端 - 宠物养成 */}
        <Route
          path="/student/pet"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <PetPage />
            </ProtectedRoute>
          }
        />

        {/* 默认路由 */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </Suspense>
    </Router>
    </ErrorBoundary>
  );
}

export default App;
