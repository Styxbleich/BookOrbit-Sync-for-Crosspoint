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

test('highlights: sends the latest highlight with hash, page, chapter and time', async () => {
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
  const a = body.books[0].annotations[0];
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
  assert.match(status, /Found it in section 2/);
  assert.doesNotMatch(status, /appears/);
});

test('highlight position: a repeated quote prefers the chapter named in the clipping', async () => {
  const two = await sendFor('We ended up hiring five mercenaries.', 'Chapter Two', CHAPTERS);
  assert.match(two.a.pos0, /^\/body\/DocFragment\[2\]\//);
  assert.doesNotMatch(two.status, /appears/);
  const three = await sendFor('We ended up hiring five mercenaries.', 'Chapter Three', CHAPTERS);
  assert.equal(three.a.pos0, '/body/DocFragment[3]/body/section[1]/p[2]/text()[1].0');
  assert.equal(resolveXPointer(CH_THREE, three.a.pos0), 'We ended up hiring five mercenaries.');
  assert.doesNotMatch(three.status, /appears/);
  // no chapter to go by: take the first one and warn that the text repeats
  const unknown = await sendFor('We ended up hiring five mercenaries.', 'Some other title', CHAPTERS);
  assert.match(unknown.a.pos0, /^\/body\/DocFragment\[2\]\//);
  assert.match(unknown.status, /appears 2 times/);
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
