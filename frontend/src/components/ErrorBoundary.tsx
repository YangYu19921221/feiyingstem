import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染失败:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/student/dashboard';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#edf5fb] p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-3xl">🛠️</div>
            <h2 className="mb-2 text-xl font-bold text-gray-800">这页刚刚没能打开</h2>
            <p className="mb-6 text-sm leading-6 text-gray-500">
              你的学习记录不会因此丢失。可以先重试一次，或者返回学习中心继续学习。
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleReset}
                className="min-h-11 rounded-lg bg-orange-500 px-5 font-semibold text-white transition-colors hover:bg-orange-600"
              >
                重试
              </button>
              <button
                onClick={this.handleGoHome}
                className="min-h-11 rounded-lg bg-gray-100 px-5 font-semibold text-gray-700 transition-colors hover:bg-gray-200"
              >
                返回学习中心
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
