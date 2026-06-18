/**
 * index.js — public API module (port dari napi.go)
 *
 * Dua cara pakai:
 *
 *  1) High-level (pengganti napi.go):
 *     const drive = await create();
 *     const files = await drive.list();
 *
 *  2) Low-level (akses langsung ke class):
 *     const auth   = await getDriveService();
 *     const client = new DriveClient(auth);
 */

import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';

export { getDriveService }                            from './auth.js';
export { DriveClient, FOLDER_MIME, DRIVE_FIELDS }    from './client.js';
export { restoreFolder }                              from './restore.js';
export { backupFolder }                               from './backup.js';
export { startWatch }                                 from './watch.js';
export { humanSize, downloadToPath }                  from './utils.js';
export { printFileList }                              from './commands.js';

import { getDriveService }    from './auth.js';
import { DriveClient }        from './client.js';
import { restoreFolder }      from './restore.js';
import { backupFolder }       from './backup.js';
import { startWatch }         from './watch.js';
import { downloadToPath }     from './utils.js';

/**
 * Factory utama — buat koneksi Drive siap pakai.
 * Menggantikan napi.go `create()` / `buildConn()`.
 *
 * @param {object} [opts]                   - Diteruskan ke getDriveService()
 * @param {string} [opts.credentialsFile]   - Default: credentials.json
 * @param {string} [opts.tokenFile]         - Default: token.json
 *
 * @returns {Promise<DriveConnection>}
 *
 * @example
 * import { create } from 'gdrive-node';
 *
 * const drive = await create();
 *
 * const files = await drive.list();              // root
 * const sub   = await drive.list('folder-id');
 * const hits  = await drive.search('laporan');
 * const file  = await drive.upload('./x.pdf');
 * const bytes = await drive.download('id', './x.pdf');
 * const dir   = await drive.mkdir('Arsip');
 * await drive.remove('file-id');
 * const info  = await drive.info('file-id');
 * const stats = await drive.restore('folder-id', './lokal');
 * const w     = await drive.watch('./lokal', 'folder-id');
 * w.stop();
 */
export async function create(opts = {}) {
  const auth   = await getDriveService(opts);
  const client = new DriveClient(auth);

  return {
    /**
     * Daftar file di folder Drive.
     * @param {string} [parent='root']
     * @returns {Promise<DriveFile[]>}
     */
    list(parent = 'root') {
      return client.listFiles(parent).then((r) => r.files ?? []);
    },

    /**
     * Cari file berdasarkan nama.
     * @param {string} keyword
     * @returns {Promise<DriveFile[]>}
     */
    search(keyword) {
      return client.searchFiles(keyword).then((r) => r.files ?? []);
    },

    /**
     * Upload file lokal ke Drive.
     * @param {string}  localPath
     * @param {string}  [parentId]
     * @returns {Promise<DriveFile>}
     */
    upload(localPath, parentId) {
      const stream = createReadStream(localPath);
      return client.createFile(
        path.basename(localPath),
        parentId ? [parentId] : [],
        stream,
      );
    },

    /**
     * Download file dari Drive ke path lokal.
     * Google Docs/Sheets/Slides otomatis di-export ke PDF.
     * @param {string} fileId
     * @param {string} [destPath]   - Default: nama file asli
     * @returns {Promise<number>}   bytes yang ditulis
     */
    async download(fileId, destPath) {
      const meta   = await client.getFile(fileId);
      const isGdoc = meta.mimeType.startsWith('application/vnd.google-apps.');
      const dest   = destPath ?? meta.name;
      const { written } = await downloadToPath(
        client, fileId, meta.mimeType, dest, !destPath && isGdoc,
      );
      return written;
    },

    /**
     * Buat folder di Drive.
     * @param {string} name
     * @param {string} [parentId]
     * @returns {Promise<DriveFile>}
     */
    mkdir(name, parentId) {
      return client.createFolder(name, parentId ? [parentId] : []);
    },

    /**
     * Hapus file/folder permanen (bukan ke Trash).
     * @param {string} fileId
     */
    remove(fileId) {
      return client.deleteFile(fileId);
    },

    /**
     * Ambil metadata file.
     * @param {string} fileId
     * @returns {Promise<DriveFile>}
     */
    info(fileId) {
      return client.getFile(fileId);
    },

    /**
     * Download seluruh folder Drive secara rekursif ke direktori lokal.
     * @param {string} folderId
     * @param {string} localDir
     * @returns {Promise<{ok: number, failed: number}>}
     */
    async restore(localDir, folderId) {
      await fs.mkdir(localDir, { recursive: true });
      return restoreFolder(client, localDir, folderId);
    },

    /**
     * Upload semua file dalam folder lokal ke Drive secara rekursif.
     * @param {string} localDir
     * @param {string} folderId
     * @returns {Promise<{ok: number, failed: number}>}
     */
    backup(localDir, folderId) {
      return backupFolder(client, localDir, folderId);
    },

    /**
     * Pantau folder lokal dan sinkronisasi perubahan ke Drive secara real-time.
     * @param {string} localDir
     * @param {string} folderId
     * @returns {Promise<{stop(): Promise<void>}>}
     */
    watch(localDir, folderId) {
      return startWatch(client, localDir, folderId);
    },
  };
}

/**
 * @typedef {object} DriveFile
 * @property {string}  id
 * @property {string}  name
 * @property {string}  mimeType
 * @property {string}  [size]
 * @property {string}  [createdTime]
 * @property {string}  [modifiedTime]
 * @property {string[]}[parents]
 * @property {string}  [webViewLink]
 */
