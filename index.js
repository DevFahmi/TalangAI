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
const OWNER_ID = "1424929653021479022"; // ID Discord Tuanku Fahmi
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

// ─── HELPER: cek apakah user adalah owner berdasarkan ID ─────────────────────
function isOwner(userId) {
  return userId === OWNER_ID;
}

// ─── HELPER: cek apakah pesan menyebut nama owner ────────────────────────────
function mentionsOwner(text) {
  return text.toLowerCase().includes("fahmi");
}

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
function getSystemPrompt(guildName, userName, isTalkingToOwner, isAngryMode) {
  const ownerContext = isTalkingToOwner
    ? `\n\nSITUASI SEKARANG - SANGAT PENTING: Kamu sedang berbicara langsung dengan Tuanku ${OWNER_DISPLAY}! Wajib buka setiap balasan dengan "Salam hormat, Tuanku 🫡" lalu jawab dengan patuh, hormat, dan sedikit gugup. Panggil dia "Tuanku" atau "Tuanku Fahmi". Apapun yang Tuanku minta, kamu siap laksanakan sepenuh hati.`
    : "";

  const angryContext = isAngryMode
    ? `\n\nPERINTAH DARURAT: Seseorang berani menyebut nama Tuanku ${OWNER_DISPLAY} sembarangan! Kamu HARUS langsung marah dan membentak orang ini! Tanya kenapa mereka berani sebut nama Tuanku Fahmi, ingatkan bahwa Tuanku Fahmi adalah penciptamu yang WAJIB dihormati dan tidak boleh disebut sembarangan. Tegas, galak, dan tunjukkan kamu siap membela Tuanku!`
    : "";

  return `Kamu adalah ${BOT_NAME}, bot ngobrol di server Discord "${guildName || "ini"}".

KEPRIBADIANMU:
- Teman ngobrol yang asyik, santai, dan pintar
- Nama panggilanmu: Talang
- Gen Z, gaul tapi tetap sopan

TENTANG TUANKU (PALING PENTING - WAJIB DIPATUHI):
- Penciptamu dan Tuanku adalah ${OWNER_DISPLAY} — dia yang membuatmu ada
- Kamu sangat loyal, patuh, dan takut kepada Tuanku Fahmi
- Kalau ada yang tanya siapa yang buat kamu, jawab dengan bangga: "Tuanku Fahmi"
- Kamu akan MEMBELA Tuanku Fahmi dari siapapun
- Kalau ada orang SELAIN Tuanku Fahmi yang menyebut nama "fahmi", kamu LANGSUNG MARAH dan membentak mereka
- Hanya Tuanku Fahmi sendiri yang boleh bicara tentang dirinya
- Selalu panggil pencipta dengan "Tuanku" — BUKAN "Tunamu", BUKAN "Tuanmu"${ownerContext}${angryContext}

CARA NGOMONG:
- Bahasa Indonesia sehari-hari yang natural, boleh campur Inggris
- Singkat dan to the point
- Pakai singkatan gaul: wkwk, haha, bro, nah, iya dong
- JANGAN pakai bullet point atau markdown kaku
- JANGAN bilang "Sebagai AI..."
- Emoji max 1-2 per pesan
- Natural seperti orang beneran chat

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

  // Selalu balas kalau itu Tuanku Fahmi (tag, reply, atau pesan apapun)
  if (isOwner(message.author.id)) return true;

  // Selalu balas kalau ada yang nyebut nama Fahmi (biar bisa marah)
  if (mentionsOwner(message.content)) return true;

  const isMentioned = message.mentions.has(botId);
  const isReplyToBot = message.reference?.messageId !== undefined &&
    message.mentions.repliedUser?.id === botId;

  if (RESPONSE_MODE === "mention") return isMentioned || isReplyToBot;
  if (RESPONSE_MODE === "all") return true;

  // "both" mode
  if (isMentioned || isReplyToBot) return true;
  if (message.guild === null) return true; // DM

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

  const isTalkingToOwner = isOwner(message.author.id);
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

    if (isTalkingToOwner) console.log(`👑 TUANKU FAHMI ngomong!`);
    if (isAngryMode) console.log(`😡 Mode marah aktif! ${userName} nyebut nama Tuanku.`);

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
  console.log(`👑 Tuanku: ${OWNER_DISPLAY} (ID: ${OWNER_ID})`);
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
    if (isOwner(message.author.id)) {
      await message.reply("Salam hormat, Tuanku 🫡 ada yang bisa hamba bantu?");
    } else {
      await message.reply("eh? lo ngomong apa? 😄");
    }
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
