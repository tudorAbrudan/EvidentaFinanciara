import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.MISTRAL_API_KEY = 'test-key';
process.env.PROXY_APP_TOKEN = 'app-token';
process.env.PER_DEVICE_DAILY_LIMIT = '2';
process.env.PER_IP_DAILY_LIMIT = '5';
process.env.GLOBAL_DAILY_LIMIT = '8';
process.env.MAX_TOKENS_CAP = '1000';
process.env.MAX_BODY_BYTES = '4096';
process.env.UPSTREAM_REASONING_EFFORT = 'none';
// Providerul din spate e Gemini: aplicatia trimite numele Mistral, proxy-ul traduce.
// ALLOWED_MODELS NU e setat: testele verifica whitelist-ul implicit.
process.env.MODEL_MAP = JSON.stringify({ 'mistral-small-latest': 'gemini-3.8-flash' });

let upstream;
let upstreamCalls = [];
let upstreamStatus = 200;
let upstreamReply = 'salut';
let proxy;
let base;
let config;

before(async () => {
  // Fals „provider": inregistreaza ce a primit si raspunde.
  upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      upstreamCalls.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      if (upstreamStatus !== 200) {
        res.writeHead(upstreamStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `eroare ${upstreamReply}` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: upstreamReply } }] }));
    });
  });
  await new Promise(r => upstream.listen(0, r));
  process.env.MISTRAL_URL = `http://127.0.0.1:${upstream.address().port}/v1`;

  ({ server: proxy } = await import('../server.js'));
  ({ config } = await import('../config.js'));
  await new Promise(r => proxy.listen(0, r));
  base = `http://127.0.0.1:${proxy.address().port}`;
});

after(() => {
  proxy.close();
  upstream.close();
});

beforeEach(async () => {
  upstreamCalls = [];
  upstreamStatus = 200;
  upstreamReply = 'salut';
  const { __reset } = await import('../limits.js');
  __reset();
});

const rawCall = (body, headers) =>
  fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const call = (body, headers = {}) =>
  rawCall(body, {
    Authorization: 'Bearer app-token',
    'X-App-Device': 'device-aaaaaaaa',
    ...headers,
  });

const valid = {
  model: 'mistral-small-latest',
  messages: [{ role: 'user', content: 'salut' }],
  max_tokens: 500,
};

// ─── Autentificare ────────────────────────────────────────────────────────────

test('releaza o cerere valida si adauga cheia server-side', async () => {
  const res = await call(valid);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).choices[0].message.content, 'salut');
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].auth, 'Bearer test-key');
});

test('fara token => 401, fara apel upstream', async () => {
  const res = await rawCall(valid, { 'X-App-Device': 'device-aaaaaaaa' });
  assert.equal(res.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

test('Bearer gresit => 401 (inclusiv lungime diferita)', async () => {
  for (const token of ['nu-e-bun', 'app-tokem', 'app-token-mai-lung']) {
    const res = await call(valid, { Authorization: `Bearer ${token}` });
    assert.equal(res.status, 401, token);
  }
  assert.equal(upstreamCalls.length, 0);
});

test('header-ul X-Dosar-Key nu e acceptat in locul lui Bearer', async () => {
  const res = await rawCall(valid, { 'X-Dosar-Key': 'app-token' });
  assert.equal(res.status, 401);
  assert.equal(upstreamCalls.length, 0);
});

// ─── Modele ───────────────────────────────────────────────────────────────────

test('whitelist implicit: doar mistral-small-latest', async () => {
  for (const model of ['mistral-large-latest', 'pixtral-large-latest', 'mistral-medium-latest']) {
    const res = await call({ ...valid, model });
    assert.equal(res.status, 403, model);
  }
  assert.equal(upstreamCalls.length, 0);
});

test('whitelist-ul se aplica pe numele primit, nu pe cel tradus', async () => {
  const res = await call({ ...valid, model: 'gemini-3.8-flash' });
  assert.equal(res.status, 403);
  assert.equal(upstreamCalls.length, 0);
});

test('traduce numele modelului spre provider', async () => {
  const res = await call(valid);
  assert.equal(res.status, 200);
  assert.equal(upstreamCalls[0].body.model, 'gemini-3.8-flash');
});

// ─── Payload reconstruit ──────────────────────────────────────────────────────

test('max_tokens e plafonat, nu respins', async () => {
  const res = await call({ ...valid, max_tokens: 999999 });
  assert.equal(res.status, 200);
  assert.equal(upstreamCalls[0].body.max_tokens, 1000);
});

test('campurile necunoscute din corp nu ajung la provider', async () => {
  await call({ ...valid, n: 50, stream: true, tools: [{ x: 1 }] });
  const sent = upstreamCalls[0].body;
  assert.equal(sent.n, undefined);
  assert.equal(sent.tools, undefined);
  assert.equal(sent.stream, false);
});

test('mesajele sunt reconstruite: doar role si content ajung la provider', async () => {
  // `name`, `prefix`, `tool_calls` sunt parametri reali Mistral; relayate, ar
  // schimba comportamentul modelului pe contul nostru.
  await call({
    ...valid,
    messages: [
      { role: 'system', content: 'instructiune', name: 'x', prefix: true },
      { role: 'user', content: 'salut', tool_calls: [{ id: '1' }], extra: 'y' },
    ],
  });
  const sent = upstreamCalls[0].body.messages;
  assert.equal(sent.length, 2);
  for (const m of sent) {
    assert.deepEqual(Object.keys(m).sort(), ['content', 'role']);
  }
});

test('content ca lista de blocuri => 400 (prin proxy trece doar text)', async () => {
  // Un bloc `image_url` cu URL arbitrar ar rula vision/OCR pe contul nostru, iar
  // tokenii unei imagini remote nu sunt marginiti de plafonul pe corp.
  for (const content of [
    [{ type: 'image_url', image_url: { url: 'https://exemplu.test/uriaș.png' } }],
    [{ type: 'text', text: 'salut' }],
    [{ type: 'document_url', document_url: { url: 'https://exemplu.test/x.pdf' } }],
  ]) {
    const res = await call({ ...valid, messages: [{ role: 'user', content }] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error.message, /doar text/i);
  }
  assert.equal(upstreamCalls.length, 0);
});

test('rol necunoscut in messages => 400', async () => {
  const res = await call({ ...valid, messages: [{ role: 'tool', content: 'x' }] });
  assert.equal(res.status, 400);
  assert.equal(upstreamCalls.length, 0);
});

test('prea multe mesaje => 400', async () => {
  const messages = Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' }));
  const res = await call({ ...valid, messages });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /Prea multe mesaje/);
  assert.equal(upstreamCalls.length, 0);
});

test('trimite reasoning_effort cand e configurat', async () => {
  await call(valid);
  assert.equal(upstreamCalls[0].body.reasoning_effort, 'none');
});

// ─── Plafoane ─────────────────────────────────────────────────────────────────

test('limita per device => 429 dupa 2 cereri', async () => {
  assert.equal((await call(valid)).status, 200);
  assert.equal((await call(valid)).status, 200);
  const third = await call(valid);
  assert.equal(third.status, 429);
  assert.match((await third.json()).error.message, /limita de 2/);
  assert.equal(upstreamCalls.length, 2);
});

test('limita per IP prinde schimbarea header-ului de device', async () => {
  for (const device of ['device-11111111', 'device-22222222']) {
    await call(valid, { 'X-App-Device': device });
    await call(valid, { 'X-App-Device': device });
  }
  await call(valid, { 'X-App-Device': 'device-33333333' }); // al 5-lea, la limita
  const blocked = await call(valid, { 'X-App-Device': 'device-44444444' });
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error.message, /rețea/i);
  assert.equal(upstreamCalls.length, 5);
});

test('X-Forwarded-For trimis de client NU alege galeata (implicit e ignorat)', async () => {
  // Header-ul e scris de client; platformele adauga adresa reala la coada.
  // Rotindu-l, un atacator si-ar reseta cota la fiecare cerere.
  for (let i = 0; i < 5; i++) {
    await call(valid, {
      'X-App-Device': `device-rotit-${i}`,
      'X-Forwarded-For': `203.0.113.${i}`,
    });
  }
  const blocked = await call(valid, {
    'X-App-Device': 'device-rotit-9',
    'X-Forwarded-For': '203.0.113.99',
  });
  assert.equal(blocked.status, 429);
  assert.equal(upstreamCalls.length, 5);
});

test('cu TRUSTED_PROXY_HOPS=1 se ia ultimul hop, nu primul', async () => {
  const saved = config.trustedProxyHops;
  config.trustedProxyHops = 1;
  try {
    // Primul element e ales de client; ultimul e pus de platforma.
    await call(valid, { 'X-App-Device': 'device-hop-1', 'X-Forwarded-For': 'fals, 198.51.100.7' });
    await call(valid, { 'X-App-Device': 'device-hop-2', 'X-Forwarded-For': 'altul, 198.51.100.7' });
    await call(valid, { 'X-App-Device': 'device-hop-3', 'X-Forwarded-For': 'x, 198.51.100.7' });
    await call(valid, { 'X-App-Device': 'device-hop-4', 'X-Forwarded-For': 'y, 198.51.100.7' });
    await call(valid, { 'X-App-Device': 'device-hop-5', 'X-Forwarded-For': 'z, 198.51.100.7' });
    // Toate cinci au aceeasi galeata reala (198.51.100.7), desi primul element difera.
    const blocked = await call(valid, {
      'X-App-Device': 'device-hop-6',
      'X-Forwarded-For': 'w, 198.51.100.7',
    });
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error.message, /rețea/i);

    // Alt IP real => galeata proprie, deci trece.
    const altul = await call(valid, {
      'X-App-Device': 'device-hop-7',
      'X-Forwarded-For': 'w, 198.51.100.8',
    });
    assert.equal(altul.status, 200);
  } finally {
    config.trustedProxyHops = saved;
  }
});

test('plafonul global prinde chiar daca galetile de device difera', async () => {
  const savedIp = config.perIpDailyLimit;
  config.perIpDailyLimit = 100; // izolam plafonul global de cel per IP
  try {
    for (let i = 0; i < 8; i++) {
      const res = await call(valid, { 'X-App-Device': `device-glob-${i}` });
      assert.equal(res.status, 200, `cererea ${i}`);
    }
    const blocked = await call(valid, { 'X-App-Device': 'device-glob-9' });
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error.message, /plafonul zilnic/);
  } finally {
    config.perIpDailyLimit = savedIp;
  }
});

test('o cadere a providerului (5xx) nu consuma cota userului', async () => {
  upstreamStatus = 500;
  assert.equal((await call(valid)).status, 500);
  upstreamStatus = 200;
  assert.equal((await call(valid)).status, 200);
  assert.equal((await call(valid)).status, 200);
  // cota de 2/zi a fost consumata de cele doua reusite, nu de cadere
  assert.equal((await call(valid)).status, 429);
});

test('un 4xx de la provider CONSUMA cota (altfel e bucla infinita)', async () => {
  // 422 = payload refuzat de provider, 404 = MODEL_MAP gresit. Ambele sunt
  // cereri servite: iertate, ar da cota nelimitata si ar dizolva plafonul global.
  for (const status of [422, 404]) {
    const { __reset } = await import('../limits.js');
    __reset();
    upstreamCalls = [];
    upstreamStatus = status;
    assert.equal((await call(valid)).status, status);
    assert.equal((await call(valid)).status, status);
    const blocked = await call(valid);
    assert.equal(blocked.status, 429, `status ${status}`);
    assert.equal(upstreamCalls.length, 2, `status ${status}`);
  }
});

// ─── Corp ─────────────────────────────────────────────────────────────────────

test('corp peste plafon => 413 livrat efectiv, nu conexiune taiata', async () => {
  const big = { ...valid, messages: [{ role: 'user', content: 'x'.repeat(6000) }] };
  const res = await call(big);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error.message, /prea mare/);
  assert.equal(upstreamCalls.length, 0);
});

test('corp mult peste plafon => conexiune taiata, fara apel upstream', async () => {
  const huge = { ...valid, messages: [{ role: 'user', content: 'x'.repeat(40_000) }] };
  let status = 'conexiune-taiata';
  try {
    status = (await call(huge)).status;
  } catch {
    // asteptat: serverul inchide conexiunea
  }
  assert.notEqual(status, 200);
  assert.equal(upstreamCalls.length, 0);
});

test('JSON invalid => 400', async () => {
  const res = await call('nu-i json');
  assert.equal(res.status, 400);
});

// ─── Erori de la provider ─────────────────────────────────────────────────────

test('401 de la provider devine 503 (problema noastra, nu a userului)', async () => {
  upstreamStatus = 401;
  const res = await call(valid);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error.message, /indisponibil/i);
});

test('403 de la provider devine tot 503', async () => {
  upstreamStatus = 403;
  const res = await call(valid);
  assert.equal(res.status, 503);
});

test('429 de la provider devine 503: e limita contului nostru, nu a userului', async () => {
  upstreamStatus = 429;
  const res = await call(valid);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error.message, /providerul a limitat/i);
});

// ─── Confidentialitate ────────────────────────────────────────────────────────

test('continutul mesajelor si al raspunsurilor nu apare niciodata in log', async () => {
  const marker = 'MARKER-EXTRAS-RO49BTRL7f3a91';
  upstreamReply = marker;
  const lines = [];
  const originals = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...args) => lines.push(args.map(String).join(' '));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  try {
    const withMarker = { ...valid, messages: [{ role: 'user', content: `IBAN ${marker}` }] };
    await call(withMarker); // succes
    await call(withMarker, { Authorization: 'Bearer gresit' }); // auth respins
    upstreamStatus = 500;
    await call(withMarker, { 'X-App-Device': 'device-cccccccc' }); // cadere provider
    upstreamStatus = 401;
    await call(withMarker, { 'X-App-Device': 'device-dddddddd' }); // 401 -> 503
  } finally {
    Object.assign(console, originals);
  }
  assert.ok(lines.length > 0, 'proxy-ul trebuie sa logheze status/durata');
  for (const line of lines) {
    assert.ok(!line.includes(marker), `log cu continut: ${line}`);
  }
});

test('/health nu expune contoare fara token', async () => {
  const anonim = await (await fetch(`${base}/health`)).json();
  assert.equal(anonim.ok, true);
  assert.equal(anonim.devicesToday, undefined);
  assert.equal(anonim.globalCount, undefined);

  const autentificat = await (
    await fetch(`${base}/health`, { headers: { Authorization: 'Bearer app-token' } })
  ).json();
  assert.equal(autentificat.ok, true);
  assert.equal(typeof autentificat.devicesToday, 'number');
});

// ─── Configurare ──────────────────────────────────────────────────────────────

test('fara PROXY_APP_TOKEN serviciul refuza sa porneasca', async () => {
  const { assertConfigured } = await import('../config.js');
  const saved = config.appToken;
  config.appToken = '';
  try {
    assert.throws(() => assertConfigured(), /PROXY_APP_TOKEN/);
  } finally {
    config.appToken = saved;
  }
});

test('endpoint necunoscut => 404', async () => {
  const res = await fetch(`${base}/v1/models`);
  assert.equal(res.status, 404);
});
