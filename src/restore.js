/**
 * restore.js — download rekursif folder Drive ke direktori lokal (port dari restore.go)
 */

import fs from 'fs/promises';
import path from 'path';
import { FOLDER_MIME } from './client.js';
import { downloadToPath } from './utils.js';

/**
 * Download seluruh isi folder Drive ke localDir secara rekursif.
 *
 * @param {DriveClient} client
 * @param {string}      folderId   - Drive folder-id yang akan di-restore
 * @param {string}      localDir   - Path lokal tujuan (harus sudah ada)
 * @returns {Promise<{ok: number, failed: number}>}
 */
export async function restoreFolder(client, folderId, localDir) {
  let ok = 0, failed = 0, pageToken = '';

  while (true) {
    const result = await client.listFiles(folderId, pageToken);

    for (const file of result.files ?? []) {
      const localPath = path.join(localDir, file.name);

      // ── Sub-folder: rekursi ─────────────────────────────────────────────
      if (file.mimeType === FOLDER_MIME) {
        try {
          await fs.mkdir(localPath, { recursive: true });
          const sub = await restoreFolder(client, file.id, localPath);
          ok     += sub.ok;
          failed += sub.failed;
        } catch (err) {
          console.error(`[skip-dir] ${file.name}: ${err.message}`);
          failed++;
        }
        continue;
      }

      // ── File biasa (atau Google Docs → PDF) ────────────────────────────
      const isGdoc     = file.mimeType.startsWith('application/vnd.google-apps.');
      const appendPdf  = isGdoc;   // tambah .pdf kalau Google Docs

      try {
        const { finalPath, written } = await downloadToPath(
          client, file.id, file.mimeType, localPath, appendPdf,
        );
        console.log(`[restore] ${finalPath} (${written} bytes)`);
        ok++;
      } catch (err) {
        console.error(`[fail] ${file.name}: ${err.message}`);
        failed++;
      }
    }

    if (!result.nextPageToken) break;
    pageToken = result.nextPageToken;
  }

  return { ok, failed };
}
