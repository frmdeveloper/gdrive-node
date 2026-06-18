/**
 * client.js — DriveClient (port dari drive.go + api.go)
 *
 * Semua method Drive API dikumpulkan dalam satu class.
 */

import { google } from 'googleapis';

export const FOLDER_MIME   = 'application/vnd.google-apps.folder';
export const DRIVE_FIELDS  = 'id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink';

export class DriveClient {
  constructor(auth) {
    this._d = google.drive({ version: 'v3', auth });
  }

  /** Daftar file di dalam sebuah folder. */
  async listFiles(parent = 'root', pageToken = '') {
    const params = {
      q        : `'${parent}' in parents and trashed = false`,
      pageSize : 100,
      orderBy  : 'folder,name',
      fields   : `nextPageToken,files(${DRIVE_FIELDS})`,
    };
    if (pageToken) params.pageToken = pageToken;
    const res = await this._d.files.list(params);
    return res.data;   // { files, nextPageToken }
  }

  /** Cari file berdasarkan nama (contains). */
  async searchFiles(keyword) {
    const q = `name contains '${keyword.replace(/'/g, "\\'")}' and trashed = false`;
    const res = await this._d.files.list({
      q,
      pageSize : 50,
      orderBy  : 'folder,name',
      fields   : `nextPageToken,files(${DRIVE_FIELDS})`,
    });
    return res.data;
  }

  /** Ambil metadata satu file. */
  async getFile(fileId) {
    const res = await this._d.files.get({ fileId, fields: DRIVE_FIELDS });
    return res.data;
  }

  /**
   * Upload file baru.
   * @param {string}    name     - Nama file di Drive
   * @param {string[]}  parents  - Array folder-id parent (boleh kosong)
   * @param {Readable}  body     - ReadableStream isi file
   * @param {string}    fields   - Fields yang ingin dikembalikan
   */
  async createFile(name, parents = [], body, fields = DRIVE_FIELDS) {
    const res = await this._d.files.create({
      requestBody : { name, ...(parents.length && { parents }) },
      media       : { mimeType: 'application/octet-stream', body },
      fields,
    });
    return res.data;
  }

  /** Update isi file yang sudah ada (tidak mengubah nama/parents). */
  async updateFile(fileId, body) {
    await this._d.files.update({
      fileId,
      media: { mimeType: 'application/octet-stream', body },
    });
  }

  /** Buat folder baru. */
  async createFolder(name, parents = []) {
    const res = await this._d.files.create({
      requestBody : { name, mimeType: FOLDER_MIME, ...(parents.length && { parents }) },
      fields      : DRIVE_FIELDS,
    });
    return res.data;
  }

  /** Hapus file/folder permanen (bukan ke Trash). */
  async deleteFile(fileId) {
    await this._d.files.delete({ fileId });
  }

  /** Download file — mengembalikan ReadableStream. */
  async downloadFile(fileId) {
    const res = await this._d.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' },
    );
    return res.data;
  }

  /**
   * Export Google Docs/Sheets/Slides ke format lain (misal PDF).
   * Mengembalikan ReadableStream.
   */
  async exportFile(fileId, mimeType) {
    const res = await this._d.files.export(
      { fileId, mimeType },
      { responseType: 'stream' },
    );
    return res.data;
  }

  /** Raw list dengan query params bebas — dipakai oleh watch.js. */
  async listFilesRaw(params) {
    const res = await this._d.files.list(params);
    return res.data;
  }
}
