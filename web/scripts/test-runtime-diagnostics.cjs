// Synthetic response and parser tests. Not live IPC, GPU, or GUI acceptance.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const ts = require(path.join(ROOT, 'web/node_modules/typescript'));
const source = fs.readFileSync(path.join(ROOT, 'web/src/shared/runtime-diagnostics.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true }, reportDiagnostics: true });
assert.equal(compiled.diagnostics.length, 0);
const resultModule = { exports: {} };
new Function('exports', 'require', 'module', compiled.outputText)(resultModule.exports, require, resultModule);
const { parseDiagnostics, requestDiagnostics } = resultModule.exports;
const checks = [];
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
function legacy() {
  const required = ['image-worker', 'aria2', 'whisper'];
  return { ok: true, schemaVersion: 2, runtime: 'native-rust', verification: 'file-presence-only', dataModified: false, repaired: false, enginesExecuted: false, purged: 0,
    checks: ['image-worker', 'python-worker', 'ffmpeg', 'aria2', 'whisper', 'upscale-engine', 'upscale-models'].map(id => ({ id, label: id, labelEn: id, required: required.includes(id), status: required.includes(id) ? 'present' : 'missing' })) };
}
function bundled(verified = true, status = verified ? 'present' : 'missing') {
  const data = legacy();
  Object.assign(data, { upscaleSelection: 'bundled-lite', upscaleIntegrityVerified: verified, upscaleResourceFilesPresent: verified,
    upscaleEngineExecuted: false, upscaleFunctionAccepted: false, upscalePublisherAuthenticated: false });
  for (const row of data.checks.filter(row => row.id.startsWith('upscale-'))) Object.assign(row, {
    required: true, componentId: 'bundled-upscale-lite-v1', status, verification: verified ? 'pinned-sha256' : 'unverified'
  });
  return data;
}
(async () => {
  await check('older schema-2 responses remain readable without fabricated upscale verification', () => {
    const data = parseDiagnostics(legacy()); assert.equal(data.requiredPresent, true); assert.equal(data.bundledUpscaleVerified, false);
  });
  await check('valid pinned bundle is distinct from GPU or GUI acceptance', () => {
    const data = parseDiagnostics(bundled()); assert.equal(data.bundledUpscaleVerified, true); assert.equal(data.requiredPresent, true); assert.equal(data.workerTreeVerified, false);
  });
  await check('missing bundled resources are required, not optional downloads', () => {
    const data = parseDiagnostics(bundled(false)); assert.equal(data.requiredPresent, false); assert.equal(data.missingRequired, 2); assert.equal(data.bundledUpscaleVerified, false);
  });
  await check('present files with a failed integrity check stay unknown', () => {
    const response = bundled(false, 'unknown'); response.upscaleResourceFilesPresent = true;
    const data = parseDiagnostics(response); assert.equal(data.unknown, 2); assert.equal(data.requiredPresent, false); assert.equal(data.bundledUpscaleVerified, false);
  });
  await check('verified claim contradicting a missing model is rejected', () => {
    const data = bundled(); data.checks.find(row => row.id === 'upscale-models').status = 'missing'; assert.throws(() => parseDiagnostics(data));
  });
  await check('mere presence cannot claim a pinned hash result', () => {
    const data = bundled(false, 'present'); assert.throws(() => parseDiagnostics(data));
  });
  await check('missing or wrong row verification label is rejected', () => {
    for (const value of [undefined, 'file-presence-only', 'publisher-signed']) {
      const data = bundled(); data.checks.find(row => row.id === 'upscale-engine').verification = value; assert.throws(() => parseDiagnostics(data));
    }
  });
  await check('bundle cannot masquerade as a downloadable G52 component', () => {
    const data = bundled(); data.checks.find(row => row.id === 'upscale-models').componentId = 'upscale-ncnn'; assert.throws(() => parseDiagnostics(data));
  });
  await check('all bundled prerequisites have strict requiredness', () => {
    for (const id of ['image-worker', 'upscale-engine', 'upscale-models']) for (const value of [false, undefined, 'true']) {
      const data = bundled(); data.checks.find(row => row.id === id).required = value; assert.throws(() => parseDiagnostics(data));
    }
  });
  await check('integrity cannot be true while files are absent', () => {
    const data = bundled(); data.upscaleResourceFilesPresent = false; assert.throws(() => parseDiagnostics(data));
  });
  await check('no execution, acceptance, or publisher authentication may be inferred', () => {
    for (const field of ['upscaleEngineExecuted', 'upscaleFunctionAccepted', 'upscalePublisherAuthenticated']) for (const value of [true, undefined, 'false']) {
      const data = bundled(); data[field] = value; assert.throws(() => parseDiagnostics(data));
    }
  });
  await check('partial, duplicate, empty, and failed responses are rejected', () => {
    for (const data of [null, {}, [], { ok: true, components: { worker: true } }, { ...bundled(), ok: false }]) assert.throws(() => parseDiagnostics(data));
    const missing = bundled(); missing.checks.pop(); assert.throws(() => parseDiagnostics(missing));
    const duplicate = bundled(); duplicate.checks.push(duplicate.checks[0]); assert.throws(() => parseDiagnostics(duplicate));
  });
  await check('mutation claims are not relabelled as read-only success', () => {
    for (const [field, value] of [['dataModified', true], ['purged', 1], ['enginesExecuted', true], ['repaired', true], ['verification', 'checksum']]) {
      const data = bundled(); data[field] = value; assert.throws(() => parseDiagnostics(data));
    }
  });
  await check('experimental Python integrity validation remains independent', () => {
    const data = bundled(); data.verification = 'file-presence-with-pinned-worker-tree'; data.workerSelection = 'experimental-pinned'; data.workerIntegrityVerified = true;
    Object.assign(data.checks.find(row => row.id === 'python-worker'), { status: 'present', verification: 'pinned-tree-sha256' });
    const parsed = parseDiagnostics(data); assert.equal(parsed.workerTreeVerified, true); assert.equal(parsed.bundledUpscaleVerified, true);
    data.workerIntegrityVerified = false; assert.throws(() => parseDiagnostics(data));
  });
  await check('legacy mode still requires its Python worker', () => {
    const data = legacy(); data.runtime = 'legacy-compatible'; data.checks[0].required = false; data.checks[1].required = true;
    assert.equal(parseDiagnostics(data).missingRequired, 1);
  });
  await check('HTTP and malformed JSON errors remain errors', async () => {
    await assert.rejects(requestDiagnostics(async () => ({ ok: false, status: 503 })), /HTTP 503/);
    await assert.rejects(requestDiagnostics(async () => ({ ok: true, json: async () => { throw Error('invalid-json'); } })), /invalid-json/);
  });
  await check('non-abortable IPC adapters have a bounded UI wait', async () => {
    await assert.rejects(requestDiagnostics(() => new Promise(() => {}), 10), /timed out/);
  });
  await check('request uses the read-only diagnostic API contract', async () => {
    const data = await requestDiagnostics(async (url, init) => {
      assert.equal(url, '/api/system/scan'); assert.equal(init.method, 'POST'); assert(init.signal);
      return { ok: true, json: async () => bundled() };
    });
    assert.equal(data.bundledUpscaleVerified, true);
  });
  const report = { passed: checks.length, failed: 0, checks, scope: 'Synthetic parser/transport fixtures, not live GUI, IPC or inference acceptance' };
  if (process.argv[2]) {
    const target = path.resolve(ROOT, process.argv[2]); assert(target.startsWith(path.join(ROOT, '_verify') + path.sep));
    fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
