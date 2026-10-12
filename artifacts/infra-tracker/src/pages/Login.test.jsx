import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { LoginForm } from './Login';

test('declares password-manager autocomplete metadata for sign-in fields', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <LoginForm login={async () => ({ success: false })} />
    </MemoryRouter>,
  );
  const document = new JSDOM(html).window.document;
  const emailInput = document.querySelector('input[type="email"]');
  const passwordInput = document.querySelector('input[type="password"]');

  assert.equal(emailInput?.getAttribute('autocomplete'), 'email');
  assert.equal(passwordInput?.getAttribute('autocomplete'), 'current-password');
});