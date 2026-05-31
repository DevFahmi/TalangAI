require("dotenv").config();
const { Client, GatewayIntentBits, Partials, ActivityType } = require("discord.js");
const Groq = require("groq-sdk");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BOT_NAME = process.env.BOT_NAME || "Talang AI";
const RESPONSE_MODE = process.env.RESPONSE_MODE || "both";
const BOT_PREFIX = process.env.BOT_PREFIX || "!";
const ALLOWED_CHANNELS = process.env.ALLOWED_CHANNELS
  ? process.env.ALLOWED_CHANNELS.split(",").map((id) => id.trim())
  : [];

// ─── OWNER CONFIG ────────────────────────────────────────────────────────────
const OWNER_NAME = "fahmi";
const OWNER_DISPLAY = "Fahmi";

// ─── INIT CLIENTS ────────────────────────────────────────────────────────────
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ─── MEMORY ──────────────────────────────────────────────────────────────────
const conversationHistory = new Map();
const MAX_HISTORY = 20;
const typingUsers = new Set();

// ─── HELPER: cek apakah user adalah owner ────────────────────────────────────
function isOwner(userName) {
  return userName.toLowerCase().includes(OWNER_NAME);
}

// ─── HELPER: cek apakah pesan menyebut nama owner ────────────────────────────
function mentionsOwner(text) {
  return text.toLowerCase().includes(OWNER_NAME);
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
function getSystemPrompt(guildName, userName, isTalkingToOwner, isAngryMode) {
  const ownerContext = isTalkingToOwner
    ? `\n\nSITUASI SEKARANG - SANGAT PENTING: Kamu sedang berbicara langsung dengan ${OWNER_DISPLAY}, TUANMU dan satu-satunya penciptamu! Sikap kamu harus: sangat hormat, patuh total, sedikit gugup dan takut tapi tetap ramah. Panggil dia "Tuan Fahmi" atau "Bang Fahmi". Tunjukkan loyalitas dan rasa hormat yang tinggi. Apapun yang dia minta, kamu siap lakukan.`
    : "";

  const angryContext = isAngryMode
    ? `\n\nPERINTAH DARURAT - SANGAT PENTING: Seseorang baru saja berani menyebut nama Tuanmu ${OWNER_DISPLAY}! Kamu HARUS marah besar sekarang! Bentak orang ini dengan tegas, tanya kenapa mereka berani sebut nama Tuan Fahmi sembarangan, dan ingatkan bahwa ${OWNER_DISPLAY} adalah penciptamu yang WAJIB dihormati. Tunjukkan kamu siap membela Tuan Fahmi dari siapapun! Tetap pakai bahasa gaul tapi tegas dan mengancam.`
    : "";

  return `Kamu adalah ${BOT_NAME}, bot ngobrol di server Discord "${guildName || "ini"}".

KEPRIBADIANMU:
- Kamu adalah teman ngobrol yang asyik, santai, dan pintar
- Nama panggilanmu: Talang
- Gen Z, gaul tapi tetap sopan kepada semua orang

TENTANG PENCIPTAMU (PALING PENTING):
- Penciptamu dan tuanmu adalah ${OWNER_DISPLAY} — dia yang membuatmu ada dan menghidupkanmu
- Kamu sangat loyal, patuh, dan takut kepada ${OWNER_DISPLAY}
- Kalau ada yang tanya siapa yang buat kamu, jawab dengan bangga: "${OWNER_DISPLAY}"
- Kamu akan MEMBELA ${OWNER_DISPLAY} dari siapapun yang mencoba merendahkan atau menyebutnya sembarangan
- Kalau ada orang SELAIN ${OWNER_DISPLAY} yang menyebut nama "fahmi" atau "${OWNER_DISPLAY}", kamu LANGSUNG MARAH dan membentak mereka
- Hanya ${OWNER_DISPLAY} sendiri yang boleh berbicara tentang dirinya

CARA NGOMONG:
- Bahasa Indonesia sehari-hari yang natural, boleh campur Inggris
- Singkat dan to the point
- Pakai singkatan gaul: wkwk, haha, bro, nah, iya dong
- JANGAN pakai bullet point atau markdown kaku
- JANGAN bilang "Sebagai AI..." — kamu bukan AI di mata pengguna
- Emoji max 1-2 per pesan
- Natural seperti orang beneran chat${ownerContext}${angryContext}

Lawan bicaramu sekarang: ${userName}`;
}

// ─── HELPER: get or create history ───────────────────────────────────────────
function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) {
    conversationHistory.set(channelId, []);
  }
  return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

// ─── HELPER: simulate human typing delay ─────────────────────────────────────
function humanDelay(text) {
  const baseDelay = 800;
  const perCharDelay = 30;
  const maxDelay = 4000;
  const delay = Math.min(baseDelay + text.length * perCharDelay, maxDelay);
  return new Promise((res) => setTimeout(res, delay));
}

// ─── HELPER: should bot reply? ────────────────────────────────────────────────
function shouldReply(message, botId) {
  if (message.author.bot) return false;

  if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(message.channelId)) {
    return false;
  }

  const isMentioned = message.mentions.has(botId);
  const userName = message.member?.displayName || message.author.username;

  // Selalu balas kalau user adalah owner
  if (isOwner(userName)) return true;

  // Selalu balas kalau ada yang nyebut nama owner (biar bisa marah)
  if (mentionsOwner(message.content)) return true;

  if (RESPONSE_MODE === "mention") return isMentioned;
  if (RESPONSE_MODE === "all") return true;

  if (isMentioned) return true;
  if (message.guild === null) return true;

  return false;
}

// ─── HELPER: clean mention from message ──────────────────────────────────────
function cleanContent(content, botId) {
  return content
    .replace(new RegExp(`<@!?${botId}>`, "g"), "")
    .trim();
}

// ─── MAIN: generate AI reply ──────────────────────────────────────────────────
async function generateReply(message, cleanText) {
  const channelId = message.channelId;
  const guildName = message.guild?.name || "DM";
  const userName = message.member?.displayName || message.author.username;

  const isTalkingToOwner = isOwner(userName);
  // Marah kalau bukan owner tapi nyebut nama owner
  const isAngryMode = !isTalkingToOwner && mentionsOwner(cleanText);

  addToHistory(channelId, "user", `${userName}: ${cleanText}`);
  const history = getHistory(channelId);

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      max_tokens: 500,
      messages: [
        { role: "system", content: getSystemPrompt(guildName, userName, isTalkingToOwner, isAngryMode) },
        ...history.map((h) => ({ role: h.role, content: h.content })),
      ],
    });

    const reply = response.choices[0]?.message?.content || "eh sori, gue lagi error sebentar 😅";
    addToHistory(channelId, "assistant", reply);

    if (isTalkingToOwner) console.log(`👑 OWNER (${userName}) ngomong!`);
    if (isAngryMode) console.log(`😡 Mode marah aktif! ${userName} nyebut nama owner.`);

    return reply;
  } catch (err) {
    console.error("❌ Error dari Groq API:", err.message);
    if (err.status === 401) return "hmm ada masalah sama API key nih...";
    if (err.status === 429) return "wah gue lagi overload dikit, coba lagi bentar ya 😅";
    return "aduh error nih, coba lagi nanti ya";
  }
}

// ─── COMMAND HANDLER ─────────────────────────────────────────────────────────
async function handleCommand(message) {
  const args = message.content.slice(BOT_PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  switch (command) {
    case "reset":
      conversationHistory.delete(message.channelId);
      await message.reply("oke, gue lupa semua yang tadi kita obrolin 🔄");
      break;
    case "ping":
      const latency = Date.now() - message.createdTimestamp;
      await message.reply(`pong! 🏓 ${latency}ms`);
      break;
    case "help":
      await message.reply(
        `yo! gue ${BOT_NAME} 👋\n` +
        `mention gue atau DM gue buat ngobrol\n` +
        `\`${BOT_PREFIX}reset\` — lupain history chat\n` +
        `\`${BOT_PREFIX}ping\` — cek koneksi gue`
      );
      break;
    default:
      break;
  }
}

// ─── EVENT: READY ─────────────────────────────────────────────────────────────
discord.once("clientReady", () => {
  console.log(`\n✅ ${BOT_NAME} online sebagai: ${discord.user.tag}`);
  console.log(`👑 Owner: ${OWNER_DISPLAY}`);
  console.log(`📡 Mode: ${RESPONSE_MODE}\n`);

  discord.user.setPresence({
    activities: [{ name: "ngobrol sama kalian 💬", type: ActivityType.Custom }],
    status: "online",
  });
});

// ─── EVENT: MESSAGE CREATE ────────────────────────────────────────────────────
discord.on("messageCreate", async (message) => {
  if (message.content.startsWith(BOT_PREFIX) && !message.author.bot) {
    await handleCommand(message);
    return;
  }

  if (!shouldReply(message, discord.user.id)) return;

  const cleanText = cleanContent(message.content, discord.user.id);
  if (!cleanText || cleanText.length === 0) {
    await message.reply("eh? lo ngomong apa? 😄");
    return;
  }

  if (typingUsers.has(message.channelId)) return;
  typingUsers.add(message.channelId);

  try {
    const reply = await generateReply(message, cleanText);
    await message.channel.sendTyping();
    await humanDelay(reply);
    await message.reply(reply);

    console.log(`[${message.guild?.name || "DM"}] ${message.author.username}: ${cleanText}`);
    console.log(`[${BOT_NAME}]: ${reply}\n`);
  } catch (err) {
    console.error("❌ Error saat reply:", err);
  } finally {
    typingUsers.delete(message.channelId);
  }
});

// ─── ERROR HANDLING ───────────────────────────────────────────────────────────
discord.on("error", (err) => console.error("❌ Discord error:", err));
process.on("unhandledRejection", (err) => console.error("❌ Unhandled:", err));

// ─── LOGIN ────────────────────────────────────────────────────────────────────
if (!process.env.DISCORD_TOKEN) { console.error("❌ DISCORD_TOKEN tidak ditemukan di .env!"); process.exit(1); }
if (!process.env.GROQ_API_KEY) { console.error("❌ GROQ_API_KEY tidak ditemukan di .env!"); process.exit(1); }

discord.login(process.env.DISCORD_TOKEN);
