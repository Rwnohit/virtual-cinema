/**
 * Tiny voice HUD: connection dot, how many people are in the room, mic button.
 * Browsers only hand over a microphone from a real click, so a button is not
 * optional. Pass { hud: false } to createNetwork to opt out and build your own.
 */

import { t, onLanguageChange } from '../i18n/index.js';

const STYLE_ID = 'net-hud-style';

const CSS = `
.net-hud{position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px));
  z-index:40;display:flex;align-items:center;gap:8px;pointer-events:none;
  font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e9edf5}
.net-hud__pill{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;
  background:rgba(12,14,20,.72);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12)}
.net-hud__dot{width:8px;height:8px;border-radius:50%;background:#f0a202;transition:background .25s}
.net-hud[data-status="online"] .net-hud__dot{background:#4ade80}
.net-hud[data-status="offline"] .net-hud__dot{background:#ef4444}
.net-hud__btn{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:8px;
  padding:9px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.14);
  background:rgba(12,14,20,.72);backdrop-filter:blur(10px);color:#e9edf5;
  font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  transition:background .18s,border-color .18s,transform .12s}
.net-hud__btn:hover{background:rgba(28,32,42,.85)}
.net-hud__btn:active{transform:scale(.97)}
.net-hud__btn[data-on="true"]{border-color:rgba(74,222,128,.55);background:rgba(20,48,32,.8)}
.net-hud__btn[data-on="muted"]{border-color:rgba(239,68,68,.5);background:rgba(52,20,24,.8)}
.net-hud__btn:disabled{opacity:.5;cursor:default}
@media (max-width:520px){.net-hud__pill span.net-hud__label{display:none}}
`;

export function createHud({ onToggleMic }) {
  if (typeof document === 'undefined') return null;

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.className = 'net-hud';
  root.dataset.status = 'connecting';
  root.innerHTML = `
    <div class="net-hud__pill">
      <i class="net-hud__dot"></i>
      <b class="net-hud__count">0</b>
      <span class="net-hud__label">${t('net.inRoom')}</span>
    </div>
    <button class="net-hud__btn" type="button" data-on="false" aria-pressed="false">
      <span class="net-hud__icon">🎙</span><span class="net-hud__text">${t('net.mic')}</span>
    </button>`;

  const btn = root.querySelector('.net-hud__btn');
  const count = root.querySelector('.net-hud__count');
  const icon = root.querySelector('.net-hud__icon');
  const text = root.querySelector('.net-hud__text');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await onToggleMic();
    } finally {
      btn.disabled = false;
    }
  });

  document.body.appendChild(root);

  // The pill says two words, and both of them are words.
  const offLanguage = onLanguageChange(() => {
    root.querySelector('.net-hud__label').textContent = t('net.inRoom');
    if (btn.dataset.on === 'false' && icon.textContent === '🎙') text.textContent = t('net.mic');
  });

  return {
    element: root,
    setStatus(status) {
      root.dataset.status = status;
    },
    setPeerCount(n) {
      count.textContent = String(n + 1); // the others plus me
    },
    setVoice({ micEnabled, muted, error }) {
      if (error === 'mic-denied') {
        btn.dataset.on = 'false';
        icon.textContent = '🚫';
        text.textContent = t('net.micDenied');
        return;
      }
      if (!micEnabled) {
        btn.dataset.on = 'false';
        icon.textContent = '🎙';
        text.textContent = t('net.mic');
      } else if (muted) {
        btn.dataset.on = 'muted';
        icon.textContent = '🔇';
        text.textContent = t('net.micMuted');
      } else {
        btn.dataset.on = 'true';
        icon.textContent = '🎤';
        text.textContent = t('net.micOn');
      }
      btn.setAttribute('aria-pressed', String(micEnabled && !muted));
    },
    dispose() {
      offLanguage?.();
      root.remove();
    },
  };
}
