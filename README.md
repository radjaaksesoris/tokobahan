# KonveksiPOS

Aplikasi **Point of Sale (POS)** modern untuk **toko grosir alat konveksi**, dibangun dengan React + Vite + Supabase.

- Responsive (HP & Tablet)
- UI modern (Tailwind CSS)
- Multi-satuan harga jual (Satuan, Lusin, Kodi, Gross, Meter, Pack)
- Harga berbeda per satuan
- Perhitungan laba/rugi & pendapatan bersih real-time
- Single device POS + multi-user monitoring (4+ monitor via dashboard)
- Realtime update via Supabase Realtime
- Deploy mudah via GitHub → Vercel / Netlify

## Fitur Utama

| Fitur | Keterangan |
|-------|------------|
| **Kasir (POS)** | Cari produk, pilih satuan, qty, pembayaran (Tunai/TF/QRIS/Kredit) |
| **Harga Multi-Satuan** | Setiap produk bisa punya harga berbeda untuk satuan / lusin / gross / dll |
| **Laba Rugi** | Otomatis hitung HPP, laba kotor, margin % per transaksi & periode |
| **Dashboard** | KPI hari ini + grafik 7 hari (realtime) |
| **Produk** | CRUD produk + atur harga per satuan |
| **Laporan** | Filter hari ini / 7 hari / bulan + riwayat transaksi |
| **Role** | `admin`, `cashier`, `monitor` |

### Konversi Satuan Default
- **Satuan** = 1 pcs
- **Lusin** = 12 pcs
- **Kodi** = 20 pcs
- **Gross** = 144 pcs
- **Meter** / **Pack** = custom (atur conversion di produk)

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS 4
- **State**: Zustand
- **Backend**: Supabase (Auth, Postgres, Realtime)
- **Charts**: Recharts
- **Icons**: Lucide React
- **Routing**: React Router 7
- **PWA**: Installable di HP/desktop, offline app shell, dan service worker untuk caching aset

## Setup Lokal

### 1. Clone & Install

```bash
git clone <repo-url>
cd konveksi-pos
npm install
```

### 2. Buat Project Supabase

1. Buka [supabase.com](https://supabase.com) → New Project
2. Masuk ke **SQL Editor** → paste seluruh isi file `supabase/schema.sql` → Run
   - Stok, harga modal, dan harga jual menggunakan satuan yang dipilih secara langsung;
     sistem tidak mengonversi nilai ke pcs/base unit.
   - Jika database sudah pernah dibuat, jalankan file
     `supabase/migrations/20260919210000_restore_checkout_sale.sql` untuk mengaktifkan RPC
     checkout dan menyegarkan schema cache PostgREST.
3. Ambil **Project URL** dan **anon public key** di Settings → API

### 3. Environment

```bash
cp .env.example .env
```

Isi:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 4. Buat User

Di Supabase Dashboard → Authentication → Users → Add user  
Atau daftar via app (setelah enable Email provider).

Setelah user dibuat, update role di tabel `profiles`:

```sql
UPDATE profiles SET role = 'admin' WHERE id = 'user-uuid';
-- role: admin | cashier | monitor
```

Buat 4 user dengan role `monitor` / `admin` untuk monitoring, dan 1 `cashier` untuk device kasir.

### 5. Jalankan

```bash
npm run dev
```

Buka http://localhost:5173

### PWA

Build production (`npm run build`) sudah menghasilkan aplikasi yang bisa dipasang dari browser melalui opsi **Install app / Add to Home Screen**. Service worker melakukan cache app shell dan menampilkan shell terakhir saat koneksi terputus. Untuk menguji mode offline, gunakan `npm run preview` lalu buka melalui HTTPS atau `localhost`.

## Deploy ke GitHub + Vercel (Recommended)

### 1. Push ke GitHub

```bash
git init
git add .
git commit -m "Initial KonveksiPOS"
git branch -M main
git remote add origin https://github.com/USERNAME/konveksi-pos.git
git push -u origin main
```

### 2. Deploy Vercel

1. Buka [vercel.com](https://vercel.com) → Import Project → pilih repo
2. Framework: **Vite**
3. Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy

Untuk GitHub Pages, tambahkan dua **Repository secrets** berikut di
`Settings → Secrets and variables → Actions`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Workflow deploy membaca secrets tersebut saat menjalankan `npm run build`.

Setiap push ke `main` akan auto-deploy.

### Alternatif: Netlify

Sama, connect GitHub repo, build command `npm run build`, publish dir `dist`.

## Struktur Folder

```
src/
├── components/
│   ├── layout/      # Sidebar + header
│   └── ui/          # Button, Input, Card
├── pages/
│   ├── Dashboard.tsx
│   ├── POS.tsx      # Kasir
│   ├── Products.tsx
│   ├── Reports.tsx  # Laba rugi
│   └── Login.tsx
├── store/           # Zustand (cart + auth)
├── lib/             # supabase client + utils
└── types/
supabase/
└── schema.sql       # Full database schema
```

## Cara Pakai Singkat

1. **Login** sebagai admin/cashier
2. **Produk** → Tambah barang, isi harga modal + harga jual per satuan
3. **Kasir** → Cari produk → pilih satuan (Lusin/Gross/dll) → qty → Bayar
4. **Dashboard / Laporan** → Monitor penjualan & laba (bisa dibuka di 4 HP/tablet berbeda secara realtime)

## Catatan Penting

- Aplikasi dirancang **single store / single device POS**. Device kasir cukup satu, sisanya monitor via dashboard.
- Realtime: setiap transaksi langsung muncul di dashboard monitor lain.
- Stok otomatis berkurang saat checkout (berdasarkan conversion satuan).
- Untuk production: aktifkan RLS lebih ketat jika perlu multi-toko.

---

Dibuat untuk toko grosir alat konveksi Indonesia.
