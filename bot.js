// bot.js — Verhör-Trainer v7 (DE/CH/AT, UX improvements)
const { Bot, InlineKeyboard, Keyboard } = require('grammy');
const OpenAI = require('openai');
const express = require('express');

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

// ============ STATUS ============
const STATUS = {
  witness:    'Zeuge',
  suspect:    'Beschuldigter',
  accused:    'Angeklagter',
  victim:     'Geschädigter',
  plaintiff:  'Kläger',
  defendant:  'Beklagter'
};

// ============ JURISDICTIONS ============
const JUR = {
  DE: { name: 'Deutschland',   laws: 'StGB / StPO / ZPO / OWiG / Grundgesetz' },
  CH: { name: 'Schweiz',       laws: 'StGB / StPO / ZGB / BV' },
  AT: { name: 'Österreich',    laws: 'StGB / StPO / ABGB / B-VG' }
};

// ============ TRANSLATIONS ============
const T = {
  startSub: '⚠️ Das ist ein Trainingssimulator, keine Rechtsberatung.',
  chooseJur: 'Wählen Sie die Jurisdiktion:',
  chooseMode: 'Wählen Sie den Modus:',
  beginner: '🎓 Anfänger',
  exam: '📝 Prüfung',
  chooseStatus: '*Wählen Sie Ihren Verfahrensstatus:*',
  describe: (jur, status) => `🇩🇪 *${jur}* · *${status}*\n\n*Beschreiben Sie Ihren Vorfall ausführlich:*\n\n• Was ist passiert?\n• Wann?\n• Wer war beteiligt?\n• Was haben Sie getan?\n\n⚠️ Keine persönlichen Daten.`,
  preparingQ: '⏳ Erste Frage wird vorbereitet...',
  trainerStarted: '⚖️ *Trainer gestartet.*\n\nButtons unten — Schnellaktionen.',
  analyzing: '⏳ Antwort wird analysiert...',
  round: '📊 *Runde',
  endBtn: '🎓 Training beenden',
  hintBtn: '💡 Hinweis',
  summaryBtn: '📊 Auswertung',
  changeStatusBtn: '🔄 Status ändern',
  skipBtn: '⏭️ Überspringen',
  lawsBtn: '📚 Gesetze',
  hintDisabled: '💡 Im Prüfungsmodus sind Hinweise deaktiviert.',
  noSession: 'Keine aktive Sitzung. Senden Sie /start.',
  aiError: '⚠️ KI vorübergehend nicht verfügbar. Versuchen Sie es in 30 Sekunden erneut.',
  hintError: '⚠️ Hinweis-Fehler. Versuchen Sie es erneut.',
  summaryError: '⚠️ Auswertungsfehler. Versuchen Sie /finish erneut.',
  skipped: '[Frage übersprungen]',
  newTraining: 'Senden Sie /start für ein neues Training.',
  helpTitle: '⚖️ *Verhör-Trainer — Hilfe*',
  helpBody: '• /start — neu beginnen\n• /reset — Sitzung zurücksetzen\n• /finish — Auswertung\n• /help — Hilfe\n\n📚 Verwendet StGB, StPO, BV/B-VG.'
};

// ============ LANGUAGE GUARD ============
function detectLanguage(text) {
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  const cyr = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  if (latin + cyr === 0) return 'unknown';
  return latin > cyr ? 'latin' : 'cyrillic';
}

function hasWrongJurisdiction(text, jur) {
  const t = text.toLowerCase();
  if (jur === 'DE') {
    if (/упк|ук рф|конституц[а-я]+ рф|гпк|коап/.test(t)) return true;
  }
  if (jur === 'CH') {
    if (/упк|ук рф|stpo|grundgesetz/.test(t)) return true;
    if (/§ \d+ stpo|stgb §/.test(t)) return true;
  }
  if (jur === 'AT') {
    if (/упк|ук рф|stpo §|grundgesetz/.test(t)) return true;
  }
  return false;
}

// ============ LAWS CONTEXT ============
function buildLawsContext(jur) {
  const bases = {
    DE: `- Grundgesetz Art. 1, 2, 20
- StPO § 136 (Belehrung), § 136a (Verbot Zwang), § 163a
- StPO § 52 (Zeugnisverweigerung), § 55 (Auskunftsverweigerung)
- StPO § 58, § 70
- JGG §§ 67, 70
- ZPO §§ 138, 141
- OWiG §§ 55, 67, 71`,
    CH: `- Bundesverfassung (BV) Art. 31 (Verteidigungsrechte), Art. 32 (Unschuldsvermutung)
- StPO Art. 113 (Rechte der beschuldigten Person)
- StPO Art. 158, 159, 160 (Einvernahme, Aussageverweigerung, Belehrung)
- StPO Art. 179 (Zeugeneinvernahme)
- StGB Art. 305`,
    AT: `- B-VG Art. 90 (Anklageprinzip)
- StPO § 5 (Unschuldsvermutung), § 6 (Verteidigung), § 7 (faires Verfahren)
- StPO § 164, 165 (Vernehmung, Belehrung)
- StPO § 166 (Aussageverweigerung)
- StPO § 167 (Zeugen)
- JGG, ABGB`
  };
  return bases[jur] || '';
}

// ============ PROMPTS ============
function buildQuestionPrompt(jur, status, incident, history) {
  const statusText = STATUS[status];
  const country = JUR[jur].name;
  const lawsList = JUR[jur].laws;

  return `⚠️ STRIKT: Antwort NUR auf DEUTSCH.
⚠️ STRIKT: NUR Gesetze von ${country}: ${lawsList}.
⚠️ VERBOTEN: andere Sprachen, andere Länder (РФ, Kasachstan).
⚠️ EINE Frage. KEINE Analyse. KEINE Kommentare.

Land: ${country}. Status: ${statusText}.

VORFALL:
${incident}

DIALOG:
${history}

GESETZE ${country.toUpperCase()}:
${buildLawsContext(jur)}

FORMAT:
🎭 Ermittler: [eine Frage auf Deutsch]

NUR DIESE ZEILE.`;
}

function buildEvaluationPrompt(jur, status, incident, history) {
  const statusText = STATUS[status];
  const country = JUR[jur].name;
  const lawsList = JUR[jur].laws;

  return `⚠️ STRIKT: NUR DEUTSCH.
⚠️ STRIKT: NUR Gesetze von ${country}: ${lawsList}.
⚠️ VERBOTEN: Analyse der Rolle, "The user...", Fakten erfinden.
⚠️ NUR das Format unten.

Land: ${country}. Status: ${statusText}.

VORFALL:
${incident}

DIALOG:
${history}

GESETZE ${country.toUpperCase()}:
${buildLawsContext(jur)}

FORMAT (strikt):

📊 Bewertung: [✅ / ⚠️ / ❌]

⚠️ Fehler: [1 Satz oder "keine"]

🎯 Etalon: «[korrekte Formulierung]»

📚 Gesetze: [genaue Titel aus ${country}]

💬 Kurz: [1-2 Sätze]

NUR DIESES FORMAT.`;
}

function buildHintPrompt(jur, status, incident, history) {
  const statusText = STATUS[status];
  const country = JUR[jur].name;

  return `⚠️ NUR DEUTSCH. ⚠️ NUR Gesetze von ${country}. Max 2 Sätze. KEINE vollständige Antwort.

Land: ${country}. Status: ${statusText}.
VORFALL: ${incident}
DIALOG: ${history}

FORMAT:
💡 Hinweis: [max 2 Sätze auf Deutsch]`;
}

function buildSummaryPrompt(jur, status, incident, history, stats) {
  const statusText = STATUS[status];
  const country = JUR[jur].name;

  return `⚠️ NUR DEUTSCH. ⚠️ NUR Gesetze von ${country}.

Analysiere das Training und gib eine Auswertung.

Land: ${country}. Status: ${statusText}.
Statistik: richtig ${stats.correct}, Warnungen ${stats.warnings}, Fehler ${stats.errors}.

VORFALL:
${incident}

DIALOG:
${history}

FORMAT (strikt):

🎓 TRAININGS-AUSWERTUNG

✅ Richtig: ${stats.correct}
⚠️ Warnungen: ${stats.warnings}
❌ Fehler: ${stats.errors}

📊 Schwächen:
• [Punkt 1]
• [Punkt 2]
• [Punkt 3]

💡 Wiederholen:
• [Thema 1]
• [Thema 2]

🎯 Empfehlung: [1-2 Sätze]

NUR DIESES FORMAT.`;
}

// ============ SESSIONS ============
const sessions = new Map();

// ============ KEYBOARDS ============
function mainReplyKeyboard() {
  const t = T;
  return new Keyboard()
    .text(t.endBtn).text(t.hintBtn).row()
    .text(t.summaryBtn).text(t.changeStatusBtn).row()
    .resized().persistent();
}

function questionInlineKeyboard() {
  return new InlineKeyboard()
    .text(T.hintBtn, 'hint').row()
    .text(T.lawsBtn, 'show_laws').row()
    .text(T.skipBtn, 'skip_question');
}

// ============ BOT ============
const bot = new Bot(BOT_TOKEN);
bot.catch((err) => console.error('Bot error:', err));

// ============ PROGRESS BAR ============
function progressBar(sess) {
  return `${T.round} ${sess.round}*  ·  ✅ ${sess.correct}  ⚠️ ${sess.warnings}  ❌ ${sess.errors}`;
}

// ============ AI CALL ============
async function callAI(prompt, maxTokens, jur, attempt = 1) {
  let text = '';
  try {
    const r = await ai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: maxTokens
    });
    text = r.choices[0].message.content || '';
  } catch (e) {
    const is429 = e.message && (e.message.includes('429') || e.message.includes('rate') || e.message.includes('quota'));
    if (is429 && attempt < 3) {
      const wait = attempt * 15;
      console.log(`⚠️ Rate limit (${attempt}/3). Retry in ${wait}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));
      return callAI(prompt, maxTokens, jur, attempt + 1);
    }
    throw e;
  }

  const langWrong = detectLanguage(text) === 'cyrillic';
  const jurWrong = hasWrongJurisdiction(text, jur);

  if (langWrong || jurWrong) {
    console.warn(`⚠️ Guard triggered. Retrying...`);
    try {
      const retry = await ai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: text },
          { role: 'user', content: `FALSCH! Nur auf DEUTSCH. Nur Gesetze von ${JUR[jur].name}. Nur das Format.` }
        ],
        temperature: 0.2,
        max_tokens: maxTokens
      });
      const retryText = retry.choices[0].message.content || '';
      if (!hasWrongJurisdiction(retryText, jur)) text = retryText;
    } catch (e) {
      console.warn('Retry failed:', e.message);
    }
  }
  return text;
}

// ============ /start ============
bot.command('start', async (ctx) => {
  sessions.delete(ctx.from.id);
  const kb = new InlineKeyboard()
    .text('🇩🇪 Deutschland', 'jur:DE').row()
    .text('🇨🇭 Schweiz', 'jur:CH').row()
    .text('🇦🇹 Österreich', 'jur:AT');

  await ctx.reply(
    `⚖️ *Verhör-Trainer*\n\n${T.startSub}\n\n${T.chooseJur}`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// ============ JURISDICTION ============
bot.callbackQuery(/^jur:(DE|CH|AT)$/, async (ctx) => {
  const jur = ctx.match[1];
  sessions.set(ctx.from.id, {
    jur, mode: null, status: null, incident: null, history: [],
    round: 0, correct: 0, warnings: 0, errors: 0,
    currentQuestion: null
  });
  await ctx.answerCallbackQuery();

  const kb = new InlineKeyboard()
    .text(T.beginner, 'mode:beginner').row()
    .text(T.exam, 'mode:exam');

  await ctx.reply(`🇩🇪 *${JUR[jur].name}*\n\n${T.chooseMode}`, {
    parse_mode: 'Markdown',
    reply_markup: kb
  });
});

// ============ MODE ============
bot.callbackQuery(/^mode:(beginner|exam)$/, async (ctx) => {
  const mode = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Bitte /start senden' });
  sess.mode = mode;
  await ctx.answerCallbackQuery();

  const kb = new InlineKeyboard()
    .text('👤 Zeuge', 'st:witness').row()
    .text('🚨 Beschuldigter', 'st:suspect').row()
    .text('⚖️ Angeklagter', 'st:accused').row()
    .text('🛡️ Geschädigter', 'st:victim').row()
    .text('📋 Kläger', 'st:plaintiff').row()
    .text('📋 Beklagter', 'st:defendant');

  await ctx.reply(T.chooseStatus, { parse_mode: 'Markdown', reply_markup: kb });
});

// ============ STATUS ============
bot.callbackQuery(/^st:(witness|suspect|accused|victim|plaintiff|defendant)$/, async (ctx) => {
  const status = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Bitte /start senden' });
  sess.status = status;
  await ctx.answerCallbackQuery();

  const statusText = STATUS[status];
  await ctx.reply(T.describe(JUR[sess.jur].name, statusText), { parse_mode: 'Markdown' });
});

// ============ /reset ============
bot.command('reset', async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply('Sitzung zurückgesetzt. Senden Sie /start.');
});

// ============ /help ============
bot.command('help', async (ctx) => {
  await ctx.reply(`${T.helpTitle}\n\n${T.helpBody}`, { parse_mode: 'Markdown' });
});

// ============ Reply keyboard handlers ============
bot.hears(T.endBtn, async (ctx) => { await handleFinish(ctx); });
bot.hears(T.hintBtn, async (ctx) => { await handleHint(ctx); });
bot.hears(T.summaryBtn, async (ctx) => { await handleFinish(ctx); });
bot.hears(T.changeStatusBtn, async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.reply('Bitte /start senden');
  const kb = new InlineKeyboard()
    .text('👤 Zeuge', 'st:witness').row()
    .text('🚨 Beschuldigter', 'st:suspect').row()
    .text('⚖️ Angeklagter', 'st:accused').row()
    .text('🛡️ Geschädigter', 'st:victim').row()
    .text('📋 Kläger', 'st:plaintiff').row()
    .text('📋 Beklagter', 'st:defendant');
  await ctx.reply(T.chooseStatus, { parse_mode: 'Markdown', reply_markup: kb });
});

// ============ INLINE handlers ============
bot.callbackQuery('hint', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleHint(ctx);
});

async function handleHint(ctx) {
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Bitte /start senden');
  if (sess.mode === 'exam') return ctx.reply(T.hintDisabled);

  await ctx.replyWithChatAction('typing');
  try {
    const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');
    const answer = await callAI(
      buildHintPrompt(sess.jur, sess.status, sess.incident, histText),
      300,
      sess.jur
    );
    await ctx.reply(answer, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply(T.hintError);
  }
}

bot.callbackQuery('show_laws', async (ctx) => {
  await ctx.answerCallbackQuery();
  const sess = sessions.get(ctx.from.id);
  if (!sess) return;
  const laws = buildLawsContext(sess.jur);
  const country = JUR[sess.jur].name;
  await ctx.reply(`📚 *Gesetze ${country}:*\n\n${laws}`, { parse_mode: 'Markdown' });
});

bot.callbackQuery('skip_question', async (ctx) => {
  await ctx.answerCallbackQuery();
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Bitte /start senden');

  sess.round++;
  sess.errors++;
  sess.history.push({ role: 'user', content: T.skipped });

  await nextQuestion(ctx, sess);
});

// ============ /finish ============
bot.command('finish', async (ctx) => { await handleFinish(ctx); });

async function handleFinish(ctx) {
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply(T.noSession);

  await ctx.replyWithChatAction('typing');
  try {
    const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');
    const summary = await callAI(
      buildSummaryPrompt(sess.jur, sess.status, sess.incident, histText, sess),
      1200,
      sess.jur
    );
    await ctx.reply(summary, { parse_mode: 'Markdown' });
    await ctx.reply(T.newTraining);
    sessions.delete(ctx.from.id);
  } catch (e) {
    console.error(e);
    await ctx.reply(T.summaryError);
  }
}

// ============ NEXT QUESTION ============
async function nextQuestion(ctx, sess) {
  await ctx.replyWithChatAction('typing');
  try {
    const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');
    const question = await callAI(
      buildQuestionPrompt(sess.jur, sess.status, sess.incident, histText),
      500,
      sess.jur
    );
    sess.currentQuestion = question;
    sess.history.push({ role: 'assistant', content: question });

    await ctx.reply(progressBar(sess), { parse_mode: 'Markdown' });
    await ctx.reply(question, { parse_mode: 'Markdown', reply_markup: questionInlineKeyboard() });
  } catch (e) {
    console.error('AI error:', e);
    await ctx.reply(T.aiError);
  }
}

// ============ MAIN ============
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const userId = ctx.from.id;
  const sess = sessions.get(userId);
  if (!sess) return ctx.reply('Bitte /start senden');
  if (!sess.jur) return ctx.reply('Wählen Sie die Jurisdiktion: /start');
  if (!sess.mode) return ctx.reply('Wählen Sie den Modus: /start');
  if (!sess.status) return ctx.reply('Wählen Sie den Status.');

  // Skip reply keyboard labels
  if ([T.endBtn, T.hintBtn, T.summaryBtn, T.changeStatusBtn].includes(text)) return;

  // ========== FIRST INCIDENT ==========
  if (!sess.incident) {
    sess.incident = text;
    sess.history = [{ role: 'user', content: 'Vorfall: ' + text }];
    sess.round = 1;

    await ctx.reply(T.preparingQ);

    try {
      await ctx.replyWithChatAction('typing');
      const question = await callAI(
        buildQuestionPrompt(sess.jur, sess.status, sess.incident, 'Vorfall: ' + text),
        500,
        sess.jur
      );
      sess.currentQuestion = question;
      sess.history.push({ role: 'assistant', content: question });

      await ctx.reply(T.trainerStarted, {
        parse_mode: 'Markdown',
        reply_markup: mainReplyKeyboard()
      });

      await ctx.reply(progressBar(sess), { parse_mode: 'Markdown' });
      await ctx.reply(question, { parse_mode: 'Markdown', reply_markup: questionInlineKeyboard() });
    } catch (e) {
      console.error('AI error:', e);
      await ctx.reply(T.aiError);
    }
    return;
  }

  // ========== USER ANSWER ==========
  sess.history.push({ role: 'user', content: text });
  await ctx.reply(T.analyzing);

  try {
    await ctx.replyWithChatAction('typing');
    const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');
    const evaluation = await callAI(
      buildEvaluationPrompt(sess.jur, sess.status, sess.incident, histText),
      700,
      sess.jur
    );

    // Stats
    if (evaluation.includes('📊 Bewertung: ✅')) sess.correct++;
    else if (evaluation.includes('📊 Bewertung: ⚠️')) sess.warnings++;
    else if (evaluation.includes('📊 Bewertung: ❌')) sess.errors++;
    sess.round++;

    await ctx.reply(evaluation, { parse_mode: 'Markdown' });
    await nextQuestion(ctx, sess);
  } catch (e) {
    console.error('AI error:', e);
    await ctx.reply(T.aiError);
  }
});

// ============ START WITH RETRY ============
let retryCount = 0;
const MAX_RETRIES = 10;

async function startBot() {
  try {
    await bot.start({
      drop_pending_updates: true,
      onStart: (botInfo) => {
        console.log(`🚀 Verhör-Trainer v7 started as @${botInfo.username}`);
        retryCount = 0;
      }
    });
  } catch (e) {
    const is409 = e.message && e.message.includes('409');
    if (is409 && retryCount < MAX_RETRIES) {
      retryCount++;
      const wait = Math.min(30 * retryCount, 120);
      console.log(`⚠️ 409 (attempt ${retryCount}/${MAX_RETRIES}). Retry in ${wait}s...`);
      setTimeout(startBot, wait * 1000);
    } else {
      console.error('❌ Fatal:', e.message);
      process.exit(1);
    }
  }
}
startBot();

const httpApp = express();
httpApp.get('/', (req, res) => res.send('Verhör-Trainer v7 running'));
const PORT = process.env.PORT || 3000;
httpApp.listen(PORT, () => console.log('HTTP server on port ' + PORT));
