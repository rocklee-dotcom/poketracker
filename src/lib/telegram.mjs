// Minimaler Telegram-Client (Bot API). Das Token wird nie ausgegeben.
import './env.mjs';

const MAX = 4000; // Telegram-Limit 4096 Zeichen pro Nachricht, mit Puffer

function api(method) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN fehlt (.env lokal bzw. GitHub-Secret)');
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function call(method, body) {
  const res = await fetch(api(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
}

export const getMe = () => call('getMe');
export const getUpdates = () => call('getUpdates');

// Telegram zählt nur den sichtbaren Text (ohne HTML-Tags/Link-Ziele) gegen das 4096-Zeichen-Limit.
const visibleLength = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot);/g, '_').length;

/** Sendet HTML-Text; teilt an Abschnittsgrenzen (Leerzeilen), falls zu lang. */
export async function sendHtml(text, chatId = process.env.TELEGRAM_CHAT_ID) {
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID fehlt');
  const parts = [];
  let cur = '';
  for (const block of text.split('\n\n')) {
    if (visibleLength(cur + '\n\n' + block) > MAX && cur) {
      parts.push(cur);
      cur = block;
    } else cur = cur ? cur + '\n\n' + block : block;
  }
  if (cur) parts.push(cur);
  for (const part of parts) {
    await call('sendMessage', { chat_id: chatId, text: part, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }
  return parts.length;
}

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
