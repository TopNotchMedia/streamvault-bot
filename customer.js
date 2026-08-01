const { Bolt Database } = require('./supabase');
const { getSession, setSession, clearSession } = require('./session');
const { formatPrice, formatOrderStatus, truncate } = require('./format');

const {
  mainMenuKeyboard,
  categoriesKeyboard,
  productsKeyboard,
  productDetailKeyboard,
  cartKeyboard,
  checkoutConfirmKeyboard,
  ordersKeyboard,
  orderDetailKeyboard,
} = require('../keyboards');

const SHOP_NAME = 'StreamVault';

async function sendMainMenu(bot, msg) {
  const chatId = msg.chat.id;
  const text =
    `🛍 *Welcome to ${SHOP_NAME}!*\n\n` +
    `Your one-stop shop for premium tech gear. Browse our catalog, add items to your cart, and check out — all right here in Telegram.\n\n` +
    `What would you like to do?`;
  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: await mainMenuKeyboard(),
  });
}

async function handleShop(bot, msg) {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, '🛍 *Shop Categories*\n\nPick a category to browse products:', {
    parse_mode: 'Markdown',
    reply_markup: await categoriesKeyboard(),
  });
}

async function handleCategory(bot, query) {
  const chatId = query.message.chat.id;
  const categoryId = query.data.split(':')[1];

  const { data: category } = await supabase
    .from('categories')
    .select('name, description')
    .eq('id', categoryId)
    .maybeSingle();

  const name = category?.name || 'Products';
  const desc = category?.description ? `\n${category.description}\n` : '';
  await bot.sendMessage(chatId, `📂 *${name}*${desc}\nSelect a product to view details:`, {
    parse_mode: 'Markdown',
    reply_markup: await productsKeyboard(categoryId),
  });
}

async function handleProduct(bot, query) {
  const chatId = query.message.chat.id;
  const productId = query.data.split(':')[1];

  const { data: product } = await supabase
    .from('products')
    .select('id, name, description, price, image_url, stock')
    .eq('id', productId)
    .maybeSingle();

  if (!product) {
    await bot.sendMessage(chatId, '⚠️ Product not found.');
    return;
  }

  const { data: cartItem } = await supabase
    .from('cart_items')
    .select('id')
    .eq('telegram_id', query.from.id)
    .eq('product_id', productId)
    .maybeSingle();

  const stockText = product.stock > 0 ? `✅ In stock (${product.stock})` : '⚪ Sold out';
  const caption =
    `*${product.name}*\n\n` +
    `${truncate(product.description, 500)}\n\n` +
    `💰 Price: *${formatPrice(product.price)}*\n` +
    `📦 ${stockText}`;

  const keyboard = productDetailKeyboard(productId, !!cartItem);

  if (product.image_url) {
    await bot.sendPhoto(chatId, product.image_url, {
      caption,
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    await bot.sendMessage(chatId, caption, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

async function handleAddToCart(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const productId = query.data.split(':')[1];

  const { data: product } = await supabase
    .from('products')
    .select('id, name, stock')
    .eq('id', productId)
    .maybeSingle();

  if (!product || product.stock <= 0) {
    await bot.answerCallbackQuery(query.id, { text: 'This item is sold out.', show_alert: true });
    return;
  }

  const { data: existing } = await supabase
    .from('cart_items')
    .select('id, quantity')
    .eq('telegram_id', telegramId)
    .eq('product_id', productId)
    .maybeSingle();

  if (existing) {
    if (existing.quantity >= product.stock) {
      await bot.answerCallbackQuery(query.id, { text: 'You already have the max available in your cart.', show_alert: true });
      return;
    }
    await supabase
      .from('cart_items')
      .update({ quantity: existing.quantity + 1 })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('cart_items')
      .insert({ telegram_id: telegramId, product_id: productId, quantity: 1 });
  }

  await bot.answerCallbackQuery(query.id, { text: `${product.name} added to cart!` });
  await handleCart(bot, query, true);
}

async function handleCart(bot, query, asNewMessage = false) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;

  const { data: items } = await supabase
    .from('cart_items')
    .select('id, quantity, products(id, name, price, stock)')
    .eq('telegram_id', telegramId);

  if (!items || items.length === 0) {
    const text = '🛒 *Your Cart*\n\nYour cart is empty. Browse the shop to add items!';
    if (asNewMessage) {
      await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: await cartKeyboard(telegramId),
      });
    } else {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: await cartKeyboard(telegramId),
      });
    }
    return;
  }

  let total = 0;
  const lines = items.map((item) => {
    const p = item.products;
    if (!p) return null;
    const lineTotal = Number(p.price) * item.quantity;
    total += lineTotal;
    return `  • ${item.quantity} × ${p.name} — ${formatPrice(lineTotal)}`;
  }).filter(Boolean);

  const text =
    `🛒 *Your Cart*\n\n` +
    `${lines.join('\n')}\n\n` +
    `*Total: ${formatPrice(total)}*`;

  const keyboard = await cartKeyboard(telegramId);

  if (asNewMessage) {
    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (e) {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }
}

async function handleCartQtyChange(bot, query, action) {
  const chatId = query.message.chat.id;
  const cartItemId = query.data.split(':')[1];

  const { data: item } = await supabase
    .from('cart_items')
    .select('id, quantity, product_id, products(stock)')
    .eq('id', cartItemId)
    .maybeSingle();

  if (!item) {
    await bot.answerCallbackQuery(query.id, { text: 'Item no longer in cart.' });
    return;
  }

  let newQty = action === 'inc' ? item.quantity + 1 : item.quantity - 1;

  if (newQty > item.products.stock) {
    await bot.answerCallbackQuery(query.id, { text: 'Cannot exceed available stock.', show_alert: true });
    return;
  }

  if (newQty <= 0) {
    await supabase.from('cart_items').delete().eq('id', cartItemId);
    await bot.answerCallbackQuery(query.id, { text: 'Item removed from cart.' });
  } else {
    await supabase.from('cart_items').update({ quantity: newQty }).eq('id', cartItemId);
    await bot.answerCallbackQuery(query.id, { text: `Quantity: ${newQty}` });
  }
  await handleCart(bot, query, false);
}

async function handleRemoveCartItem(bot, query) {
  const cartItemId = query.data.split(':')[1];
  await supabase.from('cart_items').delete().eq('id', cartItemId);
  await bot.answerCallbackQuery(query.id, { text: 'Removed from cart.' });
  await handleCart(bot, query, false);
}

async function handleClearCart(bot, query) {
  const telegramId = query.from.id;
  await supabase.from('cart_items').delete().eq('telegram_id', telegramId);
  await bot.answerCallbackQuery(query.id, { text: 'Cart cleared.' });
  await handleCart(bot, query, false);
}

async function handleCheckout(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;

  const { data: items } = await supabase
    .from('cart_items')
    .select('quantity, products(name, price, stock)')
    .eq('telegram_id', telegramId);

  if (!items || items.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: 'Your cart is empty.', show_alert: true });
    return;
  }

  let total = 0;
  const lines = [];
  for (const item of items) {
    const p = item.products;
    if (!p) continue;
    if (p.stock < item.quantity) {
      await bot.answerCallbackQuery(query.id, {
        text: `Not enough stock for ${p.name}. Please adjust your cart.`,
        show_alert: true,
      });
      return;
    }
    const lineTotal = Number(p.price) * item.quantity;
    total += lineTotal;
    lines.push(`  • ${item.quantity} × ${p.name} — ${formatPrice(lineTotal)}`);
  }

  setSession(telegramId, 'awaiting_name', { total, lines });

  const text =
    `📝 *Checkout*\n\n` +
    `${lines.join('\n')}\n\n` +
    `*Total: ${formatPrice(total)}*\n\n` +
    `Please enter your *full name* to continue:`;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: checkoutConfirmKeyboard(),
  });
  // We expect text input next, but the Cancel button is available.
}

async function handleCheckoutInput(bot, msg) {
  const telegramId = msg.from.id;
  const session = getSession(telegramId);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!session.state) return false;

  if (session.state === 'awaiting_name') {
    if (!text || text.length < 2) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid name (at least 2 characters).');
      return true;
    }
    session.data.name = text;
    session.state = 'awaiting_phone';
    await bot.sendMessage(chatId, '📞 Please enter your *phone number*:', { parse_mode: 'Markdown' });
    return true;
  }

  if (session.state === 'awaiting_phone') {
    if (!text || text.length < 5) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid phone number.');
      return true;
    }
    session.data.phone = text;
    session.state = 'awaiting_address';
    await bot.sendMessage(chatId, '📍 Please enter your *delivery address*:', { parse_mode: 'Markdown' });
    return true;
  }

  if (session.state === 'awaiting_address') {
    if (!text || text.length < 3) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid address.');
      return true;
    }
    session.data.address = text;
    session.state = 'awaiting_notes';
    await bot.sendMessage(
      chatId,
      '📝 Enter any *order notes* (optional), or type "skip" to continue:',
      { parse_mode: 'Markdown' }
    );
    return true;
  }

  if (session.state === 'awaiting_notes') {
    session.data.notes = text && text.toLowerCase() !== 'skip' ? text : null;
    session.state = 'review';
    const d = session.data;
    const summary =
      `📋 *Order Summary*\n\n` +
      `${d.lines.join('\n')}\n\n` +
      `*Total: ${formatPrice(d.total)}*\n\n` +
      `👤 Name: ${d.name}\n` +
      `📞 Phone: ${d.phone}\n` +
      `📍 Address: ${d.address}\n` +
      (d.notes ? `📝 Notes: ${d.notes}\n` : '') +
      `\nConfirm your order?`;
    await bot.sendMessage(chatId, summary, {
      parse_mode: 'Markdown',
      reply_markup: checkoutConfirmKeyboard(),
    });
    return true;
  }

  return false;
}

async function handleConfirmOrder(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const session = getSession(telegramId);

  if (session.state !== 'review') {
    await bot.answerCallbackQuery(query.id, { text: 'Session expired. Please start checkout again.' });
    clearSession(telegramId);
    return;
  }

  const { data: items } = await supabase
    .from('cart_items')
    .select('id, product_id, quantity, products(id, name, price, stock)')
    .eq('telegram_id', telegramId);

  if (!items || items.length === 0) {
    await bot.answerCallbackQuery(query.id, { text: 'Cart is empty.', show_alert: true });
    clearSession(telegramId);
    return;
  }

  let total = 0;
  const orderItems = [];
  for (const item of items) {
    const p = item.products;
    if (!p) continue;
    if (p.stock < item.quantity) {
      await bot.answerCallbackQuery(query.id, {
        text: `${p.name} is out of stock. Please adjust your cart.`,
        show_alert: true,
      });
      return;
    }
    const lineTotal = Number(p.price) * item.quantity;
    total += lineTotal;
    orderItems.push({
      product_id: p.id,
      product_name: p.name,
      price: p.price,
      quantity: item.quantity,
    });
  }

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      telegram_id: telegramId,
      status: 'pending',
      total,
      customer_name: session.data.name,
      customer_phone: session.data.phone,
      customer_address: session.data.address,
      notes: session.data.notes,
    })
    .select('id')
    .single();

  if (error || !order) {
    await bot.answerCallbackQuery(query.id, { text: 'Failed to create order. Please try again.', show_alert: true });
    return;
  }

  for (const oi of orderItems) {
    oi.order_id = order.id;
  }
  await supabase.from('order_items').insert(orderItems);

  await supabase.from('cart_items').delete().eq('telegram_id', telegramId);

  for (const item of items) {
    if (item.products) {
      await supabase
        .from('products')
        .update({ stock: Math.max(0, item.products.stock - item.quantity) })
        .eq('id', item.products.id);
    }
  }

  clearSession(telegramId);

  await bot.answerCallbackQuery(query.id, { text: 'Order placed!' });
  await bot.sendMessage(
    chatId,
    `✅ *Order Confirmed!*\n\n` +
    `Your order has been placed successfully.\n` +
    `Order ID: \`#${order.id.slice(0, 8)}\`\n` +
    `Total: *${formatPrice(total)}*\n\n` +
    `We'll notify you when your order status changes. Thank you for shopping at ${SHOP_NAME}!`,
    { parse_mode: 'Markdown', reply_markup: await mainMenuKeyboard() }
  );

  const { data: admins } = await supabase.from('admins').select('telegram_id');
  for (const admin of admins || []) {
    try {
      await bot.sendMessage(
        admin.telegram_id,
        `🔔 *New Order!*\n\n` +
        `Order #${order.id.slice(0, 8)}\n` +
        `Customer: ${session.data.name}\n` +
        `Total: ${formatPrice(total)}\n\n` +
        `Use /admin to manage orders.`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) {}
  }
}

async function handleCancelCheckout(bot, query) {
  const telegramId = query.from.id;
  clearSession(telegramId);
  await bot.answerCallbackQuery(query.id, { text: 'Checkout cancelled.' });
  await handleCart(bot, query, true);
}

async function handleOrders(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;

  const { data: orders } = await supabase
    .from('orders')
    .select('id, created_at, total, status')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!orders || orders.length === 0) {
    await bot.sendMessage(chatId, '📦 *My Orders*\n\nYou have no orders yet. Start shopping!', {
      parse_mode: 'Markdown',
      reply_markup: await ordersKeyboard(telegramId),
    });
    return;
  }

  await bot.sendMessage(chatId, '📦 *My Orders*\n\nSelect an order to view details:', {
    parse_mode: 'Markdown',
    reply_markup: await ordersKeyboard(telegramId),
  });
}

async function handleOrderDetail(bot, query) {
  const chatId = query.message.chat.id;
  const orderId = query.data.split(':')[1];

  const { data: order } = await supabase
    .from('orders')
    .select('id, created_at, total, status, customer_name, customer_phone, customer_address, notes')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) {
    await bot.sendMessage(chatId, '⚠️ Order not found.');
    return;
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('product_name, price, quantity')
    .eq('order_id', orderId);

  const itemLines = (items || []).map(
    (i) => `  • ${i.quantity} × ${i.product_name} — ${formatPrice(Number(i.price) * i.quantity)}`
  );

  const text =
    `📦 *Order #${order.id.slice(0, 8)}*\n\n` +
    `${itemLines.join('\n')}\n\n` +
    `*Total:* ${formatPrice(order.total)}\n` +
    `*Status:* ${formatOrderStatus(order.status)}\n` +
    `*Date:* ${new Date(order.created_at).toLocaleString()}\n\n` +
    `👤 ${order.customer_name}\n` +
    `📞 ${order.customer_phone}\n` +
    `📍 ${order.customer_address}` +
    (order.notes ? `\n📝 ${order.notes}` : '');

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: orderDetailKeyboard(),
  });
}

async function handleHelp(bot, msg) {
  const chatId = msg.chat?.id || msg.message.chat.id;
  const text =
    `❓ *Help — ${SHOP_NAME}*\n\n` +
    `🛍 *Shop* — Browse products by category\n` +
    `🛒 *Cart* — View and manage items you've added\n` +
    `📦 *My Orders* — Track your placed orders\n\n` +
    `To buy something:\n` +
    `1. Tap *Shop* and pick a category\n` +
    `2. Select a product and tap *Add to Cart*\n` +
    `3. Open your *Cart* and tap *Checkout*\n` +
    `4. Enter your details and confirm\n\n` +
    `Need help? Contact support.`;
  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: await mainMenuKeyboard(),
  });
}

module.exports = {
  sendMainMenu,
  handleShop,
  handleCategory,
  handleProduct,
  handleAddToCart,
  handleCart,
  handleCartQtyChange,
  handleRemoveCartItem,
  handleClearCart,
  handleCheckout,
  handleCheckoutInput,
  handleConfirmOrder,
  handleCancelCheckout,
  handleOrders,
  handleOrderDetail,
  handleHelp,
};
