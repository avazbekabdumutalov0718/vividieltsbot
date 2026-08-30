# VIVID IELTS — Premium Approval Bot

Bu bot foydalanuvchi to'lov chekini yuborganda, sizga (admin) tugma
bilan xabar yuboradi. Tugmani bossangiz, bot avtomatik ravishda
Supabase'dagi foydalanuvchi profilini "premium" qilib yangilaydi.

## 1) Telegram bot yaratish

1. Telegram'da **@BotFather** ga yozing
2. `/newbot` buyrug'ini yuboring, botga nom va username bering
3. Sizga beriladigan **tokenni saqlab qo'ying** (masalan `123456:AAExample...`)

## 2) O'zingizning Chat ID'ingizni topish

1. Telegram'da **@userinfobot** ga `/start` yozing
2. U sizga chat ID'ingizni (raqam) ko'rsatadi — shuni saqlab qo'ying

## 3) Supabase Service Role Key'ni olish

1. Supabase dashboard → loyihangiz → **Project Settings** → **API**
2. **service_role** qatoridagi kalitni nusxalang (⚠️ bu MAXFIY kalit —
   hech qachon GitHub'ga yoki boshqa hech kimga bermang, chunki u
   barcha xavfsizlik qoidalarini chetlab o'tadi)

## 4) Mahalliy sinovdan o'tkazish (ixtiyoriy, kompyuteringizda)

```bash
cd premium-bot
npm install
cp .env.example .env
# .env faylini oching va haqiqiy qiymatlarni kiriting
node bot.js
```

Agar konsolda "Bot ishga tushdi..." chiqsa — tayyor. Telegram'da botga
`/start` yozib sinab ko'ring.

## 5) Doimiy ishlashi uchun — Render.com'ga joylash (bepul)

1. [render.com](https://render.com) saytida ro'yxatdan o'ting (GitHub
   akkaunt bilan kirsa qulay)
2. Bu `premium-bot` papkasini GitHub'ga alohida repository sifatida
   yuklang (**`.env` faylini hech qachon yuklamang** — u faqat sizning
   maxfiy kalitlaringizni saqlaydi)
3. Render'da **New +** → **Background Worker** ni tanlang
4. GitHub repository'ingizni ulang
5. **Environment** bo'limida `.env.example`dagi barcha o'zgaruvchilarni
   qo'lda kiriting (haqiqiy qiymatlar bilan)
6. **Start Command**: `node bot.js`
7. Deploy qiling — bir necha daqiqada bot doimiy ishlab turadi

## Bot qanday ishlaydi

1. Foydalanuvchi botga to'lov cheki (screenshot) va emailini yuboradi
2. Bot buni sizga (admin) forward qiladi, ostida 2 ta tugma chiqadi:
   **✅ Premium berish** / **❌ Rad etish**
3. "✅ Premium berish" bossangiz:
   - Bot Supabase'dan shu email bo'yicha foydalanuvchini qidiradi
   - `profiles` jadvalida `tariff = 'premium'` va
     `premium_expires_at = hozir + 30 kun` qilib yozadi
   - Foydalanuvchiga va sizga tasdiq xabari yuboriladi

## Muhim eslatmalar

- Foydalanuvchi emailni matn sifatida yozishi kerak (bot avtomatik
  emailni matndan aniqlaydi). Agar email topilmasa, tugma bosilganda
  bot xabar beradi — o'zingiz qo'lda so'rashingiz kerak bo'ladi.
- `PREMIUM_DAYS` o'zgaruvchisi orqali necha kunlik premium
  berilishini o'zgartirsa bo'ladi.
- Agar kelajakda turli muddatli tariflar (1 oy / 3 oy / 1 yil) kerak
  bo'lsa, tugmalarni ko'paytirib, har biriga alohida kunlik son
  berish mumkin — shunda ayting, kengaytirib beraman.
