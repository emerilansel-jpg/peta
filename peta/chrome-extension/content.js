// PeTa WA Verifier — content script
//
// Runs inside web.whatsapp.com. Monitors DOM for new messages in the configured
// PeTa group. When a message body matches the trigger keyword ("peta", case-insensitive),
// extracts the sender's phone number from the message's data-id attribute and sends
// it to the background service worker for verification against Supabase.
//
// Architecture choices:
//   - DOM polling (not MutationObserver) — simpler, robust to WA Web's React re-renders
//   - data-id attribute parsing — WA Web embeds sender JID in the message DOM node
//     (format: "false_<groupId>@g.us_<msgId>_<senderPhone>@s.whatsapp.net")
//   - Per-message dedup via `seenMessages` Set — guards against polling collision

const TRIGGER_KEYWORD = 'peta';
const POLL_INTERVAL_MS = 3000;
const MAX_SEEN_CACHE = 5000;

const seenMessages = new Set();
let config = { groupName: '', enabled: false };
let lastChatTitle = '';
let stats = { messagesScanned: 0, triggered: 0, verifiedOk: 0, errors: 0 };

function log(...args) {
  console.log('%c[PeTa]', 'color:#FF6B6B;font-weight:bold', ...args);
}

function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['groupName', 'enabled'], (res) => {
      config.groupName = (res.groupName || '').trim();
      config.enabled = res.enabled === true;
      resolve();
    });
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.groupName) config.groupName = (changes.groupName.newValue || '').trim();
  if (changes.enabled) config.enabled = changes.enabled.newValue === true;
});

function getCurrentChatTitle() {
  // WA Web renders chat title in the conversation header. The element is a span
  // with `title` attribute matching the chat name.
  const header = document.querySelector('header span[title]');
  return header ? header.getAttribute('title') : '';
}

function parseDataId(dataId) {
  // Format: "<true|false>_<groupId>@g.us_<msgId>[_<senderPhone>@s.whatsapp.net]"
  // Returns { isOwn, senderPhone } or null.
  if (!dataId || typeof dataId !== 'string') return null;
  const parts = dataId.split('_');
  if (parts.length < 3) return null;
  const isOwn = parts[0] === 'true';
  let senderPhone = '';
  // The sender JID is the last segment when present (group messages from others)
  const last = parts[parts.length - 1];
  if (last.includes('@')) {
    senderPhone = last.split('@')[0];
  }
  return { isOwn, senderPhone };
}

function getMessageText(msgNode) {
  // Try a few selectors that WA Web has used for the message body text.
  // We prefer the copyable/selectable text region.
  const sel = msgNode.querySelector('span.selectable-text.copyable-text') ||
              msgNode.querySelector('span.selectable-text') ||
              msgNode.querySelector('[data-pre-plain-text] span') ||
              msgNode.querySelector('._akbu') ||
              msgNode.querySelector('span[dir]');
  return sel ? (sel.textContent || '').trim() : '';
}

function pushSeen(id) {
  seenMessages.add(id);
  if (seenMessages.size > MAX_SEEN_CACHE) {
    // Drop oldest ~20% to keep memory bounded
    const drop = Math.floor(MAX_SEEN_CACHE * 0.2);
    let i = 0;
    for (const k of seenMessages) {
      if (i++ >= drop) break;
      seenMessages.delete(k);
    }
  }
}

function showInlineToast(text, color = '#06D6A0') {
  // Render a small fixed toast in the bottom-right of WA Web so admin sees verifications happen.
  const id = 'peta-toast-' + Date.now();
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
    background: ${color}; color: white; padding: 10px 14px; border-radius: 10px;
    font-family: -apple-system, sans-serif; font-size: 13px; font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2); max-width: 320px;
    opacity: 0; transform: translateY(10px); transition: all 0.25s ease;
  `;
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

async function handleTrigger(phone, text, msgId) {
  stats.triggered++;
  log('Trigger detected:', { phone, text, msgId });
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'VERIFY',
      phone,
      messageBody: text,
      messageId: msgId,
    });
    if (response?.ok && response?.result?.ok) {
      stats.verifiedOk++;
      showInlineToast(`✅ ${response.result.message || 'Verified +Rp5.000'}`, '#06D6A0');
    } else if (response?.result?.reason === 'already_claimed') {
      // Silent — not an error, just dedup at backend
      log('Already claimed:', phone);
    } else if (response?.result?.reason === 'user_not_found') {
      showInlineToast(`⚠️ Nomor ${phone} belum daftar PeTa`, '#FFB740');
    } else {
      stats.errors++;
      showInlineToast(`❌ ${response?.result?.message || response?.error || 'Verify gagal'}`, '#EF4444');
    }
  } catch (e) {
    stats.errors++;
    log('Verify error:', e);
    showInlineToast('❌ Extension error — cek popup', '#EF4444');
  }
  chrome.storage.local.set({ stats });
}

function scanChat() {
  if (!config.enabled || !config.groupName) return;

  const title = getCurrentChatTitle();
  if (title !== lastChatTitle) {
    lastChatTitle = title;
    log('Active chat:', title || '(none)');
  }
  if (!title || !title.toLowerCase().includes(config.groupName.toLowerCase())) return;

  // All message nodes in the visible conversation pane
  const nodes = document.querySelectorAll('div[data-id]');
  for (const node of nodes) {
    const dataId = node.getAttribute('data-id');
    if (!dataId || seenMessages.has(dataId)) continue;
    pushSeen(dataId);
    stats.messagesScanned++;

    const parsed = parseDataId(dataId);
    if (!parsed || parsed.isOwn || !parsed.senderPhone) continue;

    const text = getMessageText(node);
    if (!text) continue;

    // Match: word "peta" surrounded by word boundaries (so "peta lah" matches but "petani" doesn't)
    if (/(^|\s|[^a-z0-9])peta(\s|[^a-z0-9]|$)/i.test(text)) {
      handleTrigger(parsed.senderPhone, text, dataId);
    }
  }

  // Persist stats periodically (not every scan — once per ~minute)
  if (Date.now() % 60000 < POLL_INTERVAL_MS) {
    chrome.storage.local.set({ stats, lastScanAt: new Date().toISOString() });
  }
}

async function init() {
  await loadConfig();
  log('Initialized. Group:', config.groupName || '(not set)', 'Enabled:', config.enabled);
  // Wait a beat for WA Web's React tree to render before first scan
  setTimeout(() => {
    setInterval(scanChat, POLL_INTERVAL_MS);
  }, 5000);
}

// Heartbeat for popup to detect content script is alive
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'PING') {
    sendResponse({
      alive: true,
      activeChat: getCurrentChatTitle(),
      configuredGroup: config.groupName,
      enabled: config.enabled,
      stats,
    });
    return true;
  }
});

init();
