// BookOrbit Reading Log: settings card for the CrossPoint web interface.
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
    return Array.from(opf.getElementsByTagName('itemref')).map((ref) => {
      const href = manifest[ref.getAttribute('idref')];
      return href ? joinPath(dir, href) : null;
    });
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

  // Finds the highlighted text in the book. Returns null when it cannot be found.
  async function locateHighlight(bytes, quote, chapter, progress) {
    const wanted = normalizeQuote(quote);
    if (!wanted) return null;
    const Zip = await ensureJSZip();
    const zip = await Zip.loadAsync(bytes);
    const spine = await readSpine(zip);
    const candidates = [];
    let total = 0;
    for (let i = 0; i < spine.length; i++) {
      if (!spine[i]) continue;
      const file = zip.file(spine[i]);
      if (!file) continue;
      if (progress && i % 10 === 0) progress(i + 1, spine.length);
      const doc = parseMarkup(await file.async('string'));
      const body = doc.getElementsByTagName('body')[0];
      if (!body) continue;
      const indexed = indexText(body);
      let from = 0;
      let first = -1;
      for (;;) {
        const hit = indexed.text.indexOf(wanted, from);
        if (hit < 0) break;
        total++;
        if (first < 0) first = hit;
        from = hit + wanted.length;
      }
      let approx = false;
      if (first < 0 && wanted.length > 60) {
        first = indexed.text.indexOf(wanted.slice(0, 60));
        if (first >= 0) { approx = true; total++; }
      }
      if (first < 0) continue;
      const head = indexed.text.slice(0, 300).toLowerCase();
      const titled = !!chapter && head.includes(String(chapter).split(' | ').pop().toLowerCase());
      candidates.push({ fragment: i + 1, indexed, first, approx, titled });
      if (titled && !approx) break;
    }
    if (!candidates.length) return null;
    const pick = candidates.find((c) => c.titled) || candidates[0];
    const last = Math.min(pick.first + wanted.length, pick.indexed.text.length) - 1;
    const [startNode, startIdx] = pick.indexed.at[pick.first];
    const [endNode, endIdx] = pick.indexed.at[last];
    const endUnit = (endNode.data.codePointAt(endIdx) || 0) > 0xffff ? 2 : 1;
    return {
      pos0: xpointerFor(pick.fragment, startNode, startIdx),
      pos1: xpointerFor(pick.fragment, endNode, endIdx + endUnit),
      fragment: pick.fragment, matches: total, approx: pick.approx, byChapter: pick.titled
    };
  }

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

  container.innerHTML =
    '<details id="bo-panel"><summary style="cursor:pointer">' +
    '<h2 style="display:inline-block;margin:0">BookOrbit Reading Log</h2> ' +
    '<span id="bo-state" style="color:#666;font-size:0.9em"></span></summary>' +
    '<p>Sends your reading sessions to BookOrbit. Use the KOReader sync login ' +
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
    '<details id="bo-hl"><summary style="cursor:pointer"><strong>Highlights (experimental)</strong></summary>' +
    '<p>Sends your most recent highlight from <code>/My Clippings.txt</code> to BookOrbit, as a test. ' +
    'Enter the path of that book\'s EPUB on the SD card. Highlights only sync when the file is ' +
    'identical to the one in BookOrbit. Reading the book file can take a while on the reader.</p>' +
    '<div class="setting-row"><span class="setting-name">Book file</span>' +
    '<span class="setting-control"><input type="text" id="bo-book" autocomplete="off" ' +
    'placeholder="/Books/My Book.epub" style="width:100%"></span></div>' +
    '<div class="setting-row"><span class="setting-control">' +
    '<button type="button" id="bo-hl-check">Check book</button> ' +
    '<button type="button" id="bo-hl-send">Send latest highlight</button></span></div>' +
    '<p id="bo-hl-status" style="color:#666"></p></details>' +
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

  // ---- Highlights (experimental) ------------------------------------------
  const PLUGIN_VERSION = 'crosspoint/0.10.0';

  function hlStatus(message, bad, good) {
    const el = $('bo-hl-status');
    el.textContent = message;
    const color = good ? '#3fb950' : bad ? '#ff6b6b' : '#999';
    el.style.color = color;
    el.style.border = good || bad ? '1px solid ' + color : '1px solid transparent';
    el.style.borderRadius = '6px';
    el.style.padding = '8px 10px';
    el.style.background = good ? 'rgba(63,185,80,0.12)' : bad ? 'rgba(255,107,107,0.12)' : 'transparent';
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
    try {
      const bytes = await bookBytes(path);
      const hash = partialMd5(bytes);
      let entry = null;
      if (send) {
        const clippings = parseClippings(await readText('/My Clippings.txt'));
        if (!clippings.length) throw new Error('no highlights found in /My Clippings.txt');
        entry = clippings[clippings.length - 1];
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
        return hlStatus('BookOrbit has this exact file (hash ' + hash + '). Highlights can sync.', false, true);
      }
      let where = null;
      try {
        where = await locateHighlight(bytes, entry.text, entry.chapter, (n, of) =>
          hlStatus('Looking for the highlight in the book (' + n + ' of ' + of + ')...'));
      } catch (e) {
        where = null;
      }
      const annotation = {
        datetime: entry.datetime || nowDatetime(), drawer: 'lighten', text: entry.text.slice(0, 10000),
        chapter: entry.chapter.slice(0, 500), pageno: entry.page, posFormat: 'xpointer',
        pos0: where ? where.pos0 : '/body/DocFragment[1]/body/text().0'
      };
      if (where) annotation.pos1 = where.pos1;
      const r = await postJson('annotations', Object.assign(deviceInfo(), {
        books: [{ hash, annotations: [annotation] }]
      }));
      if (!(r.status >= 200 && r.status < 300) || !r.data) return hlStatus('BookOrbit answered ' + r.status + '.', true);
      if ((r.data.unmatched || []).length) {
        return hlStatus('BookOrbit does not have this exact file, so the highlight was not stored.', true);
      }
      const upserted = ((r.data.results || [])[0] || {}).upserted || 0;
      const quote = entry.text.length > 70 ? entry.text.slice(0, 70) + '...' : entry.text;
      const note = !where ? 'Could not find the exact spot in the book, so the position is only a placeholder.'
        : 'Found it in section ' + where.fragment + (where.approx ? ' (approximately)' : '') +
          (where.matches > 1 && !where.byChapter ? '; the text appears ' + where.matches + ' times, so check it is the right one' : '') + '.';
      return hlStatus('Sent. BookOrbit stored ' + upserted + ' highlight (' + quote + '). ' + note,
        upserted === 0, upserted > 0);
    } catch (e) {
      hlStatus('Could not finish: ' + (e && e.message ? e.message : e), true);
    } finally {
      $('bo-hl-check').disabled = $('bo-hl-send').disabled = false;
    }
  }

  $('bo-hl-check').onclick = () => highlightAction(false);
  $('bo-hl-send').onclick = () => highlightAction(true);

  $('bo-test').onclick = () => run(false);
  $('bo-save').onclick = () => run(true);
  if (restoredFromHold) status('Restored your server address: an earlier version was holding sessions. Press Test connection to check it.', false);
});
