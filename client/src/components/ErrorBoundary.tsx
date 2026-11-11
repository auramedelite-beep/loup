import { Component, type ErrorInfo, type ReactNode } from 'react';
import { PawPrint } from 'lucide-react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] unhandled error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-950 px-4">
        <div className="card w-full max-w-lg p-8 text-center">
          <PawPrint className="mx-auto mb-3 h-10 w-10 text-blood-400" aria-hidden />
          <h1 className="font-display text-xl font-semibold text-parchment-100">حدث خطأ غير متوقع</h1>
          <p className="mt-2 text-sm leading-relaxed text-mist">
            واجهت اللعبة مشكلة غير متوقعة. أعد تحميل الصفحة للمتابعة.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              إعادة التحميل
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                this.setState({ error: null });
                window.location.assign('/');
              }}
            >
              العودة للرئيسية
            </button>
          </div>
        </div>
      </div>
    );
  }
}
