import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('Unhandled error caught by ErrorBoundary:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-sm text-ink shadow-sm">
            <p className="mb-2 font-semibold text-rose">เกิดข้อผิดพลาดที่ไม่คาดคิด</p>
            <p className="text-ink/70">{this.state.error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-teal-dark px-4 py-2 text-xs font-medium text-white"
            >
              โหลดหน้าใหม่
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
