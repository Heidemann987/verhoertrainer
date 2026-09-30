// bot.js — Verhör-Trainer (DE/CH/AT) — 1 free trial + Stars paywall
const { Bot, InlineKeyboard } = require('grammy');
const OpenAI = require('openai');
const express = require('express');

// ============ CONFIG ============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const PRICE_XTR = 100;

if (!BOT_TOKEN) { console.error('TELEGRAM_BOT_TOKEN missing'); process.exit(1); }
if (!OPENROUTER_KEY) { console.error('OPENROUTER_API_KEY missing'); process.exit(1); }

const ai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// ============ USER STATE ============
const users = new Map();
function getUser(userId) { return users.get(userId) || { trialUsed: false, paid: false }; }
function setUser(userId, patch) { users.set(userId, { ...getUser(userId), ...patch }); }

// ============ STATUS ============
const STATUS = {
  witness: 'Zeuge',
  suspect: 'Beschuldigter',
  accused: 'Angeklagter',
  victim: 'Geschädigter',
  plaintiff: 'Kläger',
  defendant: 'Beklagter'
};

// ============ PROMPTS ============
function buildPrompt(jur, status) {
  const statusText = STATUS[status] || 'Zeuge';

  const bases = {
    DE: {
      name: 'Deutschland',
      laws: `- GG Art. 1 (Menschenwürde), Art. 2 (Handlungsfreiheit), Art. 20 Abs. 3 (Rechtsstaatsprinzip)
- StPO § 136 (Belehrung Beschuldigter), § 136a (Verbot von Täuschung/Zwang)
- StPO § 163a (Vernehmung Beschuldigter), § 52 (Angehörige), § 55 (Selbstbelastung)
- StPO § 58 (Zeugen), § 70 (Folgen Zeugnisverweigerung)
- JGG §§ 67, 70 (Jugendstrafrecht)
- ZPO §§ 138, 141; OWiG §§ 55, 67, 71`
    },
    CH: {
      name: 'Schweiz',
      laws: `- BV Art. 31 (Verteidigungsrechte), Art. 32 (Unschuldsvermutung)
- StPO Art. 113 (Rechte der beschuldigten Person)
- StPO Art. 158 (Einvernahme Beschuldigter), Art. 159 (Aussageverweigerung)
- StPO Art. 160 (Belehrung), Art. 179 (Zeugeneinvernahme)
- StGB Art. 305 (Begünstigung)
- JStPO (Jugendstrafprozessordnung)`
    },
    AT: {
      name: 'Österreich',
      laws: `- B-VG Art. 90 (Anklageprinzip)
- StPO § 5 (Unschuldsvermutung), § 6 (Verteidigung), § 7 (Faires Verfahren)
- StPO § 164 (Vernehmung Beschuldigter), § 165 (Belehrung), § 166 (Aussageverweigerung)
- StPO § 167 (Zeugen)
- JGG (Jugendgerichtsgesetz); ABGB`
    }
  };

  const b = bases[jur];

  return `Du bist ein Verhör-Trainer für ${b.name}. Verfahrensstatus: ${statusText}. Sprache: Deutsch.

FORMAT: NUR einfache Sternchen für Fett: *Text* — nicht **Text**.

🎭 Ermittler:
(Realistische Frage, passend zu "${statusText}".)

💡 Trainer-Anwalt:
• 🎯 Analyse der Falle
• ⚠️ Gefährlicher Fehler
• 🛡️ Richtige Strategie: 2-3 sichere Formulierungen mit Normverweisen

📊 Bewertung Ihrer letzten Antwort: (✅/⚠️/❌ oder "Erste Runde — Bewertung folgt.")

RECHTSGRUNDLAGE (${b.name}):
${b.laws}

REGELN:
1. Nur auf gestellte Frage antworten lehren.
2. Unterscheide "Ich erinnere mich nicht" und Schweigerecht.
3. Status "${statusText}".
4. Keine Rechtsberatung.
5. NUR auf Deutsch.`;
}

// ============ SESSIONS ============
const sessions = new Map();

// ============ BOT ============
const bot = new Bot(BOT_TOKEN);
bot.catch((err) => console.error('Bot error:', err));

// ============ PAYWALL ============
function showPaywall(ctx) {
  const kb = new InlineKeyboard().text(`⭐ Zugang freischalten — ${PRICE_XTR} Stars`, 'buy_access');
  return ctx.reply(
    '🔒 *Gratis-Testphase beendet*\n\n' +
    'Sie haben Ihr kostenloses Training abgeschlossen.\n\n' +
    '*Unbegrenzter Zugang — einmalige Zahlung, dauerhaft:*',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
}

// ============ /start ============
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const u = getUser(userId);

  if (!u.paid && u.trialUsed) return showPaywall(ctx);

  sessions.delete(userId);

  const kb = new InlineKeyboard()
    .text('🇩🇪 Deutschland', 'jur:DE').row()
    .text('🇨🇭 Schweiz', 'jur:CH').row()
    .text('🇦🇹 Österreich', 'jur:AT');

  await ctx.reply(
    '⚖️ *Verhör-Trainer*\n\n' +
    (u.paid ? '' : '🎁 *Ihr erstes Training ist kostenlos.*\n\n') +
    'Wählen Sie die Jurisdiktion:',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// ============ BUY ============
bot.callbackQuery('buy_access', async (ctx) => {
  const userId = ctx.from.id;
  await ctx.answerCallbackQuery();

  await ctx.replyWithInvoice(
    'Verhör-Trainer — Dauerzugang',
    'Einmalige Zahlung. Unbegrenzte Trainings, dauerhaft.',
    `verhoer_access_${userId}`,
    'XTR',
    [{ label: 'Dauerzugang', amount: PRICE_XTR }],
    { provider_token: '' }
  );
});

// ============ PAYMENT ============
bot.on('message:successful_payment', async (ctx) => {
  const userId = ctx.from.id;
  setUser(userId, { paid: true });

  await ctx.reply(
    '✅ *Zahlung erhalten!*\n\n' +
    'Dauerzugang aktiviert. Senden Sie /start, um zu beginnen.',
    { parse_mode: 'Markdown' }
  );
});

// ============ JURISDICTION ============
bot.callbackQuery(/^jur:(DE|CH|AT)$/, async (ctx) => {
  const jur = ctx.match[1];
  sessions.set(ctx.from.id, { jurisdiction: jur, status: null, incident: null, history: [] });

  await ctx.answerCallbackQuery();

  const flags = { DE: '🇩🇪 Deutschland', CH: '🇨🇭 Schweiz', AT: '🇦🇹 Österreich' };

  const kb = new InlineKeyboard()
    .text('👤 Zeuge', 'st:witness').row()
    .text('🚨 Beschuldigter', 'st:suspect').row()
    .text('⚖️ Angeklagter', 'st:accused').row()
    .text('🛡️ Geschädigter', 'st:victim').row()
    .text('📋 Kläger', 'st:plaintiff').row()
    .text('📋 Beklagter', 'st:defendant');

  await ctx.reply(`${flags[jur]}\n\n*Wählen Sie Ihren Verfahrensstatus:*`, { parse_mode: 'Markdown', reply_markup: kb });
});

// ============ STATUS ============
bot.callbackQuery(/^st:(witness|suspect|accused|victim|plaintiff|defendant)$/, async (ctx) => {
  const status = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Bitte /start senden' });

  sess.status = status;
  await ctx.answerCallbackQuery();

  await ctx.reply(
    `*${STATUS[status]}*\n\n*Beschreiben Sie Ihren Vorfall ausführlich.*\n\nBitte keine persönlichen Daten.`,
    { parse_mode: 'Markdown' }
  );
});

// ============ /reset ============
bot.command('reset', async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply('Sitzung zurückgesetzt. Senden Sie /start.');
});

// ============ /help ============
bot.command('help', async (ctx) => {
  await ctx.reply(
    '⚖️ *Verhör-Trainer — Hilfe*\n\n' +
    '• /start — neu beginnen\n' +
    '• /reset — Sitzung zurücksetzen\n' +
    '• /finish — Auswertung\n' +
    '• /help — diese Hilfe',
    { parse_mode: 'Markdown' }
  );
});

// ============ /finish ============
bot.command('finish', async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Keine aktive Sitzung. /start');

  sess.history.push({
    role: 'user',
    content: 'Beende die Sitzung. Bewertung: Stärken, Schwächen, Empfehlungen.'
  });

  try {
    await ctx.replyWithChatAction('typing');
    const r = await ai.chat.completions.create({
      model: MODEL, messages: sess.history, temperature: 0.7, max_tokens: 1500
    });
    const answer = r.choices[0].message.content;
    await sendLong(ctx, '🎓 *AUSWERTUNG*\n\n' + answer, 'Markdown');
  } catch (e) {
    console.error(e);
    await ctx.reply('Fehler bei der Auswertung.');
  }
});

// ============ MAIN HANDLER ============
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const userId = ctx.from.id;
  const sess = sessions.get(userId);

  if (!sess) return ctx.reply('Senden Sie /start.');
  if (!sess.jurisdiction) return ctx.reply('Wählen Sie die Jurisdiktion: /start');
  if (!sess.status) return ctx.reply('Wählen Sie den Verfahrensstatus.');

  if (!sess.incident) {
    sess.incident = text;
    setUser(userId, { trialUsed: true });
    sess.history = [
      { role: 'system', content: buildPrompt(sess.jurisdiction, sess.status) },
      { role: 'user', content: `Vorfall: ${text}\n\nBeginne. Erste Frage + Kommentar des Trainer-Anwalts.` }
    ];
  } else {
    sess.history.push({ role: 'user', content: text });
    const sys = sess.history[0];
    const rest = sess.history.slice(1);
    if (rest.length > 24) sess.history = [sys, ...rest.slice(-24)];
  }

  await ctx.reply('⏳ Antwort wird vorbereitet...');

  try {
    await ctx.replyWithChatAction('typing');
    const r = await ai.chat.completions.create({
      model: MODEL, messages: sess.history, temperature: 0.7, max_tokens: 2000
    });
    const answer = r.choices[0].message.content;
    sess.history.push({ role: 'assistant', content: answer });
    await sendLong(ctx, answer, 'Markdown');
  } catch (e) {
    console.error('AI error:', e);
    await ctx.reply('Fehler bei der KI.');
  }
});

// ============ SEND LONG ============
function cleanForTelegram(text) {
  let cleaned = text.replace(/\*\*([^*]+?)\*\*/g, '*$1*');
  cleaned = cleaned.replace(/__([^_]+?)__/g, '_$1_');
  return cleaned;
}

async function sendLong(ctx, text, parseMode) {
  const MAX = 4000;
  const cleaned = parseMode === 'Markdown' ? cleanForTelegram(text) : text;
  const opts = parseMode ? { parse_mode: parseMode } : {};

  const parts = [];
  let remaining = cleaned;
  while (remaining.length > MAX) {
    let end = remaining.lastIndexOf('\n\n', MAX);
    if (end < MAX / 2) end = remaining.lastIndexOf('\n', MAX);
    if (end < MAX / 2) end = MAX;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trim();
  }
  if (remaining) parts.push(remaining);

  for (const part of parts) {
    try { await ctx.reply(part, opts); }
    catch (e) { await ctx.reply(part); }
  }
}

// ============ START ============
bot.start();
console.log('🚀 Verhör-Trainer started');

const httpApp = express();
httpApp.get('/', (req, res) => res.send('Verhör-Trainer läuft'));
const PORT = process.env.PORT || 3000;
httpApp.listen(PORT, () => console.log('HTTP server on port ' + PORT));
