/**
 * ============================================================================
 * CRYPTO-GUARD & CORE UTILITIES (100% Pure JavaScript - Zero Node/NPM)
 * ============================================================================
 * Menyediakan:
 * 1. Enkripsi/Dekripsi ChaCha20 + HMAC-SHA256 + PBKDF2-SHA256 terikat Domain.
 * 2. Domain Lock Guard (Mencegah aplikasi berjalan di luar domain terdaftar).
 * 3. Konverter Link Google Drive -> Direct Image URL + Fallback otomatis.
 * 4. Kalkulator Denda Keterlambatan (% per jam) & Helper WhatsApp/Rupiah.
 */
(function (global) {
  "use strict";

  const te = new TextEncoder();
  const td = new TextDecoder();

  // Fragmen internal untuk pengikatan kunci aplikasi (jangan diubah setelah build)
  const _k1 = "Sh4l1jch@";
  const _k2 = "R3ntC4r";
  const _k3 = "#2026!GDrive";

  function getRuntimeSeed() {
    return [_k1, _k2, _k3].join("::");
  }

  // ---------- Pure-JS SHA-256 ----------
  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function sha256(msgBytes) {
    const len = msgBytes.length;
    const bitLenHi = Math.floor((len * 8) / 0x100000000);
    const bitLenLo = (len * 8) >>> 0;
    const paddedLen = Math.ceil((len + 9) / 64) * 64;
    const buf = new Uint8Array(paddedLen);
    buf.set(msgBytes);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(paddedLen - 8, bitLenHi, false);
    dv.setUint32(paddedLen - 4, bitLenLo, false);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);

    for (let offset = 0; offset < paddedLen; offset += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = dv.getUint32(offset + i * 4, false);
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }

      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;

        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const outDv = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((val, idx) => outDv.setUint32(idx * 4, val, false));
    return out;
  }

  function hmacSha256(keyBytes, dataBytes) {
    let k = keyBytes;
    if (k.length > 64) k = sha256(k);
    const ipad = new Uint8Array(64);
    const opad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      const b = i < k.length ? k[i] : 0;
      ipad[i] = b ^ 0x36;
      opad[i] = b ^ 0x5c;
    }
    const inner = new Uint8Array(64 + dataBytes.length);
    inner.set(ipad);
    inner.set(dataBytes, 64);
    const innerHash = sha256(inner);

    const outer = new Uint8Array(64 + 32);
    outer.set(opad);
    outer.set(innerHash, 64);
    return sha256(outer);
  }

  function pbkdf2Sha256(passwordStr, saltBytes, iterations, keyLen) {
    const passBytes = te.encode(passwordStr);
    const blocks = Math.ceil(keyLen / 32);
    const out = new Uint8Array(blocks * 32);
    for (let b = 1; b <= blocks; b++) {
      const saltBlock = new Uint8Array(saltBytes.length + 4);
      saltBlock.set(saltBytes);
      saltBlock[saltBytes.length] = (b >>> 24) & 0xff;
      saltBlock[saltBytes.length + 1] = (b >>> 16) & 0xff;
      saltBlock[saltBytes.length + 2] = (b >>> 8) & 0xff;
      saltBlock[saltBytes.length + 3] = b & 0xff;

      let u = hmacSha256(passBytes, saltBlock);
      const t = new Uint8Array(u);
      for (let i = 1; i < iterations; i++) {
        u = hmacSha256(passBytes, u);
        for (let j = 0; j < 32; j++) t[j] ^= u[j];
      }
      out.set(t, (b - 1) * 32);
    }
    return out.slice(0, keyLen);
  }

  // ---------- Pure-JS ChaCha20 (RFC 7539) ----------
  function rotl32(v, c) {
    return ((v << c) | (v >>> (32 - c))) >>> 0;
  }

  function qr(s, a, b, c, d) {
    s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 16);
    s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 12);
    s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 8);
    s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 7);
  }

  function chacha20Block(key32, counter, nonce12) {
    const state = new Uint32Array(16);
    state[0] = 0x61707865; state[1] = 0x3320646e; state[2] = 0x79622d32; state[3] = 0x6b206574;
    const kdv = new DataView(key32.buffer, key32.byteOffset, 32);
    for (let i = 0; i < 8; i++) state[4 + i] = kdv.getUint32(i * 4, true);
    state[12] = counter >>> 0;
    const ndv = new DataView(nonce12.buffer, nonce12.byteOffset, 12);
    for (let i = 0; i < 3; i++) state[13 + i] = ndv.getUint32(i * 4, true);

    const w = new Uint32Array(state);
    for (let i = 0; i < 10; i++) {
      qr(w, 0, 4, 8, 12); qr(w, 1, 5, 9, 13); qr(w, 2, 6, 10, 14); qr(w, 3, 7, 11, 15);
      qr(w, 0, 5, 10, 15); qr(w, 1, 6, 11, 12); qr(w, 2, 7, 8, 13); qr(w, 3, 4, 9, 14);
    }
    const out = new Uint8Array(64);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 16; i++) {
      odv.setUint32(i * 4, (w[i] + state[i]) >>> 0, true);
    }
    return out;
  }

  function chacha20Xor(key32, nonce12, dataBytes) {
    const out = new Uint8Array(dataBytes.length);
    for (let i = 0; i < dataBytes.length; i += 64) {
      const counter = Math.floor(i / 64) + 1;
      const block = chacha20Block(key32, counter, nonce12);
      const chunkLen = Math.min(64, dataBytes.length - i);
      for (let j = 0; j < chunkLen; j++) {
        out[i + j] = dataBytes[i + j] ^ block[j];
      }
    }
    return out;
  }

  // ---------- Base64 & Hex Helpers ----------
  function toHex(bytes) {
    return Array.from(bytes).map(b => ("0" + b.toString(16)).slice(-2)).join("");
  }

  function toB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function fromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function randomBytes(len) {
    const arr = new Uint8Array(len);
    if (global.crypto && global.crypto.getRandomValues) {
      global.crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return arr;
  }

  function constantTimeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  function domainHash(hostname) {
    return toHex(sha256(te.encode(getRuntimeSeed() + "::DOMAIN::" + String(hostname || "").toLowerCase())));
  }

  /**
   * Enkripsi konfigurasi sensitif ke dalam slot khusus per domain yang diizinkan.
   * Jika dibuka di domain lain atau file:// yang tidak diizinkan, dekripsi tidak mungkin dilakukan.
   */
  function encryptConfigForDomains(configObj, allowedDomains) {
    const plainBytes = te.encode(JSON.stringify(configObj));
    const slots = {};

    allowedDomains.forEach(rawDom => {
      const dom = String(rawDom || "").trim().toLowerCase();
      if (!dom) return;
      const salt = randomBytes(16);
      const nonce = randomBytes(12);
      const masterKey = pbkdf2Sha256(getRuntimeSeed() + "::" + dom, salt, 4000, 64);
      const encKey = masterKey.slice(0, 32);
      const macKey = masterKey.slice(32, 64);

      const cipher = chacha20Xor(encKey, nonce, plainBytes);
      const macInput = new Uint8Array(salt.length + nonce.length + cipher.length);
      macInput.set(salt, 0);
      macInput.set(nonce, salt.length);
      macInput.set(cipher, salt.length + nonce.length);
      const mac = hmacSha256(macKey, macInput);

      slots[domainHash(dom)] = {
        s: toB64(salt),
        n: toB64(nonce),
        c: toB64(cipher),
        m: toB64(mac)
      };
    });

    return {
      v: 2,
      alg: "ChaCha20-HMAC-SHA256-DomainLock",
      slots: slots
    };
  }

  /**
   * Dekripsi konfigurasi hanya jika hostname saat ini cocok dengan salah satu slot terenkripsi.
   */
  function unlockConfig() {
    const encBundle = global.ENCRYPTED_RENTAL_CONFIG;
    if (!encBundle || !encBundle.slots) {
      return { ok: false, reason: "MISSING_CONFIG", message: "Konfigurasi terenkripsi (config.enc.js) tidak ditemukan." };
    }

    const protocol = (global.location && global.location.protocol) || "";
    const host = ((global.location && global.location.hostname) || "").toLowerCase();

    if (protocol === "file:" && !encBundle.slots[domainHash("file-local")]) {
      return {
        ok: false,
        reason: "DOMAIN_LOCKED",
        host: "file:// (Lokal)",
        message: "Akses ditolak: Aplikasi terenkripsi ini dikunci khusus untuk domain resmi GitHub Pages dan tidak dapat dijalankan langsung dari file lokal."
      };
    }

    const lookupKey = protocol === "file:" ? "file-local" : host;
    const slot = encBundle.slots[domainHash(lookupKey)];
    if (!slot) {
      return {
        ok: false,
        reason: "DOMAIN_LOCKED",
        host: host || protocol,
        message: "Akses ditolak: Domain '" + (host || protocol) + "' tidak memiliki izin dekripsi untuk menjalankan aplikasi ini."
      };
    }

    try {
      const salt = fromB64(slot.s);
      const nonce = fromB64(slot.n);
      const cipher = fromB64(slot.c);
      const mac = fromB64(slot.m);

      const masterKey = pbkdf2Sha256(getRuntimeSeed() + "::" + lookupKey, salt, 4000, 64);
      const encKey = masterKey.slice(0, 32);
      const macKey = masterKey.slice(32, 64);

      const macInput = new Uint8Array(salt.length + nonce.length + cipher.length);
      macInput.set(salt, 0);
      macInput.set(nonce, salt.length);
      macInput.set(cipher, salt.length + nonce.length);
      const expectedMac = hmacSha256(macKey, macInput);

      if (!constantTimeEqual(mac, expectedMac)) {
        return { ok: false, reason: "TAMPERED", message: "Integritas data terenkripsi gagal diverifikasi." };
      }

      const plainBytes = chacha20Xor(encKey, nonce, cipher);
      const config = JSON.parse(td.decode(plainBytes));
      return { ok: true, config: config, host: lookupKey };
    } catch (err) {
      return { ok: false, reason: "DECRYPT_ERROR", message: "Gagal mendekripsi konfigurasi aplikasi." };
    }
  }

  // ============================================================================
  // GOOGLE DRIVE IMAGE CONVERTER
  // ============================================================================
  function extractDriveFileId(url) {
    if (!url) return "";
    const str = String(url).trim();
    const patterns = [
      /\/file\/d\/([a-zA-Z0-9_-]{10,})/,
      /[?&]id=([a-zA-Z0-9_-]{10,})/,
      /\/d\/([a-zA-Z0-9_-]{10,})/,
      /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = str.match(patterns[i]);
      if (m && m[1]) return m[1];
    }
    if (/^[a-zA-Z0-9_-]{20,}$/.test(str)) return str;
    return "";
  }

  function resolveImageUrls(url) {
    const clean = String(url || "").trim();
    if (!clean) return { primary: "", fallback: "", isDrive: false, fileId: "" };
    const id = extractDriveFileId(clean);
    if (id) {
      return {
        primary: "https://drive.google.com/thumbnail?id=" + id + "&sz=w1000",
        fallback: "https://lh3.googleusercontent.com/d/" + id,
        isDrive: true,
        fileId: id
      };
    }
    return { primary: clean, fallback: "", isDrive: false, fileId: "" };
  }

  const CAR_PLACEHOLDER_SVG =
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 360" fill="none">' +
      '<rect width="600" height="360" fill="#0f172a"/>' +
      '<path d="M125 225h350l-28-68c-6-15-20-25-36-25H194c-16 0-30 10-36 25l-33 68z" fill="#1e293b" stroke="#38bdf8" stroke-width="6"/>' +
      '<circle cx="190" cy="235" r="32" fill="#020617" stroke="#38bdf8" stroke-width="6"/>' +
      '<circle cx="410" cy="235" r="32" fill="#020617" stroke="#38bdf8" stroke-width="6"/>' +
      '<text x="300" y="305" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="20">Foto Armada (Google Drive)</text>' +
      '</svg>'
    );

  function renderCarImage(url, alt, className) {
    const info = resolveImageUrls(url);
    const cls = className || "car-img";
    const safeAlt = escapeHtml(alt || "Armada Mobil");
    if (!info.primary) {
      return '<img src="' + CAR_PLACEHOLDER_SVG + '" alt="' + safeAlt + '" class="' + cls + '" loading="lazy">';
    }
    const fbAttr = info.fallback ? ' data-fb="' + escapeHtml(info.fallback) + '"' : "";
    return (
      '<img src="' + escapeHtml(info.primary) + '"' + fbAttr +
      ' alt="' + safeAlt + '" class="' + cls + '" loading="lazy"' +
      ' onerror="if(this.dataset.fb && this.src!==this.dataset.fb){this.src=this.dataset.fb;this.dataset.fb=\'\';}else{this.onerror=null;this.src=\'' + CAR_PLACEHOLDER_SVG + '\';}">'
    );
  }


  function compressImageForUpload(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const mw = maxWidth || 1280;
      const q = quality || 0.8;
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Gagal membaca file foto."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("File bukan gambar yang valid."));
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > mw) {
            h = Math.round((h * mw) / w);
            w = mw;
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", q);
          const base64 = dataUrl.split(",")[1] || "";
          const cleanName = String(file.name || "foto.jpg").replace(/\.[^.]+$/, "") + ".jpg";
          resolve({ base64: base64, mimeType: "image/jpeg", fileName: cleanName, previewDataUrl: dataUrl });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ============================================================================
  // FORMATTERS & BUSINESS LOGIC
  // ============================================================================
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatRupiah(num) {
    const n = Math.round(Number(num) || 0);
    return "Rp " + n.toLocaleString("id-ID");
  }

  function parseRupiah(val) {
    if (typeof val === "number") return Math.round(val) || 0;
    const digits = String(val || "").replace(/[^0-9]/g, "");
    return digits ? parseInt(digits, 10) : 0;
  }

  function setRupiahInput(el, num) {
    if (!el) return;
    if (num === "" || num === null || num === undefined) {
      el.value = "";
      return;
    }
    el.value = formatRupiah(parseRupiah(num));
  }

  function bindRupiahInputs(selector) {
    document.querySelectorAll(selector || ".rupiah-input").forEach(el => {
      if (el.dataset.rpBound) return;
      el.dataset.rpBound = "1";
      el.addEventListener("input", function () {
        const raw = String(el.value || "").replace(/[^0-9]/g, "");
        if (!raw) {
          el.value = "";
          return;
        }
        el.value = formatRupiah(parseInt(raw, 10));
      });
    });
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return "-";
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr);
    return d.toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function toLocalInputValue(dateObj) {
    const d = dateObj ? new Date(dateObj) : new Date();
    if (isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return (
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes())
    );
  }

  function normalizePhone(phone) {
    let p = String(phone || "").replace(/[^0-9]/g, "");
    if (p.startsWith("0")) p = "62" + p.slice(1);
    else if (p.startsWith("8")) p = "62" + p;
    return p;
  }

  function buildWhatsAppUrl(phone, message) {
    const p = normalizePhone(phone);
    return "https://wa.me/" + p + "?text=" + encodeURIComponent(message);
  }

  /**
   * Hitung keterlambatan & denda otomatis berdasarkan persentase per jam dari harga harian
   */
  function calculateOvertime(tglSelesaiIso, tglAktualIso, hargaHarian, persenPerJam, toleransiMenit) {
    const end = new Date(tglSelesaiIso);
    const now = tglAktualIso ? new Date(tglAktualIso) : new Date();
    if (isNaN(end.getTime()) || isNaN(now.getTime())) {
      return { selisihMenit: 0, jamTelat: 0, denda: 0, isOverdue: false, label: "Normal" };
    }

    const selisihMenit = Math.floor((now.getTime() - end.getTime()) / (1000 * 60));
    const tol = Number(toleransiMenit) || 0;
    const pct = Number(persenPerJam) || 10;
    const rate = Number(hargaHarian) || 0;

    if (selisihMenit <= 0) {
      const sisaMenit = Math.abs(selisihMenit);
      const sisaJam = Math.floor(sisaMenit / 60);
      const mnt = sisaMenit % 60;
      return {
        selisihMenit: selisihMenit,
        sisaMenit: sisaMenit,
        jamTelat: 0,
        denda: 0,
        isOverdue: false,
        inTolerance: false,
        label: sisaJam > 0 ? sisaJam + " jam " + mnt + " mnt lagi" : mnt + " menit lagi"
      };
    }

    if (selisihMenit <= tol) {
      return {
        selisihMenit: selisihMenit,
        sisaMenit: 0,
        jamTelat: 0,
        denda: 0,
        isOverdue: true,
        inTolerance: true,
        label: "Lewat " + selisihMenit + " mnt (Masa Toleransi)"
      };
    }

    const menitKenaDenda = selisihMenit - tol;
    const jamTelat = Math.ceil(menitKenaDenda / 60);
    const denda = Math.round(jamTelat * (pct / 100) * rate);
    const totalJam = Math.floor(selisihMenit / 60);
    const sisaMnt = selisihMenit % 60;

    return {
      selisihMenit: selisihMenit,
      sisaMenit: 0,
      jamTelat: jamTelat,
      denda: denda,
      isOverdue: true,
      inTolerance: false,
      label: "Telat " + (totalJam > 0 ? totalJam + " jam " : "") + sisaMnt + " mnt (Dihitung " + jamTelat + " jam)"
    };
  }

  /**
   * API Caller ke Google Apps Script Web App
   */
  async function apiCall(config, action, payload) {
    if (!config || !config.gasUrl || config.gasUrl.indexOf("http") !== 0) {
      throw new Error("URL Google Apps Script belum dikonfigurasi pada config.enc.js.");
    }
    const body = Object.assign({ action: action, appKey: config.appKey }, payload || {});
    const res = await fetch(config.gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error("Gagal terhubung ke server Google Apps Script (HTTP " + res.status + ").");
    }
    const json = await res.json();
    return json;
  }

  global.RentalGuard = {
    encryptConfigForDomains: encryptConfigForDomains,
    unlockConfig: unlockConfig,
    extractDriveFileId: extractDriveFileId,
    resolveImageUrls: resolveImageUrls,
    renderCarImage: renderCarImage,
    compressImageForUpload: compressImageForUpload,
    CAR_PLACEHOLDER_SVG: CAR_PLACEHOLDER_SVG,
    escapeHtml: escapeHtml,
    formatRupiah: formatRupiah,
    parseRupiah: parseRupiah,
    setRupiahInput: setRupiahInput,
    bindRupiahInputs: bindRupiahInputs,
    formatDateTime: formatDateTime,
    toLocalInputValue: toLocalInputValue,
    normalizePhone: normalizePhone,
    buildWhatsAppUrl: buildWhatsAppUrl,
    calculateOvertime: calculateOvertime,
    apiCall: apiCall
  };
})(window);
