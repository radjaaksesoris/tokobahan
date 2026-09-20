import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useAuthStore'
import { LoadingDots } from '@/components/ui/LoadingDots'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { toast } from 'sonner'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const signIn = useAuthStore((s) => s.signIn)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) {
      toast.error(error)
    } else {
      toast.success('Berhasil masuk')
      navigate('/')
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ink p-4">
      <img
        src={`${import.meta.env.BASE_URL}login-background.jpg`}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-75"
      />
      <div
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(32,42,46,0.94)_0%,rgba(32,42,46,0.62)_45%,rgba(32,42,46,0.86)_100%)]"
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,253,248,0.1),transparent_48%)]" aria-hidden="true" />
      <Card className="relative w-full max-w-md border-white/35 bg-surface/90 shadow-[0_24px_80px_rgba(20,27,30,0.32)] backdrop-blur-md">
        <CardHeader className="items-center text-center pb-2">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-ink shadow-[0_0_0_6px_rgba(228,168,83,0.14)]">
            <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="Radja Aksesoris" className="h-14 w-14 rounded-2xl object-cover" />
          </div>
          <CardTitle className="text-2xl tracking-tight text-ink">RADJA AKSESORIS</CardTitle>
          <p className="text-sm text-muted-foreground">Aksesoris Konveksi</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink/85">Username atau email</label>
              <Input
                type="text"
                placeholder="voltker1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink/85">Password</label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? <LoadingDots className="text-current" dotClassName="h-1.5 w-1.5" /> : 'Masuk'}
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Aplikasi single-device POS · Multi-monitor dashboard
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
