import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EvidenceMedia from './EvidenceMedia';
import { isVideoFile, markMediaPath } from '../utils/imageUtils';

globalThis.window = {
  location: { origin: 'https://infra.example.test' },
};

const extensionlessVideoPath = '/objects/uploads/550e8400-e29b-41d4-a716-446655440000?media=video';

test('retains video type metadata on an extensionless object-storage path', () => {
  const upload = { name: 'walkthrough.mov', type: 'video/quicktime' };

  assert.equal(
    markMediaPath('/objects/uploads/550e8400-e29b-41d4-a716-446655440000', upload),
    extensionlessVideoPath,
  );
  assert.equal(isVideoFile(extensionlessVideoPath), true);
});

test('renders marked extensionless videos immediately as playable evidence', () => {
  const html = renderToStaticMarkup(
    <EvidenceMedia
      path={extensionlessVideoPath}
      alt="Checklist evidence"
      controls
    />,
  );

  assert.match(html, /^<video /);
  assert.match(html, /controls=""/);
  assert.match(html, /src="https:\/\/infra\.example\.test\/objects\/uploads\/[^"]+\?media=video"/);
  assert.match(html, /aria-label="Checklist evidence"/);
});

test('structured content type renders an unmarked extensionless video immediately', () => {
  const path = '/objects/uploads/550e8400-e29b-41d4-a716-446655440000';
  const html = renderToStaticMarkup(
    <EvidenceMedia path={path} contentType="video/quicktime" alt="Video evidence" />,
  );

  assert.equal(isVideoFile(path, 'video/quicktime'), true);
  assert.match(html, /^<video /);
  assert.match(html, /src="https:\/\/infra\.example\.test\/objects\/uploads\/[^"]+"/);
});

test('the shared media renderer keeps image uploads as images', () => {
  const html = renderToStaticMarkup(
    <EvidenceMedia path="/objects/uploads/photo.jpg" alt="Photo evidence" />,
  );

  assert.match(html, /<img /);
  assert.match(html, /src="https:\/\/infra\.example\.test\/objects\/uploads\/photo.jpg"/);
  assert.match(html, /alt="Photo evidence"/);
});

test('structured image content type renders an extensionless object without probing', () => {
  const html = renderToStaticMarkup(
    <EvidenceMedia
      path="/objects/uploads/550e8400-e29b-41d4-a716-446655440000"
      contentType="image/webp"
      alt="Image evidence"
    />,
  );

  assert.match(html, /<img /);
  assert.match(html, /alt="Image evidence"/);
});

test('recognizes video metadata when another query parameter is already present', () => {
  const marked = markMediaPath(
    '/objects/uploads/550e8400-e29b-41d4-a716-446655440000?download=1',
    { name: 'walkthrough.mp4', type: 'video/mp4' },
  );

  assert.equal(marked, '/objects/uploads/550e8400-e29b-41d4-a716-446655440000?download=1&media=video');
  assert.equal(isVideoFile(marked), true);
});