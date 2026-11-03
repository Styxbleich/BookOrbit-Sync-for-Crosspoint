// Runs plugin.js against a fake DOM/relay: checks the md5 key, the written
// config.json, validation, and the connection-test messages.
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'bookorbit-sync.crosspoint-plugin', 'plugin.js'), 'utf8');

async function load({ existing = null, device = null, events = null, relay }) {
  const els = {};
  const getEl = (id) => (els[id] ||= { id, value: '', placeholder: '', textContent: '', style: {}, disabled: false });
  const document = { getElementById: getEl };
  const writes = [];
  const relays = [];
  let register;
  const sandbox = {
    document, TextEncoder, btoa, console,
    CrossPoint: { registerPlugin: (fn) => { register = fn; } },
    fetch: async (url) => {
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
    relay: async (m, u, h, b) => { relays.push({ m, u, h }); return relay(m, u, h, b); },
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
