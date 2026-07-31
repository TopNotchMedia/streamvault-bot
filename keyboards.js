const { supabase } = require('./supabase');

const BACK_BUTTONS = {
  shop: { text: '🛍 Back to Shop', callback_data: 'shop' },
  cart: { text: '🛒 View Cart', callback_data: 'cart' },
  main: { text: '🏠 Main Menu', callback_data: 'main' },
  orders: { text: '📦 Back to Orders', callback_data: 'orders' },
};

function buildKeyboard(rows) {
  const inline_keyboard = rows.map((row) => {
    const buttons = Array.isArray(row) ? row : [row];
    return buttons.map((b) => ({ text: b.text, callback_data: b.callback_data }));
  });
  return { inline_keyboard };
}

async function mainMenuKeyboard() {
  return buildKeyboard([
    [{ text: '🛍 Shop', callback_data: 'shop' }, { text: '🛒 Cart', callback_data: 'cart' }],
    [{ text: '📦 My Orders', callback_data: 'orders' }, { text: '❓ Help', callback_data: 'help' }],
  ]);
}

async function categoriesKeyboard() {
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .order('sort_order', { ascending: true });

  const rows = (categories || []).map((c) => [
    { text: c.name, callback_data: `cat:${c.id}` },
  ]);
  rows.push([{ text: BACK_BUTTONS.main.text, callback_data: BACK_BUTTONS.main.callback_data }]);
  return buildKeyboard(rows);
}

async function productsKeyboard(categoryId) {
  const { data: products } = await supabase
    .from('products')
    .select('id, name, stock')
    .eq('category_id', categoryId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  const rows = (products || []).map((p) => [
    {
      text: p.stock > 0 ? p.name : `⚪ ${p.name} (sold out)`,
      callback_data: p.stock > 0 ? `prod:${p.id}` : `soldout:${p.id}`,
    },
  ]);
  rows.push([{ text: BACK_BUTTONS.shop.text, callback_data: BACK_BUTTONS.shop.callback_data }]);
  return buildKeyboard(rows);
}

function productDetailKeyboard(productId, inCart) {
  const rows = [
    [{ text: '➕ Add to Cart', callback_data: `add:${productId}` }],
  ];
  if (inCart) {
    rows.push([{ text: '🛒 View Cart', callback_data: 'cart' }]);
  }
  rows.push([{ text: '⬅️ Back', callback_data: 'back_to_category' }]);
  return buildKeyboard(rows);
}

async function cartKeyboard(telegramId) {
  const { data: items } = await supabase
    .from('cart_items')
    .select('id, product_id, quantity, products(id, name, price, stock)')
    .eq('telegram_id', telegramId);

  if (!items || items.length === 0) {
    return buildKeyboard([[BACK_BUTTONS.shop]]);
  }

  const rows = [];
  for (const item of items) {
    const p = item.products;
    if (!p) continue;
    rows.push([
      { text: '➖', callback_data: `dec:${item.id}` },
      { text: `${item.quantity} × ${p.name}`, callback_data: 'noop' },
      { text: '➕', callback_data: `inc:${item.id}` },
    ]);
    rows.push([
      { text: '🗑 Remove', callback_data: `rmcart:${item.id}` },
    ]);
  }
  rows.push([{ text: '✅ Checkout', callback_data: 'checkout' }]);
  rows.push([{ text: '🗑 Clear Cart', callback_data: 'clear_cart' }]);
  rows.push([{ text: BACK_BUTTONS.shop.text, callback_data: BACK_BUTTONS.shop.callback_data }]);
  return buildKeyboard(rows);
}

function checkoutConfirmKeyboard() {
  return buildKeyboard([
    [{ text: '✅ Confirm Order', callback_data: 'confirm_order' }],
    [{ text: '❌ Cancel', callback_data: 'cancel_checkout' }],
  ]);
}

async function ordersKeyboard(telegramId) {
  const { data: orders } = await supabase
    .from('orders')
    .select('id, created_at, total, status')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!orders || orders.length === 0) {
    return buildKeyboard([[BACK_BUTTONS.main]]);
  }

  const rows = orders.map((o) => [
    {
      text: `${new Date(o.created_at).toLocaleDateString()} — $${Number(o.total).toFixed(2)} (${o.status})`,
      callback_data: `order:${o.id}`,
    },
  ]);
  rows.push([{ text: BACK_BUTTONS.main.text, callback_data: BACK_BUTTONS.main.callback_data }]);
  return buildKeyboard(rows);
}

function orderDetailKeyboard() {
  return buildKeyboard([[BACK_BUTTONS.orders]]);
}

module.exports = {
  buildKeyboard,
  mainMenuKeyboard,
  categoriesKeyboard,
  productsKeyboard,
  productDetailKeyboard,
  cartKeyboard,
  checkoutConfirmKeyboard,
  ordersKeyboard,
  orderDetailKeyboard,
  BACK_BUTTONS,
};
