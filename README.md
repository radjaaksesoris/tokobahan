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
- **Backup HDD otomatis**: Di Chrome/Edge desktop, admin dapat memilih folder HDD dari Pengaturan → Backup.
  Backup penuh disimpan ke `tokobahan-backup-latest.json` dan file arsip bertimestamp setiap hari pukul 17.00.
  Fitur ini berjalan selama aplikasi/browser terbuka.
- **Akses offline**: Perangkat yang pernah berhasil login menyimpan sesi admin dan profil lokal hingga 30 hari
  untuk tetap dapat membuka aplikasi tanpa koneksi. Logout tetap menghapus akses offline dari perangkat tersebut.

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
   - Setelah schema dasar, jalankan semua file di `supabase/migrations/` yang belum
     diterapkan dalam urutan nama/timestamp sebelum aplikasi digunakan. Untuk database
     production, jangan hanya menjalankan contoh migration pilihan di bawah.
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

### Backup ke HDD saat offline

Pada PC, buka **Pengaturan → Backup → Backup otomatis ke HDD PC**, lalu pilih folder pada HDD. Browser akan
meminta izin folder satu kali. Selama aplikasi terbuka, perubahan snapshot lokal dicadangkan otomatis ke folder
tersebut. File `tokobahan-backup-latest.json` adalah salinan terbaru dan file bertimestamp yang dibuat pukul 17.00
dapat dipakai sebagai riwayat backup penuh.

Penulisan langsung ke folder HDD menggunakan File System Access API, sehingga Chrome atau Edge desktop diperlukan.
Browser tidak dapat menjalankan backup ketika aplikasi benar-benar ditutup atau PC mati; untuk jadwal tersebut
gunakan service desktop atau Windows Task Scheduler sebagai lapisan tambahan.

## Deploy ke GitHub + Vercel (Recommended)

## Aplikasi desktop Tauri

Proyek ini juga memiliki wrapper Tauri untuk aplikasi desktop. Jalankan `npm run tauri:dev` untuk pengembangan
 desktop atau `npm run tauri:build` untuk membuat paket pada sistem operasi pengembang. Workflow **Publish Tauri
Windows Update** membuat GitHub Release berisi installer Windows dan berkas updater yang sudah ditandatangani.
Versi desktop menggunakan alur React dan Supabase yang sama dengan PWA.

### Auto-update Tauri

Updater hanya berlaku untuk aplikasi desktop Tauri; PWA tetap diperbarui melalui deploy web.

1. Signing key sudah disiapkan lokal di `.tauri-secrets/raja-aksesoris.key`. Jangan commit atau membagikan file ini.
2. Di GitHub buka **Settings → Secrets and variables → Actions → New repository secret**:
   - Nama: `TAURI_SIGNING_PRIVATE_KEY`
   - Nilai: seluruh isi file `.tauri-secrets/raja-aksesoris.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` tidak perlu dibuat karena key ini tidak memakai password.
3. Saat akan merilis pembaruan, naikkan `version` di `src-tauri/tauri.conf.json`, misalnya `0.1.0` menjadi `0.1.1`, lalu commit dan push.
4. Buka **Actions → Publish Tauri Windows Update → Run workflow**. Workflow akan membuat tag dan Release secara otomatis.

```bash
# contoh versi yang ditulis di src-tauri/tauri.conf.json
"version": "0.1.1"
```

GitHub Actions akan membuat Release publik dengan `latest.json`, installer, dan signature. Aplikasi desktop memeriksa
versi baru saat dibuka dan menyediakan tombol **Cek pembaruan aplikasi** di **Pengaturan → Backup**. Admin tetap harus
menyetujui pemasangan; data lokal tidak dihapus saat update.

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
- Tombol **Reset Semua Data** menghapus data operasional dan master, membersihkan antrean
  offline di perangkat yang menjalankan reset, dan mengembalikan nomor invoice online ke
  `RJA-0001`. Generasi reset disimpan di server; saat perangkat lain kembali online, antrean
  dan cache operasional yang tertinggal otomatis dihapus sebelum sinkronisasi. Jangan
  mencatat transaksi secara offline pada perangkat lama setelah reset; antrean tersebut
  akan dibuang saat perangkat tersambung kembali. Akun/profil admin, subscription notifikasi,
  konfigurasi Edge Functions, dan backup operasional tetap dipertahankan; UUID data tidak
  diurutkan ulang.
- Jalankan migration Supabase secara berurutan sebelum memakai aplikasi setelah deploy.
- Migration `20260927210000_offline_reset_generation.sql` harus diterapkan sebelum deploy
  frontend yang memeriksa generasi reset; tanpa migration ini, sinkronisasi offline akan
  berhenti dengan error secara sengaja agar antrean lama tidak terkirim.
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
- Jalankan migration `20260926140000_single_admin_access.sql` setelah migration
  sebelumnya.
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
- Setelah menjalankan migration `20260927130000_remove_legacy_checkout_overload.sql`,
  verifikasi signature dan hak akses checkout di SQL Editor. Hasil harus hanya berisi
  satu fungsi checkout 9-parameter; `authenticated` boleh menjalankannya, sedangkan
  `anon` tidak:

  ```sql
  SELECT
    p.oid::regprocedure AS signature,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('checkout_sale', 'checkout_sale_internal');
  ```

  Pastikan hasil tepat satu baris dengan signature
  `checkout_sale(text,numeric,numeric,numeric,text,uuid,jsonb,text,numeric)`,
  `authenticated_can_execute = true`, dan `anon_can_execute = false`.
  Migration menghapus signature lama 7-parameter dan helper internal lamanya yang
  menerima total dari klien.

---

Dibuat untuk toko grosir alat konveksi Indonesia.
