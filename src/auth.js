/**
 * auth.js — OAuth2 Google Drive (port dari auth.go)
 *
 * - Baca credentials.json (Desktop app dari Google Cloud Console)
 * - Jalankan OAuth flow dengan local HTTP server di port 8765
 * - Simpan / muat ulang token.json secara otomatis
 */

import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import http from 'http';
import https from 'https';

const CREDENTIALS_FILE = 'credentials.json';
const TOKEN_FILE       = 'token.json';
const REDIRECT_URL     = 'http://127.0.0.1:8765/callback';
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive';

/**
 * Mengembalikan OAuth2Client yang sudah ter-autentikasi.
 * Kalau token.json belum ada, akan membuka browser sekali untuk login.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.credentialsFile='credentials.json']
 * @param {string}  [opts.tokenFile='token.json']
 * @returns {Promise<OAuth2Client>}
 */
export async function getDriveService({
  credentialsFile = CREDENTIALS_FILE,
  tokenFile       = TOKEN_FILE,
} = {}) {
  // ── Baca credentials ─────────────────────────────────────────────────────
  let creds;
  try {
    const raw = await fs.readFile(credentialsFile, 'utf8');
    creds = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Tidak bisa baca ${credentialsFile}: ${err.message}\n` +
      `→ Buat OAuth client ID (tipe "Desktop app") di Google Cloud Console,\n` +
      `  download JSON-nya dan simpan sebagai ${credentialsFile}`,
    );
  }

  const { client_id, client_secret } = creds.installed ?? creds.web ?? {};
  if (!client_id || !client_secret) {
    throw new Error(
      `Format ${credentialsFile} tidak valid — tidak ditemukan client_id / client_secret.`,
    );
  }

  const auth = new OAuth2Client(client_id, client_secret, REDIRECT_URL);

  // ── Muat token tersimpan ──────────────────────────────────────────────────
  let savedToken = null;
  try {
    const raw = await fs.readFile(tokenFile, 'utf8');
    savedToken = JSON.parse(raw);
  } catch { /* belum ada — akan dibuat lewat OAuth flow */ }

  if (savedToken) {
    auth.setCredentials(savedToken);
  } else {
    const token = await getTokenFromWeb(auth);
    auth.setCredentials(token);
    await _saveToken(tokenFile, token);
  }

  // ── Auto-simpan token yang diperbarui ─────────────────────────────────────
  auth.on('tokens', async (newToken) => {
    const merged = { ...auth.credentials, ...newToken };
    auth.setCredentials(merged);
    await _saveToken(tokenFile, merged).catch(() => {});
  });

  return auth;
}

// ─────────────────────────────────────────────────────────────────────────────

const RETRYABLE = ['Premature close', 'fetch failed', 'socket hang up', 'ECONNRESET', 'ETIMEDOUT'];

async function retryFetch(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message ?? '';
      const isNetwork = RETRYABLE.some(e => msg.includes(e)) || err.code === 'ECONNRESET';
      if (!isNetwork || attempt === maxAttempts) throw err;
      const wait = 800 * attempt;
      console.error(`[retry] ${msg.split('\n')[0]} — coba lagi dalam ${wait}ms (${attempt}/${maxAttempts - 1})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function getTokenFromWeb(auth) {
  const authUrl = auth.generateAuthUrl({
    access_type : 'offline',
    scope       : [DRIVE_SCOPE],
    prompt      : 'consent',
  });

  console.error('Buka link berikut di browser untuk login akun Google:');
  console.error(authUrl);
  console.error('\nMenunggu login...');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      let url;
      try { url = new URL(req.url, 'http://127.0.0.1:8765'); }
      catch { res.writeHead(400).end(); return; }

      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }

      const errMsg = url.searchParams.get('error');
      if (errMsg) {
        res.end(`Login gagal: ${errMsg}. Tutup tab ini dan jalankan ulang perintahnya.`);
        server.close();
        return reject(new Error(`OAuth error: ${errMsg}`));
      }

      const code = url.searchParams.get('code');
      if (!code) { res.writeHead(400).end('Tidak ada kode'); return; }

      res.end('Login berhasil! Tab ini bisa ditutup, kembali ke terminal.');
      server.close();

      try {
        const tokens = await exchangeCode(auth._clientId, auth._clientSecret, code, REDIRECT_URL);
        console.error('Login berhasil!');
        resolve(tokens);
      } catch (err) {
        reject(err);
      }
    });

    server.listen(8765, '127.0.0.1');
    server.on('error', reject);
  });
}

async function _saveToken(tokenFile, token) {
  await fs.writeFile(tokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
}

/**
 * Tukar auth code dengan token secara manual pakai https native Node.js.
 * Menghindari masalah "Premature close" dari fetch di google-auth-library.
 */
function exchangeCode(clientId, clientSecret, code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id     : clientId,
    client_secret : clientSecret,
    redirect_uri  : redirectUri,
    grant_type    : 'authorization_code',
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname : 'oauth2.googleapis.com',
      path     : '/token',
      method   : 'POST',
      headers  : {
        'Content-Type'   : 'application/x-www-form-urlencoded',
        'Content-Length' : Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            reject(new Error(parsed.error_description ?? parsed.error));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`Response tidak valid: ${raw}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
