import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const dom = new JSDOM(`<style>${css.replace(/^@import.*$/m, '')}</style>`);
const rules = [...dom.window.document.styleSheets[0].cssRules];
const rule = selector => rules.find(entry => entry.selectorText === selector)?.style;

test('Staff Room has slate tokens in both themes and a light print palette', () => {
  for (const [selector, row, hover, text] of [
    [':root', '#f8fafc', '#e2e8f0', '#334155'],
    ['[data-theme="dark"]', '#1e293b', '#334155', '#e2e8f0'],
  ]) {
    assert.equal(rule(selector).getPropertyValue('--report-staff-row'), row);
    assert.equal(rule(selector).getPropertyValue('--report-staff-hover'), hover);
    assert.equal(rule(selector).getPropertyValue('--report-staff-text'), text);
    assert.notEqual(rule(selector).getPropertyValue('--report-done-row'), row);
  }
  for (const prefix of ['', '[data-theme="dark"] ']) {
    for (const [state, token] of [['', 'row'], [':hover', 'hover']]) {
      const style = rule(`${prefix}.daily-report-table tr.daily-area-staff${state} td`);
      assert.equal(style.background, `var(--report-staff-${token})`);
      assert.equal(style.getPropertyPriority('background'), 'important');
    }
    const heading = rule(`${prefix}.work-report-area-staff .work-report-section-title`);
    assert.equal(heading.background, 'var(--report-staff-header)');
    assert.equal(heading.color, 'var(--report-staff-text)');
  }
  assert.match(rule('.work-report-area-staff').getPropertyValue('border-left'), /--report-staff-border/);
  const print = rules.find(entry => entry.conditionText === 'print');
  const palette = [...print.cssRules].find(entry => entry.selectorText === ':root, [data-theme="dark"]').style;
  assert.equal(palette.getPropertyValue('--report-staff-row'), '#f8fafc');
  assert.equal(palette.getPropertyValue('--report-done-row'), '#f0fdf4');
  assert.equal(palette.getPropertyValue('--report-done-text'), '#166534');
});

test('Done rows override dark striping and hover without changing classroom, lab or summary colours', () => {
  const completed = rules.filter(entry => entry.selectorText?.includes('tr.daily-report-completed'));
  assert.equal(completed.length, 2);
  for (const entry of completed) {
    assert.ok(entry.selectorText.includes('[data-theme="dark"]'));
    assert.equal(entry.style.background, `var(--report-done-${entry.selectorText.includes(':hover') ? 'hover' : 'row'})`);
    assert.equal(entry.style.getPropertyPriority('background'), 'important');
  }
  assert.equal(rule('.work-report-done').background, '#ecfdf5');
  assert.equal(rule('.work-report-section-done').color, 'var(--report-done-text)');
  for (const [area, light, dark, hover, darkHover] of [
    ['classrooms', '#eff6ff', '#172b46', '#dbeafe', '#1d3a5f'],
    ['lab', '#f5f3ff', '#272442', '#ede9fe', '#35305c'],
  ]) {
    assert.equal(rule(`.daily-report-table tr.daily-area-${area} td`).background, light);
    assert.equal(rule(`[data-theme="dark"] .daily-report-table tr.daily-area-${area} td`).background, dark);
    assert.equal(rule(`.daily-report-table tr.daily-area-${area}:hover td`).background, hover);
    assert.equal(rule(`[data-theme="dark"] .daily-report-table tr.daily-area-${area}:hover td`).background, darkHover);
  }
});