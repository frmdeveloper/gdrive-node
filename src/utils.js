/**
 * utils.js — helper bersama
 */

import { createWriteStream } from 'fs';

/** Ukuran file yang mudah dibaca manusia (B / KiB / MiB / …) */
export function humanSize(bytes) {
  bytes = Number(bytes) || 0;
  const K = 1024;
  if (bytes < K) return `${bytes} B`;
  const exp = Math.floor(Math.log(bytes) / Math.log(K));
  return `${(bytes / K ** exp).toFixed(1)} ${'KMGTPE'[exp - 1]}iB`;
}

/**
 * Download (atau export ke PDF untuk Google Docs) ke path lokal.
 *
 * @param {DriveClient} client
 * @param {string}      fileId
 * @param {string}      mimeType      - MIME type file di Drive
 * @param {string}      destPath      - Path tujuan (tanpa .pdf)
 * @param {boolean}     appendPdfExt  - Apakah tambahkan ekstensi .pdf
 * @returns {Promise<{finalPath: string, written: number}>}
 */
export async function downloadToPath(client, fileId, mimeType, destPath, appendPdfExt) {
  let stream;
  let finalPath = destPath;

  if (mimeType.startsWith('application/vnd.google-apps.')) {
    // Google Docs/Sheets/Slides → export sebagai PDF
    if (appendPdfExt) finalPath += '.pdf';
    stream = await client.exportFile(fileId, 'application/pdf');
  } else {
    stream = await client.downloadFile(fileId);
  }

  const out = createWriteStream(finalPath);
  let written = 0;

  await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => { written += chunk.length; });
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    stream.pipe(out);
  });

  return { finalPath, written };
}
