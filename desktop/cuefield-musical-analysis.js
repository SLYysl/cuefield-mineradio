const path = require('path');
const { Worker } = require('worker_threads');

function createMusicalAnalysisService(options = {}) {
  const createWorker = options.createWorker || (() => new Worker(
    options.workerPath || path.join(__dirname, 'cuefield-musical-worker.js'),
  ));
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
  const maxSamples = Number.isFinite(options.maxSamples) ? options.maxSamples : 22050 * 16;
  const queue = [];
  let worker = null;
  let active = null;
  let serial = 0;
  let closed = false;

  function destroyWorker() {
    if (!worker) return;
    worker.removeAllListeners();
    worker.terminate();
    worker = null;
  }

  function failActive(error, restart) {
    if (!active) return;
    clearTimeout(active.timer);
    const rejected = active;
    active = null;
    if (restart) destroyWorker();
    rejected.reject(error);
    pump();
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.on('message', (message) => {
      if (!active || !message || message.id !== active.id) return;
      clearTimeout(active.timer);
      const completed = active;
      active = null;
      if (message.ok) completed.resolve(message.profile || {});
      else completed.reject(new Error(message.error || 'MUSICAL_ANALYSIS_FAILED'));
      pump();
    });
    worker.on('error', (error) => failActive(error, true));
    worker.on('exit', (code) => {
      worker = null;
      if (active) failActive(new Error(`MUSICAL_ANALYSIS_WORKER_EXIT:${code}`), false);
    });
    return worker;
  }

  function pump() {
    if (closed || active || !queue.length) return;
    active = queue.shift();
    const currentWorker = ensureWorker();
    active.timer = setTimeout(() => {
      failActive(new Error('MUSICAL_ANALYSIS_TIMEOUT'), true);
    }, timeoutMs);
    currentWorker.postMessage({
      id: active.id,
      samples: active.payload.samples,
      sampleRate: active.payload.sampleRate,
      windowStarts: active.payload.windowStarts || [],
      windowSeconds: active.payload.windowSeconds || 0,
    });
  }

  function analyze(payload = {}) {
    if (closed) return Promise.reject(new Error('MUSICAL_ANALYSIS_CLOSED'));
    if (!(payload.samples instanceof Float32Array)) return Promise.reject(new Error('MUSICAL_ANALYSIS_SAMPLES_REQUIRED'));
    if (payload.samples.length > maxSamples) return Promise.reject(new Error('MUSICAL_ANALYSIS_SAMPLE_LIMIT'));
    return new Promise((resolve, reject) => {
      queue.push({ id: ++serial, payload, resolve, reject, timer: null });
      pump();
    });
  }

  function close() {
    closed = true;
    if (active) {
      clearTimeout(active.timer);
      active.reject(new Error('MUSICAL_ANALYSIS_CLOSED'));
      active = null;
    }
    while (queue.length) queue.shift().reject(new Error('MUSICAL_ANALYSIS_CLOSED'));
    destroyWorker();
  }

  return { analyze, close };
}

module.exports = { createMusicalAnalysisService };
