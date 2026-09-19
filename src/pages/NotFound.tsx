import { Link } from 'react-router-dom'
import { ArrowLeft, PackageSearch } from 'lucide-react'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-6 py-12">
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-stone-200/80 bg-surface p-8 shadow-[0_24px_80px_rgba(32,42,46,0.1)] sm:p-12">
        <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-accent/20 blur-2xl" aria-hidden="true" />
        <div className="relative">
          <div className="mb-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-accent">
            <PackageSearch className="h-7 w-7" aria-hidden="true" />
          </div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">Radja Aksesoris</p>
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">Halaman tidak ditemukan</h1>
          <p className="mt-4 max-w-md text-base leading-7 text-slate-500">
            Alamat yang dibuka tidak tersedia atau sudah dipindahkan. Kembali ke ruang kerja untuk melanjutkan.
          </p>
          <Link
            to="/"
            className="mt-8 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-[0_6px_16px_rgba(33,108,104,0.18)] transition-all duration-200 hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 active:scale-[0.98]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Kembali ke dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
