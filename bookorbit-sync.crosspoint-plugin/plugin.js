// BookOrbit Sync: settings card for the CrossPoint web interface.
// Made with AI assistance and lightly tested: it may contain errors. Review before trusting it.
// Writes config.json next to this plugin; device.json reads it as {cfg.*}.
CrossPoint.registerPlugin(async (container, api) => {
  const NAME = (api && api.name) || 'bookorbit-sync';
  const ROOTS = ['/.crosspoint/plugins', '/plugins', '/.plugins'];
  const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
  const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

  // ---- MD5 (BookOrbit accepts md5(password) like KOReader sends, so the
  // password itself never has to be stored) --------------------------------
  const MD5_K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];
  const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  function md5Hex(text) {
    return md5Bytes(new TextEncoder().encode(text));
  }

  function md5Bytes(msg) {
    const len = msg.length;
    const total = (((len + 8) >> 6) + 1) << 6;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(total - 8, (len << 3) >>> 0, true);
    view.setUint32(total - 4, Math.floor(len / 0x20000000), true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    const M = new Uint32Array(16);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + MD5_K[i] + M[g]) >>> 0;
        A = D; D = C; C = B;
        B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new DataView(new ArrayBuffer(16));
    out.setUint32(0, a0, true); out.setUint32(4, b0, true);
    out.setUint32(8, c0, true); out.setUint32(12, d0, true);
    return Array.from(new Uint8Array(out.buffer), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- helpers -----------------------------------------------------------
  function b64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const byte of bytes) bin += String.fromCharCode(byte);
    return btoa(bin);
  }

  // KOReader's "partial MD5" document id, which BookOrbit uses to recognise a book:
  // md5 over 1 KiB samples at offset 0 and at 1024 << (2*i) for i = 0..10.
  function partialMd5(bytes) {
    const parts = [];
    for (let i = -1; i <= 10; i++) {
      const offset = i < 0 ? 0 : 1024 * Math.pow(4, i);
      if (offset >= bytes.length) continue;
      parts.push(bytes.subarray(offset, Math.min(offset + 1024, bytes.length)));
    }
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    return md5Bytes(all);
  }

  // "Added on Tuesday, November 3, 2026, 04:12 PM" -> "2026-11-03 16:12:00" (or null).
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december'];
  function addedOnToDatetime(text) {
    const m = /Added on [A-Za-z]+, ([A-Za-z]+) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}) ?([AP]M)/i.exec(text || '');
    if (!m) return null;
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) return null;
    let hour = parseInt(m[4], 10) % 12;
    if (/PM/i.test(m[6])) hour += 12;
    const p = (n) => String(n).padStart(2, '0');
    return m[3] + '-' + p(month + 1) + '-' + p(parseInt(m[2], 10)) + ' ' + p(hour) + ':' + m[5] + ':00';
  }

  function nowDatetime() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // CrossPoint's /My Clippings.txt, Kindle style:
  //   Title (Author)\n- Your Highlight on Page 12 | Chapter | Added on ...\n\ntext\n==========
  function parseClippings(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n==========\r?\n?/)) {
      const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
      while (lines.length && !lines[0].trim()) lines.shift();
      if (lines.length < 2) continue;
      const head = /^(.*) \(([^()]*)\)\s*$/.exec(lines[0]);
      const loc = /^- Your Highlight on Page (\d+)(.*)$/.exec(lines[1]);
      if (!loc) continue;
      const bits = loc[2].split(' | ').map((s) => s.trim()).filter(Boolean);
      const added = bits.length && /^Added on /.test(bits[bits.length - 1]) ? bits.pop() : '';
      const quote = lines.slice(2).join('\n').trim();
      if (!quote) continue;
      out.push({
        title: head ? head[1] : lines[0].trim(), author: head ? head[2] : '',
        page: parseInt(loc[1], 10), chapter: bits.join(' | '),
        datetime: addedOnToDatetime(added), text: quote
      });
    }
    return out;
  }

  // ---- finding a highlight inside the EPUB (KOReader-style position) --------
  // BookOrbit needs a position like /body/DocFragment[8]/body/div[2]/p[4]/text()[1].96 to put a
  // highlight at the right spot in its web reader. CrossPoint does not store that for highlights,
  // so it is rebuilt here by finding the highlighted text in the book's own chapter files.
  async function ensureJSZip() {
    if (typeof JSZip !== 'undefined') return JSZip;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/js/jszip.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load the ZIP reader from the reader'));
      document.head.appendChild(s);
    });
    if (typeof JSZip === 'undefined') throw new Error('the ZIP reader did not load');
    return JSZip;
  }

  const tagOf = (el) => String(el.localName || el.tagName || '').toLowerCase();

  function parseMarkup(text) {
    try {
      const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
      if (doc && !doc.getElementsByTagName('parsererror').length && doc.getElementsByTagName('body').length) return doc;
    } catch (e) { /* not well-formed XML: fall back to the lenient HTML parser */ }
    return new DOMParser().parseFromString(text, 'text/html');
  }

  function joinPath(dir, href) {
    let rel = href.split('#')[0];
    try { rel = decodeURIComponent(rel); } catch (e) { /* keep as written */ }
    const out = [];
    for (const part of (dir ? dir.split('/') : []).concat(rel.split('/'))) {
      if (part === '..') out.pop();
      else if (part && part !== '.') out.push(part);
    }
    return out.join('/');
  }

  // Chapter files in reading order. Position N here is the DocFragment[N] number (1-based).
  async function readSpine(zip) {
    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('this is not an EPUB (no META-INF/container.xml)');
    const container = new DOMParser().parseFromString(await containerFile.async('string'), 'application/xml');
    const rootfile = container.getElementsByTagName('rootfile')[0];
    const opfPath = rootfile && rootfile.getAttribute('full-path');
    const opfFile = opfPath && zip.file(opfPath);
    if (!opfFile) throw new Error('could not find the EPUB package file');
    const opf = new DOMParser().parseFromString(await opfFile.async('string'), 'application/xml');
    const manifest = {};
    for (const item of Array.from(opf.getElementsByTagName('item'))) manifest[item.getAttribute('id')] = item.getAttribute('href');
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const spine = Array.from(opf.getElementsByTagName('itemref')).map((ref) => {
      const href = manifest[ref.getAttribute('idref')];
      return href ? joinPath(dir, href) : null;
    });
    const titleEl = opf.getElementsByTagName('dc:title')[0] || opf.getElementsByTagName('title')[0];
    spine.title = titleEl ? String(titleEl.textContent || '').trim() : '';
    const authorEl = opf.getElementsByTagName('dc:creator')[0] || opf.getElementsByTagName('creator')[0];
    spine.author = authorEl ? String(authorEl.textContent || '').trim() : '';
    return spine;
  }

  const SKIP_TAGS = { script: 1, style: 1, head: 1, title: 1 };
  const BLOCK_TAGS = {
    p: 1, div: 1, li: 1, ul: 1, ol: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, blockquote: 1, section: 1,
    article: 1, aside: 1, figure: 1, figcaption: 1, tr: 1, td: 1, th: 1, dd: 1, dt: 1, pre: 1, br: 1, hr: 1, body: 1
  };

  // The visible text of a chapter with whitespace collapsed, and for every character the text
  // node and position it came from.
  function indexText(body) {
    const units = [];
    const at = [];
    let blockId = 0;
    let lastBlock = -1;
    const space = (node, idx) => { units.push(' '); at.push([node, idx]); };
    (function walk(el) {
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 1) {
          const name = tagOf(child);
          if (SKIP_TAGS[name]) continue;
          const block = !!BLOCK_TAGS[name];
          if (block) blockId++;
          walk(child);
          if (block) blockId++;
        } else if (child.nodeType === 3) {
          if (blockId !== lastBlock && units.length && units[units.length - 1] !== ' ') space(child, 0);
          lastBlock = blockId;
          let idx = 0;
          for (const ch of child.data) {
            if (ch === '­') { idx += ch.length; continue; }
            if (/\s/.test(ch)) {
              if (units.length && units[units.length - 1] !== ' ') space(child, idx);
            } else {
              for (let u = 0; u < ch.length; u++) { units.push(ch[u]); at.push([child, idx]); }
            }
            idx += ch.length;
          }
        }
      }
    })(body);
    return { text: units.join(''), at };
  }

  function normalizeQuote(text) {
    return String(text || '').replace(/­/g, '').replace(/\s+/g, ' ').trim();
  }

  function xpointerFor(fragment, node, utf16Index) {
    const segments = [];
    let el = node.parentNode;
    while (el && tagOf(el) !== 'body') {
      const name = tagOf(el);
      let n = 0;
      for (const sib of Array.from(el.parentNode.childNodes)) {
        if (sib.nodeType === 1 && tagOf(sib) === name) { n++; if (sib === el) break; }
      }
      segments.unshift(name + '[' + n + ']');
      el = el.parentNode;
    }
    // KOReader counts only non-empty text nodes, and drops a whitespace-only first child.
    let count = 0;
    let own = 0;
    Array.from(node.parentNode.childNodes).forEach((c, pos) => {
      if (c.nodeType !== 3 || !c.data.length) return;
      if (pos === 0 && /^\s*$/.test(c.data)) return;
      count++;
      if (c === node) own = count;
    });
    const offset = Array.from(node.data.slice(0, utf16Index)).length;
    return '/body/DocFragment[' + fragment + ']/body' + (segments.length ? '/' + segments.join('/') : '') +
      '/text()[' + own + '].' + offset;
  }

  // Reads the whole book once: the visible text of every chapter, so each highlight is then a
  // quick search instead of another trip through the ZIP.
  async function openBook(bytes, progress) {
    const Zip = await ensureJSZip();
    const zip = await Zip.loadAsync(bytes);
    const spine = await readSpine(zip);
    const texts = [];
    for (let i = 0; i < spine.length; i++) {
      texts.push(null);
      const file = spine[i] && zip.file(spine[i]);
      if (!file) continue;
      if (progress && i % 10 === 0) progress(i + 1, spine.length);
      const body = parseMarkup(await file.async('string')).getElementsByTagName('body')[0];
      if (body) texts[i] = indexText(body).text;
    }
    return { zip, spine, texts, title: spine.title };
  }

  // ---- Highlights in the reader's own format ------------------------------------------------------
  // The reader keeps a book's highlights in /.crosspoint/clippings/epub_<hash of the book path>.bin.
  // Each one is placed by a chapter number and a start and end offset: the count of characters of
  // text in that chapter's <body>, whitespace included, with &entities; already turned into characters.
  const cpCount = (text) => { let n = 0; for (const unused of text) n++; return n; };
  const RAW_SKIP = { script: 1, style: 1 };

  function rawIndex(body) {
    const starts = new Map();
    const chars = [];
    (function walk(el) {
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === 1) {
          if (!RAW_SKIP[tagOf(child)]) walk(child);
        } else if (child.nodeType === 3 || child.nodeType === 4) {
          starts.set(child, chars.length);
          for (const ch of child.data) chars.push(ch);
        }
      }
    })(body);
    return { starts, chars };
  }

  const rawPos = (raw, node, utf16Index) => raw.starts.get(node) + cpCount(node.data.slice(0, utf16Index));

  // The reader's file name uses std::hash of the book's path, which on its 32-bit chip is MurmurHash2.
  function murmurHash2(bytes) {
    const m = 0x5bd1e995;
    let len = bytes.length;
    let h = (0xc70f6907 ^ len) >>> 0;
    let i = 0;
    while (len >= 4) {
      let k = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
      k = Math.imul(k, m) >>> 0;
      k = (k ^ (k >>> 24)) >>> 0;
      k = Math.imul(k, m) >>> 0;
      h = Math.imul(h, m) >>> 0;
      h = (h ^ k) >>> 0;
      i += 4;
      len -= 4;
    }
    if (len === 3) h = (h ^ (bytes[i + 2] << 16)) >>> 0;
    if (len >= 2) h = (h ^ (bytes[i + 1] << 8)) >>> 0;
    if (len >= 1) { h = (h ^ bytes[i]) >>> 0; h = Math.imul(h, m) >>> 0; }
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, m) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
    return h;
  }

  const clippingStorePath = (bookPath) => '/.crosspoint/clippings/epub_' + murmurHash2(new TextEncoder().encode(bookPath)) + '.bin';

  const STORE_VERSION = 4;
  const REC_FIXED = 154; // bytes of one record before its text length
  const REC_TEXT_MAX = 4096;
  const REC_CHAPTER_MAX = 47;
  const STORE_MAX_RECORDS = 256; // the smaller of the reader models' limits

  // Cuts text to at most max bytes of UTF-8 without splitting a character.
  function utf8Cut(text, max) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length <= max) return bytes;
    let cut = max;
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
    return bytes.slice(0, cut);
  }

  // Reads the reader's file without changing it. Throws if it is not exactly the format described
  // above, so that a file this plugin does not understand is never rewritten.
  function parseStore(bytes) {
    const bad = () => new Error('the reader\'s highlight file for this book is in a format this plugin does not know, so it was left alone');
    if (bytes.length < 3 || bytes[0] !== STORE_VERSION) throw bad();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint16(1, true);
    let p = 3;
    const strings = [];
    for (let i = 0; i < 3; i++) {
      if (p + 4 > bytes.length) throw bad();
      const n = view.getUint32(p, true);
      p += 4;
      if (n > bytes.length - p) throw bad();
      strings.push(bytes.slice(p, p + n));
      p += n;
    }
    const decoder = new TextDecoder();
    const records = [];
    for (let i = 0; i < count; i++) {
      if (p + REC_FIXED + 2 > bytes.length) throw bad();
      const textLen = view.getUint16(p + REC_FIXED, true);
      const end = p + REC_FIXED + 2 + textLen;
      if (textLen > REC_TEXT_MAX || end > bytes.length) throw bad();
      records.push({
        raw: bytes.slice(p, end), spine: view.getUint16(p, true),
        start: view.getUint32(p + 24, true), end: view.getUint32(p + 28, true),
        timestamp: view.getUint32(p + 16, true),
        synced: bytes[p + 41] !== 0, // has an id from a CrossPoint sync server
        chapter: decoder.decode(bytes.slice(p + 106, p + 154)).replace(/\0[\s\S]*$/, ''),
        text: decoder.decode(bytes.slice(p + REC_FIXED + 2, end))
      });
      p = end;
    }
    if (p !== bytes.length) throw bad();
    return { strings, records };
  }

  function buildStore(strings, records) {
    const parts = [new Uint8Array([STORE_VERSION, records.length & 0xff, records.length >> 8])];
    for (const s of strings) {
      const head = new Uint8Array(4);
      new DataView(head.buffer).setUint32(0, s.length, true);
      parts.push(head, s);
    }
    for (const r of records) parts.push(r.raw);
    const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
    let at = 0;
    for (const a of parts) { out.set(a, at); at += a.length; }
    return out;
  }

  // One new highlight. Pages and the layout number are left at 0: with offsets present the reader
  // places the highlight by them alone, whatever the font size or margins.
  function makeRecord(o) {
    const text = utf8Cut(o.text, REC_TEXT_MAX);
    const raw = new Uint8Array(REC_FIXED + 2 + text.length);
    const view = new DataView(raw.buffer);
    view.setUint16(12, Math.min(String(o.text).split(/\s+/).filter(Boolean).length, 0xffff), true);
    view.setUint16(14, 0xffff, true); // paragraph: unknown
    view.setUint16(0, o.spine, true);
    view.setUint32(16, o.timestamp >>> 0, true);
    view.setUint32(24, o.start, true);
    view.setUint32(28, o.end, true);
    raw.set(utf8Cut(o.chapter || '', REC_CHAPTER_MAX), 106);
    view.setUint16(REC_FIXED, text.length, true);
    raw.set(text, REC_FIXED + 2);
    return { raw, spine: o.spine, start: o.start, end: o.end, text: o.text };
  }

  // KOReader-style position -> where it is in the chapter, or null if it is not in a form we follow.
  function parsePosition(xp) {
    const m = /^\/body\/DocFragment\[(\d+)\]\/body((?:\/[A-Za-z0-9_:-]+(?:\[\d+\])?)*)\/text\(\)(?:\[(\d+)\])?\.(\d+)$/.exec(String(xp || ''));
    if (!m) return null;
    const segments = m[2].split('/').filter(Boolean).map((seg) => {
      const parts = /^([A-Za-z0-9_:-]+)(?:\[(\d+)\])?$/.exec(seg);
      return [parts[1].toLowerCase(), Number(parts[2] || 1)];
    });
    return { fragment: Number(m[1]), segments, textNo: Number(m[3] || 1), offset: Number(m[4]) };
  }

  function walkPosition(body, pos) {
    let el = body;
    for (const [name, n] of pos.segments) {
      el = Array.from(el.childNodes).filter((c) => c.nodeType === 1 && tagOf(c) === name)[n - 1];
      if (!el) return null;
    }
    const texts = Array.from(el.childNodes).filter((c, at) =>
      c.nodeType === 3 && c.data.length && !(at === 0 && /^\s*$/.test(c.data)));
    const node = texts[pos.textNo - 1];
    if (!node) return null;
    let idx = 0;
    let left = pos.offset;
    for (const ch of node.data) { if (!left) break; idx += ch.length; left--; }
    return left ? null : { node, idx };
  }

  async function chapterView(book, index) {
    book.views = book.views || {};
    if (book.views[index] === undefined) {
      const file = book.spine[index] && book.zip.file(book.spine[index]);
      const body = file ? parseMarkup(await file.async('string')).getElementsByTagName('body')[0] : null;
      book.views[index] = body ? { body, raw: rawIndex(body) } : null;
    }
    return book.views[index];
  }

  // BookOrbit's own position, when it gives one that really spans the highlighted text.
  async function placeByPosition(book, entry) {
    const a = parsePosition(entry.pos0);
    const b = parsePosition(entry.pos1);
    if (!a || !b || a.fragment !== b.fragment) return null;
    const index = a.fragment - 1;
    const view = await chapterView(book, index);
    if (!view) return null;
    const from = walkPosition(view.body, a);
    const to = walkPosition(view.body, b);
    if (!from || !to) return null;
    const start = rawPos(view.raw, from.node, from.idx);
    const end = rawPos(view.raw, to.node, to.idx);
    const want = normalizeQuote(entry.text);
    if (!(end > start) || !want || normalizeQuote(view.raw.chars.slice(start, end).join('')) !== want) return null;
    return { index, start, end };
  }

  // Where a BookOrbit highlight goes in the reader, or null (with why) when it cannot be placed safely.
  async function placeOnReader(book, entry) {
    let byPosition = null;
    try { byPosition = await placeByPosition(book, entry); } catch (e) { byPosition = null; }
    if (byPosition) return byPosition;
    const hit = await locateIn(book, entry.text, entry.chapter);
    if (!hit || hit.approx) return { missing: true };
    if (hit.matches > 1 && !hit.byChapter) return { ambiguous: true };
    return { index: hit.index, start: hit.rawStart, end: hit.rawEnd };
  }

  // Finds one highlighted text in an opened book. Returns null when it cannot be found.
  async function locateIn(book, quote, chapter) {
    const wanted = normalizeQuote(quote);
    if (!wanted) return null;
    const candidates = [];
    let total = 0;
    for (let i = 0; i < book.texts.length; i++) {
      const text = book.texts[i];
      if (!text) continue;
      let from = 0;
      let first = -1;
      for (;;) {
        const hit = text.indexOf(wanted, from);
        if (hit < 0) break;
        total++;
        if (first < 0) first = hit;
        from = hit + wanted.length;
      }
      let approx = false;
      if (first < 0 && wanted.length > 60) {
        first = text.indexOf(wanted.slice(0, 60));
        if (first >= 0) { approx = true; total++; }
      }
      if (first < 0) continue;
      const head = text.slice(0, 300).toLowerCase();
      const titled = !!chapter && head.includes(String(chapter).split(' | ').pop().toLowerCase());
      candidates.push({ index: i, first, approx, titled });
      if (titled && !approx) break;
    }
    if (!candidates.length) return null;
    const pick = candidates.find((c) => c.titled) || candidates[0];
    // Only the chapter that matched is read again, to learn which text node each letter is in.
    const body = parseMarkup(await book.zip.file(book.spine[pick.index]).async('string')).getElementsByTagName('body')[0];
    const indexed = indexText(body);
    const last = Math.min(pick.first + wanted.length, indexed.text.length) - 1;
    const [startNode, startIdx] = indexed.at[pick.first];
    const [endNode, endIdx] = indexed.at[last];
    const endUnit = (endNode.data.codePointAt(endIdx) || 0) > 0xffff ? 2 : 1;
    const fragment = pick.index + 1;
    const raw = rawIndex(body);
    return {
      pos0: xpointerFor(fragment, startNode, startIdx),
      pos1: xpointerFor(fragment, endNode, endIdx + endUnit),
      fragment, matches: total, approx: pick.approx, byChapter: pick.titled,
      index: pick.index, rawStart: rawPos(raw, startNode, startIdx), rawEnd: rawPos(raw, endNode, endIdx + endUnit)
    };
  }

  // The titles a book may go by in /My Clippings.txt: the one inside the EPUB and the one the reader
  // keeps in its recent-books list.
  async function bookTitles(bytes, path) {
    let epubTitle = '';
    try { epubTitle = (await readSpine(await (await ensureJSZip()).loadAsync(bytes))).title; } catch (e) { epubTitle = ''; }
    return [epubTitle, recentTitles[path]].filter(Boolean);
  }

  const sameTitle = (a, b) => {
    const n = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    return !!n(a) && n(a) === n(b);
  };

  // A browser's "Failed to fetch" means the page could not talk to the reader at all.
  const whyFailed = (e) => {
    const message = e && e.message ? e.message : String(e);
    return /failed to fetch|networkerror|load failed/i.test(message)
      ? 'the page lost contact with the reader. Check that File Transfer is still open on the reader (it may have gone to sleep), reload this page and try again.'
      : message;
  };

  async function readText(path) {
    try {
      const response = await fetch('/download?path=' + encodeURIComponent(path));
      return response.ok ? await response.text() : null;
    } catch (e) {
      return null;
    }
  }

  // config.json must sit in this plugin's own folder, wherever it is installed.
  async function locateConfigPath() {
    if (api && typeof api.dir === 'string' && api.dir.startsWith('/')) {
      return api.dir.replace(/\/+$/, '') + '/config.json';
    }
    for (const root of ROOTS) {
      if ((await readText(root + '/' + NAME + '/manifest.json')) !== null) {
        return root + '/' + NAME + '/config.json';
      }
    }
    return ROOTS[1] + '/' + NAME + '/config.json';
  }

  // "192.168.1.50:3000" -> http://..., "books.example.com/" -> https://...,
  // and a pasted /api/v1 or /api/v1/koreader suffix is dropped.
  function normalizeServer(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      const host = s.split(/[\/:?#]/)[0];
      const local = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === 'localhost' ||
        !host.includes('.') || host.endsWith('.local');
      s = (local ? 'http://' : 'https://') + s;
    }
    s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
    return s.replace(/\/api\/v1(\/koreader)?$/i, '');
  }

  const $ = (id) => document.getElementById(id);
  const PLUGIN_VERSION = 'crosspoint/0.13.0';

  container.innerHTML =
    '<details id="bo-panel"><summary style="cursor:pointer">' +
    '<h2 style="display:inline-block;margin:0">BookOrbit Sync</h2> ' +
    '<span id="bo-state" style="color:#666;font-size:0.9em"></span></summary>' +
    '<p id="bo-version" style="color:#666;font-size:0.9em;margin:12px 0 16px">Version: v' + PLUGIN_VERSION.split('/')[1] + '</p>' +
    '<p>Sends your reading sessions and highlights to BookOrbit. Use the KOReader sync login ' +
    'from BookOrbit (Settings &gt; Devices &amp; Sync &gt; KOReader).</p>' +
    '<div class="setting-row"><span class="setting-name">Server URL</span>' +
    '<span class="setting-control"><input type="text" id="bo-server" autocomplete="off" ' +
    'placeholder="http://192.168.1.50:3000" style="width:100%"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Username</span>' +
    '<span class="setting-control"><input type="text" id="bo-user" autocomplete="off" ' +
    'style="width:100%"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Password</span>' +
    '<span class="setting-control"><input type="password" id="bo-pass" autocomplete="new-password" ' +
    'style="width:100%"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Device name</span>' +
    '<span class="setting-control"><input type="text" id="bo-device" autocomplete="off" ' +
    'placeholder="crosspoint" style="width:100%"></span></div>' +
    '<div class="setting-row"><span class="setting-name">Also send at sleep</span>' +
    '<span class="setting-control"><input type="checkbox" id="bo-sleep"> ' +
    'Join WiFi when the reader sleeps (needs a restart)</span></div>' +
    '<div class="setting-row"><span class="setting-control">' +
    '<button type="button" id="bo-test">Test connection</button> ' +
    '<button type="button" id="bo-save">Save</button></span></div>' +
    '<p id="bo-status" style="color:#666"></p>' +
    '<p style="color:#666;font-size:0.9em">Saved to config.json on the SD card. The password ' +
    'is stored only as an md5 hash, which still works as the login, so use a trusted ' +
    'network. By default sessions are sent the next time the reader goes online, ' +
    'for example when you use the long-press or menu Sync progress action. ' +
    'This plugin was made with AI assistance and may contain errors.</p>' +
    '<details id="bo-hl"><summary style="cursor:pointer"><strong>Highlights</strong></summary>' +
    '<p>Pick a book, then use the buttons. The book must be the same file BookOrbit has. ' +
    'Reading it can take a while.</p>' +
    '<ul style="margin:0 0 12px;padding-left:1.2em;line-height:1.5">' +
    '<li><strong>Check book:</strong> confirms BookOrbit has this file and lists the reader\'s highlights for it.</li>' +
    '<li><strong>Send highlights:</strong> sends the reader\'s highlights for this book to BookOrbit. ' +
    'Ones it already has are skipped.</li>' +
    '<li><strong>Pull highlights:</strong> lists the highlights BookOrbit has for this book.</li>' +
    '<li><strong>Add to reader:</strong> after a pull, adds them to the reader\'s own highlights. Ones on the reader that BookOrbit does not have can then be deleted from the reader.</li>' +
    '</ul>' +
    '<div class="setting-row" id="bo-recent-row" style="display:none"><span class="setting-name">Recent books</span>' +
    '<span class="setting-control"><select id="bo-recent" style="width:100%"></select></span></div>' +
    '<div class="setting-row" id="bo-book-row"><span class="setting-name">Book file</span>' +
    '<span class="setting-control"><input type="text" id="bo-book" autocomplete="off" ' +
    'placeholder="/Books/My Book.epub" style="width:100%"></span></div>' +
    '<div class="setting-row"><span class="setting-control">' +
    '<button type="button" id="bo-hl-check">Check book</button> ' +
    '<button type="button" id="bo-hl-send">Send highlights</button> ' +
    '<button type="button" id="bo-hl-pull">Pull highlights</button></span></div>' +
    '<p id="bo-hl-status" style="color:#666"></p>' +
    '<div class="setting-row" id="bo-hl-actions" style="display:none"><span class="setting-control">' +
    '<button type="button" id="bo-hl-add" disabled>Add to reader</button></span></div>' +
    '<div id="bo-hl-list"></div><div id="bo-hl-strays"></div></details>' +
    '</details>';

  // Show this card first on the Plugins page, above the other plugins.
  try {
    const host = container.parentNode;
    if (host && host.firstChild && host.firstChild !== container) host.insertBefore(container, host.firstChild);
  } catch (e) { /* keep the default position */ }

  let configPath = await locateConfigPath();
  let saved = {};
  try {
    const text = await readText(configPath);
    if (text) saved = JSON.parse(text) || {};
  } catch (e) {
    saved = {};
  }
  // Version 0.6 to 0.7 could hold sessions by pointing "server" at a dead address. Undo that,
  // otherwise nothing would ever be sent.
  let restoredFromHold = false;
  if (saved.hold) {
    saved = { server: saved.server_real || '', user: saved.user, key: saved.key, device_id: saved.device_id };
    if (saved.server) {
      try {
        const written = await api.writeFile(configPath, b64(JSON.stringify(saved, null, 2)));
        restoredFromHold = !(written && written.ok === false);
      } catch (e) { restoredFromHold = false; }
    }
  }
  $('bo-server').value = saved.server || '';
  $('bo-user').value = saved.user || '';
  $('bo-device').value = saved.device_id || '';
  $('bo-pass').placeholder = saved.key ? '(saved; leave blank to keep)' : '';

  // Delivery mode lives in device.json ("connect": true on reader.session).
  const devicePath = configPath.replace(/config\.json$/, 'device.json');
  let deviceDoc = null;
  try {
    const text = await readText(devicePath);
    if (text) deviceDoc = JSON.parse(text);
  } catch (e) {
    deviceDoc = null;
  }
  const sessionHandler = () => deviceDoc && deviceDoc.events && deviceDoc.events['reader.session'];
  const sleepOn = () => !!(sessionHandler() && sessionHandler().connect === true);
  $('bo-sleep').checked = sleepOn();
  if (!sessionHandler()) $('bo-sleep').disabled = true;

  async function saveSleepMode() {
    const want = !!$('bo-sleep').checked;
    if (!sessionHandler() || want === sleepOn()) return false;
    const next = JSON.parse(JSON.stringify(deviceDoc));
    if (want) next.events['reader.session'].connect = true;
    else delete next.events['reader.session'].connect;
    const result = await api.writeFile(devicePath, b64(JSON.stringify(next, null, 2)));
    if (result && result.ok === false) throw new Error('could not write ' + devicePath);
    deviceDoc = next;
    return true;
  }

  // Collapsed once set up (click the title to change it); open for first-time setup.
  function isConfigured() { return !!(saved.server && saved.user && saved.key); }
  function showState() {
    $('bo-state').textContent = isConfigured() ? '(set up: ' + saved.server + ')' : '(not set up)';
  }
  $('bo-panel').open = !isConfigured();
  showState();

  // Neutral while working, red box on a problem, green box when BookOrbit accepted the login.
  function status(message, bad, good) {
    const el = $('bo-status');
    el.textContent = message;
    const color = good ? '#3fb950' : bad ? '#ff6b6b' : '#999';
    el.style.color = color;
    el.style.fontWeight = good || bad ? '600' : 'normal';
    el.style.border = good || bad ? '1px solid ' + color : '1px solid transparent';
    el.style.borderRadius = '6px';
    el.style.padding = '8px 10px';
    el.style.background = good ? 'rgba(63,185,80,0.12)' : bad ? 'rgba(255,107,107,0.12)' : 'transparent';
  }

  function readForm() {
    const server = normalizeServer($('bo-server').value);
    const user = $('bo-user').value.trim();
    const password = $('bo-pass').value;
    const deviceId = $('bo-device').value.trim() || 'crosspoint';
    if (!/^https?:\/\/[^\s"\\]+$/i.test(server)) return { error: 'Enter the BookOrbit server URL.' };
    if (!user || CONTROL_CHARS.test(user)) return { error: 'Enter the KOReader sync username.' };
    if (CONTROL_CHARS.test(password)) return { error: 'The password contains unsupported characters.' };
    if (!password && !saved.key) return { error: 'Enter the KOReader sync password.' };
    if (!DEVICE_ID_RE.test(deviceId)) {
      return { error: 'Device name may only use letters, digits, _ and - (up to 100).' };
    }
    return { server, user, password, deviceId };
  }

  // Asks BookOrbit from the reader itself, so it also proves the reader can reach it.
  async function loginStatus(server, user, key) {
    const res = await api.relay('GET', server + '/api/v1/koreader/users/auth', {
      accept: 'application/json', 'x-auth-user': user, 'x-auth-key': key
    }, '');
    return res && res.status;
  }

  // Tries md5(password) first, then the plain password (BookOrbit accepts either).
  async function resolveKey(form) {
    const candidates = form.password ? [md5Hex(form.password), form.password] : [saved.key];
    let last = null;
    for (const key of candidates) {
      last = await loginStatus(form.server, form.user, key);
      if (last === 200) return { key, status: 200 };
      if (last !== 401) return { key: candidates[0], status: last };
    }
    return { key: candidates[0], status: last };
  }

  function describe(statusCode) {
    if (statusCode === 200) return { ok: true, text: 'Connected to BookOrbit.' };
    if (statusCode === 401) return { text: 'BookOrbit rejected the login. Check the KOReader sync username and password.' };
    if (statusCode === 403) return { text: 'KOReader sync is disabled for this BookOrbit account.' };
    if (statusCode === 404) return { text: 'BookOrbit answered 404. Check the server URL (no path needed).' };
    return { text: 'BookOrbit answered ' + statusCode + '.' };
  }

  async function run(write) {
    const form = readForm();
    if (form.error) return status(form.error, true);
    $('bo-test').disabled = $('bo-save').disabled = true;
    status('Contacting BookOrbit...');
    let outcome;
    try {
      const result = await resolveKey(form);
      outcome = Object.assign({ key: result.key }, describe(result.status));
    } catch (e) {
      outcome = {
        key: form.password ? md5Hex(form.password) : saved.key,
        text: 'The reader could not reach ' + form.server + ': ' + (e && e.message ? e.message : e)
      };
    }
    try {
      if (write) {
        const config = { server: form.server, user: form.user, key: outcome.key, device_id: form.deviceId };
        const result = await api.writeFile(configPath, b64(JSON.stringify(config, null, 2)));
        if (result && result.ok === false) throw new Error('could not write ' + configPath);
        saved = config;
        $('bo-server').value = form.server;
        $('bo-pass').value = '';
        $('bo-pass').placeholder = '(saved; leave blank to keep)';
        const modeChanged = await saveSleepMode();
        status((outcome.ok ? 'Saved. ' : 'Saved, but: ') + outcome.text +
          (modeChanged ? ' Restart the reader to apply the sleep setting.' : ''), !outcome.ok, !!outcome.ok);
        showState();
        // Collapse after a clean save, unless there is something to read or do.
        if (outcome.ok && !modeChanged) {
          $('bo-panel').open = false;
          $('bo-state').textContent = '(saved, connected to ' + saved.server + ')';
        }
      } else {
        status(outcome.text, !outcome.ok, !!outcome.ok);
      }
    } catch (e) {
      status('Could not save: ' + (e && e.message ? e.message : e), true);
    } finally {
      $('bo-test').disabled = $('bo-save').disabled = false;
    }
  }

  // ---- Highlights ------------------------------------------

  // good = green, bad = red, warn = orange (nothing wrong, but nothing was sent either)
  function hlStatus(message, bad, good, warn) {
    const el = $('bo-hl-status');
    el.textContent = message;
    const tone = good ? ['#3fb950', 'rgba(63,185,80,0.12)'] : bad ? ['#ff6b6b', 'rgba(255,107,107,0.12)']
      : warn ? ['#f0a030', 'rgba(240,160,48,0.12)'] : ['#999', 'transparent'];
    el.style.color = tone[0];
    el.style.border = '1px solid ' + (good || bad || warn ? tone[0] : 'transparent');
    el.style.borderRadius = '6px';
    el.style.padding = '8px 10px';
    el.style.background = tone[1];
  }

  let bytesCache = { path: '', bytes: null };
  async function bookBytes(path) {
    if (bytesCache.path === path && bytesCache.bytes) return bytesCache.bytes;
    hlStatus('Reading the book from the reader (this can take a while)...');
    const response = await fetch('/download?path=' + encodeURIComponent(path));
    if (!response.ok) throw new Error('could not read ' + path + ' (check the path)');
    const bytes = new Uint8Array(await response.arrayBuffer());
    bytesCache = { path, bytes };
    return bytes;
  }

  async function postJson(endpoint, payload) {
    const res = await api.relay('POST', saved.server + '/api/v1/koreader/plugin/' + endpoint, {
      'Content-Type': 'application/json', accept: 'application/json',
      'x-auth-user': saved.user, 'x-auth-key': saved.key
    }, JSON.stringify(payload));
    let data = null;
    try { data = JSON.parse(res.body); } catch (e) { data = null; }
    return { status: res.status, data };
  }

  function deviceInfo() {
    return { deviceId: saved.device_id || 'crosspoint', deviceModel: 'CrossPoint',
      pluginVersion: PLUGIN_VERSION, deviceTime: nowDatetime() };
  }

  async function highlightAction(send) {
    if (!isConfigured()) return hlStatus('Save the server and login above first.', true);
    const path = $('bo-book').value.trim();
    if (!path.startsWith('/')) return hlStatus('Enter the book file path, starting with /.', true);
    $('bo-hl-check').disabled = $('bo-hl-send').disabled = true;
    clearList();
    try {
      const bytes = await bookBytes(path);
      const hash = partialMd5(bytes);
      let entries = [];
      if (send) {
        const all = parseClippings(await readText('/My Clippings.txt'));
        if (!all.length && !(await withStoreHighlights(path, [], 'x')).length) throw new Error('no highlights found in /My Clippings.txt');
        let book = null;
        try {
          book = await openBook(bytes, (n, of) => hlStatus('Reading the book (' + n + ' of ' + of + ')...'));
        } catch (e) {
          book = null;
        }
        // Only highlights whose book title matches this book are sent. The title is read from the EPUB
        // and from the reader's recent-books list, which is where the reader got the title it wrote
        // into /My Clippings.txt. If neither matches, nothing is sent: guessing would attach one
        // book's highlights to another.
        const titles = [book && book.title, recentTitles[path]].filter(Boolean);
        entries = all.filter((c) => titles.some((t) => sameTitle(c.title, t)));
        const present = await stillOnReader(path, entries);
        const gone = present.gone;
        entries = present.entries;
        if (titles.length) entries = await withStoreHighlights(path, entries, titles[0]);
        if (!entries.length && gone) {
          return hlStatus('The ' + gone + ' highlight' + (gone === 1 ? '' : 's') + ' for this book in /My Clippings.txt ' +
            (gone === 1 ? 'was' : 'were') + ' deleted from the reader, so nothing was sent.', false, false, true);
        }
        if (!entries.length) {
          return hlStatus(titles.length
            ? 'No highlights for "' + titles[0] + '" were found in /My Clippings.txt, so nothing was sent.'
            : 'Could not tell which highlights belong to this book (it has no title), so nothing was sent.',
          false, false, true);
        }
        const goneNote = gone ? ' ' + gone + ' deleted from the reader ' + (gone === 1 ? 'was' : 'were') + ' skipped.' : '';
        hlStatus('Looking for ' + entries.length + ' highlight' + (entries.length === 1 ? '' : 's') + ' in the book...');
        let found = 0;
        let uncertain = 0;
        const annotations = [];
        for (const entry of entries) {
          let where = null;
          try { where = book ? await locateIn(book, entry.text, entry.chapter) : null; } catch (e) { where = null; }
          if (where) { found++; if (where.approx || (where.matches > 1 && !where.byChapter)) uncertain++; }
          const annotation = {
            datetime: entry.datetime || nowDatetime(), drawer: 'lighten', text: entry.text.slice(0, 10000),
            chapter: entry.chapter.slice(0, 500), pageno: entry.page, posFormat: 'xpointer',
            pos0: where ? where.pos0 : '/body/DocFragment[1]/body/text().0'
          };
          if (where) annotation.pos1 = where.pos1;
          annotations.push(annotation);
        }
        hlStatus('Asking BookOrbit...');
        const r = await postJson('annotations', Object.assign(deviceInfo(), { books: [{ hash, annotations }] }));
        if (!(r.status >= 200 && r.status < 300) || !r.data) return hlStatus('BookOrbit answered ' + r.status + '.', true);
        if ((r.data.unmatched || []).length) {
          return hlStatus('BookOrbit does not have this exact file, so the highlights were not stored.', true);
        }
        const upserted = ((r.data.results || [])[0] || {}).upserted || 0;
        const n = annotations.length;
        const lost = n - found;
        const already = Math.max(0, n - upserted);
        if (upserted === 0) {
          return hlStatus('Nothing new to send: ' + (n === 1 ? 'this highlight is' : 'all ' + n + ' highlights are') +
            ' already in BookOrbit.' + goneNote, false, false, true);
        }
        let msg = 'Sent. ' + upserted + ' new' + (already ? ', ' + already + ' already in BookOrbit' : '') + '. ' +
          found + ' of ' + n + ' found in the book';
        if (lost) msg += ', ' + lost + ' could not be found (placeholder position, will show "Anchor lost")';
        if (uncertain) msg += ', ' + uncertain + ' matched text that appears more than once or only partly, so check ' + (uncertain === 1 ? 'it' : 'them');
        msg += '.' + goneNote;
        return hlStatus(msg, false, true);
      }
      hlStatus('Asking BookOrbit...');
      if (!send) {
        const r = await postJson('match-check', Object.assign(deviceInfo(), { hashes: [hash] }));
        if (!(r.status >= 200 && r.status < 300) || !r.data) return hlStatus('BookOrbit answered ' + r.status + '.', true);
        const match = (r.data.matches || [])[0];
        if (!match) return hlStatus('BookOrbit does not have this exact file (hash ' + hash + ').', true);
        if (match.positionCompatible === false) {
          return hlStatus('BookOrbit has this book, but the file differs from its copy, so highlights will not sync.', true);
        }
        // Show what the reader has for this book, so it can be looked over before pressing Send.
        let mine = [];
        try {
          const titles = await bookTitles(bytes, path);
          mine = parseClippings(await readText('/My Clippings.txt')).filter((c) => titles.some((t) => sameTitle(c.title, t)));
          mine = (await stillOnReader(path, mine)).entries;
          if (titles.length) mine = await withStoreHighlights(path, mine, titles[0]);
        } catch (e) { mine = []; }
        if (mine.length) {
          showList('On the reader (' + mine.length + '). Press Send highlights to send them to BookOrbit.',
            mine.map((c) => ({ chapter: c.chapter, page: c.page, text: c.text })));
        } else {
          showList('No highlights for this book were found on the reader yet.', []);
        }
        if (!mine.length) {
          return hlStatus('BookOrbit has this exact file (hash ' + hash + '). The reader has no highlights for this book yet, so there is nothing to send.',
            false, false, true);
        }
        return hlStatus('BookOrbit has this exact file (hash ' + hash + '). Highlights can sync.', false, true);
      }
    } catch (e) {
      hlStatus('Could not finish: ' + whyFailed(e), true);
    } finally {
      $('bo-hl-check').disabled = $('bo-hl-send').disabled = false;
    }
  }

  // ---- pulling highlights made elsewhere (the BookOrbit web reader, other devices) ----------
  // Uses BookOrbit's annotation exchange as a read: the reader says it has nothing for this copy of
  // the book, BookOrbit lists what it holds, and each page is acknowledged so the next one follows.
  // Nothing is written into the reader's own highlight store.
  let pulled = null;
  const escapeHtml = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // header: a line above the list; items: { chapter, page, text, note }
  function showList(header, items) {
    const list = $('bo-hl-list');
    list.innerHTML = (header ? '<p style="color:#999;margin:12px 0 4px">' + escapeHtml(header) + '</p>' : '') +
      items.map((e) =>
        '<div style="border-top:1px solid #555;padding:8px 0">' +
        '<div style="font-size:12px;color:#999">' + escapeHtml(e.chapter || '') + (e.page ? ' \u00b7 p. ' + escapeHtml(e.page) : '') + '</div>' +
        '<div>' + escapeHtml(e.text) + '</div>' +
        (e.note ? '<div style="font-size:13px;color:#999">Note: ' + escapeHtml(e.note) + '</div>' : '') + '</div>').join('');
  }

  // Any button other than Add to reader clears what was listed before.
  function clearList() {
    pulled = null;
    strays = null;
    armed = null;
    $('bo-hl-list').innerHTML = '';
    $('bo-hl-strays').innerHTML = '';
    syncActions();
  }

  // Add to reader only shows once there is a pulled list to work with.
  function syncActions() {
    $('bo-hl-add').disabled = !pulled;
    $('bo-hl-actions').style.display = pulled ? '' : 'none';
  }

  function renderPulled() {
    if (!pulled) return clearList();
    showList('', pulled.entries.map((e) => ({ chapter: e.chapter, page: e.pageno, text: e.text, note: e.note })));
  }

  async function pullAction() {
    if (!isConfigured()) return hlStatus('Save the server and login above first.', true);
    const path = $('bo-book').value.trim();
    if (!path.startsWith('/')) return hlStatus('Enter the book file path, starting with /.', true);
    $('bo-hl-check').disabled = $('bo-hl-send').disabled = $('bo-hl-pull').disabled = $('bo-hl-add').disabled = true;
    clearList();
    try {
      const bytes = await bookBytes(path);
      const hash = partialMd5(bytes);
      let title = '';
      let author = '';
      try {
        const spine = await readSpine(await (await ensureJSZip()).loadAsync(bytes));
        title = spine.title;
        author = spine.author;
      } catch (e) { /* not a readable EPUB: the file name is used instead */ }
      if (!title) title = (path.split('/').pop() || 'Book').replace(/\.[^.]*$/, '');
      hlStatus('Asking BookOrbit...');
      const entries = [];
      let first = true;
      let complete = false;
      for (let page = 0; page < 30; page++) {
        const book = { hash, keys: [], keysComplete: false, sidecarState: first ? 'new' : 'known', changes: [] };
        const r = await postJson('annotations/exchange', Object.assign(deviceInfo(), { books: [book] }));
        first = false;
        if (!(r.status >= 200 && r.status < 300) || !r.data) return hlStatus('BookOrbit answered ' + r.status + '.', true);
        if ((r.data.unmatched || []).length) return hlStatus('BookOrbit does not have this exact file.', true);
        if ((r.data.positionIncompatible || []).length) {
          return hlStatus('BookOrbit has this book, but the file differs from its copy, so highlights will not sync.', true);
        }
        const result = (r.data.results || [])[0] || {};
        const adds = ((result.toApply || {}).add) || [];
        entries.push(...adds);
        if (adds.length) {
          await postJson('annotations/exchange-ack', Object.assign(deviceInfo(), { books: [{
            hash, deleted: [],
            applied: adds.map((a) => ({ serverId: a.serverId, version: a.version, status: 'applied' }))
          }] }));
        }
        if (!result.more || !adds.length) { complete = true; break; }
        hlStatus('Asking BookOrbit... (' + entries.length + ' so far)');
      }
      entries.sort((x, y) => (x.pageno || 0) - (y.pageno || 0) || String(x.datetime).localeCompare(String(y.datetime)));
      if (!entries.length) return hlStatus('BookOrbit has no highlights for this book yet.', false, false, true);
      pulled = { entries, complete, info: { title, author }, path };
      renderPulled();
      syncActions();
      await findStrays();
      hlStatus('Got ' + entries.length + ' highlight' + (entries.length === 1 ? '' : 's') + ' from BookOrbit. ' +
        'Add to reader puts them in the reader\'s own highlights for the book.', false, true);
    } catch (e) {
      hlStatus('Could not finish: ' + whyFailed(e), true);
    } finally {
      $('bo-hl-check').disabled = $('bo-hl-send').disabled = $('bo-hl-pull').disabled = false;
      syncActions();
    }
  }

  const toBase64 = (bytes) => { let bin = ''; for (const byte of bytes) bin += String.fromCharCode(byte); return btoa(bin); };

  // The same highlight, allowing for small differences in wording or spacing.
  function sameHighlight(a, b) {
    const x = normalizeQuote(a);
    const y = normalizeQuote(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const short = x.length < y.length ? x : y;
    const long = x.length < y.length ? y : x;
    return short.length >= 30 && long.includes(short);
  }

  // The reader's own highlight file for a book. store is null when the reader has none.
  async function loadStore(bookPath) {
    const storePath = clippingStorePath(bookPath);
    const response = await fetch('/download?path=' + encodeURIComponent(storePath));
    if (response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { path: storePath, bytes, store: parseStore(bytes) };
    }
    if (response.status !== 404) throw new Error('could not read the reader\'s highlight file (' + response.status + '), so nothing was changed');
    return { path: storePath, bytes: null, store: null };
  }

  // Keeps the file as it was before this plugin changes it: one copy per book, in the plugin's folder.
  async function backupStore(storePath, bytes) {
    if (!bytes) return;
    const configPath = await locateConfigPath();
    const dir = configPath.slice(0, configPath.lastIndexOf('/'));
    const written = await api.writeFile(dir + '/backup-' + storePath.split('/').pop(), toBase64(bytes));
    if (written && written.ok === false) throw new Error('could not make a backup copy first, so nothing was changed');
  }

  async function writeStore(loaded, strings, records) {
    await backupStore(loaded.path, loaded.bytes);
    const out = buildStore(strings, records);
    if (out.length > 250 * 1024) throw new Error('the highlight file would be too big for the reader to accept, so nothing was changed');
    const written = await api.writeFile(loaded.path, toBase64(out));
    if (written && written.ok === false) throw new Error(written.error || 'the reader could not write the file');
  }

  // BookOrbit is where highlights are kept. The reader's own file is the list of what is on the reader
  // now: /My Clippings.txt only ever grows, so a highlight deleted on the reader still sits in it.
  async function stillOnReader(bookPath, entries) {
    try {
      const { store } = await loadStore(bookPath);
      if (!store) return { entries, gone: 0 };
      const kept = entries.filter((c) => store.records.some((r) => sameHighlight(c.text, r.text)));
      return { entries: kept, gone: entries.length - kept.length };
    } catch (e) {
      return { entries, gone: 0 };
    }
  }

  // /My Clippings.txt is only written when a highlight is made on the reader, so highlights added by
  // this plugin (or a clippings file that was deleted) are missing from it. The reader's own file is
  // the full list, so anything in it that /My Clippings.txt lacks is added here, with no page number.
  async function withStoreHighlights(bookPath, entries, title) {
    try {
      const { store } = await loadStore(bookPath);
      if (!store) return entries;
      const extra = store.records.filter((r) => r.text && !entries.some((c) => sameHighlight(c.text, r.text)))
        .map((r) => {
          const d = r.timestamp ? new Date(r.timestamp * 1000) : null;
          const p = (n) => String(n).padStart(2, '0');
          return { title, author: '', page: 0, chapter: r.chapter || '', text: r.text,
            datetime: d ? d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) : null };
        });
      return entries.concat(extra);
    } catch (e) {
      return entries;
    }
  }

  // ---- Highlights on the reader that BookOrbit does not have ------------------------------------
  // Shown after a pull. BookOrbit is the source of truth, so these can be removed from the reader.
  let strays = null; // { path, items: [{ key, text, chapter }], note }
  let armed = null;  // the delete button that has been pressed once and waits for a second press

  const recordKey = (r) => toBase64(r.raw);

  async function findStrays() {
    strays = null;
    armed = null;
    if (!pulled) return renderStrays();
    if (!pulled.complete) {
      strays = { path: pulled.path, items: [], synced: 0, note: 'BookOrbit has more highlights than could be listed, so the reader\'s cannot be compared safely.' };
      return renderStrays();
    }
    try {
      const { store } = await loadStore(pulled.path);
      const records = store ? store.records : [];
      const alone = records.filter((r) => !pulled.entries.some((e) => sameHighlight(e.text, r.text)));
      strays = {
        path: pulled.path,
        items: alone.filter((r) => !r.synced).map((r) => ({ key: recordKey(r), text: r.text, chapter: r.chapter })),
        synced: alone.filter((r) => r.synced).length
      };
    } catch (e) {
      strays = { path: pulled.path, items: [], synced: 0, note: 'Could not compare with the highlights on the reader: ' + whyFailed(e) };
    }
    renderStrays();
  }

  function renderStrays() {
    const box = $('bo-hl-strays');
    if (!strays) { box.innerHTML = ''; return; }
    const button = (act, id, label) => '<button type="button" data-act="' + act + '" data-id="' + escapeHtml(id) + '">' +
      escapeHtml(armed === act + ':' + id ? 'Click again to delete' : label) + '</button>';
    if (strays.note) { box.innerHTML = '<p style="color:#999">' + escapeHtml(strays.note) + '</p>'; return; }
    const n = strays.items.length;
    if (!n && !strays.synced) { box.innerHTML = '<p style="color:#999">Every highlight on the reader is in BookOrbit.</p>'; return; }
    box.innerHTML = '<div style="margin:16px 0 4px"><strong>On the reader, not in BookOrbit' + (n ? ' (' + n + ')' : '') + '</strong>' +
      (n > 1 ? ' ' + button('all', '', 'Delete all ' + n + ' from the reader') : '') + '</div>' +
      strays.items.map((e, i) =>
        '<div style="border-top:1px solid #555;padding:8px 0">' +
        '<div style="font-size:12px;color:#999">' + escapeHtml(e.chapter || '') + '</div>' +
        '<div>' + escapeHtml(e.text) + '</div>' +
        '<div style="margin-top:4px">' + button('one', String(i), 'Delete from the reader') + '</div></div>').join('') +
      (strays.synced ? '<p style="color:#999">' + strays.synced + ' more ' + (strays.synced === 1 ? 'is' : 'are') +
        ' synced to a CrossPoint sync server and ' + (strays.synced === 1 ? 'has' : 'have') + ' to be deleted on the reader itself.</p>' : '');
  }

  // The reader appends to /My Clippings.txt when a highlight is made on it, and never removes anything.
  // So that the file matches the reader's own highlights for the book, this plugin updates it whenever
  // it changes them: entries for this book whose text is no longer among the reader's highlights are
  // removed, and the given new highlights are added in the reader's own format. Other books are left
  // as they are. A copy of the old file is kept first.
  async function syncClippings(bookPath, newEntries, finalRecords) {
    try {
      const old = await readText('/My Clippings.txt');
      const text = old || '';
      if (text.length > 200 * 1024) return ' /My Clippings.txt was left as it is: it is too big to edit from here.';
      let titles = [];
      try { titles = await bookTitles(await bookBytes(bookPath), bookPath); } catch (e) { titles = [recentTitles[bookPath]].filter(Boolean); }
      if (pulled && pulled.info && pulled.info.title) titles.push(pulled.info.title);
      const mine = (entry) => entry && titles.some((t) => sameTitle(entry.title, t));
      const parts = text ? text.split(/(\r?\n==========\r?\n?)/) : []; // block, separator, block, separator...
      const out = [];
      const kept = [];
      let removed = 0;
      for (let i = 0; i < parts.length; i += 2) {
        const block = parts[i];
        const sep = parts[i + 1] || '';
        const entry = parseClippings(block)[0];
        if (mine(entry) && !finalRecords.some((r) => sameHighlight(entry.text, r.text))) { removed++; continue; }
        if (mine(entry)) kept.push(entry);
        out.push(block + sep);
      }
      const title = recentTitles[bookPath] || titles[0] || '';
      const author = (pulled && pulled.info && pulled.info.author) || '';
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const addedOn = (datetime) => {
        const d = new Date(String(datetime || '').replace(' ', 'T'));
        const when = Number.isNaN(d.getTime()) ? new Date() : d;
        const h = when.getHours() % 12 || 12;
        return 'Added on ' + days[when.getDay()] + ', ' + months[when.getMonth()] + ' ' + when.getDate() + ', ' + when.getFullYear() +
          ', ' + String(h).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0') + ' ' + (when.getHours() >= 12 ? 'PM' : 'AM');
      };
      let added = 0;
      let add = '';
      for (const e of newEntries) {
        const quote = String(e.text || '').trim().slice(0, 2000);
        if (!quote || kept.some((k) => sameHighlight(k.text, quote))) continue;
        add += title + ' (' + author + ')\n- Your Highlight on Page ' + (e.pageno || 1) +
          (e.chapter ? ' | ' + e.chapter : '') + ' | ' + addedOn(e.datetime) + '\n\n' + quote + '\n==========\n';
        added++;
      }
      if (!removed && !added) return '';
      let result = out.join('');
      if (add && result && !/\n$/.test(result)) result += '\n';
      result += add;
      const configPath = await locateConfigPath();
      const dir = configPath.slice(0, configPath.lastIndexOf('/'));
      const b64text = (t) => toBase64(new TextEncoder().encode(t));
      if (old) {
        const saved = await api.writeFile(dir + '/backup-My Clippings.txt', b64text(old));
        if (saved && saved.ok === false) return ' /My Clippings.txt was left as it is: a backup copy could not be made.';
      }
      const written = await api.writeFile('/My Clippings.txt', b64text(result));
      if (written && written.ok === false) return ' /My Clippings.txt could not be updated.';
      const bits = [];
      if (added) bits.push('added ' + added + (added === 1 ? ' entry' : ' entries'));
      if (removed) bits.push('removed ' + removed + (removed === 1 ? ' entry' : ' entries'));
      return ' /My Clippings.txt: ' + bits.join(', ') + '.';
    } catch (e) {
      return ' /My Clippings.txt could not be updated.';
    }
  }

  async function strayClick(ev) {
    const target = ev && ev.target;
    const act = target && target.getAttribute && target.getAttribute('data-act');
    if (!act || !strays || !pulled) return;
    const id = target.getAttribute('data-id') || '';
    if (armed !== act + ':' + id) { armed = act + ':' + id; renderStrays(); return; }
    armed = null;
    const chosen = act === 'all' ? strays.items.slice() : [strays.items[Number(id)]].filter(Boolean);
    if (!chosen.length) return;
    const buttons = ['bo-hl-check', 'bo-hl-send', 'bo-hl-pull', 'bo-hl-add'];
    buttons.forEach((b) => { $(b).disabled = true; });
    try {
      const loaded = await loadStore(strays.path);
      if (!loaded.store) throw new Error('the reader has no highlight file for this book any more');
      const wanted = new Map();
      chosen.forEach((c) => wanted.set(c.key, (wanted.get(c.key) || 0) + 1));
      const kept = [];
      let removed = 0;
      for (const r of loaded.store.records) {
        const key = recordKey(r);
        if (!r.synced && wanted.get(key) > 0) { wanted.set(key, wanted.get(key) - 1); removed++; } else kept.push(r);
      }
      if (!removed) {
        hlStatus('Those highlights are already gone from the reader.', false, false, true);
      } else {
        await writeStore(loaded, loaded.store.strings, kept);
        const tidy = await syncClippings(strays.path, [], kept);
        hlStatus('Deleted ' + removed + ' highlight' + (removed === 1 ? '' : 's') + ' from the reader.' + tidy + ' BookOrbit was not changed.', false, true);
      }
      await findStrays();
    } catch (e) {
      hlStatus('Could not delete: ' + whyFailed(e), true);
    } finally {
      ['bo-hl-check', 'bo-hl-send', 'bo-hl-pull'].forEach((b) => { $(b).disabled = false; });
      syncActions();
    }
  }

  // Puts the pulled highlights into the reader's own highlight file for the book, so they are drawn
  // in the book and listed in its highlights menu. Highlights already there are never changed.
  async function addToReaderAction() {
    if (!pulled) return hlStatus('Pull the highlights first.', true);
    const buttons = ['bo-hl-check', 'bo-hl-send', 'bo-hl-pull', 'bo-hl-add'];
    buttons.forEach((id) => { $(id).disabled = true; });
    const keep = pulled;
    try {
      const bytes = await bookBytes(keep.path);
      const book = await openBook(bytes, (n, of) => hlStatus('Reading the book (' + n + ' of ' + of + ')...'));
      hlStatus('Reading the reader\'s highlights for this book...');
      const loaded = await loadStore(keep.path);
      let store = loaded.store;
      if (!store) {
        const enc = new TextEncoder();
        store = { strings: [enc.encode(keep.info.title || ''), enc.encode(keep.info.author || ''), enc.encode(keep.path)], records: [] };
      }
      const seen = new Set(store.records.map((r) => normalizeQuote(r.text)));
      // The same passage counts as already there even if its wording differs a little (curly quotes,
      // spacing): any highlight in the same chapter that covers at least half of it is the same one.
      const taken = store.records.map((r) => ({ spine: r.spine, start: r.start, end: r.end }));
      const overlaps = (spot) => taken.some((t) => {
        if (t.spine !== spot.index) return false;
        const shared = Math.min(t.end, spot.end) - Math.max(t.start, spot.start);
        return shared > 0 && shared * 2 >= Math.min(t.end - t.start, spot.end - spot.start);
      });
      const fresh = [];
      const freshEntries = [];
      const count = { have: 0, missing: 0, ambiguous: 0, full: 0 };
      for (let i = 0; i < keep.entries.length; i++) {
        const entry = keep.entries[i];
        hlStatus('Finding highlight ' + (i + 1) + ' of ' + keep.entries.length + ' in the book...');
        const text = String(entry.text || '').trim();
        if (!text) continue;
        if (seen.has(normalizeQuote(text))) { count.have++; continue; }
        const spot = await placeOnReader(book, entry);
        if (spot.missing) { count.missing++; continue; }
        if (spot.ambiguous) { count.ambiguous++; continue; }
        if (overlaps(spot)) { count.have++; continue; }
        if (store.records.length + fresh.length >= STORE_MAX_RECORDS) { count.full++; continue; }
        const stamp = Date.parse(String(entry.datetime || '').replace(' ', 'T'));
        fresh.push(makeRecord({ spine: spot.index, start: spot.start, end: spot.end, text,
          chapter: entry.chapter, timestamp: Number.isFinite(stamp) ? Math.floor(stamp / 1000) : 0 }));
        freshEntries.push(entry);
        seen.add(normalizeQuote(text));
        taken.push({ spine: spot.index, start: spot.start, end: spot.end });
      }
      const skipped = [];
      if (count.have) skipped.push(count.have + ' already on the reader');
      if (count.missing) skipped.push(count.missing + ' not found in the book text');
      if (count.ambiguous) skipped.push(count.ambiguous + ' skipped because the text appears more than once and BookOrbit gave no exact position');
      if (count.full) skipped.push(count.full + ' skipped because the reader holds at most ' + STORE_MAX_RECORDS + ' highlights per book');
      const tail = skipped.length ? ' Not added: ' + skipped.join(', ') + '.' : '';
      if (!fresh.length) {
        // Nothing to add to the reader, but /My Clippings.txt may still be missing entries for it.
        const clips = await syncClippings(keep.path, keep.entries.filter((e) => store.records.some((r) => sameHighlight(e.text, r.text))), store.records);
        return hlStatus('Nothing new to add to the reader.' + clips + tail, false, false, true);
      }
      store.records.push(...fresh.sort((x, y) => x.spine - y.spine || x.start - y.start));
      await writeStore(loaded, store.strings, store.records);
      const clips = await syncClippings(keep.path, freshEntries, store.records);
      hlStatus('Added ' + fresh.length + ' highlight' + (fresh.length === 1 ? '' : 's') + ' to the reader.' + clips + tail, false, true);
      await findStrays();
    } catch (e) {
      hlStatus('Could not add them: ' + whyFailed(e), true);
    } finally {
      ['bo-hl-check', 'bo-hl-send', 'bo-hl-pull'].forEach((id) => { $(id).disabled = false; });
      syncActions();
    }
  }

  // The reader remembers the books you opened last in /.crosspoint/recent.json (up to 10, finished
  // books drop off). Offering them saves typing a path. The path box stays for anything else.
  const OTHER_BOOK = '__other__';
  const recentTitles = {};
  async function loadRecentBooks() {
    let books = [];
    try {
      const doc = JSON.parse(await readText('/.crosspoint/recent.json'));
      books = (doc && doc.books || []).filter((b) => b && /\.epub$/i.test(String(b.path || '')));
    } catch (e) { books = []; }
    if (!books.length) return;
    for (const b of books) if (b.title) recentTitles[b.path] = b.title;
    $('bo-recent').innerHTML = books.map((b) =>
      '<option value="' + escapeHtml(b.path) + '">' + escapeHtml((b.title || b.path.split('/').pop()) + (b.author ? ' - ' + b.author : '')) + '</option>').join('') +
      '<option value="' + OTHER_BOOK + '">Another book (type its path)...</option>';
    $('bo-recent-row').style.display = '';
    const choose = () => {
      clearList();
      const value = $('bo-recent').value;
      if (value === OTHER_BOOK) { $('bo-book-row').style.display = ''; $('bo-book').value = ''; return; }
      $('bo-book').value = value;
      $('bo-book-row').style.display = 'none';
    };
    $('bo-recent').onchange = choose;
    if (!$('bo-book').value) { $('bo-recent').value = books[0].path; choose(); }
  }
  await loadRecentBooks();

  $('bo-hl-pull').onclick = pullAction;
  $('bo-hl-add').onclick = addToReaderAction;
  $('bo-hl-strays').onclick = strayClick;
  $('bo-hl-check').onclick = () => highlightAction(false);
  $('bo-hl-send').onclick = () => highlightAction(true);

  $('bo-test').onclick = () => run(false);
  $('bo-save').onclick = () => run(true);
  if (restoredFromHold) status('Restored your server address: an earlier version was holding sessions. Press Test connection to check it.', false);
});
