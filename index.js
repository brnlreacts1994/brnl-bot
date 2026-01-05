const { Telegraf, Markup } = require('telegraf');
const { Pool } = require('pg');

// Token e canal via variáveis de ambiente
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;

const bot = new Telegraf(BOT_TOKEN);

// Conexão PostgreSQL (Railway fornece DATABASE_URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Criar tabela se não existir
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      access_expires_at BIGINT,
      subscription_status TEXT,
      join_method TEXT,
      language TEXT
    )
  `);
})();

const now = () => Math.floor(Date.now() / 1000);
const addDays = (days) => now() + days * 24 * 60 * 60;

// Mensagens por idioma
const messages = {
  pt: {
    directpass: '💫 Direct Pass custa 800 Stars. Envie o pagamento e me mande o comprovante.',
    directpass_confirm: '✅ Direct Pass confirmado. Você tem acesso por 30 dias.',
    choose_plan: 'Escolha seu plano:',
    sub15: '✅ Assinatura confirmada por 15 dias.',
    sub30: '✅ Assinatura confirmada por 30 dias.',
    plans: [
      Markup.button.callback('📅 Quinzenal (300 Stars)', 'SUB_15'),
      Markup.button.callback('📅 Mensal (500 Stars)', 'SUB_30')
    ]
  },
  en: {
    directpass: '💫 Direct Pass costs 800 Stars. Please send the payment and forward me the proof.',
    directpass_confirm: '✅ Direct Pass confirmed. You now have 30 days of access.',
    choose_plan: 'Please choose your plan:',
    sub15: '✅ Subscription confirmed for 15 days.',
    sub30: '✅ Subscription confirmed for 30 days.',
    plans: [
      Markup.button.callback('📅 Biweekly (300 Stars)', 'SUB_15'),
      Markup.button.callback('📅 Monthly (500 Stars)', 'SUB_30')
    ]
  },
  es: {
    directpass: '💫 El Pase Directo cuesta 800 Stars. Por favor envía el pago y mándame el comprobante.',
    directpass_confirm: '✅ Pase Directo confirmado. Ahora tienes 30 días de acceso.',
    choose_plan: 'Por favor, elige tu plan:',
    sub15: '✅ Suscripción confirmada por 15 días.',
    sub30: '✅ Suscripción confirmada por 30 días.',
    plans: [
      Markup.button.callback('📅 Quincenal (300 Stars)', 'SUB_15'),
      Markup.button.callback('📅 Mensual (500 Stars)', 'SUB_30')
    ]
  }
};

// Seleção de idioma
bot.start(async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🇧🇷 Português', 'LANG_PT')],
    [Markup.button.callback('🇺🇸 English', 'LANG_EN')],
    [Markup.button.callback('🇪🇸 Español', 'LANG_ES')]
  ]);
  ctx.reply('Choose your language / Escolha seu idioma / Elige tu idioma:', keyboard);
  console.log(`Usuário ${ctx.from.id} iniciou o bot`);
});

async function setLanguage(ctx, lang, msg) {
  await pool.query(
    `INSERT INTO users (telegram_id, access_expires_at, subscription_status, join_method, language)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telegram_id) DO UPDATE SET language = EXCLUDED.language`,
    [ctx.from.id, null, 'none', null, lang]
  );
  ctx.reply(msg);
  console.log(`Usuário ${ctx.from.id} escolheu idioma: ${lang}`);
}

bot.action('LANG_PT', (ctx) => setLanguage(ctx, 'pt', '✅ Idioma definido: Português 🇧🇷'));
bot.action('LANG_EN', (ctx) => setLanguage(ctx, 'en', '✅ Language set: English 🇺🇸'));
bot.action('LANG_ES', (ctx) => setLanguage(ctx, 'es', '✅ Idioma establecido: Español 🇪🇸'));

// Direct Pass
bot.command('directpass', async (ctx) => {
  const res = await pool.query(`SELECT language FROM users WHERE telegram_id = $1`, [ctx.from.id]);
  const lang = res.rows[0]?.language || 'en';
  ctx.reply(messages[lang].directpass);
  const expires = addDays(30);
  await pool.query(
    `INSERT INTO users (telegram_id, access_expires_at, subscription_status, join_method, language)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telegram_id) DO UPDATE SET
       access_expires_at = EXCLUDED.access_expires_at,
       subscription_status = EXCLUDED.subscription_status,
       join_method = EXCLUDED.join_method,
       language = EXCLUDED.language`,
    [ctx.from.id, expires, 'active', 'direct_pass', lang]
  );
  ctx.reply(messages[lang].directpass_confirm);
  console.log(`Usuário ${ctx.from.id} ativou Direct Pass`);
});

// Subscription
bot.command('subscribe', async (ctx) => {
  const res = await pool.query(`SELECT language FROM users WHERE telegram_id = $1`, [ctx.from.id]);
  const lang = res.rows[0]?.language || 'en';
  const keyboard = Markup.inlineKeyboard([messages[lang].plans]);
  ctx.reply(messages[lang].choose_plan, keyboard);
  console.log(`Usuário ${ctx.from.id} abriu planos de assinatura`);
});

bot.action('SUB_15', async (ctx) => {
  const res = await pool.query(`SELECT language FROM users WHERE telegram_id = $1`, [ctx.from.id]);
  const lang = res.rows[0]?.language || 'en';
  const expires = addDays(15);
  await pool.query(
    `UPDATE users SET access_expires_at = $1, subscription_status = 'active', join_method = 'subscription' WHERE telegram_id = $2`,
    [expires, ctx.from.id]
  );
  ctx.reply(messages[lang].sub15);
  console.log(`Usuário ${ctx.from.id} assinou plano de 15 dias`);
});

bot.action('SUB_30', async (ctx) => {
  const res = await pool.query(`SELECT language FROM users WHERE telegram_id = $1`, [ctx.from.id]);
  const lang = res.rows[0]?.language || 'en';
  const expires = addDays(30);
  await pool.query(
    `UPDATE users SET access_expires_at = $1, subscription_status = 'active', join_method = 'subscription' WHERE telegram_id = $2`,
    [expires, ctx.from.id]
  );
  ctx.reply(messages[lang].sub30);
  console.log(`Usuário ${ctx.from.id} assinou plano de 30 dias`);
});

// Remover expirados
setInterval(async () => {
  const res = await pool.query(`SELECT telegram_id FROM users WHERE access_expires_at IS NOT NULL AND access_expires_at < $1`, [now()]);
  for (const u of res.rows) {
    try {
      await bot.telegram.kickChatMember(CHANNEL_ID, u.telegram_id);
      console.log(`Usuário ${u.telegram_id} removido por expiração`);
    } catch (err) {
      console.error(`Erro ao remover ${u.telegram_id}:`, err);
    }
  }
}, 60 * 60 * 1000);

bot.launch();
console.log("🤖 Bot ativo e rodando!");