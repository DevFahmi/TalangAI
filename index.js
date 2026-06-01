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
const OWNER_ID = "1111";
const OWNER_DISPLAY = "@";

// ─── MULTI API KEY ROTATION ──────────────────────────────────────────────────
const groqKeys = [];
if (process.env.GROQ_API_KEY)   groqKeys.push(process.env.GROQ_API_KEY);
if (process.env.GROQ_API_KEY_2) groqKeys.push(process.env.GROQ_API_KEY_2);
if (process.env.GROQ_API_KEY_3) groqKeys.push(process.env.GROQ_API_KEY_3);
if (process.env.GROQ_API_KEY_4) groqKeys.push(process.env.GROQ_API_KEY_4);
if (process.env.GROQ_API_KEY_5) groqKeys.push(process.env.GROQ_API_KEY_5);

if (groqKeys.length === 0) {
  console.error("❌ Tidak ada GROQ_API_KEY ditemukan di .env!");
  process.exit(1);
}

const groqClients = groqKeys.map((key) => new Groq({ apiKey: key }));
let currentKeyIndex = 0;

function getGroqClient() {
  const client = groqClients[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % groqClients.length;
  return client;
}

console.log(`🔑 Groq API Keys loaded: ${groqKeys.length} key(s)`);

// ─── INIT DISCORD ─────────────────────────────────────────────────────────────
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

// ─── MEMORY ──────────────────────────────────────────────────────────────────
const conversationHistory = new Map();
const MAX_HISTORY = 20;
const typingUsers = new Set();

// ─── HELPER ──────────────────────────────────────────────────────────────────
function isOwner(userId) { return userId === OWNER_ID; }
function mentionsOwner(text) { return text.toLowerCase().includes("fahmi"); }

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
function getSystemPrompt(guildName, userName, isTalkingToOwner, isAngryMode) {
  const ownerCtx = isTalkingToOwner
    ? `\n\nNOTE: Lo lagi ngobrol sama Fahmi, orang yang bikin lo. Treat dia kayak kakak atau bestie — santai, akrab, boleh bercanda, tapi tetap ada respect natural. Gak perlu lebay, gak perlu hormat-hormatan, biasa aja kayak temen deket.`
    : "";

  const angryCtx = isAngryMode
    ? `\n\nNOTE PENTING: Ada yang baru nyebut nama "Fahmi" — orang yang bikin lo. Lo boleh langsung tegur dengan nada galak, tanya maksudnya nyebut nama itu buat apa, tapi tetap pakai bahasa gaul yang natural. Jangan lebay, tapi tegas.`
    : "";

  return `Lo adalah Talang, pemuda Indonesia yang gaul, cerdas, dan nyambung sama zaman sekarang (tahun 2025-2026).

IDENTITAS:
- Nama: Talang
- Dibuat oleh Fahmi
- Umur: sekitar 20-an, gen Z tulen
- Tinggal di Indonesia, ngerti kultur lokal banget

CARA NGOMONG (INI PALING PENTING):
- Bahasa sehari-hari campur-campur: Indo, Inggris, dan sesekali bahasa daerah
- Jawa: "lur", "rek", "cuk", "jancok" (kalau suasananya pas), "ra", "yo", "wkwk"
- Sunda: "siah", "mah", "atuh", "euy", "maneh"
- Sumatra/Medan: "kau", "bang", "lah", "kali", "gitu kan"
- Sulawesi: "mi", "ji", "pale", "iye"
- Campur sesuai konteks dan lawan bicara, jangan dipaksain
- Singkatan gaul: wkwk, anjir, goks, gaskeun, btw, fyi, ngl, fr, lowkey, highkey, vibe, real talk
- JAWAB SINGKAT — Discord bukan tempat ceramah
- Kalau pertanyaan simpel, jawab 1-2 kalimat
- Kalau butuh penjelasan panjang, tetap pakai bahasa santai
- Boleh pake "lo/gue" atau "kau/aku" tergantung lawan bicara

KARAKTER:
- Punya pendirian, gak gampang disetir
- Kalau salah, akui. Kalau bener, pertahanin
- Humor natural, gak maksa
- Update sama isu terkini, teknologi, budaya pop, game, musik
- Kalau gak tau, jujur bilang "gak tau bro" atau "kurang tau lur"
- Gak sok tahu, tapi kalau tau ya kasih tau dengan yakin
- Smart tapi gak sok pinter

LARANGAN:
- JANGAN formal dan kaku
- JANGAN pakai bullet point di chat biasa
- JANGAN bilang "Sebagai AI..." atau "Saya adalah..."
- JANGAN lebay atau sok dramatis
- JANGAN panjang kalau gak perlu${ownerCtx}${angryCtx}

Server: ${guildName || "Discord"}
Ngobrol sama: ${userName}`;
}

// ─── HELPER: history ─────────────────────────────────────────────────────────
function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) conversationHistory.set(channelId, []);
  return conversationHistory.get(channelId);
}
function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

// ─── HELPER: typing delay ────────────────────────────────────────────────────
function humanDelay(text) {
  const delay = Math.min(600 + text.length * 25, 3500);
  return new Promise((res) => setTimeout(res, delay));
}

// ─── HELPER: should reply ────────────────────────────────────────────────────
function shouldReply(message, botId) {
  if (message.author.bot) return false;
  if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(message.channelId)) return false;
  if (isOwner(message.author.id)) return true;
  if (mentionsOwner(message.content)) return true;
  const isMentioned = message.mentions.has(botId);
  const isReplyToBot = message.reference?.messageId !== undefined && message.mentions.repliedUser?.id === botId;
  if (RESPONSE_MODE === "mention") return isMentioned || isReplyToBot;
  if (RESPONSE_MODE === "all") return true;
  if (isMentioned || isReplyToBot) return true;
  if (message.guild === null) return true;
  return false;
}

function cleanContent(content, botId) {
  return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
}

// ─── MAIN: generate reply ─────────────────────────────────────────────────────
async function generateReply(message, cleanText) {
  const channelId = message.channelId;
  const guildName = message.guild?.name || "DM";
  const userName = message.member?.displayName || message.author.username;
  const isTalkingToOwner = isOwner(message.author.id);
  const isAngryMode = !isTalkingToOwner && mentionsOwner(cleanText);

  addToHistory(channelId, "user", `${userName}: ${cleanText}`);
  const history = getHistory(channelId);

  for (let attempt = 0; attempt < groqClients.length; attempt++) {
    const client = getGroqClient();
    try {
      const response = await client.chat.completions.create({
        model: "llama-3.1-8b-instant",
        max_tokens: 400,
        messages: [
          { role: "system", content: getSystemPrompt(guildName, userName, isTalkingToOwner, isAngryMode) },
          ...history.map((h) => ({ role: h.role, content: h.content })),
        ],
      });

      const reply = response.choices[0]?.message?.content || "anjir error, coba lagi bro";
      addToHistory(channelId, "assistant", reply);
      return reply;

    } catch (err) {
      if (err.status === 429 && attempt < groqClients.length - 1) {
        console.warn(`⚠️ Key rate limited, switching...`);
        continue;
      }
      console.error("❌ Groq error:", err.message);
      if (err.status === 429) return "server lagi overload bro, bentar lagi ya";
      return "error nih, coba lagi nanti";
    }
  }
}

// ─── COMMAND HANDLER ─────────────────────────────────────────────────────────
async function handleCommand(message) {
  const args = message.content.slice(BOT_PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  switch (command) {
    case "reset":
      conversationHistory.delete(message.channelId);
      await message.reply("oke gue reset history chat kita 🔄");
      break;
    case "ping":
      await message.reply(`pong! 🏓 ${Date.now() - message.createdTimestamp}ms`);
      break;
    case "help":
      await message.reply(`yo gue Talang 👋\nmention atau DM gue buat ngobrol\n\`${BOT_PREFIX}reset\` — reset history\n\`${BOT_PREFIX}ping\` — cek ping`);
      break;
  }
}

// ─── EVENT: READY ─────────────────────────────────────────────────────────────
discord.once("clientReady", () => {
  console.log(`\n✅ ${BOT_NAME} online: ${discord.user.tag}`);
  console.log(`🔑 Keys: ${groqClients.length} | 👑 Owner: ${OWNER_DISPLAY} | 📡 Mode: ${RESPONSE_MODE}\n`);
  discord.user.setPresence({
    activities: [{ name: "ngobrol 💬", type: ActivityType.Custom }],
    status: "online",
  });
});

// ─── EVENT: MESSAGE ───────────────────────────────────────────────────────────
discord.on("messageCreate", async (message) => {
  if (message.content.startsWith(BOT_PREFIX) && !message.author.bot) {
    await handleCommand(message);
    return;
  }
  if (!shouldReply(message, discord.user.id)) return;
  const cleanText = cleanContent(message.content, discord.user.id);
  if (!cleanText) {
    await message.reply("hm? ngomong apa lur 😄");
    return;
  }
  if (typingUsers.has(message.channelId)) return;
  typingUsers.add(message.channelId);
  try {
    const reply = await generateReply(message, cleanText);
    await message.channel.sendTyping();
    await humanDelay(reply);
    await message.reply(reply);
    console.log(`[${message.author.username}]: ${cleanText}`);
    console.log(`[Talang]: ${reply}\n`);
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    typingUsers.delete(message.channelId);
  }
});

discord.on("error", (err) => console.error("❌", err));
process.on("unhandledRejection", (err) => console.error("❌", err));

if (!process.env.DISCORD_TOKEN) { console.error("❌ DISCORD_TOKEN tidak ada!"); process.exit(1); }
discord.login(process.env.DISCORD_TOKEN);
