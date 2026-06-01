// PeTa WA Verifier — service worker (background)
//
// Receives VERIFY messages from content script, POSTs to Supabase Edge Function
// `wa-extension-verify`. The function-level auth is via an extension token stored
// in chrome.storage.local (admin pastes it during setup). The Supabase anon key
// is shipped in this file (it's safe to expose — anon perms are read-only and
// the edge function checks the extension token before doing anything).

const SUPABASE_URL = 'https://yorlsgzsawchpeeazcvi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvcmxzZ3pzYXdjaHBlZWF6Y3ZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5ODU4NzQsImV4cCI6MjA5MzU2MTg3NH0.He3SQMbxTrsBmWmhZWa6P3C1TgFSBqMVjzjdnMhNjD8';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/wa-extension-verify`;

async function getToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['extensionToken'], (res) => resolve(res.extensionToken || ''));
  });
}

async function verifyWithBackend({ phone, messageBody, messageId }) {
  const token = await getToken();
  if (!token) {
    return { ok: false, error: 'extension_token_missing' };
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ phone, messageBody, messageId, extension_token: token }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, result: data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'VERIFY') {
    verifyWithBackend(msg).then(sendResponse);
    return true; // keep channel open for async response
  }
  if (msg?.type === 'TEST_CONNECTION') {
    (async () => {
      const token = await getToken();
      if (!token) return sendResponse({ ok: false, error: 'extension_token_missing' });
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ extension_token: token, action: 'ping' }),
        });
        const data = await res.json().catch(() => ({}));
        sendResponse({ ok: res.ok, status: res.status, result: data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[PeTa WA Verifier] Service worker installed.');
});
