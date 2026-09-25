import { useAuth } from '../contexts/AuthContext'
import BrandLogo from './BrandLogo'

export default function Login() {
  const { signInWithGoogle } = useAuth()

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center mb-4">
            <BrandLogo className="h-12 w-12" />
          </div>
          <h1 className="text-xl font-semibold text-ink">IPD AR Discharge</h1>
          <p className="mt-1 text-sm text-ink/60">ระบบติดตามเคสผู้ป่วยใน (IPD)</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper transition-colors"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.01c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.1A12 12 0 0 0 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.38z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.62l4 3.1C6.22 6.86 8.87 4.75 12 4.75z"
              />
            </svg>
            เข้าสู่ระบบด้วย Google
          </button>
          <p className="mt-4 text-center text-xs text-ink/50">
            จำกัดเฉพาะบัญชี @mahidol.ac.th เท่านั้น
          </p>
        </div>
      </div>
    </div>
  )
}
