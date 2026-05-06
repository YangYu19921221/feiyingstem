import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import ToastContainer from './components/Toast'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// 学生端禁右键：阻止「右键 → 翻译选中内容」「右键 → 检查」等绕过手段
// 只对学生生效；老师/管理员保留正常右键
function isStudent(): boolean {
  try {
    const userStr = localStorage.getItem('user')
    if (!userStr) return false
    const user = JSON.parse(userStr)
    return user?.role === 'student'
  } catch {
    return false
  }
}

window.addEventListener('contextmenu', (e) => {
  if (!isStudent()) return
  // 输入框 / textarea 内的右键保留（学生需要复制粘贴账号、修改资料）
  const target = e.target as HTMLElement
  if (target.closest('input, textarea, [contenteditable]')) return
  e.preventDefault()
})

// 学生端禁拖拽（防止把单词图片直接拖到翻译软件）
window.addEventListener('dragstart', (e) => {
  if (!isStudent()) return
  const target = e.target as HTMLElement
  if (target.tagName === 'IMG') e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ToastContainer />
    </QueryClientProvider>
  </StrictMode>,
)
