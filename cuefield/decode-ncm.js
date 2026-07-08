const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NCM_MAGIC = Buffer.from('CTENFDAM');
const CORE_KEY = Buffer.from('hzHRAmso5kInbaxW');
const META_KEY = Buffer.from("#14ljk_!\\]&0U<'(");

function aesEcbDecrypt(data, key) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

function xorBuffer(data, value) {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i++) out[i] ^= value;
  return out;
}

function buildKeyBox(key) {
  const box = new Uint8Array(256);
  for (let i = 0; i < 256; i++) box[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + box[i] + key[i % key.length]) & 0xff;
    const tmp = box[i];
    box[i] = box[j];
    box[j] = tmp;
  }
  return box;
}

function decryptAudio(data, box) {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i++) {
    const j = (i + 1) & 0xff;
    out[i] ^= box[(box[j] + box[(box[j] + j) & 0xff]) & 0xff];
  }
  return out;
}

function parseMeta(encryptedMeta) {
  if (!encryptedMeta.length) return {};
  try {
    const xored = xorBuffer(encryptedMeta, 0x63).toString('utf8');
    const base64 = xored.replace(/^163 key\(Don't modify\):/, '');
    const decrypted = aesEcbDecrypt(Buffer.from(base64, 'base64'), META_KEY).toString('utf8');
    const json = decrypted.replace(/^music:/, '');
    return JSON.parse(json);
  } catch (_) {
    return {};
  }
}

function inferAudioExtension(buffer, meta = {}) {
  const format = String(meta.format || '').toLowerCase();
  if (format === 'mp3') return '.mp3';
  if (format === 'flac') return '.flac';
  if (buffer.slice(0, 3).toString('utf8') === 'ID3') return '.mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return '.mp3';
  if (buffer.slice(0, 4).toString('utf8') === 'fLaC') return '.flac';
  return '.bin';
}

function decodeNcmBuffer(input) {
  if (!Buffer.isBuffer(input)) input = Buffer.from(input);
  if (input.length < 32 || !input.slice(0, 8).equals(NCM_MAGIC)) {
    throw new Error('INVALID_NCM_MAGIC');
  }

  let offset = 10;
  const keyLength = input.readUInt32LE(offset);
  offset += 4;
  const encryptedKey = xorBuffer(input.slice(offset, offset + keyLength), 0x64);
  offset += keyLength;
  const keyData = aesEcbDecrypt(encryptedKey, CORE_KEY).slice(17);
  const box = buildKeyBox(keyData);

  const metaLength = input.readUInt32LE(offset);
  offset += 4;
  const encryptedMeta = input.slice(offset, offset + metaLength);
  offset += metaLength;
  const meta = parseMeta(encryptedMeta);

  offset += 4; // crc32
  offset += 5; // reserved gap
  const imageLength = input.readUInt32LE(offset);
  offset += 4 + imageLength;

  const audio = decryptAudio(input.slice(offset), box);
  return {
    audio,
    meta,
    extension: inferAudioExtension(audio, meta),
  };
}

function outputNameFor(inputFile, extension, meta = {}) {
  const title = meta.musicName || path.basename(inputFile, path.extname(inputFile));
  const artists = Array.isArray(meta.artist)
    ? meta.artist.map((item) => Array.isArray(item) ? item[0] : item).filter(Boolean).join(',')
    : '';
  const raw = artists ? `${artists} - ${title}` : title;
  return raw.replace(/[\\/:*?"<>|]+/g, '-').trim() + extension;
}

function decodeNcmFile(inputFile, outDir) {
  const decoded = decodeNcmBuffer(fs.readFileSync(inputFile));
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, outputNameFor(inputFile, decoded.extension, decoded.meta));
  fs.writeFileSync(outFile, decoded.audio);
  return {
    file: outFile,
    extension: decoded.extension,
    meta: decoded.meta,
    bytes: decoded.audio.length,
  };
}

module.exports = {
  decodeNcmBuffer,
  decodeNcmFile,
  inferAudioExtension,
};
