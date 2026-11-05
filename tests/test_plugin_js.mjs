// Runs plugin.js against a fake DOM/relay: checks the md5 key, the written
// config.json, validation, and the connection-test messages.
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser } from 'linkedom';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'bookorbit-sync.crosspoint-plugin', 'plugin.js'), 'utf8');

async function load({ existing = null, device = null, events = null, relay, files = {}, unreachable = [] }) {
  const els = {};
  const getEl = (id) => (els[id] ||= { id, value: '', placeholder: '', textContent: '', style: {}, disabled: false });
  const document = { getElementById: getEl };
  getEl('bo-book'); // an input the page creates, which tests fill in before any click
  const writes = [];
  const relays = [];
  let register;
  const sandbox = {
    document, TextEncoder, TextDecoder, btoa, console, JSZip, DOMParser, Uint8Array, // same realm as JSZip, as in a browser
    CrossPoint: { registerPlugin: (fn) => { register = fn; } },
    fetch: async (url) => {
      const asked = url.startsWith('/download?path=') ? decodeURIComponent(url.slice('/download?path='.length)) : null;
      if (asked !== null && unreachable.includes(asked)) throw new TypeError('Failed to fetch');
      if (asked !== null && files[asked] !== undefined) {
        const f = files[asked];
        const buf = Buffer.isBuffer(f) ? f : Buffer.from(f, 'utf8');
        return { ok: true, status: 200, text: async () => buf.toString('utf8'),
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
      }
      if (url.includes('events.jsonl')) return { ok: events !== null, text: async () => events };
      const isDev = url.includes('device.json');
      const body = isDev ? device : existing;
      const found = body !== null && (isDev || url.includes('config.json'));
      return { ok: found, status: found ? 200 : 404, text: async () => body };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const host = { children: [{ id: 'hub' }], get firstChild() { return this.children[0]; },
    insertBefore(node, ref) { this.children = [node, ...this.children.filter((c) => c !== node)]; } };
  const container = { parentNode: host };
  host.children.push(container);
  const api = {
    name: 'bookorbit-sync', dir: '/plugins/bookorbit-sync',
    relay: async (m, u, h, b) => { relays.push({ m, u, h, body: b }); return relay(m, u, h, b); },
    writeFile: async (p, b64) => { const bin = Buffer.from(b64, 'base64'); writes.push({ p, text: bin.toString('utf8'), bin }); files[p] = bin; return { ok: true }; }
  };
  await register(container, api);
  return { els, writes, relays, container, host };
}

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const fill = (els, o) => { for (const [k, v] of Object.entries(o)) els['bo-' + k].value = v; };

test('save writes md5 key, normalized server and config path', async () => {
  const pw = 'pässw0rd with spaces ✓';
  const { els, writes, relays } = await load({ relay: async () => ({ status: 200 }) });
  fill(els, { server: '192.168.1.50:3000/', user: 'reader', pass: pw, device: '' });
  await els['bo-save'].onclick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].p, '/plugins/bookorbit-sync/config.json');
  const cfg = JSON.parse(writes[0].text);
  assert.deepEqual(cfg, { server: 'http://192.168.1.50:3000', user: 'reader', key: md5(pw), device_id: 'crosspoint' });
  assert.equal(relays[0].u, 'http://192.168.1.50:3000/api/v1/koreader/users/auth');
  assert.equal(relays[0].h['x-auth-key'], md5(pw));
  assert.match(els['bo-status'].textContent, /^Saved\. Connected/);
  assert.equal(els['bo-pass'].value, '');
});

test('md5 matches node for many lengths (block boundaries)', async () => {
  for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 200]) {
    const pw = 'a'.repeat(n) || 'x';
    const { els, writes } = await load({ relay: async () => ({ status: 200 }) });
    fill(els, { server: 'http://h:1', user: 'u', pass: pw });
    await els['bo-save'].onclick();
    assert.equal(JSON.parse(writes[0].text).key, md5(pw), 'len ' + n);
  }
});

test('falls back to plain password when md5 is rejected', async () => {
  const { els, writes } = await load({ relay: async (m, u, h) => ({ status: h['x-auth-key'] === 'secret' ? 200 : 401 }) });
  fill(els, { server: 'https://b.example.com', user: 'u', pass: 'secret' });
  await els['bo-save'].onclick();
  assert.equal(JSON.parse(writes[0].text).key, 'secret');
});

test('test button never writes; 401 reported', async () => {
  const { els, writes } = await load({ relay: async () => ({ status: 401 }) });
  fill(els, { server: 'http://h:1', user: 'u', pass: 'wrong' });
  await els['bo-test'].onclick();
  assert.equal(writes.length, 0);
  assert.match(els['bo-status'].textContent, /rejected the login/);
  assert.equal(els['bo-test'].disabled, false);
});

test('existing config prefills and blank password keeps saved key', async () => {
  const existing = JSON.stringify({ server: 'http://h:1', user: 'u', key: 'abc123', device_id: 'kobo-1' });
  const { els, writes, relays } = await load({ existing, relay: async () => ({ status: 200 }) });
  assert.equal(els['bo-server'].value, 'http://h:1');
  assert.equal(els['bo-device'].value, 'kobo-1');
  assert.equal(els['bo-pass'].value, '');
  els['bo-user'].value = 'u2';
  await els['bo-save'].onclick();
  const cfg = JSON.parse(writes[0].text);
  assert.equal(cfg.key, 'abc123');
  assert.equal(cfg.user, 'u2');
  assert.equal(relays[0].h['x-auth-key'], 'abc123');
});

test('validation blocks bad input without network or writes', async () => {
  const { els, writes, relays } = await load({ relay: async () => ({ status: 200 }) });
  const bad = [
    [{ server: '', user: 'u', pass: 'p' }, /server URL/],
    [{ server: 'http://h:1', user: '', pass: 'p' }, /username/],
    [{ server: 'http://h:1', user: 'u', pass: '' }, /password/],
    [{ server: 'http://h:1', user: 'u', pass: 'p', device: 'bad name!' }, /Device name/],
    [{ server: 'http://h"x:1', user: 'u', pass: 'p' }, /server URL/]
  ];
  for (const [vals, re] of bad) {
    fill(els, { server: '', user: '', pass: '', device: '', ...vals });
    await els['bo-save'].onclick();
    assert.match(els['bo-status'].textContent, re);
  }
  assert.equal(writes.length, 0);
  assert.equal(relays.length, 0);
});

test('written JSON is safe for device.json templates (no quotes/backslashes injected)', async () => {
  const { els, writes } = await load({ relay: async () => ({ status: 200 }) });
  fill(els, { server: 'http://h:1/api/v1/koreader', user: 'u"x', pass: 'p' });
  await els['bo-save'].onclick();
  assert.equal(writes.length, 1);
  const cfg = JSON.parse(writes[0].text);
  assert.equal(cfg.server, 'http://h:1');
});

test('relay failure still saves but reports the problem', async () => {
  const { els, writes } = await load({ relay: async () => { throw new Error('timeout'); } });
  fill(els, { server: 'http://h:1', user: 'u', pass: 'p' });
  await els['bo-save'].onclick();
  assert.equal(writes.length, 1);
  assert.match(els['bo-status'].textContent, /Saved, but: .*timeout/);
});

const DEVICE = fs.readFileSync(path.join(here, '..', 'bookorbit-sync.crosspoint-plugin', 'device.json'), 'utf8');

test('shipped device.json does not connect at sleep by default', () => {
  const d = JSON.parse(DEVICE);
  assert.equal(d.events['reader.session'].connect, undefined);
});

test('sleep checkbox reflects device.json and toggling rewrites only that flag', async () => {
  const { els, writes } = await load({ device: DEVICE, relay: async () => ({ status: 200 }) });
  assert.equal(els['bo-sleep'].checked, false);
  fill(els, { server: 'http://h:1', user: 'u', pass: 'p' });
  await els['bo-save'].onclick();
  assert.equal(writes.length, 1, 'device.json untouched when the mode did not change');
  els['bo-sleep'].checked = true;
  await els['bo-save'].onclick();
  const dev = writes.find((w) => w.p.endsWith('/device.json'));
  assert.equal(dev.p, '/plugins/bookorbit-sync/device.json');
  const next = JSON.parse(dev.text);
  assert.equal(next.events['reader.session'].connect, true);
  const orig = JSON.parse(DEVICE);
  delete next.events['reader.session'].connect;
  assert.deepEqual(next, orig);
  assert.match(els['bo-status'].textContent, /Restart the reader/);
});

test('turning sleep delivery off removes the flag again', async () => {
  const on = JSON.parse(DEVICE); on.events['reader.session'].connect = true;
  const { els, writes } = await load({ device: JSON.stringify(on), relay: async () => ({ status: 200 }) });
  assert.equal(els['bo-sleep'].checked, true);
  fill(els, { server: 'http://h:1', user: 'u', pass: 'p' });
  els['bo-sleep'].checked = false;
  await els['bo-save'].onclick();
  const dev = writes.find((w) => w.p.endsWith('/device.json'));
  assert.equal(JSON.parse(dev.text).events['reader.session'].connect, undefined);
});

test('missing device.json disables the checkbox and still saves config', async () => {
  const { els, writes } = await load({ relay: async () => ({ status: 200 }) });
  assert.equal(els['bo-sleep'].disabled, true);
  fill(els, { server: 'http://h:1', user: 'u', pass: 'p' });
  await els['bo-save'].onclick();
  assert.equal(writes.length, 1);
});

test('card moves above other plugins on the page', async () => {
  const { host, container } = await load({ relay: async () => ({ status: 200 }) });
  assert.equal(host.children[0], container);
});

test('panel is open for first setup and collapsed when already configured', async () => {
  const fresh = await load({ relay: async () => ({ status: 200 }) });
  assert.equal(fresh.els['bo-panel'].open, true);
  assert.match(fresh.els['bo-state'].textContent, /not set up/);
  const existing = JSON.stringify({ server: 'http://h:1', user: 'u', key: 'abc', device_id: 'x' });
  const set = await load({ existing, relay: async () => ({ status: 200 }) });
  assert.equal(set.els['bo-panel'].open, false);
  assert.match(set.els['bo-state'].textContent, /set up: http:\/\/h:1/);
});

test('clean save collapses the panel; a failed login keeps it open', async () => {
  const ok = await load({ relay: async () => ({ status: 200 }) });
  fill(ok.els, { server: 'http://h:1', user: 'u', pass: 'p' });
  await ok.els['bo-save'].onclick();
  assert.equal(ok.els['bo-panel'].open, false);
  assert.match(ok.els['bo-state'].textContent, /saved, connected/);
  const bad = await load({ relay: async () => ({ status: 401 }) });
  fill(bad.els, { server: 'http://h:1', user: 'u', pass: 'p' });
  await bad.els['bo-save'].onclick();
  assert.notEqual(bad.els['bo-panel'].open, false);
});

test('changing the sleep setting keeps the panel open so the restart note stays visible', async () => {
  const { els } = await load({ device: DEVICE, relay: async () => ({ status: 200 }) });
  fill(els, { server: 'http://h:1', user: 'u', pass: 'p' });
  els['bo-sleep'].checked = true;
  await els['bo-save'].onclick();
  assert.notEqual(els['bo-panel'].open, false);
  assert.match(els['bo-status'].textContent, /Restart/);
});

test('status box is green after a successful test and red after a failure', async () => {
  const ok = await load({ relay: async () => ({ status: 200 }) });
  fill(ok.els, { server: 'http://h:1', user: 'u', pass: 'p' });
  await ok.els['bo-test'].onclick();
  assert.equal(ok.els['bo-status'].style.color, '#3fb950');
  assert.match(ok.els['bo-status'].style.border, /#3fb950/);
  const bad = await load({ relay: async () => ({ status: 401 }) });
  fill(bad.els, { server: 'http://h:1', user: 'u', pass: 'p' });
  await bad.els['bo-test'].onclick();
  assert.equal(bad.els['bo-status'].style.color, '#ff6b6b');
});

const evLine = (startSec, dur = 600, s = 1000, e = 1500) => JSON.stringify({ e: 'reader.session', id: 'a-1', ts: startSec,
  vars: { book: '/b.epub', document: 'a'.repeat(32), start_time: String(startSec), end_time: String(startSec + dur),
    duration_seconds: String(dur), start_progress_bp: String(s), end_progress_bp: String(e), progress_scale: '10000' } });

test('shipped device.json shows a toast after a session is sent', () => {
  assert.match(JSON.parse(DEVICE).events['reader.session'].toast, /BookOrbit/);
});

test('shipped device.json stamps sessions from the firmware start and end times', () => {
  const body = JSON.parse(DEVICE).events['reader.session'].request.body;
  assert.match(body, /"startTime":\{event\.start_time\}.*"startTime":\{event\.end_time\}/);
  assert.ok(!body.includes('{event.ts}'));
});


test('a hold left by an earlier version is undone so sessions are not blocked', async () => {
  const held = JSON.stringify({ server: 'http://127.0.0.1:9', server_real: 'http://books.example:3000', hold: '1',
    user: 'u', key: 'abc', device_id: 'x' });
  const { els, writes, relays } = await load({ existing: held, relay: async () => ({ status: 200 }) });
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].text), { server: 'http://books.example:3000', user: 'u', key: 'abc', device_id: 'x' });
  assert.equal(els['bo-server'].value, 'http://books.example:3000');
  assert.match(els['bo-status'].textContent, /Restored your server address/);
  assert.equal(relays.length, 0);
});

test('the card no longer has hold, time source or queue controls', async () => {
  const { els } = await load({ device: DEVICE, relay: async () => ({ status: 200 }) });
  for (const id of ['bo-hold', 'bo-time', 'bo-refresh', 'bo-queue']) assert.equal(els[id], undefined, id);
});


// ---- Highlights ---------------------------------------------
const CONFIG = JSON.stringify({ server: 'http://h:1', user: 'u', key: 'k', device_id: 'x4pro' });
const rec = (p, title) => JSON.stringify({ books: [{ path: p, title, author: '', coverBmpPath: '' }] });
const CLIPS = [
  'Dune (Frank Herbert)\n- Your Highlight on Page 12 | Book One | Added on Monday, November 2, 2026, 09:05 AM\n\nFirst quote\n==========\n',
  'Dune (Frank Herbert)\n- Your Highlight on Page 40 | Part 2 | The Gom Jabbar | Added on Tuesday, November 3, 2026, 04:12 PM\n\nFear is the mind-killer.\nSecond line.\n==========\n'
].join('');

function refPartialMd5(buf) {
  const parts = [];
  for (let i = -1; i <= 10; i++) {
    const off = i < 0 ? 0 : 1024 * 4 ** i;
    if (off >= buf.length) continue;
    parts.push(buf.subarray(off, Math.min(off + 1024, buf.length)));
  }
  return crypto.createHash('md5').update(Buffer.concat(parts)).digest('hex');
}

test('highlights: book hash matches KOReader partial md5 for many sizes', async () => {
  for (const n of [10, 1024, 1025, 4097, 20000, 70000, 2000000]) {
    const epub = crypto.randomBytes(n);
    const { els, relays } = await load({
      existing: CONFIG, files: { '/Books/b.epub': epub },
      relay: async () => ({ status: 200, body: JSON.stringify({ matches: [{ hash: 'x', bookId: 1, bookFileId: 2 }], libraryVersion: 'v' }) })
    });
    els['bo-book'].value = '/Books/b.epub';
    await els['bo-hl-check'].onclick();
    const body = JSON.parse(relays[0].body);
    assert.deepEqual(body.hashes, [refPartialMd5(epub)], 'size ' + n);
    assert.match(els['bo-hl-status'].textContent, /BookOrbit has this exact file/);
  }
});

test('highlights: sends the book\'s highlights with hash, page, chapter and time', async () => {
  const epub = crypto.randomBytes(30000);
  const { els, relays } = await load({
    existing: CONFIG, files: { '/Books/b.epub': epub, '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec('/Books/b.epub', 'Dune') },
    relay: async () => ({ status: 200, body: JSON.stringify({ results: [{ hash: 'h', upserted: 1 }], unmatched: [] }) })
  });
  els['bo-book'].value = '/Books/b.epub';
  await els['bo-hl-send'].onclick();
  const call = relays.find((r) => r.u.endsWith('/annotations'));
  assert.equal(call.u, 'http://h:1/api/v1/koreader/plugin/annotations');
  assert.equal(call.h['x-auth-key'], 'k');
  const body = JSON.parse(call.body);
  assert.equal(body.deviceId, 'x4pro');
  assert.ok(body.pluginVersion.length <= 20);
  assert.equal(body.books[0].hash, refPartialMd5(epub));
  assert.equal(body.books[0].annotations.length, 2);
  const a = body.books[0].annotations[1];
  assert.equal(a.text, 'Fear is the mind-killer.\nSecond line.');
  assert.equal(a.pageno, 40);
  assert.equal(a.chapter, 'Part 2 | The Gom Jabbar');
  assert.equal(a.datetime, '2026-11-03 16:12:00');
  assert.equal(a.drawer, 'lighten');
  assert.equal(a.posFormat, 'xpointer');
  assert.match(a.pos0, /^\/body\/DocFragment\[1\]/);
  assert.match(body.deviceTime, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  assert.match(els['bo-hl-status'].textContent, /^Sent\./);
});

test('highlights: 12 AM / 12 PM and a missing "Added on" are handled', async () => {
  const mk = (when) => 'B (A)\n- Your Highlight on Page 1' + when + '\n\nq\n==========\n';
  for (const [clip, expect] of [
    [mk(' | Added on Friday, January 5, 2026, 12:30 AM'), '2026-01-05 00:30:00'],
    [mk(' | Added on Friday, January 5, 2026, 12:30 PM'), '2026-01-05 12:30:00'],
    [mk(''), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/]
  ]) {
    const { els, relays } = await load({
      existing: CONFIG, files: { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': clip, '/.crosspoint/recent.json': rec('/b.epub', 'B') },
      relay: async () => ({ status: 200, body: JSON.stringify({ results: [{ hash: 'h', upserted: 1 }], unmatched: [] }) })
    });
    els['bo-book'].value = '/b.epub';
    await els['bo-hl-send'].onclick();
    const dt = JSON.parse(relays[0].body).books[0].annotations[0].datetime;
    if (expect instanceof RegExp) assert.match(dt, expect); else assert.equal(dt, expect);
  }
});

test('highlights: clear messages for the failure cases', async () => {
  const ok = { status: 200, body: JSON.stringify({ results: [], unmatched: ['h'] }) };
  const cases = [
    [{ existing: null, files: {}, relay: async () => ok }, '/b.epub', /Save the server and login/],
    [{ existing: CONFIG, files: {}, relay: async () => ok }, 'b.epub', /starting with \//],
    [{ existing: CONFIG, files: {}, relay: async () => ok }, '/nope.epub', /could not read \/nope\.epub/],
    [{ existing: CONFIG, files: { '/b.epub': Buffer.from('a') }, relay: async () => ok }, '/b.epub', /no highlights found/],
    [{ existing: CONFIG, files: { '/b.epub': Buffer.from('a'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec('/b.epub', 'Dune') }, relay: async () => ok }, '/b.epub', /does not have this exact file/],
    [{ existing: CONFIG, files: { '/b.epub': Buffer.from('a'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec('/b.epub', 'Dune') }, relay: async () => ({ status: 401, body: '' }) }, '/b.epub', /answered 401/]
  ];
  for (const [opts, bookPath, re] of cases) {
    const { els } = await load(opts);
    els['bo-book'].value = bookPath;
    await els['bo-hl-send'].onclick();
    assert.match(els['bo-hl-status'].textContent, re);
    assert.equal(els['bo-hl-send'].disabled, false);
  }
});

test('highlights: check book reports a differing copy and an unknown file', async () => {
  const run = async (data) => {
    const { els } = await load({
      existing: CONFIG, files: { '/b.epub': Buffer.from('abc') },
      relay: async () => ({ status: 200, body: JSON.stringify(data) })
    });
    els['bo-book'].value = '/b.epub';
    await els['bo-hl-check'].onclick();
    return els['bo-hl-status'].textContent;
  };
  assert.match(await run({ matches: [], libraryVersion: 'v' }), /does not have this exact file/);
  assert.match(await run({ matches: [{ hash: 'h', bookId: 1, bookFileId: 2, positionCompatible: false }], libraryVersion: 'v' }), /differs from its copy/);
});

test('highlights: BookOrbit answers POSTs with 201 Created, which counts as success', async () => {
  const { els } = await load({
    existing: CONFIG, files: { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec('/b.epub', 'Dune') },
    relay: async (m, u) => ({ status: 201, body: JSON.stringify(u.endsWith('/annotations')
      ? { results: [{ hash: 'h', upserted: 1 }], unmatched: [] }
      : { matches: [{ hash: 'h', bookId: 1, bookFileId: 2 }], libraryVersion: 'v' }) })
  });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-check'].onclick();
  assert.match(els['bo-hl-status'].textContent, /Highlights can sync/);
  await els['bo-hl-send'].onclick();
  assert.match(els['bo-hl-status'].textContent, /^Sent\./);
});


// ---- Locating a highlight inside the EPUB -----------------------------------
const XHTML = (title, body) => '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml">' +
  '<head><title>' + title + '</title><style>p{}</style></head><body>' + body + '</body></html>';

async function makeEpub(chapters) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const items = chapters.map((c, i) => '<item id="c' + i + '" href="text/' + c.name + '" media-type="application/xhtml+xml"/>').join('');
  const refs = chapters.map((c, i) => '<itemref idref="c' + i + '"/>').join('');
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0">' +
    '<manifest>' + items + '</manifest><spine>' + refs + '</spine></package>');
  for (const c of chapters) zip.file('OEBPS/text/' + c.name, c.xhtml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// Follows a KOReader-style position through the real chapter markup, like a reader would.
function resolveXPointer(xhtml, xp) {
  const m = /^\/body\/DocFragment\[(\d+)\]\/body((?:\/[a-z0-9]+\[\d+\])*)\/text\(\)\[(\d+)\]\.(\d+)$/.exec(xp);
  assert.ok(m, 'unexpected position format: ' + xp);
  const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml');
  let el = doc.getElementsByTagName('body')[0];
  for (const seg of m[2].split('/').filter(Boolean)) {
    const [, name, n] = /^([a-z0-9]+)\[(\d+)\]$/.exec(seg);
    el = Array.from(el.childNodes).filter((c) => c.nodeType === 1 && c.localName === name)[Number(n) - 1];
    assert.ok(el, 'no element for ' + seg);
  }
  const texts = Array.from(el.childNodes).filter((c, pos) => c.nodeType === 3 && c.data.length && !(pos === 0 && /^\s*$/.test(c.data)));
  const node = texts[Number(m[3]) - 1];
  assert.ok(node, 'no text node ' + m[3]);
  return Array.from(node.data).slice(Number(m[4])).join('');
}

const CH_ONE = XHTML('One', '<h1>Chapter One</h1><p>Opening words.</p>');
const CH_TWO = XHTML('Two', '<h1>Chapter Two</h1><div class="a"><p>First para.</p>' +
  '<p>We ended up <i>hiring</i> five mercenaries. Then more text.</p></div>');
const CH_THREE = XHTML('Three', '<h1>Chapter Three</h1><section><p>Unrelated.</p><p>We ended up hiring five mercenaries.</p></section>' +
  '<p>caf\u00e9 \ud83d\ude00   na\u00efve\n   line end</p>');

async function sendFor(quote, chapter, chapters) {
  const epub = await makeEpub(chapters);
  const clip = 'Book (Auth)\n- Your Highlight on Page 3 | ' + chapter + ' | Added on Tuesday, November 3, 2026, 04:12 PM\n\n' + quote + '\n==========\n';
  const { els, relays } = await load({
    existing: CONFIG, files: { '/b.epub': epub, '/My Clippings.txt': clip, '/.crosspoint/recent.json': rec('/b.epub', 'Book') },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', upserted: 1 }], unmatched: [] }) })
  });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-send'].onclick();
  const body = JSON.parse(relays.find((r) => r.u.endsWith('/annotations')).body);
  return { a: body.books[0].annotations[0], status: els['bo-hl-status'].textContent };
}

const CHAPTERS = [{ name: 'one.xhtml', xhtml: CH_ONE }, { name: 'two.xhtml', xhtml: CH_TWO }, { name: 'three.xhtml', xhtml: CH_THREE }];

test('highlight position: text spanning inline markup gets exact start and end positions', async () => {
  const { a, status } = await sendFor('We ended up hiring five mercenaries.', 'Chapter Two', CHAPTERS.slice(0, 2));
  assert.equal(a.pos0, '/body/DocFragment[2]/body/div[1]/p[2]/text()[1].0');
  assert.equal(a.pos1, '/body/DocFragment[2]/body/div[1]/p[2]/text()[2].18');
  assert.equal(resolveXPointer(CH_TWO, a.pos0).slice(0, 12), 'We ended up ');
  assert.match(status, /1 of 1 found in the book/);
  assert.doesNotMatch(status, /more than once/);
});

test('highlight position: a repeated quote prefers the chapter named in the clipping', async () => {
  const two = await sendFor('We ended up hiring five mercenaries.', 'Chapter Two', CHAPTERS);
  assert.match(two.a.pos0, /^\/body\/DocFragment\[2\]\//);
  assert.doesNotMatch(two.status, /more than once/);
  const three = await sendFor('We ended up hiring five mercenaries.', 'Chapter Three', CHAPTERS);
  assert.equal(three.a.pos0, '/body/DocFragment[3]/body/section[1]/p[2]/text()[1].0');
  assert.equal(resolveXPointer(CH_THREE, three.a.pos0), 'We ended up hiring five mercenaries.');
  assert.doesNotMatch(three.status, /more than once/);
  // no chapter to go by: take the first one and warn that the text repeats
  const unknown = await sendFor('We ended up hiring five mercenaries.', 'Some other title', CHAPTERS);
  assert.match(unknown.a.pos0, /^\/body\/DocFragment\[2\]\//);
  assert.match(unknown.status, /more than once/);
});

test('highlight position: whitespace, accents and emoji (UTF-16 pairs) are handled', async () => {
  const { a } = await sendFor('caf\u00e9 \ud83d\ude00 na\u00efve line', 'Chapter Three', CHAPTERS);
  assert.equal(a.pos0, '/body/DocFragment[3]/body/p[1]/text()[1].0');
  assert.match(resolveXPointer(CH_THREE, a.pos0), /^caf\u00e9 \ud83d\ude00/);
  assert.match(a.pos1, /text\(\)\[1\]\.\d+$/);
  // end is in codepoints: "café 😀   naïve\n   line" up to and including "line" is 4+1+1+1... check against the source text
  const endOffset = Number(/\.(\d+)$/.exec(a.pos1)[1]);
  const src = 'caf\u00e9 \ud83d\ude00   na\u00efve\n   line end';
  assert.equal(Array.from(src).slice(0, endOffset).join('').trimEnd().endsWith('line'), true);
});

test('highlight position: text that is not in the book falls back to a placeholder and says so', async () => {
  const { a, status } = await sendFor('A sentence the book does not contain.', 'Chapter Two', CHAPTERS);
  assert.equal(a.pos0, '/body/DocFragment[1]/body/text().0');
  assert.equal(a.pos1, undefined);
  assert.match(status, /placeholder/);
});

test('highlights: every highlight of the book is sent in one request, other books are left out', async () => {
  const chapters = [{ name: 'one.xhtml', xhtml: XHTML('One', '<h1>Chapter One</h1><p>Alpha beta gamma.</p><p>Delta epsilon.</p>') },
    { name: 'two.xhtml', xhtml: XHTML('Two', '<h1>Chapter Two</h1><p>Alpha beta gamma.</p><p>Zeta eta theta.</p>') }];
  const epub = await makeEpub(chapters);
  const opfTitle = 'The Real Title';
  const zip = await JSZip.loadAsync(epub);
  const opf = await zip.file('OEBPS/content.opf').async('string');
  zip.file('OEBPS/content.opf', opf.replace('<manifest>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + opfTitle + '</dc:title></metadata><manifest>'));
  const titled = await zip.generateAsync({ type: 'nodebuffer' });
  const clip = (title, page, chap, text, min) => title + ' (Au)\n- Your Highlight on Page ' + page + ' | ' + chap +
    ' | Added on Tuesday, November 3, 2026, 04:' + min + ' PM\n\n' + text + '\n==========\n';
  const clips = clip('The Real Title', 1, 'Chapter One', 'Delta epsilon.', '10') +
    clip('Other Book', 9, 'X', 'Zeta eta theta.', '11') +
    clip('The Real Title', 2, 'Chapter Two', 'Alpha beta gamma.', '12') +
    clip('The Real Title', 3, 'Chapter Two', 'Not in the book at all', '13');
  const { els, relays } = await load({
    existing: CONFIG, files: { '/b.epub': titled, '/My Clippings.txt': clips },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', upserted: 3 }], unmatched: [] }) })
  });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-send'].onclick();
  const sent = relays.filter((r) => r.u.endsWith('/annotations'));
  assert.equal(sent.length, 1);
  const anns = JSON.parse(sent[0].body).books[0].annotations;
  assert.deepEqual(anns.map((a) => a.text), ['Delta epsilon.', 'Alpha beta gamma.', 'Not in the book at all']);
  assert.match(anns[0].pos0, /^\/body\/DocFragment\[1\]\/body\/p\[2\]\/text\(\)\[1\]\.0$/);
  assert.match(anns[1].pos0, /^\/body\/DocFragment\[2\]\//, 'chapter title picks the second occurrence');
  assert.equal(anns[2].pos0, '/body/DocFragment[1]/body/text().0');
  const msg = els['bo-hl-status'].textContent;
  assert.match(msg, /^Sent\. 3 new\. 2 of 3 found in the book, 1 could not be found/);
  assert.doesNotMatch(msg, /did not match/);
});

test('highlights: a book with no highlights of its own sends nothing, even when other books have highlights', async () => {
  const withTitle = async (title) => {
    const plain = await JSZip.loadAsync(await makeEpub(CHAPTERS));
    const opf = await plain.file('OEBPS/content.opf').async('string');
    plain.file('OEBPS/content.opf', opf.replace('<manifest>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + title + '</dc:title></metadata><manifest>'));
    return plain.generateAsync({ type: 'nodebuffer' });
  };
  const clips = 'Other Book (A)\n- Your Highlight on Page 1 | Chapter One | Added on Tuesday, November 3, 2026, 04:12 PM\n\nOpening words.\n==========\n';
  for (const files of [
    { '/b.epub': await withTitle('Some Other Title'), '/My Clippings.txt': clips },               // title from the EPUB
    { '/b.epub': Buffer.from('not an epub'), '/My Clippings.txt': clips, '/.crosspoint/recent.json': rec('/b.epub', 'The Gate') }, // title from the recent list
    { '/b.epub': Buffer.from('not an epub'), '/My Clippings.txt': clips }                         // no title at all
  ]) {
    const { els, relays } = await load({ existing: CONFIG, files, relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', upserted: 1 }], unmatched: [] }) }) });
    els['bo-book'].value = '/b.epub';
    await els['bo-hl-send'].onclick();
    assert.equal(relays.filter((r) => r.u.endsWith('/annotations')).length, 0, 'nothing is sent');
    assert.match(els['bo-hl-status'].textContent, /nothing was sent/);
    assert.equal(els['bo-hl-status'].style.color, '#f0a030');
  }
});

test('highlights: the title from the recent list finds highlights when the EPUB has no title', async () => {
  const clips = 'My Book (A)\n- Your Highlight on Page 1 | Chapter One | Added on Tuesday, November 3, 2026, 04:12 PM\n\nOpening words.\n==========\n' +
    'Another (A)\n- Your Highlight on Page 2 | X | Added on Tuesday, November 3, 2026, 04:13 PM\n\nSomething else.\n==========\n';
  const { els, relays } = await load({
    existing: CONFIG, files: { '/b.epub': await makeEpub(CHAPTERS), '/My Clippings.txt': clips, '/.crosspoint/recent.json': rec('/b.epub', 'My Book') },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', upserted: 1 }], unmatched: [] }) })
  });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-send'].onclick();
  const anns = JSON.parse(relays.find((r) => r.u.endsWith('/annotations')).body).books[0].annotations;
  assert.deepEqual(anns.map((a) => a.text), ['Opening words.']);
});

test('highlights: when everything is already in BookOrbit the box is orange, not red', async () => {
  const { els } = await load({
    existing: CONFIG, files: { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec('/b.epub', 'Dune') },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', upserted: 0 }], unmatched: [] }) })
  });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-send'].onclick();
  const box = els['bo-hl-status'];
  assert.match(box.textContent, /^Nothing new to send: all 2 highlights are already in BookOrbit\.$/);
  assert.equal(box.style.color, '#f0a030');
});

// ---- Pulling highlights from BookOrbit --------------------------------------
async function epubWithMeta(title, author) {
  const zip = await JSZip.loadAsync(await makeEpub(CHAPTERS));
  const opf = await zip.file('OEBPS/content.opf').async('string');
  zip.file('OEBPS/content.opf', opf.replace('<manifest>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' +
    title + '</dc:title><dc:creator>' + author + '</dc:creator></metadata><manifest>'));
  return zip.generateAsync({ type: 'nodebuffer' });
}
const add = (id, page, chapter, text, note) => ({ serverId: id, version: 1, datetime: '2026-11-03 21:0' + id + ':00', drawer: 'lighten',
  color: 'yellow', text, note: note || null, chapter, posFormat: 'xpointer', pos0: '/body/DocFragment[1]/body/p[1]/text()[1].0', pos1: null, pageno: page });

test('pull: pages through BookOrbit, acknowledges each page, lists them', async () => {
  const epub = await epubWithMeta('The Butcher’s Masquerade', 'Matt Dinniman');
  const pages = [
    { results: [{ hash: 'h', bookId: 1, toApply: { add: [add(2, 30, 'Chapter 7', 'Second <b>one</b> & more'), add(1, 27, 'Chapter 6', 'I’ve got “quotes”', 'my note')], edit: [], delete: [] }, more: true }], unmatched: [], positionIncompatible: [] },
    { results: [{ hash: 'h', bookId: 1, toApply: { add: [add(3, 31, 'Chapter 7', 'Third')], edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] }
  ];
  let n = 0;
  const { els, relays, writes } = await load({
    existing: CONFIG, files: { '/Books/Dinniman, Matt/b.epub': epub },
    relay: async (m, u) => ({ status: 201, body: JSON.stringify(u.endsWith('/exchange') ? pages[n++] : { results: [], unmatched: [], positionIncompatible: [] }) })
  });
  els['bo-book'].value = '/Books/Dinniman, Matt/b.epub';
  await els['bo-hl-pull'].onclick();
  const calls = relays.map((r) => r.u.split('/').pop());
  assert.deepEqual(calls, ['exchange', 'exchange-ack', 'exchange', 'exchange-ack']);
  const first = JSON.parse(relays[0].body).books[0];
  assert.deepEqual([first.sidecarState, first.keysComplete, first.keys, first.changes], ['new', false, [], []]);
  assert.equal(JSON.parse(relays[2].body).books[0].sidecarState, 'known');
  assert.deepEqual(JSON.parse(relays[1].body).books[0].applied.map((a) => a.serverId), [2, 1]);
  assert.match(els['bo-hl-status'].textContent, /^Got 3 highlights from BookOrbit/);
  const html = els['bo-hl-list'].innerHTML;
  assert.ok(html.indexOf('quotes') < html.indexOf('Second'), 'sorted by page');
  assert.match(html, /Second &lt;b&gt;one&lt;\/b&gt; &amp; more/, 'text is escaped');
  assert.match(html, /Note: my note/);
  assert.equal(els['bo-hl-add'].disabled, false);
  assert.equal(writes.length, 0, 'pulling writes nothing to the reader');
});

test('pull: no highlights is orange, unknown or differing files are red, add needs a pull first', async () => {
  const run = async (data) => {
    const { els, writes } = await load({ existing: CONFIG, files: { '/b.epub': Buffer.from('abc') },
      relay: async () => ({ status: 201, body: JSON.stringify(data) }) });
    els['bo-book'].value = '/b.epub';
    await els['bo-hl-pull'].onclick();
    return { box: els['bo-hl-status'], saveDisabled: els['bo-hl-add'].disabled, writes };
  };
  const none = await run({ results: [{ hash: 'h', bookId: 1, toApply: { add: [], edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] });
  assert.match(none.box.textContent, /no highlights for this book yet/);
  assert.equal(none.box.style.color, '#f0a030');
  assert.equal(none.saveDisabled, true);
  const unknown = await run({ results: [], unmatched: ['h'], positionIncompatible: [] });
  assert.match(unknown.box.textContent, /does not have this exact file/);
  assert.equal(unknown.box.style.color, '#ff6b6b');
  const differs = await run({ results: [], unmatched: [], positionIncompatible: ['h'] });
  assert.match(differs.box.textContent, /file differs from its copy/);
  const { els } = await load({ existing: CONFIG, relay: async () => ({ status: 200, body: '{}' }) });
  await els['bo-hl-add'].onclick();
  assert.match(els['bo-hl-status'].textContent, /Pull the highlights first/);
});

// ---- Recent books ------------------------------------------------------------
const RECENT = JSON.stringify({ books: [
  { path: '/Books/Dinniman, Matt/The Butcher’s Masquerade.epub', title: 'The Butcher’s Masquerade', author: 'Matt Dinniman', coverBmpPath: '' },
  { path: '/Comics/notes.txt', title: 'Notes', author: '', coverBmpPath: '' },
  { path: '/Books/B & B.EPUB', title: '<i>B</i> & B', author: '', coverBmpPath: '' }
] });

test('recent books: the reader\'s recent list fills a dropdown, the newest is chosen and the path box is hidden', async () => {
  const { els } = await load({ existing: CONFIG, files: { '/.crosspoint/recent.json': RECENT }, relay: async () => ({ status: 200, body: '{}' }) });
  const html = els['bo-recent'].innerHTML;
  assert.match(html, /The Butcher\u2019s Masquerade - Matt Dinniman/);
  assert.doesNotMatch(html, /notes\.txt/, 'only EPUBs are offered');
  assert.match(html, /&lt;i&gt;B&lt;\/i&gt; &amp; B/, 'titles are escaped');
  assert.match(html, /Another book/);
  assert.equal(els['bo-recent-row'].style.display, '');
  assert.equal(els['bo-book-row'].style.display, 'none');
  assert.equal(els['bo-book'].value, '/Books/Dinniman, Matt/The Butcher\u2019s Masquerade.epub');
  els['bo-recent'].value = '/Books/B & B.EPUB';
  els['bo-recent'].onchange();
  assert.equal(els['bo-book'].value, '/Books/B & B.EPUB');
  assert.equal(els['bo-book-row'].style.display, 'none');
  els['bo-recent'].value = '__other__';
  els['bo-recent'].onchange();
  assert.equal(els['bo-book-row'].style.display, '', 'the path box appears for another book');
  assert.equal(els['bo-book'].value, '');
});

test('recent books: no list, a broken list or no EPUBs leaves the path box as it was', async () => {
  for (const files of [{}, { '/.crosspoint/recent.json': 'not json' }, { '/.crosspoint/recent.json': JSON.stringify({ books: [{ path: '/a.txt' }] }) }]) {
    const { els } = await load({ existing: CONFIG, files, relay: async () => ({ status: 200, body: '{}' }) });
    assert.equal(els['bo-book'].value, '');
    assert.notEqual(els['bo-recent-row'] && els['bo-recent-row'].style.display, '');
    assert.notEqual(els['bo-book-row'] && els['bo-book-row'].style.display, 'none', 'the path box stays visible without a list');
  }
});

// ---- Version line, check-then-send, clearing the list ---------------------------
test('the expanded card shows the plugin version under the header, matching the manifest', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, '..', 'bookorbit-sync.crosspoint-plugin', 'manifest.json'), 'utf8'));
  const { container } = await load({ existing: CONFIG, relay: async () => ({ status: 200, body: '{}' }) });
  const html = container.innerHTML;
  const header = html.indexOf('</summary>');
  const version = html.indexOf('Version: v' + manifest.version + '<');
  assert.ok(version > header, 'the version sits inside the expanded part, after the header');
  assert.ok(version < html.indexOf('Sends your reading sessions'), 'and above the description');
});

test('check book lists the highlights the reader has for that book, ready to send', async () => {
  const clips = 'Dune (Frank Herbert)\n- Your Highlight on Page 12 | Book One | Added on Monday, November 2, 2026, 09:05 AM\n\nFirst <quote>\n==========\n' +
    'Other (X)\n- Your Highlight on Page 1 | C | Added on Monday, November 2, 2026, 09:06 AM\n\nNot this book\n==========\n';
  const { els, relays } = await load({
    existing: CONFIG, files: { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': clips, '/.crosspoint/recent.json': rec('/b.epub', 'Dune') },
    relay: async () => ({ status: 200, body: JSON.stringify({ matches: [{ hash: 'h', bookId: 1, bookFileId: 2 }], libraryVersion: 'v' }) })
  });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-check'].onclick();
  assert.match(els['bo-hl-status'].textContent, /Highlights can sync/);
  const html = els['bo-hl-list'].innerHTML;
  assert.match(html, /On the reader \(1\)\. Press Send highlights/);
  assert.match(html, /First &lt;quote&gt;/);
  assert.doesNotMatch(html, /Not this book/);
  assert.equal(relays.filter((r) => r.u.endsWith('/annotations')).length, 0, 'checking sends nothing');
});

test('the pulled list is cleared by every other button', async () => {
  const pulledBody = JSON.stringify({ results: [{ hash: 'h', bookId: 1, toApply: { add: [add(1, 5, 'C', 'pulled text')], edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] });
  for (const clearing of ['bo-hl-check', 'bo-hl-send', 'bo-hl-pull']) {
    const { els, writes } = await load({
      existing: CONFIG, files: { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec('/b.epub', 'Dune') },
      relay: async (m, u) => ({ status: 201, body: u.endsWith('/exchange') ? pulledBody
        : u.endsWith('/match-check') ? JSON.stringify({ matches: [{ hash: 'h', bookId: 1, bookFileId: 2 }] })
        : u.endsWith('/annotations') ? JSON.stringify({ results: [{ hash: 'h', upserted: 0 }], unmatched: [] }) : '{}' })
    });
    els['bo-book'].value = '/b.epub';
    await els['bo-hl-pull'].onclick();
    assert.match(els['bo-hl-list'].innerHTML, /pulled text/);
    await els[clearing].onclick();
    if (clearing !== 'bo-hl-pull') assert.doesNotMatch(els['bo-hl-list'].innerHTML, /pulled text/, clearing + ' clears the old list');
    if (clearing !== 'bo-hl-pull') assert.equal(els['bo-hl-add'].disabled, true);
  }
});

test('choosing another book in the dropdown clears the list', async () => {
  const both = JSON.stringify({ books: [{ path: '/a.epub', title: 'A' }, { path: '/b.epub', title: 'B' }] });
  const { els } = await load({
    existing: CONFIG, files: { '/a.epub': Buffer.from('abc'), '/.crosspoint/recent.json': both },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', bookId: 1, toApply: { add: [add(1, 5, 'C', 'pulled text')], edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] }) })
  });
  await els['bo-hl-pull'].onclick();
  assert.match(els['bo-hl-list'].innerHTML, /pulled text/);
  els['bo-recent'].value = '/b.epub';
  els['bo-recent'].onchange();
  assert.equal(els['bo-hl-list'].innerHTML, '');
  assert.equal(els['bo-hl-add'].disabled, true);
});

// ---- Adding pulled highlights to the reader's own highlight file ----------------------------------
// An independent reader of the binary format, written from the firmware's ClippingStore::writeToFile.
function decodeStore(buf) {
  let p = 0;
  const version = buf.readUInt8(p); p += 1;
  const count = buf.readUInt16LE(p); p += 2;
  const str = () => { const n = buf.readUInt32LE(p); p += 4; const v = buf.subarray(p, p + n).toString('utf8'); p += n; return v; };
  const header = { title: str(), author: str(), path: str() };
  const records = [];
  for (let i = 0; i < count; i++) {
    const r = {};
    for (const k of ['spine', 'startPage', 'endPage', 'pageCount', 'startWord', 'endWord', 'wordCount', 'paragraph']) { r[k] = buf.readUInt16LE(p); p += 2; }
    for (const k of ['timestamp', 'layout', 'startOffset', 'endOffset']) { r[k] = buf.readUInt32LE(p); p += 4; }
    r.revision = buf.readBigUInt64LE(p); p += 8;
    r.pending = buf.readUInt8(p); p += 1;
    r.id = buf.subarray(p, p + 65).toString('latin1').replace(/\0+$/, ''); p += 65;
    r.chapter = buf.subarray(p, p + 48).toString('utf8').replace(/\0+$/, ''); p += 48;
    const n = buf.readUInt16LE(p); p += 2;
    r.text = buf.subarray(p, p + n).toString('utf8'); p += n;
    records.push(r);
  }
  assert.equal(p, buf.length, 'no bytes left over');
  return { version, header, records };
}

function encodeStore(header, records) {
  const parts = [Buffer.from([4]), Buffer.from([records.length & 255, records.length >> 8])];
  for (const v of [header.title, header.author, header.path]) { const b = Buffer.from(v); const n = Buffer.alloc(4); n.writeUInt32LE(b.length); parts.push(n, b); }
  for (const r of records) {
    const f = Buffer.alloc(154);
    f.writeUInt16LE(r.spine, 0); f.writeUInt16LE(r.startPage || 0, 2); f.writeUInt16LE(r.pageCount || 0, 6);
    f.writeUInt32LE(r.layout || 0, 20); f.writeUInt32LE(r.startOffset, 24); f.writeUInt32LE(r.endOffset, 28);
    f.writeUInt8(r.pending ? 1 : 0, 40); f.write(r.id || '', 41, 'latin1'); f.write(r.chapter || '', 106);
    const t = Buffer.from(r.text); const n = Buffer.alloc(2); n.writeUInt16LE(t.length);
    parts.push(f, n, t);
  }
  return Buffer.concat(parts);
}

// The text of a chapter the way the reader counts it: everything between the tags, entities decoded.
const rawText = (xhtml) => xhtml.slice(xhtml.indexOf('<body')).replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const cpIndex = (text, part) => Array.from(text.slice(0, text.indexOf(part))).length;

const BOOK_PATH = '/Books/Test/Book.epub';
const STORE_PATH = '/.crosspoint/clippings/epub_2361001545.bin';
const entry = (id, chapter, text, pos0, pos1) => ({ serverId: id, version: 1, datetime: '2026-11-03 21:0' + id + ':00',
  drawer: 'lighten', color: 'yellow', text, note: null, chapter, posFormat: 'xpointer', pos0: pos0 || null, pos1: pos1 || null, pageno: 1 });

async function addToReader({ chapters = CHAPTERS, entries, store, extra = {} }) {
  const epub = await makeEpub(chapters);
  const files = { [BOOK_PATH]: epub, '/.crosspoint/recent.json': rec(BOOK_PATH, 'Book') };
  if (store) files[STORE_PATH] = store;
  Object.assign(files, extra);
  const body = JSON.stringify({ results: [{ hash: 'h', bookId: 1, toApply: { add: entries, edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] });
  const loaded = await load({ existing: CONFIG, files, relay: async () => ({ status: 201, body }) });
  loaded.els['bo-book'].value = BOOK_PATH;
  await loaded.els['bo-hl-pull'].onclick();
  await loaded.els['bo-hl-add'].onclick();
  const written = loaded.writes.filter((w) => w.p === STORE_PATH);
  return { ...loaded, status: loaded.els['bo-hl-status'].textContent, written };
}

const CLIP_PATH = '/My Clippings.txt';
const clipFor = (when, chapter, text) => 'Book ()\n- Your Highlight on Page 1 | ' + chapter + ' | Added on ' + when + '\n\n' + text + '\n==========\n';

test('add to reader: /My Clippings.txt is created in the reader\'s own format when it is missing', async () => {
  const { writes, status } = await addToReader({ entries: [entry(1, 'Chapter Two', 'Then more text.')] });
  const clip = writes.find((w) => w.p === CLIP_PATH);
  assert.equal(clip.bin.toString('utf8'), clipFor('Tuesday, November 3, 2026, 09:01 PM', 'Chapter Two', 'Then more text.'));
  assert.match(status, /\/My Clippings\.txt: added 1 entry\./);
  assert.ok(!writes.some((w) => w.p === '/plugins/bookorbit-sync/backup-My Clippings.txt'), 'nothing to back up');
});

test('add to reader: other books\' entries are kept, stale ones for this book are removed, new ones are appended', async () => {
  const other = 'Other (B)\n- Your Highlight on Page 2 | C | Added on Monday, January 1, 2024, 10:00 AM\n\nOther book text\n==========\n';
  const stale = clipFor('Monday, January 1, 2024, 10:00 AM', 'Chapter One', 'Deleted on the reader long ago, so it is stale.');
  const { writes, status } = await addToReader({ entries: [entry(1, 'Chapter Two', 'Then more text.')], extra: { [CLIP_PATH]: other + stale } });
  const clip = writes.find((w) => w.p === CLIP_PATH);
  assert.equal(clip.bin.toString('utf8'), other + clipFor('Tuesday, November 3, 2026, 09:01 PM', 'Chapter Two', 'Then more text.'));
  assert.equal(writes.find((w) => w.p === '/plugins/bookorbit-sync/backup-My Clippings.txt').bin.toString('utf8'), other + stale);
  assert.match(status, /\/My Clippings\.txt: added 1 entry, removed 1 entry\./);
});

test('add to reader: pressing it again, or a highlight already in the file, adds no duplicate entry', async () => {
  const first = await addToReader({ entries: [entry(1, 'Chapter Two', 'Then more text.')] });
  const clipText = first.writes.find((w) => w.p === CLIP_PATH).bin.toString('utf8');
  const again = await addToReader({ entries: [entry(1, 'Chapter Two', 'Then more text.')], store: first.written[0].bin, extra: { [CLIP_PATH]: clipText } });
  assert.equal(again.writes.filter((w) => w.p === CLIP_PATH).length, 0);
});

test('add to reader: nothing new for the reader still creates the missing /My Clippings.txt', async () => {
  const first = await addToReader({ entries: [entry(1, 'Chapter Two', 'Then more text.')] });
  const again = await addToReader({ entries: [entry(1, 'Chapter Two', 'Then more text.')], store: first.written[0].bin });
  assert.match(again.status, /^Nothing new to add to the reader\. \/My Clippings\.txt: added 1 entry\./);
  assert.ok(again.writes.some((w) => w.p === CLIP_PATH));
});

test('add to reader: the file name is the reader\'s own hash of the book path', async () => {
  const { written } = await addToReader({ entries: [entry(1, 'Chapter Two', 'Then more text.')] });
  assert.equal(written.length, 1, 'wrote /.crosspoint/clippings/epub_2361001545.bin');
});

test('add to reader: offsets count the chapter text the way the reader does', async () => {
  const quoteA = 'We ended up hiring five mercenaries.';
  const quoteB = 'naïve line end';
  const { written, status, els } = await addToReader({ entries: [
    entry(1, 'Chapter Two', quoteA, '/body/DocFragment[2]/body/div[1]/p[2]/text()[1].0', '/body/DocFragment[2]/body/div[1]/p[2]/text()[2].18'),
    entry(2, 'Chapter Three', quoteB)
  ] });
  assert.match(status, /^Added 2 highlights to the reader\./);
  assert.equal(els['bo-hl-status'].style.color, '#3fb950');
  const store = decodeStore(written[0].bin);
  assert.equal(store.version, 4);
  assert.deepEqual(store.header, { title: 'Book', author: '', path: BOOK_PATH }, 'a new file is named after the book');
  const two = rawText(CH_TWO);
  const [a, b] = store.records;
  assert.equal(a.spine, 1);
  assert.equal(a.startOffset, cpIndex(two, quoteA));
  assert.equal(a.endOffset, a.startOffset + Array.from(quoteA).length);
  assert.equal(a.text, quoteA);
  assert.equal(a.chapter, 'Chapter Two');
  const three = rawText(CH_THREE);
  assert.equal(b.spine, 2);
  assert.equal(b.startOffset, cpIndex(three, 'naïve'), 'counts characters, not UTF-16 units: the emoji is one');
  const spanText = three.slice(three.indexOf('na\u00efve'), three.indexOf('line end') + 'line end'.length);
  assert.ok(spanText.includes('\n'), 'the highlight crosses source whitespace');
  assert.equal(b.endOffset - b.startOffset, Array.from(spanText).length, 'the source whitespace inside the highlight is counted');
  for (const r of store.records) {
    assert.equal(r.pending, 0, 'not queued for upload');
    assert.equal(r.layout, 0);
    assert.equal(r.id, '');
    assert.equal(r.paragraph, 0xffff);
    assert.equal(r.timestamp, Math.floor(Date.parse('2026-11-03T21:0' + (r === a ? 1 : 2) + ':00') / 1000));
  }
});

test('add to reader: an existing highlight file keeps every byte, new ones follow, running again adds nothing', async () => {
  const old = { spine: 1, startOffset: 5, endOffset: 9, text: 'Old one', chapter: 'Chapter Two', pending: true, id: 'abc123', layout: 777, pageCount: 40, startPage: 3 };
  const header = { title: 'Book', author: 'Auth', path: BOOK_PATH };
  const store = encodeStore(header, [old]);
  const first = await addToReader({ store, entries: [entry(1, 'Chapter One', 'Opening words.'), entry(2, 'Chapter Two', 'Old one')] });
  assert.match(first.status, /^Added 1 highlight to the reader\./);
  assert.match(first.status, /1 already on the reader/);
  const out = decodeStore(first.written[0].bin);
  assert.deepEqual(out.header, header, 'title, author and path are kept');
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records[0], decodeStore(store).records[0], 'the old record is untouched');
  assert.equal(out.records[1].text, 'Opening words.');
  const oldRecord = store.subarray(store.length - (154 + 2 + 'Old one'.length));
  assert.ok(first.written[0].bin.includes(oldRecord), 'the old record\'s bytes are copied as they were');

  const second = await addToReader({ store: first.written[0].bin, entries: [entry(1, 'Chapter Two', 'Opening words.')] });
  assert.match(second.status, /^Nothing new to add to the reader\./);
  assert.equal(second.els['bo-hl-status'].style.color, '#f0a030');
  assert.equal(second.written.length, 0, 'nothing is written when nothing is new');
});

test('add to reader: text that appears twice with no exact position, or is not in the book, is skipped', async () => {
  const { written, status } = await addToReader({ entries: [
    entry(1, 'Elsewhere', 'We ended up hiring five mercenaries.'),
    entry(2, 'Chapter One', 'This text is not in the book at all.'),
    entry(3, 'Chapter One', 'Opening words.')
  ] });
  assert.match(status, /^Added 1 highlight/);
  assert.match(status, /1 not found in the book text/);
  assert.match(status, /1 skipped because the text appears more than once/);
  assert.equal(decodeStore(written[0].bin).records.length, 1);
});

test('add to reader: BookOrbit\'s own position is used, and decides between repeated text', async () => {
  const q = 'We ended up hiring five mercenaries.';
  const { written } = await addToReader({ entries: [
    entry(1, 'Elsewhere', q, '/body/DocFragment[3]/body/section[1]/p[2]/text()[1].0', '/body/DocFragment[3]/body/section[1]/p[2]/text()[1].36')
  ] });
  const r = decodeStore(written[0].bin).records[0];
  assert.equal(r.spine, 2);
  assert.equal(r.startOffset, cpIndex(rawText(CH_THREE), q));
});

test('add to reader: a file in a format it does not know is left alone', async () => {
  const odd = Buffer.from(encodeStore({ title: 'B', author: 'A', path: BOOK_PATH }, []));
  odd[0] = 9;
  const { written, status, els } = await addToReader({ store: odd, entries: [entry(1, 'Chapter One', 'Opening words.')] });
  assert.equal(written.length, 0);
  assert.match(status, /^Could not add them: .*format this plugin does not know/);
  assert.equal(els['bo-hl-status'].style.color, '#ff6b6b');
  const cut = encodeStore({ title: 'B', author: 'A', path: BOOK_PATH }, [{ spine: 1, startOffset: 1, endOffset: 3, text: 'xyz' }]).subarray(0, 120);
  const again = await addToReader({ store: cut, entries: [entry(1, 'Chapter One', 'Opening words.')] });
  assert.equal(again.written.length, 0, 'a cut-off file is not rewritten either');
});

test('add to reader: the button needs a pull first and is cleared with the list', async () => {
  const { els } = await load({ existing: CONFIG, files: { '/.crosspoint/recent.json': rec(BOOK_PATH, 'Book') }, relay: async () => ({ status: 200, body: '{}' }) });
  assert.equal(els['bo-hl-add'].disabled, true);
  await els['bo-hl-add'].onclick();
  assert.match(els['bo-hl-status'].textContent, /Pull the highlights first/);
});

test('add to reader: never duplicates, however the same passage is worded or how often it is pressed', async () => {
  const q = 'We ended up hiring five mercenaries.';
  const two = rawText(CH_TWO);
  const start = cpIndex(two, q);
  // The reader already has this passage, worded differently (no final full stop, different text).
  const header = { title: 'Book', author: '', path: BOOK_PATH };
  const store = encodeStore(header, [{ spine: 1, startOffset: start, endOffset: start + q.length - 1, text: 'We ended up hiring five mercenaries', chapter: 'Chapter Two' }]);
  const same = await addToReader({ store, entries: [entry(1, 'Chapter Two', q), entry(2, 'Chapter Two', q + ' ')] });
  assert.match(same.status, /^Nothing new to add to the reader\./);
  assert.equal(same.written.length, 0);
  // Two pulled entries for one passage add it once.
  const twice = await addToReader({ entries: [entry(1, 'Chapter Two', q), entry(2, 'Chapter Two', q.replace('five', 'five  '))] });
  assert.match(twice.status, /^Added 1 highlight to the reader\./);
  assert.equal(decodeStore(twice.written[0].bin).records.length, 1);
  // Pressing the button again without pulling again changes nothing the second time.
  const epub = await makeEpub(CHAPTERS);
  const files = { [BOOK_PATH]: epub, '/.crosspoint/recent.json': rec(BOOK_PATH, 'Book') };
  const body = JSON.stringify({ results: [{ hash: 'h', bookId: 1, toApply: { add: [entry(1, 'Chapter Two', q)], edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] });
  const { els, writes } = await load({ existing: CONFIG, files, relay: async () => ({ status: 201, body }) });
  els['bo-book'].value = BOOK_PATH;
  await els['bo-hl-pull'].onclick();
  await els['bo-hl-add'].onclick();
  files[STORE_PATH] = writes.find((w) => w.p === STORE_PATH).bin; // what the reader now holds
  await els['bo-hl-add'].onclick();
  assert.match(els['bo-hl-status'].textContent, /^Nothing new to add to the reader\./);
  assert.equal(writes.filter((w) => w.p === STORE_PATH).length, 1);
});

test('add to reader: the button stays greyed out until highlights have been pulled', async () => {
  const q = 'Opening words.';
  const body = JSON.stringify({ results: [{ hash: 'h', bookId: 1, toApply: { add: [entry(1, 'Chapter One', q)], edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] });
  const { els } = await load({ existing: CONFIG, files: { [BOOK_PATH]: await makeEpub(CHAPTERS), '/.crosspoint/recent.json': rec(BOOK_PATH, 'Book') },
    relay: async (m, u) => ({ status: 200, body: u.endsWith('/match-check') ? JSON.stringify({ matches: [{ hash: 'h', bookId: 1, bookFileId: 2 }] }) : body }) });
  els['bo-book'].value = BOOK_PATH;
  assert.equal(els['bo-hl-add'].disabled, true, 'greyed out at the start');
  assert.equal(els['bo-hl-actions'].style.display, 'none', 'hidden at the start');
  await els['bo-hl-check'].onclick();
  assert.equal(els['bo-hl-add'].disabled, true, 'Check book does not enable it');
  await els['bo-hl-pull'].onclick();
  assert.equal(els['bo-hl-add'].disabled, false, 'enabled after a pull that found highlights');
  assert.equal(els['bo-hl-actions'].style.display, '', 'shown after a pull that found highlights');
  await els['bo-hl-check'].onclick();
  assert.equal(els['bo-hl-add'].disabled, true, 'greyed out again when another button clears the list');
  assert.equal(els['bo-hl-actions'].style.display, 'none', 'hidden again when another button clears the list');
});

test('check book: no highlights on the reader still confirms the book and says there are none', async () => {
  const found = async (m, u) => ({ status: 200, body: JSON.stringify({ matches: [{ hash: 'h', bookId: 1, bookFileId: 2 }] }) });
  for (const files of [
    { '/b.epub': Buffer.from('abc') },                                   // no /My Clippings.txt at all
    { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': '' },          // an empty one
    { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec('/b.epub', 'Some Other Book') }
  ]) {
    const { els } = await load({ existing: CONFIG, files, relay: found });
    els['bo-book'].value = '/b.epub';
    await els['bo-hl-check'].onclick();
    assert.match(els['bo-hl-status'].textContent, /^BookOrbit has this exact file .*The reader has no highlights for this book yet/);
    assert.equal(els['bo-hl-status'].style.color, '#f0a030');
    assert.match(els['bo-hl-list'].innerHTML || els['bo-hl-list'].textContent || '', /No highlights for this book were found on the reader yet/);
  }
});

test('check book: still says the book is missing from BookOrbit when there are no highlights', async () => {
  const { els } = await load({ existing: CONFIG, files: { '/b.epub': Buffer.from('abc') },
    relay: async () => ({ status: 200, body: JSON.stringify({ matches: [] }) }) });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-check'].onclick();
  assert.match(els['bo-hl-status'].textContent, /^BookOrbit does not have this exact file/);
  assert.equal(els['bo-hl-status'].style.color, '#ff6b6b');
});

test('a lost connection to the reader is explained instead of "Failed to fetch"', async () => {
  const { els } = await load({ existing: CONFIG, files: {}, unreachable: ['/b.epub'], relay: async () => ({ status: 200, body: '{}' }) });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-check'].onclick();
  assert.match(els['bo-hl-status'].textContent, /^Could not finish: the page lost contact with the reader\. Check that File Transfer is still open/);
  assert.equal(els['bo-hl-status'].style.color, '#ff6b6b');
});

// ---- Highlights on the reader that BookOrbit does not have --------------------------------------
const A_TEXT = 'Kept in both places, a long enough highlight to match on.';
const B_TEXT = 'Only on the reader, the first one.';
const C_TEXT = 'Only on the reader, the second one.';
const strayRecord = (text, over = {}) => Object.assign({ spine: 1, startOffset: 3, endOffset: 3 + text.length, text, chapter: 'Chapter Two' }, over);
const click = (act, id = '') => ({ target: { getAttribute: (n) => ({ 'data-act': act, 'data-id': id })[n] } });

async function pullWithStore(records, { entries = [entry(1, 'Chapter Two', A_TEXT)], more = false, extra = {} } = {}) {
  const store = encodeStore({ title: 'Book', author: '', path: BOOK_PATH }, records);
  const files = { [BOOK_PATH]: Buffer.from('abc'), '/.crosspoint/recent.json': rec(BOOK_PATH, 'Book'), [STORE_PATH]: store, ...extra };
  const body = JSON.stringify({ results: [{ hash: 'h', bookId: 1, toApply: { add: entries, edit: [], delete: [] }, more }], unmatched: [], positionIncompatible: [] });
  const loaded = await load({ existing: CONFIG, files, relay: async () => ({ status: 201, body }) });
  loaded.els['bo-book'].value = BOOK_PATH;
  await loaded.els['bo-hl-pull'].onclick();
  return { ...loaded, store, files };
}

test('strays: reader highlights BookOrbit does not have are listed with delete buttons', async () => {
  const { els } = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT), strayRecord(C_TEXT)]);
  const html = els['bo-hl-strays'].innerHTML;
  assert.match(html, /On the reader, not in BookOrbit \(2\)/);
  assert.ok(html.includes(B_TEXT) && html.includes(C_TEXT));
  assert.ok(!html.includes(A_TEXT), 'a highlight BookOrbit has is not offered for deletion');
  assert.match(html, /Delete all 2 from the reader/);
  assert.equal((html.match(/Delete from the reader/g) || []).length, 2);
});

test('strays: nothing is offered when the reader and BookOrbit agree, or the reader has none', async () => {
  const same = await pullWithStore([strayRecord(A_TEXT)]);
  assert.match(same.els['bo-hl-strays'].innerHTML, /Every highlight on the reader is in BookOrbit/);
  const none = await pullWithStore([]);
  assert.match(none.els['bo-hl-strays'].innerHTML, /Every highlight on the reader is in BookOrbit/);
});

test('strays: a delete needs a second click, then removes only that highlight, with a backup', async () => {
  const { els, writes, relays, store } = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT), strayRecord(C_TEXT)]);
  const before = relays.length;
  await els['bo-hl-strays'].onclick(click('one', '0'));
  assert.match(els['bo-hl-strays'].innerHTML, /Click again to delete/);
  assert.equal(writes.filter((w) => w.p === STORE_PATH).length, 0, 'the first click changes nothing');
  await els['bo-hl-strays'].onclick(click('one', '0'));
  const out = writes.filter((w) => w.p === STORE_PATH);
  assert.equal(out.length, 1);
  assert.deepEqual(decodeStore(out[0].bin).records.map((r) => r.text), [A_TEXT, C_TEXT]);
  const backup = writes.find((w) => w.p === '/plugins/bookorbit-sync/backup-epub_2361001545.bin');
  assert.ok(backup && backup.bin.equals(store), 'the old file is kept as it was');
  assert.match(els['bo-hl-status'].textContent, /^Deleted 1 highlight from the reader\. BookOrbit was not changed\./);
  assert.equal(els['bo-hl-status'].style.color, '#3fb950');
  assert.equal(relays.length, before, 'nothing is sent to BookOrbit');
  assert.ok(!els['bo-hl-strays'].innerHTML.includes(B_TEXT), 'the deleted one is gone from the list');
  assert.ok(els['bo-hl-strays'].innerHTML.includes(C_TEXT));
});

const clipEntry = (title, text) => title + ' (A)\r\n- Your Highlight on Page 3 | Chapter Two | Added on Monday, 1 January 2024 10:00:00\r\n\r\n' + text + '\r\n==========\r\n';

test('strays: deleting also removes that book\'s matching entries from My Clippings.txt, with a backup', async () => {
  const clips = clipEntry('Book', A_TEXT) + clipEntry('Book', B_TEXT) + clipEntry('Other Book', B_TEXT) + clipEntry('Book', C_TEXT);
  const { els, writes } = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT), strayRecord(C_TEXT)], { extra: { '/My Clippings.txt': clips } });
  await els['bo-hl-strays'].onclick(click('one', '0'));
  await els['bo-hl-strays'].onclick(click('one', '0'));
  const out = writes.find((w) => w.p === '/My Clippings.txt');
  assert.equal(out.bin.toString('utf8'), clipEntry('Book', A_TEXT) + clipEntry('Other Book', B_TEXT) + clipEntry('Book', C_TEXT));
  const backup = writes.find((w) => w.p === '/plugins/bookorbit-sync/backup-My Clippings.txt');
  assert.equal(backup.bin.toString('utf8'), clips);
  assert.match(els['bo-hl-status'].textContent, /My Clippings\.txt: removed 1 entry\./);
});

test('strays: My Clippings.txt is left alone when nothing in it matches or it does not exist', async () => {
  const clips = clipEntry('Book', A_TEXT);
  const a = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT)], { extra: { '/My Clippings.txt': clips } });
  await a.els['bo-hl-strays'].onclick(click('one', '0'));
  await a.els['bo-hl-strays'].onclick(click('one', '0'));
  assert.equal(a.writes.filter((w) => w.p === '/My Clippings.txt').length, 0);
  const b = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT)]);
  await b.els['bo-hl-strays'].onclick(click('one', '0'));
  await b.els['bo-hl-strays'].onclick(click('one', '0'));
  assert.match(b.els['bo-hl-status'].textContent, /^Deleted 1 highlight from the reader\. BookOrbit was not changed\./);
});

test('strays: delete all removes every highlight BookOrbit lacks and leaves the rest byte for byte', async () => {
  const { els, writes, store } = await pullWithStore([strayRecord(B_TEXT), strayRecord(A_TEXT), strayRecord(C_TEXT)]);
  await els['bo-hl-strays'].onclick(click('all'));
  await els['bo-hl-strays'].onclick(click('all'));
  const out = decodeStore(writes.find((w) => w.p === STORE_PATH).bin);
  assert.deepEqual(out.records.map((r) => r.text), [A_TEXT]);
  assert.match(els['bo-hl-status'].textContent, /^Deleted 2 highlights from the reader/);
  assert.match(els['bo-hl-strays'].innerHTML, /Every highlight on the reader is in BookOrbit/);
  const keptBytes = encodeStore({ title: 'Book', author: '', path: BOOK_PATH }, [strayRecord(A_TEXT)]);
  assert.ok(writes.find((w) => w.p === STORE_PATH).bin.equals(keptBytes));
  void store;
});

test('strays: a different button between the two clicks cancels the first', async () => {
  const { els, writes } = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT), strayRecord(C_TEXT)]);
  await els['bo-hl-strays'].onclick(click('one', '0'));
  await els['bo-hl-strays'].onclick(click('one', '1'));
  assert.equal(writes.filter((w) => w.p === STORE_PATH).length, 0, 'two different buttons never delete anything');
});

test('strays: highlights synced to a CrossPoint sync server are left for the reader to delete', async () => {
  const { els } = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT, { id: 'abc-123' })]);
  const html = els['bo-hl-strays'].innerHTML;
  assert.ok(!html.includes('Delete from the reader'));
  assert.match(html, /1 more is synced to a CrossPoint sync server/);
});

test('strays: no comparison is made when BookOrbit has more than could be listed', async () => {
  const { els } = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT)], { more: true });
  assert.match(els['bo-hl-strays'].innerHTML, /cannot be compared safely/);
  assert.ok(!els['bo-hl-strays'].innerHTML.includes('Delete'));
});

test('strays: the list clears with the other buttons and an unknown file format is never changed', async () => {
  const { els } = await pullWithStore([strayRecord(A_TEXT), strayRecord(B_TEXT)]);
  await els['bo-hl-check'].onclick();
  assert.equal(els['bo-hl-strays'].innerHTML, '');
  const odd = encodeStore({ title: 'B', author: '', path: BOOK_PATH }, [strayRecord(B_TEXT)]);
  odd[0] = 9;
  const bad = await load({ existing: CONFIG, files: { [BOOK_PATH]: Buffer.from('abc'), '/.crosspoint/recent.json': rec(BOOK_PATH, 'Book'), [STORE_PATH]: odd },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', bookId: 1, toApply: { add: [entry(1, 'C', A_TEXT)], edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] }) }) });
  bad.els['bo-book'].value = BOOK_PATH;
  await bad.els['bo-hl-pull'].onclick();
  assert.match(bad.els['bo-hl-strays'].innerHTML, /Could not compare/);
  assert.equal(bad.writes.filter((w) => w.p === STORE_PATH).length, 0);
});

test('send: highlights deleted on the reader are not sent to BookOrbit again', async () => {
  const store = encodeStore({ title: 'Dune', author: '', path: BOOK_PATH }, [strayRecord('First quote')]);
  const { els, relays } = await load({
    existing: CONFIG,
    files: { [BOOK_PATH]: Buffer.from('abc'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec(BOOK_PATH, 'Dune'), [STORE_PATH]: store },
    relay: async (m, u) => ({ status: 201, body: JSON.stringify(u.endsWith('/annotations') ? { results: [{ hash: 'h', upserted: 1 }], unmatched: [] } : { matches: [{ hash: 'h', bookId: 1, bookFileId: 2 }] }) })
  });
  els['bo-book'].value = BOOK_PATH;
  await els['bo-hl-send'].onclick();
  const sent = JSON.parse(relays.find((r) => r.u.endsWith('/annotations')).body).books[0].annotations;
  assert.deepEqual(sent.map((a) => a.text), ['First quote']);
  assert.match(els['bo-hl-status'].textContent, /1 deleted from the reader was skipped\./);
  // Everything deleted: nothing is sent at all.
  const empty = encodeStore({ title: 'Dune', author: '', path: BOOK_PATH }, []);
  const again = await load({ existing: CONFIG, files: { [BOOK_PATH]: Buffer.from('abc'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec(BOOK_PATH, 'Dune'), [STORE_PATH]: empty },
    relay: async () => ({ status: 201, body: '{}' }) });
  again.els['bo-book'].value = BOOK_PATH;
  await again.els['bo-hl-send'].onclick();
  assert.match(again.els['bo-hl-status'].textContent, /^The 2 highlights for this book in \/My Clippings\.txt were deleted from the reader, so nothing was sent\./);
  assert.equal(again.relays.filter((r) => r.u.endsWith('/annotations')).length, 0);
});

test('check and send: highlights only in the reader\'s own file (no /My Clippings.txt) are still found', async () => {
  const store = encodeStore({ title: 'Dune', author: '', path: BOOK_PATH }, [strayRecord('Added by the plugin, only in the reader file.')]);
  const files = { [BOOK_PATH]: Buffer.from('abc'), '/.crosspoint/recent.json': rec(BOOK_PATH, 'Dune'), [STORE_PATH]: store };
  const found = async () => ({ status: 200, body: JSON.stringify({ matches: [{ hash: 'h', bookId: 1, bookFileId: 2 }] }) });
  const a = await load({ existing: CONFIG, files, relay: found });
  a.els['bo-book'].value = BOOK_PATH;
  await a.els['bo-hl-check'].onclick();
  assert.match(a.els['bo-hl-status'].textContent, /Highlights can sync\./);
  assert.ok(a.els['bo-hl-list'].innerHTML.includes('Added by the plugin, only in the reader file.'));
  const sent = [];
  const b = await load({ existing: CONFIG, files, relay: async (m, u, h, body) => { sent.push(body); return { status: 201, body: JSON.stringify({ results: [{ upserted: 1 }] }) }; } });
  b.els['bo-book'].value = BOOK_PATH;
  await b.els['bo-hl-send'].onclick();
  assert.ok(sent.some((x) => String(x).includes('Added by the plugin, only in the reader file.')), 'the highlight is sent');
});

test('send: with no highlight file on the reader, /My Clippings.txt is used as before', async () => {
  const { els, relays } = await load({
    existing: CONFIG, files: { [BOOK_PATH]: Buffer.from('abc'), '/My Clippings.txt': CLIPS, '/.crosspoint/recent.json': rec(BOOK_PATH, 'Dune') },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', upserted: 2 }], unmatched: [] }) })
  });
  els['bo-book'].value = BOOK_PATH;
  await els['bo-hl-send'].onclick();
  assert.equal(JSON.parse(relays.find((r) => r.u.endsWith('/annotations')).body).books[0].annotations.length, 2);
});
