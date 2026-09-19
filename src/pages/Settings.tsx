import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertTriangle, Database, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'

export default function Settings() {
  const { user, isRole } = useAuthStore()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [resetting, setResetting] = useState(false)

  if (!isRole('admin')) return <Navigate to="/" replace />

  async function resetDatabase() {
    if (!user?.email) {
      toast.error('Sesi pengguna tidak ditemukan')
      return
    }
    if (!password) {
      toast.error('Masukkan password akun admin')
      return
    }
    if (confirmation !== 'RESET SEMUA') {
      toast.error('Ketik RESET SEMUA untuk mengonfirmasi')
      return
    }

    setResetting(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    })
    if (authError) {
      toast.error('Password admin salah')
      setResetting(false)
      return
    }

    const resetTables = ['sale_items', 'sales', 'products', 'categories'] as const
    for (const table of resetTables) {
      const { error } = await supabase.from(table).delete().not('id', 'is', null)
      if (error) {
        toast.error(`Reset gagal pada ${table}: ${error.message}`)
        setResetting(false)
        return
      }
    }
    const { error: counterError } = await supabase
      .from('invoice_sequences')
      .update({ next_number: 1 })
      .eq('id', 1)
    if (counterError) {
      toast.error(`Reset nomor transaksi gagal: ${counterError.message}`)
      setResetting(false)
      return
    }

    toast.success('Database operasional berhasil dikosongkan')
    setPassword('')
    setConfirmation('')
    setResetting(false)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Pengaturan</h2>
        <p className="text-sm text-slate-500">Pengaturan khusus administrator</p>
      </div>

      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-700">
            <Database className="h-5 w-5" />
            Reset Database Operasional
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 rounded-lg bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p>
              Tindakan ini menghapus semua produk, kategori, transaksi, dan detail transaksi.
              Akun login dan profil admin tidak ikut dihapus. Tindakan ini tidak dapat dibatalkan.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password admin</label>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Masukkan password akun Anda"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Ketik <strong>RESET SEMUA</strong>
            </label>
            <Input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="RESET SEMUA"
              autoComplete="off"
            />
          </div>
          <Button
            variant="destructive"
            className="w-full"
            disabled={resetting || !password || confirmation !== 'RESET SEMUA'}
            onClick={resetDatabase}
          >
            {resetting && <Loader2 className="h-4 w-4 animate-spin" />}
            {resetting ? 'Mereset database...' : 'Reset Semua Data'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
