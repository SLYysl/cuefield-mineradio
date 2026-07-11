const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { createMusicalAnalysisService } = require('../desktop/cuefield-musical-analysis');

class FakeWorker extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.terminated = false;
  }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
}

test('runs one persistent worker job at a time', async () => {
  const worker = new FakeWorker();
  const service = createMusicalAnalysisService({ createWorker: () => worker, timeoutMs: 1000 });
  const first = service.analyze({ samples: new Float32Array([0.1]), sampleRate: 22050 });
  const second = service.analyze({ samples: new Float32Array([0.2]), sampleRate: 22050 });

  assert.equal(worker.messages.length, 1);
  worker.emit('message', { id: worker.messages[0].id, ok: true, profile: { confidence: 0.8 } });
  assert.deepEqual(await first, { confidence: 0.8 });
  assert.equal(worker.messages.length, 2);
  worker.emit('message', { id: worker.messages[1].id, ok: true, profile: { confidence: 0.9 } });
  assert.deepEqual(await second, { confidence: 0.9 });
  service.close();
});

test('rejects audio payloads larger than the bounded analysis window', async () => {
  const service = createMusicalAnalysisService({
    createWorker: () => new FakeWorker(),
    maxSamples: 4,
  });

  await assert.rejects(
    service.analyze({ samples: new Float32Array(5), sampleRate: 22050 }),
    /MUSICAL_ANALYSIS_SAMPLE_LIMIT/,
  );
  service.close();
});

test('restarts the worker after a timed out job', async () => {
  const workers = [];
  const service = createMusicalAnalysisService({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    timeoutMs: 15,
  });

  await assert.rejects(
    service.analyze({ samples: new Float32Array([0.1]), sampleRate: 22050 }),
    /MUSICAL_ANALYSIS_TIMEOUT/,
  );
  const next = service.analyze({ samples: new Float32Array([0.2]), sampleRate: 22050 });
  assert.equal(workers.length, 2);
  workers[1].emit('message', { id: workers[1].messages[0].id, ok: true, profile: {} });
  await next;
  service.close();
});
