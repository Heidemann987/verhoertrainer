// bot.js — Verhör-Trainer v8 (DE/CH/AT, Rechte + Beschwerden + Training)
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
  witness: 'Zeuge',
  suspect: 'Beschuldigter',
  accused: 'Angeklagter',
  victim: 'Geschädigter',
  plaintiff: 'Kläger',
  defendant: 'Beklagter'
};

// ============ JURISDICTIONS ============
const JUR = {
  DE: { name: 'Deutschland', flag: '🇩🇪', laws: 'StGB / StPO / ZPO / OWiG / Grundgesetz' },
  CH: { name: 'Schweiz', flag: '🇨🇭', laws: 'StGB / StPO / ZGB / Bundesverfassung' },
  AT: { name: 'Österreich', flag: '🇦🇹', laws: 'StGB / StPO / ABGB / B-VG' }
};

// ============ SCENARIOS ============
const SCENARIOS = {
  theft: {
    emoji: '🏪',
    title: 'Ladendiebstahl',
    textDe: 'Ich wurde als Zeuge zu einem Ladendiebstahl vorgeladen. In einem Geschäft wurde ein Handy gestohlen. Der Ermittler behauptet, die Kameras hätten meinen Bruder in der Nähe der Vitrine gezeigt. Er fragt mich, was ich über meinen Bruder und den Diebstahl weiß.'
  },
  traffic: {
    emoji: '🚗',
    title: 'Verkehrskontrolle',
    textDe: 'Ich wurde bei einer Verkehrskontrolle angehalten. Der Beamte begann, mich zu fragen, woher ich komme und was ich im Auto habe.'
  },
  fraud: {
    emoji: '💰',
    title: 'Betrugsermittlung',
    textDe: 'Kriminalbeamte kamen an meinen Arbeitsplatz und fragten nach einem Kollegen, der des Betrugs verdächtigt wird. Sie wollen, dass ich Fragen zu seinen Aktivitäten und meiner Beteiligung beantworte.'
  },
  search: {
    emoji: '🏠',
    title: 'Hausdurchsuchung',
    textDe: 'Die Polizei erschien mit einem Durchsuchungsbeschluss bei mir zu Hause. Während der Durchsuchung begannen sie, mich über gefundene Gegenstände und über meine Nachbarn zu befragen.'
  },
  witness_other: {
    emoji: '🧑‍⚖️',
    title: 'Zeuge in einer Strafsache',
    textDe: 'Ich wurde Zeuge einer Körperverletzung vor einer Bar. Die Polizei will meine Aussage, und sie stellt detaillierte Fragen darüber, was ich gesehen habe und wer beteiligt war.'
  },
  custom: {
    emoji: '📝',
    title: 'Eigener Vorfall',
    textDe: null
  }
};

// ============ TRANSLATIONS ============
const T = {
  startTitle: '⚖️ *Verhör-Trainer*',
  startSub: '⚠️ Das ist ein Trainingssimulator, keine Rechtsberatung.',
  chooseJur: 'Wählen Sie die Jurisdiktion:',
  chooseMode: 'Wählen Sie den Modus:',
  beginner: '🎓 Anfänger',
  exam: '📝 Prüfung',
  chooseStatus: '*Wählen Sie Ihren Verfahrensstatus:*',
  chooseScenario: '*Wählen Sie ein Szenario* oder beschreiben Sie Ihren Vorfall:',
  describeCustom: (jur, status) => `${JUR[jur].flag} *${JUR[jur].name}* · *${status}*\n\n*Beschreiben Sie Ihren Vorfall ausführlich:*\n\n• Was ist passiert?\n• Wann?\n• Wer war beteiligt?\n• Was haben Sie getan?\n\n⚠️ Keine persönlichen Daten.`,
  startingTraining: '⏳ Training wird gestartet...',
  preparingQ: '⏳ Erste Frage wird vorbereitet...',
  trainerStarted: '⚖️ *Trainer gestartet.*\n\nButtons unten — Schnellaktionen.',
  analyzing: '⏳ Antwort wird analysiert...',
  round: '📊 *Runde',
  endBtn: '🎓 Training beenden',
  hintBtn: '💡 Hinweis',
  rightsBtn: '🛡️ Meine Rechte',
  summaryBtn: '📊 Auswertung',
  changeStatusBtn: '🔄 Status ändern',
  skipBtn: '⏭️ Überspringen',
  meaningBtn: '🤔 Was meinte er?',
  lawsBtn: '📚 Gesetze',
  compareBtn: '📊 Mit Etalon vergleichen',
  hintDisabled: '💡 Im Prüfungsmodus sind Hinweise deaktiviert.',
  noSession: 'Keine aktive Sitzung. Senden Sie /start.',
  aiError: '⚠️ KI vorübergehend nicht verfügbar. Versuchen Sie es in 30 Sekunden erneut.',
  hintError: '⚠️ Hinweis-Fehler. Versuchen Sie es erneut.',
  summaryError: '⚠️ Auswertungsfehler. Versuchen Sie /finish erneut.',
  skipped: '[Frage übersprungen]',
  newTraining: 'Senden Sie /start für ein neues Training.',
  continueTraining: 'Setzen Sie das Training fort. Antworten Sie dem Ermittler oder nutzen Sie ein weiteres Recht.',
  rightsMenu: '🛡️ *Wählen Sie eine prozessuale Handlung:*',
  complaintsMenu: '📞 *Beschwerden und Dokumentation:*',
  backBtn: '← Zurück',
  helpTitle: '⚖️ *Verhör-Trainer — Hilfe*',
  helpBody: '• /start — neu beginnen\n• /reset — zurücksetzen\n• /finish — Auswertung\n• /help — Hilfe\n\n📚 Verwendet StGB, StPO, BV/B-VG.'
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
    if (/art\. \d+ bv|b-vg/.test(t)) return true;
  }
  if (jur === 'CH') {
    if (/упк|ук рф|grundgesetz|b-vg|art\. \d+ b-vg/.test(t)) return true;
  }
  if (jur === 'AT') {
    if (/упк|ук рф|grundgesetz|bundesverfassung/.test(t)) return true;
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
  return `⚠️ STRIKT: Antwort NUR auf DEUTSCH.
⚠️ STRIKT: NUR Gesetze von ${country}: ${JUR[jur].laws}.
⚠️ VERBOTEN: andere Sprachen, andere Länder.
⚠️ EINE Frage. KEINE Analyse.

Land: ${country}. Status: ${statusText}.

VORFALL:
${incident}

DIALOG:
${history}

GESETZE ${country.toUpperCase()}:
${buildLawsContext(jur)}

FORMAT:
🎭 Ermittler: [eine Frage auf Deutsch]`;
}

function buildEvaluationPrompt(jur, status, incident, history) {
  const statusText = STATUS[status];
  const country = JUR[jur].name;
  return `⚠️ STRIKT: NUR DEUTSCH.
⚠️ STRIKT: NUR Gesetze von ${country}: ${JUR[jur].laws}.
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
  return `⚠️ NUR DEUTSCH. Max 2 Sätze. KEINE vollständige Antwort.

Land: ${JUR[jur].name}. Status: ${STATUS[status]}.
VORFALL: ${incident}
DIALOG: ${history}

FORMAT:
💡 Hinweis: [max 2 Sätze auf Deutsch]`;
}

function buildMeaningPrompt(jur, question, incident) {
  return `⚠️ NUR DEUTSCH. Erkläre, was der Ermittler wirklich meinte. Was ist die Falle?

FRAGE DES ERMITTLERS: "${question}"
VORFALL: ${incident}

GESETZE ${JUR[jur].name.toUpperCase()}:
${buildLawsContext(jur)}

FORMAT:
🤔 Was der Ermittler meinte:
• 🎯 Zweck: [1 Satz]
• ⚠️ Risiko: [1 Satz]
• 🛡️ Wie antworten: [1-2 Sätze]

NUR DIESES FORMAT.`;
}

function buildActionPrompt(jur, action, status, incident, question) {
  const actions = {
    silence: 'Schweigerecht (StPO § 136, GG Art. 2 / BV Art. 31 / B-VG)',
    lawyer: 'Recht auf Verteidiger (StPO § 136, Art. 6 EMRK)',
    break: 'Recht auf Pause (StPO § 210 — max 4 Stunden)',
    protocol: 'Recht auf Protokolleinsicht und Anmerkungen',
    pressure: 'Recht, Zwang zu melden',
    translator: 'Recht auf kostenlosen Dolmetscher',
    refuse_sign: 'Recht, die Unterschrift zu verweigern',
    clarify: 'Recht auf Klärung der Frage'
  };
  return `⚠️ NUR DEUTSCH. Gib die genaue Formulierung.

Situation: Nutzer möchte ${actions[action]} nutzen.
Land: ${JUR[jur].name}. Status: ${STATUS[status]}.
Aktuelle Frage: "${question || '(keine)'}"
VORFALL: ${incident}

FORMAT:
🛡️ *${actions[action]}*

📝 Formulierung:
«[genaue Formulierung]»

⚖️ Grundlage: [Artikel]

💡 Tipp: [1 Satz]

NUR DIESES FORMAT.`;
}

function buildComplaintPrompt(jur, type, status, incident) {
  const types = {
    supervisor: 'Beschwerde beim Vorgesetzten',
    prosecutor: 'Beschwerde bei der Staatsanwaltschaft',
    protocol: 'Anmerkung ins Protokoll',
    document: 'Verstoß dokumentieren (Audio/Video/Zeugen)'
  };
  return `⚠️ NUR DEUTSCH. Anleitung für: ${types[type]}.

Land: ${JUR[jur].name}. Status: ${STATUS[status]}.
VORFALL: ${incident}

FORMAT:
📞 *${types[type]}*

📝 Wohin/was:
[1-2 Sätze]

🎯 Wie:
1. [Schritt 1]
2. [Schritt 2]
3. [Schritt 3]

⚖️ Grundlage: [Artikel]

NUR DIESES FORMAT.`;
}

function buildSummaryPrompt(jur, status, incident, history, stats) {
  const country = JUR[jur].name;
  return `⚠️ NUR DEUTSCH. ⚠️ NUR Gesetze von ${country}.

Analysiere das Training.

Land: ${country}. Status: ${STATUS[status]}.
Statistik: ✅ ${stats.correct}, ⚠️ ${stats.warnings}, ❌ ${stats.errors}.
Genutzte Rechte: ${stats.actionsUsed || 0}.

VORFALL:
${incident}

DIALOG:
${history}

GESETZE ${country.toUpperCase()}:
${buildLawsContext(jur)}

FORMAT:

🎓 TRAININGS-AUSWERTUNG

✅ Richtig: ${stats.correct}
⚠️ Warnungen: ${stats.warnings}
❌ Fehler: ${stats.errors}

📊 Schwächen:
• [Punkt 1]
• [Punkt 2]

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
  return new Keyboard()
    .text(T.endBtn).text(T.hintBtn).row()
    .text(T.rightsBtn).text(T.summaryBtn).row()
    .text(T.changeStatusBtn).resized().persistent();
}

function questionInlineKeyboard() {
  return new InlineKeyboard()
    .text(T.hintBtn, 'hint').row()
    .text(T.meaningBtn, 'meaning').row()
    .text(T.rightsBtn, 'rights_menu').row()
    .text(T.skipBtn, 'skip_question');
}

function rightsInlineKeyboard() {
  return new InlineKeyboard()
    .text('🛡️ Schweigerecht', 'act:silence').row()
    .text('👨‍⚖️ Verteidiger anfordern', 'act:lawyer').row()
    .text('⏸️ Pause anfordern', 'act:break').row()
    .text('📝 Anmerkung ins Protokoll', 'act:protocol').row()
    .text('⚠️ Zwang melden', 'act:pressure').row()
    .text('🌐 Dolmetscher anfordern', 'act:translator').row()
    .text('🚫 Unterschrift verweigern', 'act:refuse_sign').row()
    .text('🔍 Frage klären', 'act:clarify').row()
    .text('📞 Beschwerden', 'complaint_menu');
}

function complaintsInlineKeyboard() {
  return new InlineKeyboard()
    .text('📞 Vorgesetzter', 'comp:supervisor').row()
    .text('📞 Staatsanwaltschaft', 'comp:prosecutor').row()
    .text('📝 Ins Protokoll', 'comp:protocol').row()
    .text('📸 Verstoß dokumentieren', 'comp:document').row()
    .text('← Zurück', 'rights_menu');
}

function afterEvalInlineKeyboard() {
  return new InlineKeyboard()
    .text(T.compareBtn, 'compare_with_standard').row()
    .text(T.lawsBtn, 'show_laws');
}

// ============ PROGRESS ============
function progressBar(sess) {
  return `${T.round} ${sess.round}*  ·  ✅ ${sess.correct}  ⚠️ ${sess.warnings}  ❌ ${sess.errors}`;
}

// ============ BOT ============
const bot = new Bot(BOT_TOKEN);
bot.catch((err) => console.error('Bot error:', err));

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
      console.log(`⚠️ Rate limit. Retry in ${wait}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));
      return callAI(prompt, maxTokens, jur, attempt + 1);
    }
    throw e;
  }
  const wrong = detectLanguage(text) === 'cyrillic' || hasWrongJurisdiction(text, jur);
  if (wrong) {
    console.warn('⚠️ Guard triggered. Retrying...');
    try {
      const retry = await ai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: text },
          { role: 'user', content: `FALSCH! Nur auf DEUTSCH. Nur Gesetze von ${JUR[jur].name}. Nur das Format.` }
        ],
        temperature: 0.2, max_tokens: maxTokens
      });
      const rt = retry.choices[0].message.content || '';
      if (!hasWrongJurisdiction(rt, jur)) text = rt;
    } catch (e) { console.warn('Retry failed:', e.message); }
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
    `${T.startTitle}\n\n${T.startSub}\n\n${T.chooseJur}`,
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// ============ JURISDICTION ============
bot.callbackQuery(/^jur:(DE|CH|AT)$/, async (ctx) => {
  const jur = ctx.match[1];
  sessions.set(ctx.from.id, {
    jur, mode: null, status: null, incident: null, history: [],
    round: 0, correct: 0, warnings: 0, errors: 0, actionsUsed: 0,
    currentQuestion: null, lastEvaluation: null, lastUserAnswer: null, lastLaws: []
  });
  await ctx.answerCallbackQuery();

  const kb = new InlineKeyboard()
    .text(T.beginner, 'mode:beginner').row()
    .text(T.exam, 'mode:exam');

  await ctx.reply(`${JUR[jur].flag} *${JUR[jur].name}*\n\n${T.chooseMode}`, {
    parse_mode: 'Markdown', reply_markup: kb
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

  const kb = new InlineKeyboard()
    .text('🏪 ' + SCENARIOS.theft.title, 'sc:theft').row()
    .text('🚗 ' + SCENARIOS.traffic.title, 'sc:traffic').row()
    .text('💰 ' + SCENARIOS.fraud.title, 'sc:fraud').row()
    .text('🏠 ' + SCENARIOS.search.title, 'sc:search').row()
    .text('🧑‍⚖️ ' + SCENARIOS.witness_other.title, 'sc:witness_other').row()
    .text('📝 ' + SCENARIOS.custom.title, 'sc:custom');

  await ctx.reply(T.chooseScenario, { parse_mode: 'Markdown', reply_markup: kb });
});

// ============ SCENARIO ============
bot.callbackQuery(/^sc:(theft|traffic|fraud|search|witness_other|custom)$/, async (ctx) => {
  const key = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Bitte /start senden' });
  await ctx.answerCallbackQuery();

  if (key === 'custom') {
    const statusText = STATUS[sess.status];
    await ctx.reply(T.describeCustom(sess.jur, statusText), { parse_mode: 'Markdown' });
    return;
  }

  const scenario = SCENARIOS[key];
  await ctx.reply(`${scenario.emoji} *${scenario.title}*\n\n${scenario.textDe}\n\n${T.startingTraining}`, { parse_mode: 'Markdown' });
  await startTraining(ctx, sess, scenario.textDe);
});

// ============ START TRAINING ============
async function startTraining(ctx, sess, incidentText) {
  sess.incident = incidentText;
  sess.history = [{ role: 'user', content: 'Vorfall: ' + incidentText }];
  sess.round = 1;

  try {
    await ctx.replyWithChatAction('typing');
    const question = await callAI(
      buildQuestionPrompt(sess.jur, sess.status, sess.incident, 'Vorfall: ' + incidentText),
      500, sess.jur
    );
    sess.currentQuestion = question;
    sess.history.push({ role: 'assistant', content: question });

    await ctx.reply(T.trainerStarted, {
      parse_mode: 'Markdown', reply_markup: mainReplyKeyboard()
    });
    await ctx.reply(progressBar(sess), { parse_mode: 'Markdown' });
    await ctx.reply(question, { parse_mode: 'Markdown', reply_markup: questionInlineKeyboard() });
  } catch (e) {
    console.error('AI error:', e);
    await ctx.reply(T.aiError);
  }
}

// ============ Reply keyboard handlers ============
bot.hears(T.endBtn, async (ctx) => { await handleFinish(ctx); });
bot.hears(T.hintBtn, async (ctx) => { await handleHint(ctx); });
bot.hears(T.summaryBtn, async (ctx) => { await handleFinish(ctx); });
bot.hears(T.rightsBtn, async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Bitte /start senden');
  await ctx.reply(T.rightsMenu, { parse_mode: 'Markdown', reply_markup: rightsInlineKeyboard() });
});
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

// ============ INLINE: Hint ============
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
    const lastQ = sess.currentQuestion || '';
    const hist = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');
    const answer = await callAI(buildHintPrompt(sess.jur, sess.status, sess.incident, hist), 300, sess.jur);
    await ctx.reply(answer, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply(T.hintError);
  }
}

// ============ INLINE: Meaning ============
bot.callbackQuery('meaning', async (ctx) => {
  await ctx.answerCallbackQuery();
    const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.currentQuestion) return ctx.reply('Bitte /start senden');
  await ctx.replyWithChatAction('typing');
  try {
    const answer = await callAI(buildMeaningPrompt(sess.jur, sess.currentQuestion, sess.incident), 500, sess.jur);
    await ctx.reply(answer, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('⚠️ Fehler. Versuchen Sie es erneut.');
  }
});

// ============ RIGHTS MENU ============
bot.callbackQuery('rights_menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Bitte /start senden');
  await ctx.reply(T.rightsMenu, { parse_mode: 'Markdown', reply_markup: rightsInlineKeyboard() });
});

// ============ ACTION ============
bot.callbackQuery(/^act:(silence|lawyer|break|protocol|pressure|translator|refuse_sign|clarify)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const action = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Bitte /start senden');

  sess.actionsUsed = (sess.actionsUsed || 0) + 1;

  await ctx.replyWithChatAction('typing');
  try {
    const answer = await callAI(
      buildActionPrompt(sess.jur, action, sess.status, sess.incident, sess.currentQuestion),
      500, sess.jur
    );
    await ctx.reply(answer, { parse_mode: 'Markdown' });
    await ctx.reply(T.continueTraining);
  } catch (e) {
    console.error(e);
    await ctx.reply('⚠️ Fehler. Versuchen Sie es erneut.');
  }
});

// ============ COMPLAINTS ============
bot.callbackQuery('complaint_menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Bitte /start senden');
  await ctx.reply(T.complaintsMenu, { parse_mode: 'Markdown', reply_markup: complaintsInlineKeyboard() });
});

bot.callbackQuery(/^comp:(supervisor|prosecutor|protocol|document)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const type = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Bitte /start senden');

  await ctx.replyWithChatAction('typing');
  try {
    const answer = await callAI(buildComplaintPrompt(sess.jur, type, sess.status, sess.incident), 500, sess.jur);
    await ctx.reply(answer, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('⚠️ Fehler. Versuchen Sie es erneut.');
  }
});

// ============ SHOW LAWS ============
bot.callbackQuery('show_laws', async (ctx) => {
  await ctx.answerCallbackQuery();
  const sess = sessions.get(ctx.from.id);
  if (!sess) return;
  const country = JUR[sess.jur].name;
  const laws = buildLawsContext(sess.jur);
  await ctx.reply(`📚 *Gesetze ${country}:*\n\n${laws}`, { parse_mode: 'Markdown' });
});

// ============ COMPARE ============
bot.callbackQuery('compare_with_standard', async (ctx) => {
  await ctx.answerCallbackQuery();
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.lastEvaluation || !sess.lastUserAnswer) {
    return ctx.reply('📊 Noch nichts zu vergleichen. Antworten Sie dem Ermittler.');
  }
  const match = sess.lastEvaluation.match(/🎯 Etalon: «(.+?)»/s);
  const standard = match ? match[1] : '(nicht gefunden)';
  const text =
    `📊 *Vergleich mit Etalon*\n\n` +
    `👤 *Ihre Antwort:*\n«${sess.lastUserAnswer}»\n\n` +
    `🎯 *Etalon:*\n«${standard}»\n\n` +
    `💡 Achten Sie auf:\n• Präzision\n• Gesetzesverweis\n• Kürze\n\n` +
    `Versuchen Sie, die Struktur des Etalons zu nutzen.`;
  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// ============ SKIP ============
bot.callbackQuery('skip_question', async (ctx) => {
  await ctx.answerCallbackQuery();
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply('Bitte /start senden');
  sess.round++;
  sess.errors++;
  sess.history.push({ role: 'user', content: T.skipped });
  await nextQuestion(ctx, sess);
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

// ============ /finish ============
bot.command('finish', async (ctx) => { await handleFinish(ctx); });
async function handleFinish(ctx) {
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) return ctx.reply(T.noSession);

  await ctx.replyWithChatAction('typing');
  try {
    const hist = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');
    const summary = await callAI(buildSummaryPrompt(sess.jur, sess.status, sess.incident, hist, sess), 1200, sess.jur);
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
    const hist = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');
    const question = await callAI(buildQuestionPrompt(sess.jur, sess.status, sess.incident, hist), 500, sess.jur);
    sess.currentQuestion = question;
    sess.history.push({ role: 'assistant', content: question });

    await ctx.reply(progressBar(sess), { parse_mode: 'Markdown' });
    await ctx.reply(question, { parse_mode: 'Markdown', reply_markup: questionInlineKeyboard() });
  } catch (e) {
    console.error(e);
    await ctx.reply(T.aiError);
  }
}

// ============ MAIN TEXT ============
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const labels = [T.endBtn, T.hintBtn, T.rightsBtn, T.summaryBtn, T.changeStatusBtn];
  if (labels.includes(text)) return;

  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.reply('Bitte /start senden');
  if (!sess.jur) return ctx.reply('Wählen Sie die Jurisdiktion: /start');
  if (!sess.mode) return ctx.reply('Wählen Sie den Modus: /start');
  if (!sess.status) return ctx.reply('Wählen Sie den Status.');

  if (!sess.incident) {
    await startTraining(ctx, sess, text);
    return;
  }

  sess.history.push({ role: 'user', content: text });
  sess.lastUserAnswer = text;
  await ctx.reply(T.analyzing);

  try {
    await ctx.replyWithChatAction('typing');
    const hist = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');
    const evaluation = await callAI(buildEvaluationPrompt(sess.jur, sess.status, sess.incident, hist), 700, sess.jur);
    sess.lastEvaluation = evaluation;

    if (evaluation.includes('📊 Bewertung: ✅')) sess.correct++;
    else if (evaluation.includes('📊 Bewertung: ⚠️')) sess.warnings++;
    else if (evaluation.includes('📊 Bewertung: ❌')) sess.errors++;
    sess.round++;

    await ctx.reply(evaluation, { parse_mode: 'Markdown', reply_markup: afterEvalInlineKeyboard() });
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
      onStart: (bi) => {
        console.log(`🚀 Verhör-Trainer v8 started as @${bi.username}`);
        retryCount = 0;
      }
    });
  } catch (e) {
    const is409 = e.message && e.message.includes('409');
    if (is409 && retryCount < MAX_RETRIES) {
      retryCount++;
      const wait = Math.min(30 * retryCount, 120);
      console.log(`⚠️ 409 (${retryCount}/${MAX_RETRIES}). Retry in ${wait}s...`);
      setTimeout(startBot, wait * 1000);
    } else {
      console.error('❌ Fatal:', e.message);
      process.exit(1);
    }
  }
}
startBot();

const httpApp = express();
httpApp.get('/', (req, res) => res.send('Verhör-Trainer v8 running'));
const PORT = process.env.PORT || 3000;
httpApp.listen(PORT, () => console.log('HTTP server on port ' + PORT));
