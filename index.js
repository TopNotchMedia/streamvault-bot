require('dotenv').config();
const http = require('http');
const { TelegramBot } = require('node-telegram-bot-api');
const { Bolt Database } = require('./supabase');
const { getSession } = require('./session');
const { buildKeyboard } = require('./keyboards');

const customer = require('./customer');
const admin = require('./admin');

const SHOP_NAME = 'StreamVault';

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', bot: SHOP_NAME, uptime: process.uptime() }));
}).listen(PORT, () => {
  console.log(`Keep-alive server listening on :${PORT}`);
});

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Add it to your .env file.');
  console.error('Get a token from @BotFather on Telegram, then add: TELEGRAM_BOT_TOKEN=your-token-here');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log(`${SHOP_NAME} bot is running...`);

bot.setMyCommands([
  { command: 'start', description: 'Open the shop' },
  { command: 'shop', description: 'Browse products' },
  { command: 'cart', description: 'View your cart' },
  { command: 'orders', description: 'View your orders' },
  { command: 'help', description: 'Get help' },
  { command: 'admin', description: 'Open admin panel (admins only)' },
]);

bot.onText(/^\/start$/, (msg) => customer.sendMainMenu(bot, msg));

bot.onText(/^\/shop$/, (msg) => customer.handleShop(bot, msg));

bot.onText(/^\/cart$/, async (msg) => {
  const fakeQuery = { message: msg, from: msg.from, data: 'cart' };
  await customer.handleCart(bot, fakeQuery, true);
});

bot.onText(/^\/orders$/, async (msg) => {
  const fakeQuery = { message: msg, from: msg.from, data: 'orders' };
  await customer.handleOrders(bot, fakeQuery);
});

bot.onText(/^\/help$/, (msg) => customer.handleHelp(bot, msg));

bot.onText(/^\/admin$/, async (msg) => {
  const isAdmin = await admin.isAdmin(msg.from.id);
  if (!isAdmin) {
    await bot.sendMessage(
      msg.chat.id,
      '🚫 You are not an admin. If you believe this is an error, ask the shop owner to add you.'
    );
    return;
  }
  await admin.sendAdminMenu(bot, msg.chat.id);
});

bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;

  const telegramId = msg.from.id;
  const session = getSession(telegramId);

  if (session.state) {
    if (session.state.startsWith('admin_')) {
      await admin.adminEditProductInput(bot, msg);
      await admin.adminEditCategoryInput(bot, msg);
      await admin.adminAddProductInput(bot, msg);
      await admin.adminAddCategoryInput(bot, msg);
    } else {
      await customer.handleCheckoutInput(bot, msg);
    }
  }
});

bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;

  try {
    switch (data) {
      case 'main':
        await customer.sendMainMenu(bot, query.message);
        await bot.answerCallbackQuery(query.id);
        return;
      case 'shop':
        await customer.handleShop(bot, query.message);
        await bot.answerCallbackQuery(query.id);
        return;
      case 'cart':
        await customer.handleCart(bot, query, true);
        await bot.answerCallbackQuery(query.id);
        return;
      case 'orders':
        await customer.handleOrders(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      case 'help':
        await customer.handleHelp(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      case 'checkout':
        await customer.handleCheckout(bot, query);
        return;
      case 'confirm_order':
        await customer.handleConfirmOrder(bot, query);
        return;
      case 'cancel_checkout':
        await customer.handleCancelCheckout(bot, query);
        return;
      case 'clear_cart':
        await customer.handleClearCart(bot, query);
        return;
      case 'noop':
        await bot.answerCallbackQuery(query.id);
        return;
      case 'back_to_category':
        await bot.answerCallbackQuery(query.id);
        await customer.handleShop(bot, query.message);
        return;
      case 'soldout':
        await bot.answerCallbackQuery(query.id, { text: 'This item is currently sold out.', show_alert: true });
        return;
    }

    if (data.startsWith('cat:')) {
      await customer.handleCategory(bot, query);
      await bot.answerCallbackQuery(query.id);
      return;
    }
    if (data.startsWith('prod:')) {
      await customer.handleProduct(bot, query);
      await bot.answerCallbackQuery(query.id);
      return;
    }
    if (data.startsWith('add:')) {
      await customer.handleAddToCart(bot, query);
      return;
    }
    if (data.startsWith('inc:') || data.startsWith('dec:')) {
      const action = data.startsWith('inc:') ? 'inc' : 'dec';
      await customer.handleCartQtyChange(bot, query, action);
      return;
    }
    if (data.startsWith('rmcart:')) {
      await customer.handleRemoveCartItem(bot, query);
      return;
    }
    if (data.startsWith('order:')) {
      await customer.handleOrderDetail(bot, query);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data.startsWith('admin')) {
      const isAdm = await admin.isAdmin(telegramId);
      if (!isAdm) {
        await bot.answerCallbackQuery(query.id, { text: 'Admins only.', show_alert: true });
        return;
      }

      switch (data) {
        case 'admin':
          await admin.sendAdminMenu(bot, chatId);
          await bot.answerCallbackQuery(query.id);
          return;
        case 'admin_products':
          await admin.adminProductsMenu(bot, query);
          await bot.answerCallbackQuery(query.id);
          return;
        case 'admin_categories':
          await admin.adminCategoriesMenu(bot, query);
          await bot.answerCallbackQuery(query.id);
          return;
        case 'admin_orders':
          await admin.adminOrdersMenu(bot, query);
          await bot.answerCallbackQuery(query.id);
          return;
        case 'admin_stats':
          await admin.adminStats(bot, query);
          await bot.answerCallbackQuery(query.id);
          return;
        case 'admin_addprod':
          await admin.adminAddProductStart(bot, query);
          await bot.answerCallbackQuery(query.id);
          return;
        case 'admin_addcat':
          await adminAddCategoryStartSafe(bot, query);
          await bot.answerCallbackQuery(query.id);
          return;
        case 'admin_cancel_edit':
          await admin.adminCancelEdit(bot, query);
          return;
        case 'admin_cancel_add':
          await admin.adminCancelAdd(bot, query);
          return;
      }

      if (data.startsWith('admin_prod:')) {
        await admin.adminProductDetail(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('admin_editprod_')) {
        await admin.adminEditProductStart(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('admin_toggleprod:')) {
        await admin.adminToggleProduct(bot, query);
        return;
      }
      if (data.startsWith('admin_delprod:')) {
        await admin.adminDeleteProduct(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('admin_confirmdelprod:')) {
        await admin.adminConfirmDeleteProduct(bot, query);
        return;
      }
      if (data.startsWith('admin_addprod_cat:')) {
        await admin.adminAddProductFlow(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('admin_cat:')) {
        await admin.adminCategoryDetail(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('admin_editcat_')) {
        await admin.adminEditCategoryStart(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('admin_delcat:')) {
        await admin.adminDeleteCategory(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('admin_confirmdelcat:')) {
        await admin.adminConfirmDeleteCategory(bot, query);
        return;
      }
      if (data.startsWith('admin_order:')) {
        await admin.adminOrderDetail(bot, query);
        await bot.answerCallbackQuery(query.id);
        return;
      }
      if (data.startsWith('admin_setstatus:')) {
        await admin.adminSetOrderStatus(bot, query);
        return;
      }
    }

    await bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error('Callback error:', err);
    try {
      await bot.answerCallbackQuery(query.id, { text: 'Something went wrong. Please try again.', show_alert: true });
    } catch (_) {}
  }
});

async function adminAddCategoryStartSafe(bot, query) {
  await admin.adminAddCategoryStart(bot, query);
}

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

bot.on('error', (err) => {
  console.error('Bot error:', err.message);
});

module.exports = { bot };
