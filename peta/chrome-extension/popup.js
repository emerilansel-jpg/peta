// PeTa WA Verifier — popup logic

const $ = (id) => document.getElementById(id);

async function loadConfig() {
  const data = await chrome.storage.local.get(['groupName', 'extensionToken', 'enabled', 'stats']);
  $('group-name').value = data.groupName || '';
  $('token').value = data.extensionToken || '';
  $('enabled').checked = data.enabled === true;
  const s = data.stats || { messagesScanned: 0, triggered: 0, verifiedOk: 0 };
  $('stat-scanned').textContent = s.messagesScanned || 0;
  $('stat-triggered').textContent = s.triggered || 0;
  $('stat-verified').textContent = s.verifiedOk || 0;
}

async function saveConfig() {
  await chrome.storage.local.set({
    groupName: $('group-name').value.trim(),
    extensionToken: $('token').value.trim(),
    enabled: $('enabled').checked,
  });
  setStatusBadge('Saved', 'ok');
  refreshStatus();
}

function setStatusBadge(text, kind) {
  const b = $('status-badge');
  b.textContent = text;
  b.className = 'badge ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'warn');
}

async function pingContentScript() {
  // Find any WA Web tab and ping its content script
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (!tabs.length) return { alive: false, reason: 'no_wa_tab' };
  for (const t of tabs) {
    try {
      const r = await chrome.tabs.sendMessage(t.id, { type: 'PING' });
      if (r?.alive) return r;
    } catch {}
  }
  return { alive: false, reason: 'no_response' };
}

async function refreshStatus() {
  const cfg = await chrome.storage.local.get(['groupName', 'extensionToken', 'enabled']);
  if (!cfg.extensionToken) {
    setStatusBadge('No token', 'err');
    $('status-text').textContent = 'Paste token dulu';
    return;
  }
  if (!cfg.groupName) {
    setStatusBadge('No group', 'warn');
    $('status-text').textContent = 'Set nama grup dulu';
    return;
  }
  if (!cfg.enabled) {
    setStatusBadge('Disabled', 'warn');
    $('status-text').textContent = 'Toggle ON untuk mulai';
    return;
  }
  const status = await pingContentScript();
  if (!status.alive) {
    setStatusBadge('WA closed', 'warn');
    $('status-text').textContent = 'Buka web.whatsapp.com';
    return;
  }
  setStatusBadge('Active', 'ok');
  const inGroup = status.activeChat && cfg.groupName &&
    status.activeChat.toLowerCase().includes(cfg.groupName.toLowerCase());
  $('status-text').textContent = inGroup
    ? `Monitoring "${status.activeChat}"`
    : `Idle (buka grup "${cfg.groupName}")`;
}

async function testConnection() {
  setStatusBadge('Testing…', 'warn');
  const r = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });
  if (r?.ok && r?.result?.ok) {
    setStatusBadge('Backend OK', 'ok');
    $('status-text').textContent = 'Token valid ✅';
  } else if (r?.error === 'extension_token_missing') {
    setStatusBadge('No token', 'err');
    $('status-text').textContent = 'Paste token dulu';
  } else {
    setStatusBadge('Backend err', 'err');
    $('status-text').textContent = r?.result?.error || r?.error || 'Unknown error';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadConfig().then(refreshStatus);
  $('save-btn').addEventListener('click', saveConfig);
  $('test-btn').addEventListener('click', testConnection);
});
