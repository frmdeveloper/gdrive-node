/**
 * watch.js — sinkronisasi folder lokal ke Google Drive (port dari watch.go)
 *
 * Perbedaan utama dari versi Go:
 *  - fsnotify diganti chokidar (dengan awaitWriteFinish = debounce otomatis)
 *  - sync.Mutex diganti "pending promise" map agar tidak ada race condition
 *    meski JS single-thread, async I/O bisa saling tumpang-tindih
 */

import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { FOLDER_MIME } from './client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalisasi ke forward-slash, hapus trailing slash. */
function normPath(p) {
  return (p || '.').replace(/\\/g, '/').replace(/\/+$/, '') || '.';
}

function escapeQ(s) { return s.replace(/'/g, "\\'"); }

// ── FolderCache ───────────────────────────────────────────────────────────────

/**
 * Cache path-relatif -> Drive folder-id.
 * ensure() membuat folder di Drive jika belum ada,
 * dan melindungi dari pembuatan ganda lewat pending-promise map.
 */
class FolderCache {
  #client;
  #cache   = new Map();   // relPath → driveId
  #pending = new Map();   // relPath → Promise<driveId>  (in-flight)

  constructor(client, rootId) {
    this.#client = client;
    this.#cache.set('.', rootId);
  }

  /** Lookup cache tanpa I/O (untuk onRemove yang tidak perlu buat folder). */
  lookup(relPath) {
    return this.#cache.get(normPath(relPath)) ?? null;
  }

  /** Pastikan folder ada di Drive, buat kalau belum. */
  async ensure(relPath) {
    relPath = normPath(relPath);
    if (relPath === '.' || relPath === '') return this.#cache.get('.');
    if (this.#cache.has(relPath))           return this.#cache.get(relPath);

    // Reuse promise yang sedang berjalan agar tidak membuat folder duplikat
    if (this.#pending.has(relPath)) return this.#pending.get(relPath);

    const promise = this.#resolve(relPath);
    this.#pending.set(relPath, promise);

    try {
      const id = await promise;
      this.#cache.set(relPath, id);
      return id;
    } finally {
      this.#pending.delete(relPath);
    }
  }

  async #resolve(relPath) {
    // Pastikan parent sudah ada terlebih dulu (rekursif)
    const parentPath = normPath(path.posix.dirname(relPath));
    const parentId   = await this.ensure(parentPath);
    const name       = path.posix.basename(relPath);

    // Cek apakah sudah ada di Drive
    const result = await this.#client.listFilesRaw({
      q        : `name = '${escapeQ(name)}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields   : 'files(id)',
      pageSize : 1,
    });

    if (result.files?.length) return result.files[0].id;

    // Buat folder baru
    const created = await this.#client.createFolder(name, [parentId]);
    console.log(`[mkdir] ${relPath}`);
    return created.id;
  }
}

// ── startWatch ────────────────────────────────────────────────────────────────

/**
 * Mulai memantau localDir dan sinkronisasi perubahan ke rootFolderId di Drive.
 *
 * @param {DriveClient} client
 * @param {string}      localDir       - Folder lokal yang dipantau
 * @param {string}      rootFolderId   - Drive folder-id tujuan
 * @returns {Promise<{stop(): Promise<void>}>}
 */
export async function startWatch(client, localDir, rootFolderId) {
  const stat = await fs.stat(localDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Bukan folder yang valid: ${localDir}`);
  }

  // Lazy-load chokidar agar package ini tetap bisa dipakai tanpa chokidar
  // jika startWatch tidak dipanggil
  const { default: chokidar } = await import('chokidar');

  const cache = new FolderCache(client, rootFolderId);

  const watcher = chokidar.watch(localDir, {
    persistent      : true,
    ignoreInitial   : true,
    ignored         : /(^|[/\\])\./,        // skip dotfile/dotfolder
    awaitWriteFinish: {                      // tunggu file selesai ditulis
      stabilityThreshold : 300,
      pollInterval       : 100,
    },
  });

  // ── Handler upload / update ─────────────────────────────────────────────────
  async function onUpsert(filePath) {
    const rel    = normPath(path.relative(localDir, filePath));
    const name   = path.posix.basename(rel);
    const relDir = normPath(path.posix.dirname(rel));

    try {
      const parentId = await cache.ensure(relDir);

      const existing = await client.listFilesRaw({
        q        : `name = '${escapeQ(name)}' and '${parentId}' in parents and trashed = false`,
        fields   : 'files(id)',
        pageSize : 1,
      });

      const stream = createReadStream(filePath);

      if (existing.files?.length) {
        await client.updateFile(existing.files[0].id, stream);
        console.log(`[update] ${rel}`);
      } else {
        await client.createFile(name, [parentId], stream, 'id');
        console.log(`[upload] ${rel}`);
      }
    } catch (err) {
      console.error(`[${rel}] error: ${err.message}`);
    }
  }

  // ── Handler hapus ───────────────────────────────────────────────────────────
  async function onRemove(filePath) {
    const rel      = normPath(path.relative(localDir, filePath));
    const name     = path.posix.basename(rel);
    const relDir   = normPath(path.posix.dirname(rel));
    const parentId = cache.lookup(relDir);

    if (!parentId) return;   // folder parent belum pernah dikenal, skip

    try {
      const result = await client.listFilesRaw({
        q        : `name = '${escapeQ(name)}' and '${parentId}' in parents and trashed = false`,
        fields   : 'files(id)',
        pageSize : 1,
      });
      if (!result.files?.length) return;

      await client.deleteFile(result.files[0].id);
      console.log(`[delete] ${rel}`);
    } catch (err) {
      console.error(`[${rel}] gagal hapus di Drive: ${err.message}`);
    }
  }

  watcher.on('add',    onUpsert);
  watcher.on('change', onUpsert);
  watcher.on('unlink', onRemove);
  watcher.on('error',  (err) => console.error('watcher error:', err.message));

  return {
    /** Hentikan watcher. */
    stop() { return watcher.close(); },
  };
}
