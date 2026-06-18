#!/usr/bin/env node
/**
 * bin/gdrive.js — CLI entry point
 *
 * Penggunaan:
 *   gdrive [--credentials <path>] [--token <path>] <perintah> [argumen...]
 *
 * Env vars (fallback):
 *   GDRIVE_CREDENTIALS   path ke credentials.json
 *   GDRIVE_TOKEN         path ke token.json
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
gdrive [opsi-global] <perintah> [argumen...]

Perintah:
  list     [parent-id]               Daftar file/folder (root jika tanpa ID)
  search   <kata-kunci>              Cari file berdasarkan nama
  upload   <path> [parent-id]        Upload file ke Drive
  download <file-id> [output-path]   Download file dari Drive
  mkdir    <nama> [parent-id]        Buat folder baru
  delete   <file-id>                 Hapus file/folder permanen
  info     <file-id>                 Tampilkan metadata lengkap
  backup   <local-dir> <folder-id>   Upload semua file lokal ke Drive
  restore  <local-dir> <folder-id>   Download seluruh folder Drive ke lokal
  watch    <local-dir> <folder-id>   Pantau folder lokal & sinkron ke Drive

Opsi global:
  -c, --credentials <path>   Path ke credentials.json  [default: credentials.json]
  -t, --token <path>         Path ke token.json        [default: token.json]
  -h, --help                 Tampilkan bantuan ini

Env vars:
  GDRIVE_CREDENTIALS   Sama seperti --credentials
  GDRIVE_TOKEN         Sama seperti --token

Contoh:
  gdrive list
  gdrive --credentials ~/.config/gdrive/creds.json list
  gdrive -c ./creds.json -t ./token.json watch ./proyek 1AbC_folderId
  GDRIVE_CREDENTIALS=./creds.json gdrive upload ./file.pdf
`.trim();

// ── Parse argumen global ──────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    credentialsFile : process.env.GDRIVE_CREDENTIALS ?? 'credentials.json',
    tokenFile       : process.env.GDRIVE_TOKEN       ?? 'token.json',
  };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--credentials') {
      opts.credentialsFile = argv[++i];
    } else if (a === '-t' || a === '--token') {
      opts.tokenFile = argv[++i];
    } else {
      rest.push(a);
    }
  }

  return { opts, rest };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const { opts, rest } = parseArgs(rawArgs);
const [cmd, ...args] = rest;

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
  const auth   = await getDriveService(opts);
  const client = new DriveClient(auth);
  await COMMANDS[cmd](client, args);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
