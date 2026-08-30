/* ============================================================
   VIVID IELTS — Premium Approval Bot
   ------------------------------------------------------------
   Flow:
   1. A user sends /start, is told to send their full name +
      the email they registered on the site with, after paying.
   2. Any text message from a user is treated as a "payment claim"
      and forwarded to the ADMIN with two buttons:
        ✅ Premium berish   ❌ Rad etish
   3. When the admin taps "✅ Premium berish", the bot calls the
      Supabase REST API (using the SERVICE ROLE key, which bypasses
      row-level security) and:
        - finds the user in auth.users by email
        - upserts a row in "profiles" with tariff='premium' and
          premium_expires_at = now() + PREMIUM_DAYS
      Then it confirms to both the admin and the original user.
   ============================================================ */

const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

// ---- Required environment variables ----
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREMIUM_DAYS = parseInt(process.env.PREMIUM_DAYS || '30', 10);

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables. Check your .env file / hosting config.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ---- Minimal HTTP server (Render health checks uchun) ----
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Premium bot is running.');
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT} (for Render health checks)`);
  });

// ---- Keep-alive (Free Render Web Service uchun) ----
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL || 
  (process.env.RENDER_EXTERNAL_HOSTNAME 
    ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` 
    : null);

if (KEEP_ALIVE_URL) {
  setInterval(() => {
    https.get(KEEP_ALIVE_URL, (res) => {
      console.log(`[Keep-alive] ${KEEP_ALIVE_URL} → ${res.statusCode}`);
    }).on('error', (err) => {
      console.log(`[Keep-alive] Error: ${err.message}`);
    });
  }, 4 * 60 * 1000); // har 4 daqiqada
  console.log(`[Keep-alive] Enabled → ${KEEP_ALIVE_URL}`);
}

// In-memory store
const pendingRequests = {};
let requestCounter = 1;

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

// ---- /start ----
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Salom! 👋\n\nPremium tarifga o'tish uchun:\n1) To'lovni amalga oshiring\n2) Shu botga to'lov chekini (screenshot) VA saytda ro'yxatdan o'tgan emailingizni yuboring\n\nAdmin tekshirib, tez orada Premiumni faollashtiradi ✅`
  );
});

// ---- Any message from a normal user (not the admin) ----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) === String(ADMIN_CHAT_ID)) return;
  if (msg.text && msg.text.startsWith('/start')) return;

  const text = msg.caption || msg.text || '';
  const email = extractEmail(text);

  const reqId = String(requestCounter++);
  pendingRequests[reqId] = {
    email: email,
    userChatId: chatId,
    userName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
    username: msg.from.username ? '@' + msg.from.username : '(username yo\'q)',
  };

  const summary =
    `🆕 Yangi to'lov da'vosi\n\n` +
    `👤 Ism: ${pendingRequests[reqId].userName}\n` +
    `🔗 Username: ${pendingRequests[reqId].username}\n` +
    `📧 Aniqlangan email: ${email || '❗ topilmadi — foydalanuvchidan so\'rang'}\n\n` +
    `Xabar matni: ${text || '(matn yo\'q, ehtimol faqat rasm yubordi)'}`;

  try {
    await bot.forwardMessage(ADMIN_CHAT_ID, chatId, msg.message_id);
  } catch (e) {}

  await bot.sendMessage(ADMIN_CHAT_ID, summary, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Premium berish', callback_data: `approve:${reqId}` },
          { text: '❌ Rad etish', callback_data: `reject:${reqId}` },
        ],
      ],
    },
  });

  bot.sendMessage(chatId, 'Rahmat! So\'rovingiz adminga yuborildi, tez orada javob olasiz ⏳');
});

// ---- Admin taps a button ----
bot.on('callback_query', async (query) => {
  if (String(query.message.chat.id) !== String(ADMIN_CHAT_ID)) return;

  const [action, reqId] = query.data.split(':');
  const req = pendingRequests[reqId];

  if (!req) {
    return bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov eskirgan yoki topilmadi.' });
  }

  if (action === 'reject') {
    delete pendingRequests[reqId];
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    });
    await bot.sendMessage(ADMIN_CHAT_ID, '❌ Rad etildi.');
    bot.sendMessage(req.userChatId, 'Kechirasiz, to\'lovingiz tasdiqlanmadi. Iltimos, admin bilan bog\'laning.');
    return bot.answerCallbackQuery(query.id);
  }

  if (action === 'approve') {
    if (!req.email) {
      return bot.answerCallbackQuery(query.id, {
        text: 'Email topilmadi! Avval foydalanuvchidan email so\'rang.',
        show_alert: true,
      });
    }

    try {
      const result = await grantPremium(req.email, PREMIUM_DAYS);
      if (!result.ok) {
        await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Xatolik: ${result.message}`);
        return bot.answerCallbackQuery(query.id, { text: 'Xatolik yuz berdi.' });
      }

      delete pendingRequests[reqId];
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
      });
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `✅ Premium berildi!\n📧 ${req.email}\n📅 ${PREMIUM_DAYS} kunga faollashtirildi.`
      );
      bot.sendMessage(
        req.userChatId,
        `🎉 Tabriklaymiz! Premium tarif faollashtirildi (${PREMIUM_DAYS} kun). Saytga qayta kirib, premium bo'limlardan foydalanishingiz mumkin.`
      );
      bot.answerCallbackQuery(query.id, { text: 'Premium berildi ✅' });
    } catch (err) {
      console.error(err);
      bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Kutilmagan xatolik: ${err.message}`);
      bot.answerCallbackQuery(query.id, { text: 'Xatolik yuz berdi.' });
    }
  }
});

// ---- Supabase helper ----
async function grantPremium(email, days) {
  const listRes = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!listRes.ok) {
    return { ok: false, message: `Supabase auth so'rovi muvaffaqiyatsiz (${listRes.status})` };
  }

  const listData = await listRes.json();
  const users = listData.users || listData;
  const user = Array.isArray(users) ? users.find(u => u.email === email) : null;

  if (!user) {
    return { ok: false, message: `"${email}" bilan ro'yxatdan o'tgan foydalanuvchi topilmadi.` };
  }

  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: user.id,
      tariff: 'premium',
      premium_expires_at: expiresAt,
    }),
  });

  if (!upsertRes.ok) {
    const errText = await upsertRes.text();
    return { ok: false, message: `Profilni yangilab bo'lmadi: ${errText}` };
  }

  return { ok: true };
}

console.log('Bot ishga tushdi...');
