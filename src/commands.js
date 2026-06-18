/**
 * commands.js — handler perintah CLI (port dari commands.go)
 *
 * Setiap fungsi menerima (client, args[]) dan bersifat async.
 * Bisa dipakai langsung tanpa CLI (misal dari skrip lain).
 */

import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { FOLDER_MIME } from './client.js';
import { humanSize, downloadToPath } from './utils.js';
import { restoreFolder } from './restore.js';
import { backupFolder }  from './backup.js';
import { startWatch }    from './watch.js';

// ── Helpers tampilan ─────────────────────────────────────────────────────────

export function printFileList(files) {
  for (const f of files) {
    const isDir = f.mimeType === FOLDER_MIME;
    const typ   = isDir ? 'd' : '-';
    const size  = isDir ? '-' : humanSize(f.size);
    console.log(`${typ} | ${f.name} | ${size} | ${f.id}`);
  }
}

// ── Perintah ─────────────────────────────────────────────────────────────────

/** gdrive list [parent-id] */
export async function cmdList(client, args) {
  const parent = args[0] ?? 'root';
  const result = await client.listFiles(parent);
  if (!result.files?.length) return console.log('(kosong)');
  printFileList(result.files);
}

/** gdrive search <kata-kunci> */
export async function cmdSearch(client, args) {
  const keyword = args[0];
  if (!keyword) throw new Error('Penggunaan: gdrive search <kata-kunci>');

  const result = await client.searchFiles(keyword);
  if (!result.files?.length) return console.log('Tidak ada hasil.');
  printFileList(result.files);
}

/** gdrive upload <path-file> [parent-folder-id] */
export async function cmdUpload(client, args) {
  if (!args.length) throw new Error('Penggunaan: gdrive upload <path-file> [parent-folder-id]');

  const [localPath, parentId] = args;
  const stream   = createReadStream(localPath);
  const uploaded = await client.createFile(
    path.basename(localPath),
    parentId ? [parentId] : [],
    stream,
    'id,name,size',
  );
  console.log(`Upload berhasil: ${uploaded.name} (${uploaded.size ?? 0} bytes)`);
  console.log(`ID: ${uploaded.id}`);
}

/** gdrive download <file-id> [output-path] */
export async function cmdDownload(client, args) {
  if (!args.length) throw new Error('Penggunaan: gdrive download <file-id> [output-path]');

  const [fileId, destArg] = args;
  const meta    = await client.getFile(fileId);
  const isGdoc  = meta.mimeType.startsWith('application/vnd.google-apps.');
  const dest    = destArg ?? meta.name;
  const addPdf  = !destArg && isGdoc;

  const { finalPath, written } = await downloadToPath(
    client, fileId, meta.mimeType, dest, addPdf,
  );
  console.log(`Download berhasil: ${finalPath} (${written} bytes)`);
}

/** gdrive mkdir <nama-folder> [parent-id] */
export async function cmdMkdir(client, args) {
  if (!args.length) throw new Error('Penggunaan: gdrive mkdir <nama-folder> [parent-id]');
  const [name, parentId] = args;
  const created = await client.createFolder(name, parentId ? [parentId] : []);
  console.log(`Folder dibuat: ${created.name}`);
  console.log(`ID: ${created.id}`);
}

/** gdrive delete <file-id> */
export async function cmdDelete(client, args) {
  if (!args.length) throw new Error('Penggunaan: gdrive delete <file-id>');
  await client.deleteFile(args[0]);
  console.log('Berhasil dihapus permanen.');
}

/** gdrive info <file-id> */
export async function cmdInfo(client, args) {
  if (!args.length) throw new Error('Penggunaan: gdrive info <file-id>');

  const f = await client.getFile(args[0]);
  const rows = [
    ['Nama',    f.name],
    ['ID',      f.id],
    ['Tipe',    f.mimeType],
    ['Ukuran',  `${f.size ?? 0} bytes`],
    ['Dibuat',  f.createdTime],
    ['Diubah',  f.modifiedTime],
  ];
  if (f.parents?.length)  rows.push(['Parent', f.parents.join(', ')]);
  if (f.webViewLink)      rows.push(['Link',   f.webViewLink]);
  for (const [k, v] of rows) console.log(`${k.padEnd(8)}: ${v}`);
}

/** gdrive backup <local-dir> <drive-folder-id> */
export async function cmdBackup(client, args) {
  if (args.length < 2) throw new Error('Penggunaan: gdrive backup <local-dir> <drive-folder-id>');
  const [localDir, folderId] = args;

  // Pastikan folder lokal ada
  const stat = await fs.stat(localDir).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Bukan folder yang valid: ${localDir}`);

  console.log(`📦 Backup ${localDir}  →  Drive ${folderId}\n`);
  const { ok, failed } = await backupFolder(client, localDir, folderId);
  console.log(`\nBackup selesai: ${ok} berhasil, ${failed} gagal`);
}

/** gdrive restore <local-dir> <folder-id> */
export async function cmdRestore(client, args) {
  if (args.length < 2) throw new Error('Penggunaan: gdrive restore <local-dir> <drive-folder-id>');
  const [localDir, folderId] = args;
  await fs.mkdir(localDir, { recursive: true });
  const { ok, failed } = await restoreFolder(client, localDir, folderId);
  console.log(`\nRestore selesai: ${ok} berhasil, ${failed} gagal`);
}

/** gdrive watch <local-dir> <drive-folder-id> */
export async function cmdWatch(client, args) {
  if (args.length < 2) throw new Error('Penggunaan: gdrive watch <local-dir> <drive-folder-id>');
  const [localDir, folderId] = args;

  console.log(`👁️  Memantau ${localDir}  →  Drive ${folderId}`);
  console.log('Tekan Ctrl+C untuk berhenti.\n');

  const watcher = await startWatch(client, localDir, folderId);

  // Blokir sampai Ctrl+C
  await new Promise((resolve) => {
    process.once('SIGINT', async () => {
      console.log('\nMenghentikan watcher...');
      await watcher.stop();
      resolve();
    });
  });
}
