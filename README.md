# 📁 gdrive-node

> Google Drive di terminal — CLI kencang + library Node.js siap pakai.  
> Port dari implementasi Go, tanpa native addon, murni JavaScript. ⚡

---

## ✨ Fitur

- 📋 **List** file & folder dengan format rapi
- 🔍 **Search** file berdasarkan nama
- ⬆️  **Upload** file ke Drive
- ⬇️  **Download** file (Google Docs otomatis jadi PDF)
- 📂 **Mkdir** buat folder baru
- 🗑️  **Delete** hapus permanen
- ℹ️  **Info** metadata lengkap file
- 📦 **Backup** upload semua file lokal ke Drive secara rekursif
- 🔄 **Restore** download seluruh folder secara rekursif
- 👁️  **Watch** pantau folder lokal & sinkron ke Drive real-time

---

## 📦 Instalasi

```bash
npm install gdrive@github:frmdeveloper/gdrive-node
```

**Dependensi:**

| Package | Fungsi |
|---|---|
| `googleapis` | Drive API v3 |
| `google-auth-library` | OAuth2 |
| `chokidar` | File watcher real-time |

---

## 🔐 Setup OAuth (sekali saja)

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → buat project
2. Aktifkan **Google Drive API**
3. Buat **OAuth 2.0 Client ID** — pilih tipe **Desktop app**
4. Download JSON → simpan sebagai **`credentials.json`** di direktori kerja
5. Jalankan perintah apapun → browser terbuka untuk login 🌐
6. Token tersimpan otomatis ke `token.json` ✅

---

## 🖥️ CLI

### 📋 List
```bash
gdrive list                      # root
gdrive list 1AbC_folderId        # folder tertentu
```
```
d | Dokumen     | -        | 1AbC...
- | foto.jpg    | 3.4 MiB  | 1XyZ...
- | laporan.pdf | 1.0 MiB  | 1BxY...
```

### 🔍 Search
```bash
gdrive search laporan
gdrive search "laporan 2024"
```

### ⬆️ Upload
```bash
gdrive upload ./dokumen.pdf
gdrive upload ./dokumen.pdf 1AbC_parentFolderId
```

### ⬇️ Download
```bash
gdrive download 1XyZ_fileId
gdrive download 1XyZ_fileId ./salinan.pdf
```
> 💡 Google Docs / Sheets / Slides otomatis di-export ke PDF

### 📂 Mkdir
```bash
gdrive mkdir "Proyek Baru"
gdrive mkdir "Proyek Baru" 1AbC_parentId
```

### 🗑️ Delete
```bash
gdrive delete 1XyZ_fileId
```

### ℹ️ Info
```bash
gdrive info 1XyZ_fileId
```
```
Nama    : laporan.pdf
ID      : 1XyZ_fileId
Tipe    : application/pdf
Ukuran  : 1048576 bytes
Dibuat  : 2024-01-15T08:00:00.000Z
Diubah  : 2024-03-20T14:30:00.000Z
Link    : https://drive.google.com/...
```

### 📦 Backup
```bash
gdrive backup ./proyek 1AbC_folderId
```
```
📦 Backup ./proyek  →  Drive 1AbC_folderId

[upload] src/index.js
[upload] src/auth.js
[mkdir]  src/utils
[upload] src/utils/helper.js
[update] README.md

Backup selesai: 5 berhasil, 0 gagal
```
> 💡 File yang sudah ada di Drive akan di-update, bukan duplikat

### 🔄 Restore
```bash
gdrive restore 1AbC_folderId ./backup-lokal
```
> Mendownload seluruh folder Drive beserta sub-foldernya 📥

### 👁️ Watch
```bash
gdrive watch ./proyek 1AbC_folderId
```
```
👁️  Memantau ./proyek  →  Drive 1AbC_folderId
Tekan Ctrl+C untuk berhenti.

[upload] dokumen/laporan.pdf
[update] dokumen/laporan.pdf
[delete] dokumen/lama.txt
[mkdir]  assets/gambar
```

---

## 📦 Sebagai Module

### 🚀 High-level API

```js
import { create } from 'gdrive';

const drive = await create();

// 📋 List
const files = await drive.list();
const sub   = await drive.list('1AbC_folderId');

// 🔍 Search
const hits = await drive.search('laporan');

// ⬆️ Upload
const file = await drive.upload('./x.pdf');
const file2 = await drive.upload('./x.pdf', '1AbC_parentId');

// ⬇️ Download
const bytes = await drive.download('1XyZ_fileId', './output.pdf');

// 📂 Mkdir
const dir = await drive.mkdir('Arsip', '1AbC_parentId');

// 🗑️ Delete
await drive.remove('1XyZ_fileId');

// ℹ️ Info
const info = await drive.info('1XyZ_fileId');

// 📦 Backup
const { ok, failed } = await drive.backup('./proyek', '1AbC_folderId');

// 🔄 Restore
const { ok, failed } = await drive.restore('1AbC_folderId', './lokal');
console.log(`✅ ${ok} berhasil, ❌ ${failed} gagal`);

// 👁️ Watch
const watcher = await drive.watch('./proyek', '1AbC_folderId');
// ...
watcher.stop(); // 🛑 berhenti
```

### 🔧 Low-level API

```js
import { getDriveService, DriveClient, startWatch, restoreFolder } from 'gdrive';

const auth   = await getDriveService({ credentialsFile: 'creds.json' });
const client = new DriveClient(auth);

const { files } = await client.listFiles('root');
const meta      = await client.getFile('1XyZ');
const stream    = await client.downloadFile('1XyZ');
```

---

## 🗂️ Struktur Project

```
gdrive-node/
├── 📄 package.json
├── 📁 bin/
│   └── 📄 gdrive.js        ← CLI entry point
└── 📁 src/
    ├── 📄 auth.js           ← 🔐 OAuth2
    ├── 📄 client.js         ← 🌐 DriveClient (API wrapper)
    ├── 📄 utils.js          ← 🛠️  humanSize, downloadToPath
    ├── 📄 watch.js          ← 👁️  FolderCache + startWatch
    ├── 📄 backup.js         ← 📦 backupFolder
    ├── 📄 restore.js        ← 🔄 restoreFolder
    ├── 📄 commands.js       ← 🖥️  handler perintah CLI
    └── 📄 index.js          ← 📦 public exports + create()
```

---

## 📄 Lisensi

MIT — bebas dipakai dan dimodifikasi. 🎉
