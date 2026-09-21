import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useAuthStore'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { toast } from 'sonner'
import { ArrowUpRight, Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react'

export default function Login() {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [loading, setLoading] = useState(false)
  const signIn = useAuthStore((s) => s.signIn)
  const navigate = useNavigate()

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const updateKeyboardState = () => {
      setKeyboardVisible(window.innerHeight - viewport.height > 120)
    }

    updateKeyboardState()
    viewport.addEventListener('resize', updateKeyboardState)
    return () => viewport.removeEventListener('resize', updateKeyboardState)
  }, [])

  const handleLogin = async (value: string) => {
    if (loading || value.length !== 6) return
    setLoading(true)
    const { error } = await signIn('voltker1', value)
    setLoading(false)
    if (error) {
      toast.error(error)
      setPassword('')
    } else {
      toast.success('Berhasil masuk')
      navigate('/')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await handleLogin(password)
  }

  const handlePinDigit = (digit: string) => {
    if (loading || password.length >= 6) return
    const nextPassword = `${password}${digit}`
    setPassword(nextPassword)
    if (nextPassword.length === 6) void handleLogin(nextPassword)
  }

  return (
    <div className={`relative flex min-h-dvh justify-center overflow-y-auto bg-ink p-4 sm:p-6 lg:items-center lg:overflow-hidden lg:p-10 ${keyboardVisible ? 'items-start py-2' : 'items-center'}`}>
      <img
        src={`${import.meta.env.BASE_URL}login-background.jpg`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-75"
      />
      <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(21,31,34,0.97)_0%,rgba(21,31,34,0.72)_42%,rgba(21,31,34,0.82)_100%)]" aria-hidden="true" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_30%,rgba(228,168,83,0.22),transparent_24%),radial-gradient(circle_at_86%_72%,rgba(36,126,121,0.22),transparent_30%)]" aria-hidden="true" />
      <div className="relative grid w-[calc(100%-1rem)] max-w-5xl overflow-hidden rounded-[2rem] border border-white/20 bg-ink/35 shadow-[0_30px_100px_rgba(10,16,18,0.48)] backdrop-blur-sm sm:w-full lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden min-h-[560px] flex-col justify-between overflow-hidden p-10 text-white lg:flex">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full border border-accent/30" aria-hidden="true" />
          <div className="absolute -bottom-28 -left-20 h-64 w-64 rounded-full border-[18px] border-primary/20" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Radja Aksesoris" className="h-12 w-12 rounded-2xl object-cover ring-4 ring-accent/20" />
              <div>
                <p className="text-sm font-semibold tracking-[0.18em] text-accent">RADJA</p>
                <p className="text-xs text-white/60">Aksesoris Konveksi</p>
              </div>
            </div>
            <div className="mt-24 max-w-sm">
              <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                <Sparkles className="h-4 w-4" /> Ruang kendali toko
              </p>
              <h1 className="text-5xl font-bold leading-[0.98] tracking-[-0.05em]">
                Semua stok,
                <span className="block text-primary-foreground">satu kendali.</span>
              </h1>
              <p className="mt-6 max-w-xs text-sm leading-6 text-white/65">
                Kelola katalog, kasir, dan laporan penjualan dari satu tempat yang ringkas.
              </p>
            </div>
          </div>
          <div className="relative flex items-center justify-between text-xs text-white/50">
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-accent" /> Akses aman untuk tim toko</span>
            <ArrowUpRight className="h-5 w-5 text-accent" />
          </div>
        </section>

        <section className={`relative overflow-hidden bg-ink px-6 text-white lg:hidden ${keyboardVisible ? 'py-3' : 'py-7'}`}>
          <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full border border-accent/30" aria-hidden="true" />
          <div className="absolute -bottom-20 -left-10 h-36 w-36 rounded-full border-[12px] border-primary/20" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Radja Aksesoris" className="h-11 w-11 rounded-2xl object-cover ring-4 ring-accent/20" />
              <div>
                <p className="text-sm font-semibold tracking-[0.18em] text-accent">RADJA</p>
                <p className="text-xs text-white/60">Aksesoris Konveksi</p>
              </div>
            </div>
            <p className={`${keyboardVisible ? 'mt-3' : 'mt-7'} flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent`}>
              <Sparkles className="h-3.5 w-3.5" /> Ruang kendali toko
            </p>
            <h1 className={`${keyboardVisible ? 'text-2xl' : 'text-3xl'} mt-2 max-w-xs font-bold leading-none tracking-[-0.04em]`}>
              Semua stok,
              <span className="block text-primary-foreground">satu kendali.</span>
            </h1>
          </div>
        </section>

        <Card className="relative overflow-hidden rounded-none border-0 bg-[rgba(251,250,245,0.78)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_-12px_32px_rgba(32,42,46,0.1)] backdrop-blur-xl lg:rounded-none lg:bg-surface lg:shadow-none lg:backdrop-blur-none">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 overflow-hidden opacity-80" aria-hidden="true">
            <div className="absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-primary/15 blur-2xl" />
            <div className="absolute -bottom-32 -left-20 h-56 w-56 rounded-full border-[18px] border-accent/15" />
            <div className="absolute inset-x-0 bottom-0 h-36 bg-[linear-gradient(rgba(33,108,104,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(33,108,104,0.06)_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_top,black,transparent)]" />
          </div>
          <CardHeader className={`relative z-10 items-center text-center lg:items-start lg:text-left ${keyboardVisible ? 'pb-0 pt-4' : 'pb-2'}`}>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">Selamat datang kembali</p>
            <CardTitle className="text-3xl tracking-tight text-ink">LOGIN</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Lanjutkan aktivitas toko Anda hari ini.</p>
          </CardHeader>
          <CardContent className={`relative z-10 ${keyboardVisible ? 'pt-3' : 'pt-5'}`}>
            <form onSubmit={handleSubmit} className={keyboardVisible ? 'space-y-3' : 'space-y-5'}>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink/85">Password</label>
                <div className="relative hidden lg:block">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Masukkan password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    inputMode="numeric"
                    className="pr-11"
                  />
                  <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink" aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="lg:hidden">
                  <div
                    className="flex h-12 items-center justify-center gap-3 rounded-xl border border-border bg-surface px-4 shadow-sm"
                    aria-label={`PIN ${password.length} dari 6 digit`}
                    role="status"
                  >
                    {Array.from({ length: 6 }, (_, index) => (
                      <span
                        key={index}
                        className={`h-3 w-3 rounded-full border-2 ${index < password.length ? 'border-primary bg-primary' : 'border-muted-foreground/40 bg-transparent'}`}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-center text-xs text-muted-foreground">Masukkan 6 digit password</p>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                      <button
                        key={digit}
                        type="button"
                        onClick={() => handlePinDigit(digit)}
                        disabled={loading}
                        className="h-11 rounded-xl border border-border bg-muted/50 text-lg font-semibold text-ink transition-colors hover:bg-primary/10 active:scale-[0.98] disabled:opacity-50"
                        aria-label={`Angka ${digit}`}
                      >
                        {digit}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPassword('')}
                      disabled={loading || password.length === 0}
                      className="h-11 rounded-xl border border-border bg-muted/50 text-sm font-semibold text-muted-foreground transition-colors hover:bg-primary/10 active:scale-[0.98] disabled:opacity-50"
                      aria-label="Hapus semua angka"
                    >
                      Hapus
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePinDigit('0')}
                      disabled={loading}
                      className="h-11 rounded-xl border border-border bg-muted/50 text-lg font-semibold text-ink transition-colors hover:bg-primary/10 active:scale-[0.98] disabled:opacity-50"
                      aria-label="Angka 0"
                    >
                      0
                    </button>
                    <button
                      type="button"
                      onClick={() => setPassword((value) => value.slice(0, -1))}
                      disabled={loading || password.length === 0}
                      className="h-11 rounded-xl border border-border bg-muted/50 text-lg font-semibold text-muted-foreground transition-colors hover:bg-primary/10 active:scale-[0.98] disabled:opacity-50"
                      aria-label="Hapus angka terakhir"
                    >
                      ←
                    </button>
                  </div>
                </div>
              </div>
              <Button type="submit" className="hidden w-full shadow-[0_12px_24px_rgba(36,126,121,0.2)] lg:flex" size="lg" disabled={loading}>
                {loading ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" /> : 'Masuk ke dashboard'}
              </Button>
            </form>
            <p className="mt-7 border-t border-border pt-5 text-center text-xs text-muted-foreground">
              Single-device POS <span className="mx-1 text-primary">•</span> Multi-monitor dashboard
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
