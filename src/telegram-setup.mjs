// Einmalig: prüft das Bot-Token und zeigt die Chat-ID(s) von Leuten, die dem Bot /start geschickt haben.
// Aufruf: node src/telegram-setup.mjs
import { getMe, getUpdates } from './lib/telegram.mjs';

const me = await getMe();
console.log(`Bot OK: @${me.username} (${me.first_name})`);
const updates = await getUpdates();
const chats = new Map();
for (const u of updates) {
  const c = (u.message ?? u.edited_message ?? u.my_chat_member)?.chat;
  if (c) chats.set(c.id, `${c.type}: ${c.first_name ?? ''} ${c.username ? '@' + c.username : ''} ${c.title ?? ''}`.trim());
}
if (!chats.size) console.log('Noch keine Nachricht an den Bot gefunden – bitte dem Bot in Telegram /start schicken und erneut ausführen.');
for (const [id, who] of chats) console.log(`TELEGRAM_CHAT_ID=${id}   (${who})`);
