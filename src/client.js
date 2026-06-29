/**
 * client.js — DriveClient via native https (tanpa googleapis/gaxios/node-fetch)
 *
 * Semua request ke www.googleapis.com pakai https bawaan Node.js
 * untuk menghindari "Premature close" dari node-fetch di gaxios.
 */

import https from 'https';

export const FOLDER_MIME  = 'application/vnd.google-apps.folder';
export const DRIVE_FIELDS = 'id,name,mimeType,size,createdTime,modifiedTime,parents,webViewLink';

const HOST = 'www.googleapis.com';

// ── Retry ─────────────────────────────────────────────────────────────────────

const RETRYABLE = ['Premature close', 'fetch failed', 'socket hang up', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];

async function retry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message ?? '';
      const isNetwork = RETRYABLE.some(e => msg.includes(e)) || err.code === 'ECONNRESET';
      if (!isNetwork || attempt === maxAttempts) throw err;
      const wait = 600 * attempt;
      console.error(`[retry] ${msg.split('\n')[0]} — coba lagi dalam ${wait}ms (${attempt}/${maxAttempts - 1})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// ── Native HTTPS helpers ──────────────────────────────────────────────────────

/** GET/POST/DELETE → JSON response */
function req(method, path, token, extraHeaders = {}, body = null) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname : HOST,
      method,
      path,
      headers  : {
        'Authorization'  : `Bearer ${token}`,
        'Accept-Encoding': 'identity',
        ...extraHeaders,
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          return reject(Object.assign(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`), { status: res.statusCode }));
        }
        if (!raw.trim()) return resolve(null);
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`Invalid JSON: ${raw.slice(0, 100)}`)); }
      });
    });
    r.on('error', reject);
    if (body) { r.write(body); }
    r.end();
  });
}

/** GET → ReadableStream (untuk download/export) */
function reqStream(path, token) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname : HOST,
      method   : 'GET',
      path,
      headers  : { 'Authorization': `Bearer ${token}`, 'Accept-Encoding': 'identity' },
    }, (res) => {
      if (res.statusCode >= 400) {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`)));
        return;
      }
      resolve(res);
    });
    r.on('error', reject);
    r.end();
  });
}

/** POST/PATCH multipart/related → JSON (untuk upload file) */
function reqMultipart(method, path, token, metadata, fileStream, fileMime) {
  const boundary = `b${Date.now()}${Math.random().toString(36).slice(2)}`;
  const metaJson = JSON.stringify(metadata);
  const pre  = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n` +
    `--${boundary}\r\nContent-Type: ${fileMime}\r\n\r\n`
  );
  const post = Buffer.from(`\r\n--${boundary}--`);

  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname : HOST,
      method,
      path,
      headers  : {
        'Authorization'  : `Bearer ${token}`,
        'Accept-Encoding': 'identity',
        'Content-Type'   : `multipart/related; boundary=${boundary}`,
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error(`Invalid JSON: ${raw.slice(0, 100)}`)); }
      });
    });
    r.on('error', reject);
    r.write(pre);
    fileStream.on('data',  chunk => r.write(chunk));
    fileStream.on('end',   ()    => { r.write(post); r.end(); });
    fileStream.on('error', reject);
  });
}

/** PATCH uploadType=media → void (untuk update isi file) */
function reqPatchStream(path, token, fileStream) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname : HOST,
      method   : 'PATCH',
      path,
      headers  : {
        'Authorization'  : `Bearer ${token}`,
        'Accept-Encoding': 'identity',
        'Content-Type'   : 'application/octet-stream',
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        resolve();
      });
    });
    r.on('error', reject);
    fileStream.pipe(r, { end: false });
    fileStream.on('end',   ()  => r.end());
    fileStream.on('error', reject);
  });
}

// ── DriveClient ───────────────────────────────────────────────────────────────

export class DriveClient {
  constructor(auth) { this._auth = auth; }

  async _tok() {
    const { token } = await this._auth.getAccessToken();
    if (!token) throw new Error('Tidak bisa dapat access token.');
    return token;
  }

  async listFiles(parent = 'root', pageToken = '') {
    return retry(async () => {
      const tok = await this._tok();
      const p = new URLSearchParams({
        q       : `'${parent}' in parents and trashed = false`,
        pageSize: '100',
        orderBy : 'folder,name',
        fields  : `nextPageToken,files(${DRIVE_FIELDS})`,
        ...(pageToken && { pageToken }),
      });
      return req('GET', `/drive/v3/files?${p}`, tok);
    });
  }

  async searchFiles(keyword) {
    return retry(async () => {
      const tok = await this._tok();
      const p = new URLSearchParams({
        q       : `name contains '${keyword.replace(/'/g, "\\'")}' and trashed = false`,
        pageSize: '50',
        orderBy : 'folder,name',
        fields  : `nextPageToken,files(${DRIVE_FIELDS})`,
      });
      return req('GET', `/drive/v3/files?${p}`, tok);
    });
  }

  async getFile(fileId) {
    return retry(async () => {
      const tok = await this._tok();
      return req('GET', `/drive/v3/files/${fileId}?fields=${encodeURIComponent(DRIVE_FIELDS)}`, tok);
    });
  }

  async createFile(name, parents = [], body, fields = DRIVE_FIELDS) {
    return retry(async () => {
      const tok = await this._tok();
      const p = new URLSearchParams({ uploadType: 'multipart', fields });
      return reqMultipart('POST', `/upload/drive/v3/files?${p}`, tok,
        { name, ...(parents.length && { parents }) },
        body, 'application/octet-stream',
      );
    });
  }

  async updateFile(fileId, body) {
    return retry(async () => {
      const tok = await this._tok();
      return reqPatchStream(`/upload/drive/v3/files/${fileId}?uploadType=media`, tok, body);
    });
  }

  async createFolder(name, parents = []) {
    return retry(async () => {
      const tok = await this._tok();
      const json = JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parents.length && { parents }) });
      return req('POST', `/drive/v3/files?fields=${encodeURIComponent(DRIVE_FIELDS)}`, tok,
        { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json).toString() },
        json,
      );
    });
  }

  async deleteFile(fileId) {
    return retry(async () => {
      const tok = await this._tok();
      await req('DELETE', `/drive/v3/files/${fileId}`, tok);
    });
  }

  async downloadFile(fileId) {
    return retry(async () => {
      const tok = await this._tok();
      return reqStream(`/drive/v3/files/${fileId}?alt=media`, tok);
    });
  }

  async exportFile(fileId, mimeType) {
    return retry(async () => {
      const tok = await this._tok();
      return reqStream(`/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`, tok);
    });
  }

  async listFilesRaw(params) {
    return retry(async () => {
      const tok = await this._tok();
      const p = new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
      );
      return req('GET', `/drive/v3/files?${p}`, tok);
    });
  }
}
