import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Dashboard.jsx no longer calls retired /reports/send endpoint', () => {
  const fileContent = readFileSync(join(process.cwd(), 'src/pages/Dashboard.jsx'), 'utf-8');
  assert.equal(fileContent.includes("'/reports/send'"), false, 'Should not contain the retired /reports/send string');
});
