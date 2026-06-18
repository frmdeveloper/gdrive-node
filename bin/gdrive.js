#!/usr/bin/env node
/**
 * bin/gdrive.js — CLI entry point (port dari main.go + commands.go)
 *
 * Penggunaan:
 *   gdrive <perintah> [argumen...]
 */

import { getDriveService } from '../src/auth.js';
import { DriveClient }     from '../src/client.js';
import {
  cmdList,
  cmdSearch,
  cmdUpload,
  cmdDownload,
  cmdMkdir,
  cmdDelete,
  cmdInfo,
  cmdBackup,
  cmdRestore,
  cmdWatch,
} from '../src/commands.js';

// ── Daftar perintah ───────────────────────────────────────────────────────────

const COMMANDS = {
  list     : cmdList,
  search   : cmdSearch,
  upload   : cmdUpload,
  download : cmdDownload,
  mkdir    : cmdMkdir,
  delete   : cmdDelete,
  info     : cmdInfo,
  backup   : cmdBackup,
  restore  : cmdRestore,
  watch    : cmdWatch,
};

// ── Teks bantuan ──────────────────────────────────────────────────────────────

const HELP = `
gdrive <perintah> [opsi]

Perintah:
  list     [parent-id]               Daftar file/folder (root jika tanpa ID)
  search   <kata-kunci>              Cari file berdasarkan nama
  upload   <path> [parent-id]        Upload file ke Drive
  download <file-id> [output-path]   Download file dari Drive
  mkdir    <nama> [parent-id]        Buat folder baru
  delete   <file-id>                 Hapus file/folder permanen
  info     <file-id>                 Tampilkan metadata lengkap
  backup   <local-dir> <folder-id>   Upload semua file lokal ke Drive
  restore  <folder-id> <local-dir>   Download seluruh folder Drive ke lokal
  watch    <local-dir> <folder-id>   Pantau folder lokal & sinkron ke Drive

Opsi:
  -h, --help   Tampilkan bantuan ini

Contoh:
  gdrive list
  gdrive list 1AbC_folderId
  gdrive search "laporan 2024"
  gdrive upload ./dokumen.pdf
  gdrive upload ./dokumen.pdf 1AbC_parentId
  gdrive download 1XyZ_fileId
  gdrive download 1XyZ_fileId ./salinan.pdf
  gdrive mkdir "Arsip Q1" 1AbC_parentId
  gdrive delete 1XyZ_fileId
  gdrive info 1XyZ_fileId
  gdrive restore 1AbC_folderId ./backup
  gdrive watch ./proyek 1AbC_folderId
`.trim();

// ── Dispatch ──────────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

if (!cmd || cmd === '-h' || cmd === '--help') {
  console.log(HELP);
  process.exit(0);
}

if (!COMMANDS[cmd]) {
  console.error(`Perintah tidak dikenal: "${cmd}"`);
  console.error('Jalankan "gdrive --help" untuk melihat daftar perintah.');
  process.exit(1);
}

try {
  const auth   = await getDriveService();
  const client = new DriveClient(auth);
  await COMMANDS[cmd](client, args);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
