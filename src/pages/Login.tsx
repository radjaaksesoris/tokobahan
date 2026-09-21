import { useState } from 'react'
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
  const [loading, setLoading] = useState(false)
  const signIn = useAuthStore((s) => s.signIn)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await signIn('voltker1', password)
    setLoading(false)
    if (error) {
      toast.error(error)
    } else {
      toast.success('Berhasil masuk')
      navigate('/')
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink p-4 sm:p-6 lg:p-10">
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

        <section className="relative overflow-hidden bg-ink px-6 py-7 text-white lg:hidden">
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
            <p className="mt-7 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              <Sparkles className="h-3.5 w-3.5" /> Ruang kendali toko
            </p>
            <h1 className="mt-2 max-w-xs text-3xl font-bold leading-none tracking-[-0.04em]">
              Semua stok,
              <span className="block text-primary-foreground">satu kendali.</span>
            </h1>
          </div>
        </section>

        <Card className="relative rounded-none border-0 bg-surface/95 shadow-none lg:rounded-none">
          <CardHeader className="items-center pb-2 text-center lg:items-start lg:text-left">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-primary">Selamat datang kembali</p>
            <CardTitle className="text-3xl tracking-tight text-ink">LOGIN</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Lanjutkan aktivitas toko Anda hari ini.</p>
          </CardHeader>
          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-ink/85">Password</label>
                <div className="relative">
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
              </div>
              <Button type="submit" className="w-full shadow-[0_12px_24px_rgba(36,126,121,0.2)]" size="lg" disabled={loading}>
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
