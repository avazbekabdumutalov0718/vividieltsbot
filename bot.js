/* ============================================================
   VIVID IELTS — Premium Approval Bot
   + Majburiy kanal (Join Request bilan ishlaydi)
   + Narxlar va Admin tugmalari
   + CD TESTLAR va BOOKS (Telegram file_id orqali)
   + Keep-alive
   ============================================================ */

const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const http = require('http');
const https = require('https');

// ---- Environment variables ----
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PREMIUM_DAYS = parseInt(process.env.PREMIUM_DAYS || '30', 10);

const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '-1004304384442';
const CHANNEL_INVITE_LINK = 'https://t.me/+0Wiqg6jiVGc4YTEy';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'vividieltsadmin';

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ---- HTTP server ----
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Premium bot is running.');
}).listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// ---- Keep-alive ----
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL ||
  (process.env.RENDER_EXTERNAL_HOSTNAME
    ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
    : null);

if (KEEP_ALIVE_URL) {
  setInterval(() => {
    https.get(KEEP_ALIVE_URL, (res) => {
      console.log(`[Keep-alive] ${res.statusCode}`);
    }).on('error', (err) => {
      console.log(`[Keep-alive] Error: ${err.message}`);
    });
  }, 4 * 60 * 1000);
  console.log(`[Keep-alive] Enabled → ${KEEP_ALIVE_URL}`);
}

// ============================================================
// CD TESTLAR va BOOKS fayllari
// ------------------------------------------------------------
// Har bir faylni botga (o'zingiz, admin sifatida) bir marta hujjat
// (document) qilib yuborgach, Logs'da (Render konsolida) shu
// faylning "file_id" qiymati chiqadi. O'sha ID'ni shu ro'yxatlarga
// qo'shing. "title" — foydalanuvchiga chiqadigan nom.
// ============================================================
const CD_TEST_FILES = [
  // { title: 'Reading Test 1', file_id: 'BQACAgIAAxkBAAIB...' },
  // { title: 'Reading Test 2', file_id: 'BQACAgIAAxkBAAIC...' },
  // ... jami 15 tagacha shu tarzda qo'shiladi
];

const BOOK_FILES = [
  // { title: 'Vocabulary for IELTS', file_id: 'BQACAgIAAxkBAAID...' },
  // { title: 'Grammar for IELTS', file_id: 'BQACAgIAAxkBAAIE...' },
];

// ---- So'rov yuborganlarni eslab qolish ----
const pendingJoinRequests = new Set(); // userId lar

// ---- Kanal tekshirish ----
async function isSubscribed(userId) {
  if (pendingJoinRequests.has(userId)) {
    return true;
  }
  try {
    const member = await bot.getChatMember(REQUIRED_CHANNEL, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    return false;
  }
}

function getSubscribeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📢 Kanalga obuna bo\'lish', url: CHANNEL_INVITE_LINK }],
      [{ text: '✅ So\'rov yubordim', callback_data: 'check_sub' }]
    ]
  };
}

function getMainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '💰 Narxlar', callback_data: 'prices' }],
      [{ text: '📄 CD TESTLAR', callback_data: 'cd_tests' }, { text: '📚 BOOKS', callback_data: 'books' }],
      [{ text: '👤 Admin bilan bog\'lanish', url: `https://t.me/${ADMIN_USERNAME}` }],
      [{ text: '📸 To\'lov chekini yuborish', callback_data: 'send_payment' }]
    ]
  };
}

// ---- Join Request kelganda ----
bot.on('chat_join_request', (msg) => {
  const userId = msg.from.id;
  pendingJoinRequests.add(userId);
  console.log(`Yangi join request: ${userId} (${msg.from.first_name})`);
});

// ---- In-memory store (to'lovlar uchun) ----
const pendingRequests = {};
let requestCounter = 1;

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

// ---- /start ----
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  const subscribed = await isSubscribed(userId);

  if (!subscribed) {
    return bot.sendMessage(chatId,
      `⚠️ Botdan foydalanish uchun avval kanalimizga obuna bo'ling:\n\nSo'rov yuborganingizdan keyin "✅ So'rov yubordim" tugmasini bosing.`,
      { reply_markup: getSubscribeKeyboard() }
    );
  }

  bot.sendMessage(chatId,
    `Salom! 👋\n\nVIVID IELTS Premium botiga xush kelibsiz!\n\nQuyidagi tugmalardan birini tanlang:`,
    { reply_markup: getMainKeyboard() }
  );
});

// ---- ADMIN: hujjat yuborganda file_id'ni ko'rsatish ----
// Siz (admin) botga PDF/hujjat yuborganingizda, bot sizga o'sha faylning
// file_id'sini qaytarib beradi — shuni CD_TEST_FILES yoki BOOK_FILES
// massiviga nusxalab qo'yasiz.
bot.on('document', (msg) => {
  const chatId = msg.chat.id;
  if (String(chatId) !== String(ADMIN_CHAT_ID)) return; // faqat admindan qabul qilamiz

  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name || 'nomsiz fayl';

  bot.sendMessage(
    chatId,
    `📎 Fayl qabul qilindi: ${fileName}\n\nfile_id:\n${fileId}\n\nBuni CD_TEST_FILES yoki BOOK_FILES massiviga nusxalang.`
  );
});

// ---- Oddiy xabarlar ----
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (String(chatId) === String(ADMIN_CHAT_ID)) return;
  if (msg.text && msg.text.startsWith('/start')) return;
  if (msg.document) return; // hujjatlar yuqorida alohida ishlanadi

  const subscribed = await isSubscribed(userId);
  if (!subscribed) {
    return bot.sendMessage(chatId,
      `⚠️ Avval kanalga obuna bo'ling:`,
      { reply_markup: getSubscribeKeyboard() }
    );
  }

  const text = msg.caption || msg.text || '';
  const email = extractEmail(text);

  const reqId = String(requestCounter++);
  pendingRequests[reqId] = {
    email,
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

// ---- Helper: fayllar ro'yxatini tugma qilib chiqarish ----
function buildFileListKeyboard(files, prefix) {
  return {
    inline_keyboard: files.map((f, idx) => [
      { text: f.title, callback_data: `${prefix}:${idx}` }
    ])
  };
}

// ---- Callback tugmalar ----
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;

  // 1. So'rov yubordim tugmasi
  if (query.data === 'check_sub') {
    const subscribed = await isSubscribed(userId);
    if (subscribed) {
      await bot.answerCallbackQuery(query.id, { text: 'Rahmat! Endi botdan foydalanishingiz mumkin ✅' });
      await bot.sendMessage(chatId,
        `Salom! 👋\n\nVIVID IELTS Premium botiga xush kelibsiz!\n\nQuyidagi tugmalardan birini tanlang:`,
        { reply_markup: getMainKeyboard() }
      );
    } else {
      await bot.answerCallbackQuery(query.id, {
        text: 'Hali so\'rov yubormagansiz yoki bot sezmagan. Avval kanalga so\'rov yuboring!',
        show_alert: true
      });
    }
    return;
  }

  // 2. Narxlar
  if (query.data === 'prices') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId,
`💰 *VIVID IELTS Tariflari:*

🟢 *Free* — 0 so'm
• Limited lesson access
• 2 Reading mock tests
• 2 Full Listening mock tests

🔵 *Premium* — ~79,000 UZS/oy~
• 30 full Reading & Listening mock tests
• Certificate on completion
• Keyword tables & wordlists
• Writing mock test + AI review
• Full article library access

🟣 *Pro* — ~249,000 UZS/oy~
• Everything in Premium
• Article library + topic wordlists
• Full Speaking mock test
• 3 full IELTS mock exams

To'lovdan keyin chekni va emailingizni yuboring.`,
      { parse_mode: 'Markdown', reply_markup: getMainKeyboard() }
    );
    return;
  }

  // 3. To'lov chekini yuborish
  if (query.data === 'send_payment') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId,
      `📸 Iltimos, to'lov chekini (screenshot) va saytda ro'yxatdan o'tgan *emailingizni* yuboring.\n\nMisol:\nemail@gmail.com`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // 4. CD TESTLAR ro'yxati
  if (query.data === 'cd_tests') {
    await bot.answerCallbackQuery(query.id);
    if (CD_TEST_FILES.length === 0) {
      return bot.sendMessage(chatId, '📄 Hozircha CD testlar qo\'shilmagan. Tez orada qo\'shiladi!');
    }
    return bot.sendMessage(chatId, '📄 Kerakli testni tanlang:', {
      reply_markup: buildFileListKeyboard(CD_TEST_FILES, 'get_cd')
    });
  }

  // 5. BOOKS ro'yxati
  if (query.data === 'books') {
    await bot.answerCallbackQuery(query.id);
    if (BOOK_FILES.length === 0) {
      return bot.sendMessage(chatId, '📚 Hozircha kitoblar qo\'shilmagan. Tez orada qo\'shiladi!');
    }
    return bot.sendMessage(chatId, '📚 Kerakli kitobni tanlang:', {
      reply_markup: buildFileListKeyboard(BOOK_FILES, 'get_book')
    });
  }

  // 6. Tanlangan CD test faylini yuborish
  if (query.data.startsWith('get_cd:')) {
    const idx = parseInt(query.data.split(':')[1], 10);
    const file = CD_TEST_FILES[idx];
    await bot.answerCallbackQuery(query.id);
    if (!file) return bot.sendMessage(chatId, 'Fayl topilmadi.');
    return bot.sendDocument(chatId, file.file_id, { caption: file.title });
  }

  // 7. Tanlangan kitobni yuborish
  if (query.data.startsWith('get_book:')) {
    const idx = parseInt(query.data.split(':')[1], 10);
    const file = BOOK_FILES[idx];
    await bot.answerCallbackQuery(query.id);
    if (!file) return bot.sendMessage(chatId, 'Fayl topilmadi.');
    return bot.sendDocument(chatId, file.file_id, { caption: file.title });
  }

  // ---- Admin tugmalari (premium berish/rad etish) ----
  if (String(chatId) !== String(ADMIN_CHAT_ID)) return;

  const [action, reqId] = query.data.split(':');
  const req = pendingRequests[reqId];

  if (!req) {
    return bot.answerCallbackQuery(query.id, { text: 'Bu so\'rov eskirgan yoki topilmadi.' });
  }

  if (action === 'reject') {
    delete pendingRequests[reqId];
    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
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
        chat_id: chatId,
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

// ---- Supabase ----
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
