import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UNSUPPORTED_VIDEO_MESSAGE,
  validateVideoPlayback,
} from './imageUtils.js';

const makeVideoHarness = (eventName) => {
  const listeners = new Map();
  const video = {
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    removeAttribute() {},
    load() {
      if (this.src && listeners.has(eventName)) {
        queueMicrotask(() => listeners.get(eventName)?.());
      }
    },
  };

  return {
    createVideo: () => video,
    createObjectURL: () => 'blob:test-video',
    revokeObjectURL: () => {},
    timeoutMs: 100,
  };
};

test('accepts an MP4 after the browser decodes frame data', async () => {
  const result = await validateVideoPlayback(
    { name: 'evidence.mp4', type: 'video/mp4' },
    makeVideoHarness('loadeddata'),
  );

  assert.deepEqual(result, { supported: true });
});

test('rejects a video when the browser reports a codec or format error', async () => {
  const result = await validateVideoPlayback(
    { name: 'unsupported.mov', type: 'video/quicktime' },
    makeVideoHarness('error'),
  );

  assert.deepEqual(result, {
    supported: false,
    message: UNSUPPORTED_VIDEO_MESSAGE,
  });
  assert.match(result.message, /MP4 using H\.264 video and AAC audio/);
});