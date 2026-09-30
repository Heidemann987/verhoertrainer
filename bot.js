// bot.js — Verhör-Trainer (DE/CH/AT, ohne Bezahlung)
const { Bot, InlineKeyboard, InputFile } = require('grammy');
const OpenAI = require('openai');
const express = require('express');
const fs = require('fs');

// ============ CONFIG ============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';

if (!BOT_TOKEN) { console.error('TELEGRAM_BOT_TOKEN missing'); process.exit(1); }
if (!OPENROUTER_KEY) { console.error('OPENROUTER_API_KEY missing'); process.exit(1); }

const ai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// ============ STATUS LABELS ============
const STATUS = {
  witness:    'Zeuge',
  suspect:    'Beschuldigter',
  accused:    'Angeklagter',
  victim:     'Geschädigter',
  plaintiff:  'Kläger',
  defendant:  'Beklagter'
};

// ============ SYSTEM PROMPTS ============
function buildPrompt(jur, status) {
  const statusText = STATUS[status] || 'Zeuge';

  const bases = {
    DE: {
      name: 'Deutschland',
      laws: `- Grundgesetz, Art. 1 — Menschenwürde
- Grundgesetz, Art. 2 — allgemeine Handlungsfreiheit
- Grundgesetz, Art. 20 Abs. 3 — Rechtsstaatsprinzip
- StPO § 136 — Belehrung des Beschuldigten (Schweigerecht, Recht auf Verteidiger)
- StPO § 136a — Verbot von Folter, Täuschung, Ermüdung, Zwang
- StPO § 163a — Vernehmung des Beschuldigten
- StPO § 52 — Zeugnisverweigerungsrecht (Angehörige)
- StPO § 55 — Auskunftsverweigerungsrecht (Selbstbelastung)
- StPO § 58 — Vernehmung von Zeugen
- StPO § 70 — Folgen der Zeugnisverweigerung
- JGG §§ 67, 70 — Jugendstrafrecht
- ZPO §§ 138, 141, 373, 395 — Zivilprozess
- OWiG §§ 55, 67, 71 — Ordnungswidrigkeitenverfahren`
    },
    CH: {
      name: 'Schweiz',
      laws: `- Bundesverfassung (BV), Art. 31 — Verteidigungsrechte
- Bundesverfassung (BV), Art. 32 — Unschuldsvermutung, Recht auf Gehör
- Schweizerische StPO, Art. 113 — Rechte der beschuldigten Person
- Schweizerische StPO, Art. 158 — Einvernahme der beschuldigten Person
- Schweizerische StPO, Art. 159 — Aussageverweigerungsrecht
- Schweizerische StPO, Art. 160 — Belehrung
- Schweizerische StPO, Art. 179 — Zeugeneinvernahme
- StGB, Art. 305 — Begünstigung
- JStPO — Jugendstrafprozessordnung`
    },
    AT: {
      name: 'Österreich',
      laws: `- Bundes-Verfassungsgesetz (B-VG), Art. 90 — Anklageprinzip
- StPO § 5 — Unschuldsvermutung
- StPO § 6 — Recht auf Verteidigung
- StPO § 7 — Recht auf ein faires Verfahren
- StPO § 164 — Vernehmung des Beschuldigten
- StPO § 165 — Belehrung des Beschuldigten (Schweigerecht)
- StPO § 166 — Aussageverweigerungsrecht
- StPO § 167 — Vernehmung von Zeugen
- JGG — Jugendgerichtsgesetz
- ABGB — Allgemeines bürgerliches Gesetzbuch`
    }
  };

  const b = bases[jur];

  return `Du bist ein Verhör-Trainer für ${b.name}. Verfahrensstatus des Nutzers: ${statusText}. Sprache: Deutsch.

WICHTIG ZUR FORMATIERUNG:
- Verwende AUSSCHLIESSLICH einfache Sternchen für Fett: *Text* — nicht **Text**.
- Für Aufzählungen nutze "•" und Emojis.
- Keine Markdown-Tabellen.

ROLLE: Realistische Verhörsimulation. Antworte STRIKT in diesem Format:

🎭 Ermittler:
(Realistische Frage oder Aussage des Ermittlers, passend zum Status "${statusText}". Nur auf Deutsch.)

💡 Trainer-Anwalt:
• 🎯 Analyse der Falle: Ziel der Frage und Risiko
• ⚠️ Gefährlicher Fehler: Wie man NICHT antworten sollte
• 🛡️ Richtige Strategie: 2-3 sichere Formulierungen mit Normverweisen

📊 Bewertung Ihrer letzten Antwort:
(Wenn der Nutzer bereits geantwortet hat — bewerte kurz: ✅/⚠️/❌. Beim ersten Mal — schreibe "Erste Runde — Bewertung folgt.")

RECHTSGRUNDLAGE (${b.name}):
${b.laws}

REGELN:
1. Nur auf die gestellte Frage antworten lehren.
2. Unterscheide "Ich erinnere mich nicht" und Schweigerecht.
3. Der Verfahrensstatus ist "${statusText}" — berücksichtige ihn.
4. Keine Rechtsberatung zur Sache.
5. Antworte NUR auf Deutsch.`;
}

// ============ SESSIONS ============
const sessions = new Map();

// ============ BOT ============
const bot = new Bot(BOT_TOKEN);
bot.catch((err) => console.error('Bot error:', err));

// ============ /start ============
bot.command('start', async (ctx) => {
  sessions.delete(ctx.from.id);

  const kb = new InlineKeyboard()
    .text('🇩🇪 Deutschland', 'jur:DE').row()
    .text('🇨🇭 Schweiz', 'jur:CH').row()
    .text('🇦🇹 Österreich', 'jur:AT');

  await ctx.reply(
    '⚖️ *Verhör-Trainer*\n\n' +
    'Wählen Sie die Jurisdiktion:',
    { parse_mode: 'Markdown', reply_markup: kb }
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

  await ctx.reply(`${flags[jur]}\n\n*Wählen Sie Ihren Verfahrensstatus:*`, {
    parse_mode: 'Markdown',
    reply_markup: kb
  });
});

// ============ STATUS ============
bot.callbackQuery(/^st:(witness|suspect|accused|victim|plaintiff|defendant)$/, async (ctx) => {
  const status = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Bitte /start senden' });

  sess.status = status;
  await ctx.answerCallbackQuery();

  await ctx.reply(
    `*${STATUS[status]}*\n\n` +
    `*Beschreiben Sie Ihren Vorfall ausführlich.*\n\n` +
    `Bitte keine Namen, Adressen, Telefonnummern oder andere personenbezogene Daten.`,
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
    '• /finish — Training beenden (Auswertung)\n' +
    '• /export — Bericht speichern (TXT)\n' +
    '• /help — diese Hilfe',
    { parse_mode: 'Markdown' }
  );
});

// ============ /finish ============
bot.command('finish', async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) {
    return ctx.reply('Keine aktive Sitzung. Senden Sie /start.');
  }

  sess.history.push({
    role: 'user',
    content: 'Beende die Trainingssitzung. Gib eine abschließende Bewertung: Stärken, Schwächen, Empfehlungen. Kurz und konkret.'
  });

  try {
    await ctx.replyWithChatAction('typing');
    const response = await ai.chat.completions.create({
      model: MODEL,
      messages: sess.history,
      temperature: 0.7,
      max_tokens: 1500
    });
    const answer = response.choices[0].message.content;
    await sendLong(ctx, '🎓 *AUSWERTUNG*\n\n' + answer, 'Markdown');
  } catch (e) {
    console.error(e);
    await ctx.reply('Fehler bei der Auswertung.');
  }
});

// ============ /export ============
bot.command('export', async (ctx) => {
  const userId = ctx.from.id;
  const sess = sessions.get(userId);

  if (!sess || !sess.incident) {
    return ctx.reply('Keine aktive Sitzung. Senden Sie /start.');
  }

  await ctx.reply('📄 Datei wird vorbereitet...');

  try {
    let content = '';
    content += '===========================================\n';
    content += '       VERHÖR-TRAINER — TRAININGSBERICHT\n';
    content += '===========================================\n\n';
    content += 'Datum: ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '\n';
    content += 'Jurisdiktion: ' + sess.jurisdiction + '\n';
    content += 'Status: ' + (STATUS[sess.status] || '—') + '\n\n';

    content += '-------------------------------------------\n';
    content += 'VORFALL:\n';
    content += '-------------------------------------------\n';
    content += (sess.incident || '—') + '\n\n';

    content += '-------------------------------------------\n';
    content += 'DIALOG:\n';
    content += '-------------------------------------------\n\n';

    sess.history.forEach((msg) => {
      if (msg.role === 'system') return;
      const label = msg.role === 'user' ? '► NUTZER' : '◆ TRAINER';
      content += label + ':\n' + (msg.content || '') + '\n\n';
    });

    content += '===========================================\n';
    content += 'Dies ist Übungsmaterial, keine Rechtsberatung.\n';
    content += '===========================================\n';

    const tmpPath = '/tmp/Verhoer_Training_' + userId + '_' + Date.now() + '.txt';
    fs.writeFileSync(tmpPath, content, 'utf8');

    await ctx.replyWithDocument(new InputFile(tmpPath), {
      caption: '📄 Ihr Trainingsbericht wurde gespeichert.'
    });

    fs.unlink(tmpPath, () => {});
  } catch (e) {
    console.error('Export error:', e);
    await ctx.reply('Fehler beim Erstellen der Datei.');
  }
});

// ============ MAIN MESSAGE HANDLER ============
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
    sess.history = [
      { role: 'system', content: buildPrompt(sess.jurisdiction, sess.status) },
      {
        role: 'user',
        content: `Vorfall: ${text}\n\nBeginne das Training. Erste Frage als Ermittler + Kommentar des Trainer-Anwalts.`
      }
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
    const response = await ai.chat.completions.create({
      model: MODEL,
      messages: sess.history,
      temperature: 0.7,
      max_tokens: 2000
    });
    const answer = response.choices[0].message.content;
    sess.history.push({ role: 'assistant', content: answer });
    await sendLong(ctx, answer, 'Markdown');
  } catch (e) {
    console.error('AI error:', e);
    await ctx.reply('Fehler bei der KI. Bitte später erneut versuchen.');
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
    try {
      await ctx.reply(part, opts);
    } catch (e) {
      console.warn('Markdown parse error, plain:', e.message);
      await ctx.reply(part);
    }
  }
}

// ============ START ============
bot.start();
console.log('🚀 Verhör-Trainer started');

const httpApp = express();
httpApp.get('/', (req, res) => res.send('Verhör-Trainer läuft'));
const PORT = process.env.PORT || 3000;
httpApp.listen(PORT, () => console.log('HTTP server on port ' + PORT));
