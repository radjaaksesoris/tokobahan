# KonveksiPOS

Aplikasi **Point of Sale (POS)** modern untuk **toko grosir alat konveksi**, dibangun dengan React + Vite + Supabase.

- Responsive (HP & Tablet)
- UI modern (Tailwind CSS)
- Multi-satuan harga jual (Satuan, Lusin, Kodi, Gross, Meter, Pack)
- Harga berbeda per satuan
- Perhitungan laba/rugi & pendapatan bersih real-time
- Satu akun administrator untuk seluruh operasional toko
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
| **Akses** | Hanya akun `admin` |

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
- **Offline checkout**: Transaksi kasir disimpan lebih dulu di IndexedDB dan dikirim ulang
  otomatis saat online (maksimal 5 transaksi per batch). Status pending/gagal terlihat di POS;
  transaksi gagal dapat dicoba ulang dari indikator status.

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
   - Jalankan `supabase/migrations/20260920150000_add_fifo_stock_batches.sql` setelah migration
     checkout untuk mengaktifkan penerimaan stok, pencatatan batch HPP FIFO, dan checkout
     atomik terbaru. Migration ini menggantikan implementasi checkout lama secara aman dengan
     `CREATE OR REPLACE FUNCTION`.
   - Untuk database yang sudah memakai migration checkout, jalankan juga
     `supabase/migrations/20260919223000_scale_hardening.sql` agar agregasi laporan,
     pencarian data besar, index tambahan, dan reset database atomik aktif.
   - Untuk push notification saat aplikasi tidak aktif, jalankan
     `supabase/migrations/20260919231000_push_notifications.sql`, deploy function
     `supabase/functions/notify-low-stock`, lalu isi secret `VAPID_SUBJECT`,
     `VAPID_PUBLIC_KEY`, dan `VAPID_PRIVATE_KEY` di Supabase Edge Functions.
3. Ambil **Project URL** dan **anon public key** di Settings → API

### 3. Environment

```bash
cp .env.example .env
```

Isi:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
VITE_VAPID_PUBLIC_KEY=BCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. Buat Akun Administrator

Buat satu akun Supabase Auth melalui Supabase Dashboard → Authentication →
Users → Add user. Login aplikasi menggunakan email dan password akun ini.
Setelah user dibuat, ubah role profilnya menjadi `admin` melalui SQL Editor:

```sql
UPDATE profiles SET role = 'admin' WHERE id = 'user-uuid';
```

Jangan buat akun kasir atau monitor. Akun dengan role lama tetap tersimpan,
tetapi tidak lagi bisa mengakses data atau menggunakan aplikasi.

### 5. Jalankan

```bash
npm run dev
```

Jalankan test unit dengan `npm test`.

Buka http://localhost:5173

### PWA

Build production (`npm run build`) sudah menghasilkan aplikasi yang bisa dipasang dari browser melalui opsi **Install app / Add to Home Screen**. Service worker melakukan cache app shell dan menampilkan shell terakhir saat koneksi terputus. Untuk menguji mode offline, gunakan `npm run preview` lalu buka melalui HTTPS atau `localhost`.
Checkout offline membutuhkan browser dengan IndexedDB dan sesi kasir yang masih valid. Nomor
invoice offline memakai prefix `OFF-`; RPC `checkout_sale` tetap menjadi satu-satunya jalur
penyimpanan server dan validasi stok.

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

1. **Login** sebagai admin
2. **Produk** → Tambah barang, isi harga modal + harga jual per satuan
3. **Kasir** → Cari produk → pilih satuan (Lusin/Gross/dll) → qty → Bayar
4. **Dashboard / Laporan** → Pantau penjualan & laba

## Catatan Penting

- Aplikasi dirancang untuk **satu administrator**; seluruh menu operasional tersedia dari akun tersebut.
- Stok otomatis berkurang saat checkout (berdasarkan conversion satuan).
- Jalankan migration Supabase secara berurutan sebelum memakai aplikasi setelah deploy.
- Jalankan migration `20260921140000_production_rls_hardening.sql` sebelum production.
  Migration ini mengaktifkan pemeriksaan role pada operasi database.
- Jalankan migration `20260923233000_harden_return_adjustment_writes.sql` setelah migration
  retur. Migration ini membatasi penulisan langsung ke tabel retur dan stok opname;
  pencatatan harus melalui RPC yang memeriksa role.
- Jalankan migration `20260921150000_operational_backups.sql` untuk mengaktifkan
  backup admin. Tombol backup menyimpan snapshot operasional di Supabase dan
  mengunduh file JSON ke perangkat; password dan token tidak ikut dicadangkan.
- Jalankan migration `20260924010000_cloud_backup_retention.sql` setelah migration
  backup untuk mengaktifkan daftar, restore backup cloud, dan retensi maksimal 7
  backup terbaru per admin.
- Jalankan migration `20260924020000_operational_backup_storage.sql` setelah migration
  retensi. Migration ini membuat bucket private `operational-backups`, policy Storage
  admin-only, dan metadata object pada `operational_backups`. Backup baru benar-benar
  diunggah sebagai file JSON ke Storage melalui client Supabase terautentikasi; service
  role tidak pernah dikirim ke browser. Backup lama tanpa `storage_object_path` tetap
  dapat diunduh/dipulihkan dari payload database.
- Jalankan migration `20260926130000_harden_production_financial_workflows.sql`
  setelah migration sebelumnya. Migration ini memvalidasi transaksi di RPC checkout,
  membuat retry pelunasan offline idempoten, mempertahankan seluruh riwayat penjualan,
  dan memasukkan refund tunai retur ke laporan arus kas. Backfill retur lama
  mengasumsikan refund pada transaksi non-kredit dibayar tunai penuh; verifikasi
  asumsi ini terhadap buku kas sebelum mengandalkan laporan historis.
- Jalankan migration `20260926140000_single_admin_access.sql` paling akhir.
  Migration ini membatasi akses tabel dan RPC ke administrator, menolak akses
  aplikasi bagi akun non-admin, dan mempertahankan profil serta transaksi historis.
  Deploy ulang Edge Function `notify-low-stock` agar aturan admin-only ikut aktif.
- Urutan SQL Editor yang tepat adalah menjalankan seluruh migration yang belum diterapkan
  secara kronologis; untuk rangkaian backup, pastikan `20260921150000_operational_backups.sql`,
  migration restore/expand backup `20260923210000_returns_stock_restore.sql` dan
  `20260923211000_expand_operational_backup.sql`, lalu `20260924010000_cloud_backup_retention.sql`,
  `20260924020000_operational_backup_storage.sql`, dan terakhir
  `20260926130000_harden_production_financial_workflows.sql`. Jika memakai Supabase CLI,
  jalankan `supabase db push` dari root repository. Setelah selesai, buka Storage →
  `operational-backups` untuk memverifikasi file backup baru (bucket harus Private).

---

Dibuat untuk toko grosir alat konveksi Indonesia.
