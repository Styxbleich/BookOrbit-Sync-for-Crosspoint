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

async function load({ existing = null, device = null, events = null, relay, files = {} }) {
  const els = {};
  const getEl = (id) => (els[id] ||= { id, value: '', placeholder: '', textContent: '', style: {}, disabled: false });
  const document = { getElementById: getEl };
  getEl('bo-book'); // an input the page creates, which tests fill in before any click
  const writes = [];
  const relays = [];
  let register;
  const sandbox = {
    document, TextEncoder, btoa, console, JSZip, DOMParser, Uint8Array, // same realm as JSZip, as in a browser
    CrossPoint: { registerPlugin: (fn) => { register = fn; } },
    fetch: async (url) => {
      const asked = url.startsWith('/download?path=') ? decodeURIComponent(url.slice('/download?path='.length)) : null;
      if (asked !== null && files[asked] !== undefined) {
        const f = files[asked];
        const buf = Buffer.isBuffer(f) ? f : Buffer.from(f, 'utf8');
        return { ok: true, text: async () => buf.toString('utf8'),
          arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
      }
      if (url.includes('events.jsonl')) return { ok: events !== null, text: async () => events };
      const isDev = url.includes('device.json');
      const body = isDev ? device : existing;
      return { ok: body !== null && (isDev || url.includes('config.json')), text: async () => body };
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
    writeFile: async (p, b64) => { writes.push({ p, text: Buffer.from(b64, 'base64').toString('utf8') }); return { ok: true }; }
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


// ---- Highlights (experimental) ---------------------------------------------
const CONFIG = JSON.stringify({ server: 'http://h:1', user: 'u', key: 'k', device_id: 'x4pro' });
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
    assert.match(els['bo-hl-status'].textContent, /Highlights can sync/);
  }
});

test('highlights: sends the book\'s highlights with hash, page, chapter and time', async () => {
  const epub = crypto.randomBytes(30000);
  const { els, relays } = await load({
    existing: CONFIG, files: { '/Books/b.epub': epub, '/My Clippings.txt': CLIPS },
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
      existing: CONFIG, files: { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': clip },
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
    [{ existing: CONFIG, files: { '/b.epub': Buffer.from('a'), '/My Clippings.txt': CLIPS }, relay: async () => ok }, '/b.epub', /does not have this exact file/],
    [{ existing: CONFIG, files: { '/b.epub': Buffer.from('a'), '/My Clippings.txt': CLIPS }, relay: async () => ({ status: 401, body: '' }) }, '/b.epub', /answered 401/]
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
    existing: CONFIG, files: { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': CLIPS },
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
    existing: CONFIG, files: { '/b.epub': epub, '/My Clippings.txt': clip },
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

test('highlights: when the book title matches nothing, the most recently highlighted book is used and says so', async () => {
  const plain = await JSZip.loadAsync(await makeEpub(CHAPTERS));
  const opf = await plain.file('OEBPS/content.opf').async('string');
  plain.file('OEBPS/content.opf', opf.replace('<manifest>', '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Some Other Title</dc:title></metadata><manifest>'));
  const epub = await plain.generateAsync({ type: 'nodebuffer' });
  const clips = 'Old Book (A)\n- Your Highlight on Page 1 | C | Added on Monday, November 2, 2026, 09:05 AM\n\nOpening words.\n==========\n' +
    'New Book (A)\n- Your Highlight on Page 1 | Chapter One | Added on Tuesday, November 3, 2026, 04:12 PM\n\nOpening words.\n==========\n';
  const { els, relays } = await load({
    existing: CONFIG, files: { '/b.epub': epub, '/My Clippings.txt': clips },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', upserted: 1 }], unmatched: [] }) })
  });
  els['bo-book'].value = '/b.epub';
  await els['bo-hl-send'].onclick();
  const anns = JSON.parse(relays.find((r) => r.u.endsWith('/annotations')).body).books[0].annotations;
  assert.equal(anns.length, 1);
  assert.match(els['bo-hl-status'].textContent, /used the highlights of "New Book"/);
});

test('highlights: when everything is already in BookOrbit the box is orange, not red', async () => {
  const { els } = await load({
    existing: CONFIG, files: { '/b.epub': Buffer.from('abc'), '/My Clippings.txt': CLIPS },
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

test('pull: pages through BookOrbit, acknowledges each page, lists and saves BOOKNAME - AUTHOR Highlights.txt', async () => {
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
  assert.equal(els['bo-hl-save'].disabled, false);
  await els['bo-hl-save'].onclick();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].p, '/Books/Dinniman, Matt/The Butcher’s Masquerade - Matt Dinniman Highlights.txt');
  assert.match(writes[0].text, /^The Butcher’s Masquerade\nMatt Dinniman\nHighlights from BookOrbit \(3\)\n\n== Chapter 6 ==\n\n\[p\. 27\] I’ve got “quotes”\nNote: my note\n\n== Chapter 7 ==\n\n\[p\. 30\] Second <b>one<\/b> & more\n\n\[p\. 31\] Third\n$/);
  assert.match(els['bo-hl-status'].textContent, /^Saved 3 highlights to /);
});

test('pull: file name drops characters the SD card cannot hold, and falls back to the file name', async () => {
  const epub = await epubWithMeta('Who: What? / Why*', 'A. "Author"');
  const { els, writes } = await load({
    existing: CONFIG, files: { '/b.epub': epub, '/plain.epub': Buffer.from('not a zip') },
    relay: async () => ({ status: 201, body: JSON.stringify({ results: [{ hash: 'h', bookId: 1, toApply: { add: [add(1, 1, 'C', 'x')], edit: [], delete: [] }, more: false }], unmatched: [], positionIncompatible: [] }) })
  });
  for (const [book, expected] of [['/b.epub', '/Who What Why - A. Author Highlights.txt'], ['/plain.epub', '/plain Highlights.txt']]) {
    els['bo-book'].value = book;
    await els['bo-hl-pull'].onclick();
    await els['bo-hl-save'].onclick();
    assert.equal(writes[writes.length - 1].p, expected);
  }
});

test('pull: no highlights is orange, unknown or differing files are red, save needs a pull first', async () => {
  const run = async (data) => {
    const { els, writes } = await load({ existing: CONFIG, files: { '/b.epub': Buffer.from('abc') },
      relay: async () => ({ status: 201, body: JSON.stringify(data) }) });
    els['bo-book'].value = '/b.epub';
    await els['bo-hl-pull'].onclick();
    return { box: els['bo-hl-status'], saveDisabled: els['bo-hl-save'].disabled, writes };
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
  await els['bo-hl-save'].onclick();
  assert.match(els['bo-hl-status'].textContent, /Pull the highlights first/);
});
