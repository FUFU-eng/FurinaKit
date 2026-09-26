const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ROOT = path.resolve(__dirname, '../..');
const ts = require(path.join(ROOT, 'web/node_modules/typescript'));
const filename = path.join(ROOT, 'web/src/lib/upscale-job-client.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(compiled, filename);
const { waitForUpscaleJob, UpscaleJobCancelledError, isUpscaleCancelledStatus, isUpscaleTerminalStatus } = loaded.exports;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const passed = [];
async function check(name, run) { await run(); passed.push(name); console.log('PASS ' + name); }
function fixture(states, settings = {}) {
  let clock = 0, cancelled = !!settings.cancelled, polls = 0, waits = 0;
  const calls = [];
  const setCancelled = () => { cancelled = true; };
  const options = {
    isCancelled: () => cancelled,
    now: () => clock,
    timeoutMs: settings.timeoutMs ?? 100,
    pollIntervalMs: 5,
    requestTimeoutMs: 100,
    sleep: async milliseconds => { clock += milliseconds; waits++; settings.onWait?.(waits, setCancelled); },
    fetcher: async (input, init = {}) => {
      const url = String(input); calls.push({ url, method: init.method || 'GET' });
      if (url.endsWith('/cancel')) return json({ ok: settings.cancelStatus !== 503 }, settings.cancelStatus || 200);
      if (url.endsWith('/download')) {
        settings.onDownload?.(setCancelled);
        return new Response('pixels', { status: settings.downloadStatus || 200, headers: { 'content-type': 'image/png' } });
      }
      if (settings.pollError) throw new Error(settings.pollError);
      if (settings.invalidState) return json({ job: {} });
      const state = states[Math.min(polls++, states.length - 1)];
      return json({ job: typeof state === 'string' ? { status: state } : state });
    }
  };
  return { options, calls, setCancelled, get polls() { return polls; } };
}
const cancels = f => f.calls.filter(c => c.url.endsWith('/cancel'));
const downloads = f => f.calls.filter(c => c.url.endsWith('/download'));
(async () => {
  await check('terminal states include both cancellation spellings, not stopping', () => {
    for (const s of ['completed', 'failed', 'cancelled', 'canceled']) assert(isUpscaleTerminalStatus(s));
    for (const s of ['pending', 'queued', 'processing', 'stopping', undefined]) assert(!isUpscaleTerminalStatus(s));
    assert(isUpscaleCancelledStatus('cancelled')); assert(!isUpscaleCancelledStatus('failed'));
  });
  await check('successful job downloads exactly once without a cancel request', async () => {
    const f = fixture(['processing', 'completed']);
    assert.equal(await (await waitForUpscaleJob('owned-1', f.options)).text(), 'pixels');
    assert.equal(cancels(f).length, 0); assert.equal(downloads(f).length, 1);
  });
  await check('cancel during submission is sent as soon as the retained ID is available', async () => {
    const f = fixture(['stopping', 'cancelled'], { cancelled: true });
    await assert.rejects(waitForUpscaleJob('owned-2', f.options), UpscaleJobCancelledError);
    assert.deepEqual(f.calls[0], { url: '/api/jobs/owned-2/cancel', method: 'POST' });
    assert.equal(cancels(f).length, 1); assert.equal(f.polls, 2); assert.equal(downloads(f).length, 0);
  });
  await check('active cancel keeps polling stopping until backend cancellation is confirmed', async () => {
    const f = fixture(['processing', 'stopping', 'cancelled'], { onWait: (_, cancel) => cancel() });
    await assert.rejects(waitForUpscaleJob('owned-3', f.options), UpscaleJobCancelledError);
    assert.equal(f.polls, 3); assert.equal(cancels(f).length, 1); assert.equal(downloads(f).length, 0);
  });
  await check('task-centre cancellation ends the client without another POST', async () => {
    const f = fixture(['canceled']);
    await assert.rejects(waitForUpscaleJob('owned-4', f.options), UpscaleJobCancelledError);
    assert.equal(cancels(f).length, 0); assert.equal(downloads(f).length, 0);
  });
  await check('completion racing cancellation does not download or publish a UI result', async () => {
    const f = fixture(['completed'], { cancelled: true, cancelStatus: 503 });
    await assert.rejects(waitForUpscaleJob('owned-5', f.options), UpscaleJobCancelledError);
    assert.equal(downloads(f).length, 0);
  });
  await check('cancellation during result download discards the received blob', async () => {
    const f = fixture(['completed'], { onDownload: cancel => cancel() });
    await assert.rejects(waitForUpscaleJob('owned-6', f.options), UpscaleJobCancelledError);
    assert.equal(cancels(f).length, 0); assert.equal(downloads(f).length, 1);
  });
  await check('backend failure preserves its error and is not called cancellation', async () => {
    const f = fixture([{ status: 'failed', error: 'Vulkan unavailable' }]);
    await assert.rejects(waitForUpscaleJob('owned-7', f.options), /Vulkan unavailable/);
    assert.equal(cancels(f).length, 0);
  });
  await check('transport failure attempts cancellation only for the known owned job', async () => {
    const f = fixture(['processing'], { pollError: 'offline fixture' });
    await assert.rejects(waitForUpscaleJob('owned-8', f.options), /offline fixture/);
    assert.deepEqual(cancels(f), [{ url: '/api/jobs/owned-8/cancel', method: 'POST' }]);
  });
  await check('poll deadline is bounded and requests cancellation without claiming confirmation', async () => {
    const f = fixture(['processing'], { timeoutMs: 10 });
    await assert.rejects(waitForUpscaleJob('owned-9', f.options), /请在任务中心确认状态/);
    assert.equal(f.polls, 2); assert.equal(cancels(f).length, 1);
  });
  await check('failed cancellation requests have a bounded retry count and no fake terminal result', async () => {
    const f = fixture(['stopping'], { cancelled: true, cancelStatus: 503, timeoutMs: 25 });
    await assert.rejects(waitForUpscaleJob('owned-10', f.options), error => !(error instanceof UpscaleJobCancelledError));
    assert.equal(cancels(f).length, 3); assert.equal(f.polls, 5); assert.equal(downloads(f).length, 0);
  });
  await check('invalid state fails closed and attempts cleanup', async () => {
    const f = fixture([], { invalidState: true });
    await assert.rejects(waitForUpscaleJob('owned-11', f.options), /Invalid upscale job state/);
    assert.equal(cancels(f).length, 1);
  });
  await check('a fetch adapter ignoring AbortSignal still cannot hang the polling client', async () => {
    let cancelled = 0;
    await assert.rejects(waitForUpscaleJob('owned-12', {
      isCancelled: () => false, requestTimeoutMs: 10,
      fetcher: async input => {
        if (String(input).endsWith('/cancel')) { cancelled++; return json({ ok: true }); }
        return new Promise(() => {});
      }
    }), /Job response timed out/);
    assert.equal(cancelled, 1);
  });
  await check('job identifiers stay within one encoded API path segment', async () => {
    const f = fixture(['cancelled']);
    await assert.rejects(waitForUpscaleJob('a/b?c', f.options), UpscaleJobCancelledError);
    assert.equal(f.calls[0].url, '/api/jobs/a%2Fb%3Fc');
  });
  await check('missing ID does not perform a request', async () => {
    const f = fixture(['completed']);
    await assert.rejects(waitForUpscaleJob('', f.options), /任务编号/); assert.equal(f.calls.length, 0);
  });
  await check('download failure cannot be returned as a valid result', async () => {
    const f = fixture(['completed'], { downloadStatus: 500 });
    await assert.rejects(waitForUpscaleJob('owned-13', f.options), /下载超分结果失败/);
    assert.equal(cancels(f).length, 0);
  });
  await check('component retains create ID, delegates polling and stops cancelled external cards', () => {
    const source = fs.readFileSync(path.join(ROOT, 'web/src/components/tools/image-upscale-tool.tsx'), 'utf8');
    assert(source.includes('const blob = await waitForUpscaleJob(jobId, {'));
    assert(source.includes('if (isUpscaleTerminalStatus(data.job.status))'));
    assert(source.includes('err instanceof UpscaleJobCancelledError'));
    assert(source.includes('isUpscaleCancelledStatus(externalJob.status)'));
    assert(source.indexOf('const jobId = jobData?.id || jobData?.job?.id') < source.indexOf('const blob = await waitForUpscaleJob(jobId, {'));
  });
  const result = { passed: passed.length, failed: 0, checks: passed, scope: 'Injected-fetch client contract and source-integration checks; not real GUI or API end-to-end acceptance.' };
  if (process.argv[2]) {
    const target = path.resolve(ROOT, process.argv[2]);
    assert(target.startsWith(path.join(ROOT, '_verify') + path.sep));
    fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
