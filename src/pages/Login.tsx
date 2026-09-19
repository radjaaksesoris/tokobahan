import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Store, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-800 via-teal-700 to-teal-900 p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="items-center text-center pb-2">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-100">
            <Store className="h-8 w-8 text-teal-700" />
          </div>
          <CardTitle className="text-2xl">KonveksiPOS</CardTitle>
          <p className="text-sm text-slate-500">Toko Grosir Alat Konveksi</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <Input
                type="email"
                placeholder="email@toko.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
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
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Masuk'}
            </Button>
          </form>
          <p className="mt-6 text-center text-xs text-slate-400">
            Aplikasi single-device POS · Multi-monitor dashboard
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
