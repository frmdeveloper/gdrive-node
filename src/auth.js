/**
 * auth.js — OAuth2 Google Drive
 *
 * Semua request ke oauth2.googleapis.com (exchange code + refresh token)
 * pakai https native Node.js — bukan gaxios/node-fetch — untuk menghindari
 * error "Premature close" yang terjadi di beberapa environment.
 */

import { OAuth2Client } from 'google-auth-library';
import fs from 'fs/promises';
import http from 'http';
import https from 'https';

const CREDENTIALS_FILE = 'credentials.json';
const TOKEN_FILE       = 'token.json';
const REDIRECT_URL     = 'http://127.0.0.1:8765/callback';
const DRIVE_SCOPE      = 'https://www.googleapis.com/auth/drive';

// ── Native HTTPS ke Google token endpoint ─────────────────────────────────────

/**
 * POST ke oauth2.googleapis.com/token pakai https native.
 * Menghindari masalah gzip/gunzip dari node-fetch di gaxios.
 */
function tokenRequest(params) {
  const body = new URLSearchParams(params).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname : 'oauth2.googleapis.com',
      path     : '/token',
      method   : 'POST',
      headers  : {
        'Content-Type'    : 'application/x-www-form-urlencoded',
        'Content-Length'  : Buffer.byteLength(body),
        'Accept-Encoding' : 'identity',   // matikan gzip agar tidak ada gunzip error
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
        } catch {
          reject(new Error(`Response tidak valid dari Google: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── getDriveService ───────────────────────────────────────────────────────────

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
  // ── Baca credentials ───────────────────────────────────────────────────────
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
    throw new Error(`Format ${credentialsFile} tidak valid — tidak ditemukan client_id / client_secret.`);
  }

  const auth = new OAuth2Client(client_id, client_secret, REDIRECT_URL);

  // Patch refresh token SEBELUM apapun — gantikan gaxios dengan native https
  _patchRefreshToken(auth);

  // ── Muat token tersimpan ───────────────────────────────────────────────────
  let savedToken = null;
  try {
    const raw = await fs.readFile(tokenFile, 'utf8');
    savedToken = JSON.parse(raw);
  } catch { /* belum ada */ }

  if (savedToken) {
    auth.setCredentials(savedToken);
  } else {
    const token = await _getTokenFromWeb(auth, client_id, client_secret);
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

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Override refreshTokenNoCache agar pakai native https, bukan gaxios/node-fetch.
 * Dipanggil setiap kali access token expired dan perlu di-refresh.
 */
function _patchRefreshToken(auth) {
  auth.refreshTokenNoCache = async function (refreshTokenVal) {
    const clientId     = this.clientId_     ?? this.clientId;
    const clientSecret = this.clientSecret_ ?? this.clientSecret;

    if (!clientId || !clientSecret || !refreshTokenVal) {
      throw new Error('Refresh token atau kredensial tidak tersedia.');
    }

    const raw = await tokenRequest({
      grant_type    : 'refresh_token',
      refresh_token : refreshTokenVal,
      client_id     : clientId,
      client_secret : clientSecret,
    });

    // Pertahankan refresh_token lama (Google tidak mengirim ulang di setiap refresh)
    if (!raw.refresh_token) raw.refresh_token = refreshTokenVal;

    // google-auth-library butuh expiry_date dalam ms, bukan expires_in dalam detik
    if (raw.expires_in) raw.expiry_date = Date.now() + raw.expires_in * 1000;

    return { tokens: raw, res: null };
  };
}

async function _getTokenFromWeb(auth, clientId, clientSecret) {
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
        const raw = await tokenRequest({
          code,
          client_id     : clientId,
          client_secret : clientSecret,
          redirect_uri  : REDIRECT_URL,
          grant_type    : 'authorization_code',
        });
        if (raw.expires_in) raw.expiry_date = Date.now() + raw.expires_in * 1000;
        console.error('Login berhasil!');
        resolve(raw);
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
