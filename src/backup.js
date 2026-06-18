/**
 * backup.js — upload rekursif folder lokal ke Google Drive
 *
 * Kebalikan dari restore.js:
 *   restore  = Drive  → lokal
 *   backup   = lokal  → Drive
 *
 * Setiap file dicek dulu — kalau sudah ada di Drive, di-update;
 * kalau belum ada, di-upload baru.
 */

import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { FOLDER_MIME } from './client.js';

function escapeQ(s) { return s.replace(/'/g, "\\'"); }

/**
 * Upload semua file dalam localDir ke folderId secara rekursif.
 *
 * @param {DriveClient} client
 * @param {string}      localDir   - Folder lokal sumber
 * @param {string}      folderId   - Drive folder-id tujuan
 * @param {string}      [_base]    - Internal: root path untuk log relatif
 * @returns {Promise<{ok: number, failed: number}>}
 */
export async function backupFolder(client, localDir, folderId, _base = localDir) {
  let ok = 0, failed = 0;

  let entries;
  try {
    entries = await fs.readdir(localDir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Tidak bisa baca folder ${localDir}: ${err.message}`);
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;   // skip dotfile / .git dll

    const localPath = path.join(localDir, entry.name);
    const relPath   = path.relative(_base, localPath).replace(/\\/g, '/');

    // ── Sub-folder ──────────────────────────────────────────────────────────
    if (entry.isDirectory()) {
      try {
        // Cari folder di Drive, buat kalau belum ada
        const result = await client.listFilesRaw({
          q        : `name = '${escapeQ(entry.name)}' and '${folderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
          fields   : 'files(id)',
          pageSize : 1,
        });

        let subId;
        if (result.files?.length) {
          subId = result.files[0].id;
        } else {
          const created = await client.createFolder(entry.name, [folderId]);
          subId = created.id;
          console.log(`[mkdir]  ${relPath}`);
        }

        const sub = await backupFolder(client, localPath, subId, _base);
        ok     += sub.ok;
        failed += sub.failed;
      } catch (err) {
        console.error(`[fail]   ${relPath}: ${err.message}`);
        failed++;
      }
      continue;
    }

    // ── File ────────────────────────────────────────────────────────────────
    if (!entry.isFile()) continue;

    try {
      const existing = await client.listFilesRaw({
        q        : `name = '${escapeQ(entry.name)}' and '${folderId}' in parents and trashed = false`,
        fields   : 'files(id)',
        pageSize : 1,
      });

      const stream = createReadStream(localPath);

      if (existing.files?.length) {
        await client.updateFile(existing.files[0].id, stream);
        console.log(`[update] ${relPath}`);
      } else {
        await client.createFile(entry.name, [folderId], stream, 'id');
        console.log(`[upload] ${relPath}`);
      }
      ok++;
    } catch (err) {
      console.error(`[fail]   ${relPath}: ${err.message}`);
      failed++;
    }
  }

  return { ok, failed };
}
