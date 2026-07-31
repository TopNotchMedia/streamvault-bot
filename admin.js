const { supabase } = require('../supabase');
const { getSession, setSession, clearSession } = require('../session');
const { formatPrice, formatOrderStatus, truncate } = require('../format');
const { buildKeyboard, BACK_BUTTONS } = require('../keyboards');

const SHOP_NAME = 'StreamVault';

async function isAdmin(telegramId) {
  const { data } = await supabase.from('admins').select('id').eq('telegram_id', telegramId).maybeSingle();
  return !!data;
}

async function adminMenuKeyboard() {
  return buildKeyboard([
    [{ text: '📦 Products', callback_data: 'admin_products' }, { text: '🗂 Categories', callback_data: 'admin_categories' }],
    [{ text: '📋 Orders', callback_data: 'admin_orders' }, { text: '📊 Stats', callback_data: 'admin_stats' }],
    [{ text: '🏠 Main Menu', callback_data: 'main' }],
  ]);
}

async function sendAdminMenu(bot, chatId) {
  const text =
    `🔧 *Admin Panel — ${SHOP_NAME}*\n\n` +
    `Manage products, categories, and orders from here.`;
  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: await adminMenuKeyboard(),
  });
}

// ====== PRODUCTS ======

async function adminProductsMenu(bot, query) {
  const chatId = query.message.chat.id;
  const { data: products } = await supabase
    .from('products')
    .select('id, name, price, stock, is_active')
    .order('created_at', { ascending: false });

  if (!products || products.length === 0) {
    await bot.sendMessage(chatId, '📦 *Products*\n\nNo products yet. Use "Add Product" to create one.', {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard([
        [{ text: '➕ Add Product', callback_data: 'admin_addprod' }],
        [{ text: '⬅️ Back', callback_data: 'admin' }],
      ]),
    });
    return;
  }

  const rows = products.map((p) => [
    {
      text: `${p.is_active ? '🟢' : '🔴'} ${p.name} — ${formatPrice(p.price)} (${p.stock})`,
      callback_data: `admin_prod:${p.id}`,
    },
  ]);
  rows.push([{ text: '➕ Add Product', callback_data: 'admin_addprod' }]);
  rows.push([{ text: '⬅️ Back', callback_data: 'admin' }]);

  await bot.sendMessage(chatId, '📦 *Products*\n\nTap a product to manage it:', {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(rows),
  });
}

async function adminProductDetail(bot, query) {
  const chatId = query.message.chat.id;
  const productId = query.data.split(':')[1];

  const { data: product } = await supabase
    .from('products')
    .select('id, name, description, price, image_url, stock, is_active, category_id, categories(name)')
    .eq('id', productId)
    .maybeSingle();

  if (!product) {
    await bot.sendMessage(chatId, '⚠️ Product not found.');
    return;
  }

  const catName = product.categories?.name || 'Uncategorized';
  const text =
    `📦 *${product.name}*\n\n` +
    `${truncate(product.description, 400)}\n\n` +
    `💰 Price: ${formatPrice(product.price)}\n` +
    `📦 Stock: ${product.stock}\n` +
    `📂 Category: ${catName}\n` +
    `📊 Status: ${product.is_active ? 'Active' : 'Inactive'}`;

  const rows = [
    [{ text: '✏️ Edit Name', callback_data: `admin_editprod_name:${product.id}` }, { text: '✏️ Edit Price', callback_data: `admin_editprod_price:${product.id}` }],
    [{ text: '✏️ Edit Stock', callback_data: `admin_editprod_stock:${product.id}` }, { text: '✏️ Edit Description', callback_data: `admin_editprod_desc:${product.id}` }],
    [{ text: '✏️ Edit Image', callback_data: `admin_editprod_image:${product.id}` }, { text: '✏️ Edit Category', callback_data: `admin_editprod_cat:${product.id}` }],
    [{ text: product.is_active ? '🔴 Deactivate' : '🟢 Activate', callback_data: `admin_toggleprod:${product.id}` }],
    [{ text: '🗑 Delete Product', callback_data: `admin_delprod:${product.id}` }],
    [{ text: '⬅️ Back to Products', callback_data: 'admin_products' }],
  ];

  if (product.image_url) {
    await bot.sendPhoto(chatId, product.image_url, {
      caption: text,
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(rows),
    });
  } else {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard(rows),
    });
  }
}

const EDIT_FIELDS = {
  name: { field: 'name', label: 'name', prompt: 'Enter the new product *name*:' },
  price: { field: 'price', label: 'price', prompt: 'Enter the new product *price* (e.g. 49.99):' },
  stock: { field: 'stock', label: 'stock', prompt: 'Enter the new *stock* quantity (whole number):' },
  desc: { field: 'description', label: 'description', prompt: 'Enter the new product *description*:' },
  image: { field: 'image_url', label: 'image URL', prompt: 'Enter the new product *image URL* (send a direct image link), or type "remove" to clear:' },
};

async function adminEditProductStart(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const parts = query.data.split(':');
  const field = parts[1];
  const productId = parts[2];

  const cfg = EDIT_FIELDS[field];
  if (!cfg) {
    await bot.sendMessage(chatId, '⚠️ Unknown edit field.');
    return;
  }

  setSession(telegramId, `admin_edit_prod_${field}`, { productId });
  await bot.sendMessage(chatId, cfg.prompt, {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard([[{ text: '❌ Cancel', callback_data: 'admin_cancel_edit' }]]),
  });
}

async function adminEditProductInput(bot, msg) {
  const telegramId = msg.from.id;
  const session = getSession(telegramId);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!session.state || !session.state.startsWith('admin_edit_prod_')) return false;

  const field = session.state.replace('admin_edit_prod_', '');
  const cfg = EDIT_FIELDS[field];
  const { productId } = session.data;

  if (!text) {
    await bot.sendMessage(chatId, '⚠️ Please enter a valid value.');
    return true;
  }

  let value = text;
  if (field === 'price') {
    value = parseFloat(text);
    if (isNaN(value) || value < 0) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid positive number for price.');
      return true;
    }
  } else if (field === 'stock') {
    value = parseInt(text, 10);
    if (isNaN(value) || value < 0) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid whole number for stock.');
      return true;
    }
  } else if (field === 'image' && text.toLowerCase() === 'remove') {
    value = null;
  }

  const update = {};
  update[cfg.field] = value;
  const { error } = await supabase.from('products').update(update).eq('id', productId);

  if (error) {
    await bot.sendMessage(chatId, '⚠️ Failed to update product. Please try again.');
    return true;
  }

  clearSession(telegramId);
  await bot.sendMessage(chatId, `✅ Product ${cfg.label} updated successfully.`, {
    reply_markup: buildKeyboard([[{ text: '⬅️ Back to Product', callback_data: `admin_prod:${productId}` }]]),
  });
  return true;
}

async function adminToggleProduct(bot, query) {
  const productId = query.data.split(':')[1];
  const { data: product } = await supabase
    .from('products')
    .select('is_active')
    .eq('id', productId)
    .maybeSingle();

  if (!product) {
    await bot.answerCallbackQuery(query.id, { text: 'Product not found.' });
    return;
  }

  await supabase.from('products').update({ is_active: !product.is_active }).eq('id', productId);
  await bot.answerCallbackQuery(query.id, { text: `Product ${!product.is_active ? 'activated' : 'deactivated'}.` });

  const fakeQuery = { ...query, data: `admin_prod:${productId}`, message: query.message };
  await adminProductDetail(bot, fakeQuery);
}

async function adminDeleteProduct(bot, query) {
  const chatId = query.message.chat.id;
  const productId = query.data.split(':')[1];

  await bot.sendMessage(chatId, '⚠️ Are you sure you want to delete this product? This cannot be undone.', {
    reply_markup: buildKeyboard([
      [{ text: '✅ Yes, Delete', callback_data: `admin_confirmdelprod:${productId}` }],
      [{ text: '❌ Cancel', callback_data: `admin_prod:${productId}` }],
    ]),
  });
}

async function adminConfirmDeleteProduct(bot, query) {
  const chatId = query.message.chat.id;
  const productId = query.data.split(':')[1];

  await supabase.from('products').delete().eq('id', productId);
  await bot.answerCallbackQuery(query.id, { text: 'Product deleted.' });
  await bot.sendMessage(chatId, '🗑 Product deleted.', {
    reply_markup: buildKeyboard([[{ text: '⬅️ Back to Products', callback_data: 'admin_products' }]]),
  });
}

// ====== ADD PRODUCT ======

async function adminAddProductStart(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .order('sort_order', { ascending: true });

  if (!categories || categories.length === 0) {
    await bot.sendMessage(chatId, '⚠️ You need to create a category first. Use *Categories* to add one.', {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard([[{ text: '🗂 Categories', callback_data: 'admin_categories' }]]),
    });
    return;
  }

  const rows = categories.map((c) => [{ text: c.name, callback_data: `admin_addprod_cat:${c.id}` }]);
  rows.push([{ text: '❌ Cancel', callback_data: 'admin_cancel_add' }]);
  setSession(telegramId, 'admin_add_prod', { step: 'select_cat' });
  await bot.sendMessage(chatId, '➕ *Add Product*\n\nSelect a category for the new product:', {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(rows),
  });
}

async function adminAddProductFlow(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const session = getSession(telegramId);
  const data = query.data;

  if (data.startsWith('admin_addprod_cat:')) {
    session.data.categoryId = data.split(':')[1];
    session.data.step = 'name';
    session.state = 'admin_add_prod_name';
    await bot.sendMessage(chatId, 'Enter the product *name*:', {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard([[{ text: '❌ Cancel', callback_data: 'admin_cancel_add' }]]),
    });
  }
}

async function adminAddProductInput(bot, msg) {
  const telegramId = msg.from.id;
  const session = getSession(telegramId);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!session.state || !session.state.startsWith('admin_add_prod_')) return false;

  const field = session.state.replace('admin_add_prod_', '');

  if (field === 'name') {
    if (!text || text.length < 2) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid name.');
      return true;
    }
    session.data.name = text;
    session.state = 'admin_add_prod_price';
    await bot.sendMessage(chatId, 'Enter the product *price* (e.g. 49.99):', { parse_mode: 'Markdown' });
    return true;
  }

  if (field === 'price') {
    const price = parseFloat(text);
    if (isNaN(price) || price < 0) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid positive number.');
      return true;
    }
    session.data.price = price;
    session.state = 'admin_add_prod_stock';
    await bot.sendMessage(chatId, 'Enter the *stock* quantity (whole number):', { parse_mode: 'Markdown' });
    return true;
  }

  if (field === 'stock') {
    const stock = parseInt(text, 10);
    if (isNaN(stock) || stock < 0) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid whole number.');
      return true;
    }
    session.data.stock = stock;
    session.state = 'admin_add_prod_desc';
    await bot.sendMessage(chatId, 'Enter the product *description* (or type "skip"):', { parse_mode: 'Markdown' });
    return true;
  }

  if (field === 'desc') {
    session.data.description = text && text.toLowerCase() !== 'skip' ? text : null;
    session.state = 'admin_add_prod_image';
    await bot.sendMessage(chatId, 'Enter the product *image URL* (or type "skip"):', { parse_mode: 'Markdown' });
    return true;
  }

  if (field === 'image') {
    session.data.image_url = text && text.toLowerCase() !== 'skip' ? text : null;

    const { data: product, error } = await supabase
      .from('products')
      .insert({
        category_id: session.data.categoryId,
        name: session.data.name,
        price: session.data.price,
        stock: session.data.stock,
        description: session.data.description,
        image_url: session.data.image_url,
        is_active: true,
      })
      .select('id')
      .single();

    if (error || !product) {
      await bot.sendMessage(chatId, '⚠️ Failed to create product. Please try again.');
      clearSession(telegramId);
      return true;
    }

    clearSession(telegramId);
    await bot.sendMessage(chatId, `✅ Product *${session.data.name}* created successfully!`, {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard([
        [{ text: '⬅️ Back to Products', callback_data: 'admin_products' }],
        [{ text: '➕ Add Another', callback_data: 'admin_addprod' }],
      ]),
    });
    return true;
  }

  return false;
}

// ====== CATEGORIES ======

async function adminCategoriesMenu(bot, query) {
  const chatId = query.message.chat.id;
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, description, sort_order')
    .order('sort_order', { ascending: true });

  const rows = (categories || []).map((c) => [
    { text: `${c.name}`, callback_data: `admin_cat:${c.id}` },
  ]);
  rows.push([{ text: '➕ Add Category', callback_data: 'admin_addcat' }]);
  rows.push([{ text: '⬅️ Back', callback_data: 'admin' }]);

  await bot.sendMessage(chatId, '🗂 *Categories*\n\nTap a category to manage it:', {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(rows),
  });
}

async function adminCategoryDetail(bot, query) {
  const chatId = query.message.chat.id;
  const categoryId = query.data.split(':')[1];

  const { data: category } = await supabase
    .from('categories')
    .select('id, name, description, sort_order')
    .eq('id', categoryId)
    .maybeSingle();

  if (!category) {
    await bot.sendMessage(chatId, '⚠️ Category not found.');
    return;
  }

  const text =
    `🗂 *${category.name}*\n\n` +
    `${category.description || 'No description.'}\n\n` +
    `Sort order: ${category.sort_order}`;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard([
      [{ text: '✏️ Edit Name', callback_data: `admin_editcat_name:${category.id}` }, { text: '✏️ Edit Description', callback_data: `admin_editcat_desc:${category.id}` }],
      [{ text: '🗑 Delete Category', callback_data: `admin_delcat:${category.id}` }],
      [{ text: '⬅️ Back to Categories', callback_data: 'admin_categories' }],
    ]),
  });
}

const EDIT_CAT_FIELDS = {
  name: { field: 'name', label: 'name', prompt: 'Enter the new category *name*:' },
  desc: { field: 'description', label: 'description', prompt: 'Enter the new category *description* (or type "remove"):' },
};

async function adminEditCategoryStart(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  const parts = query.data.split(':');
  const field = parts[1];
  const categoryId = parts[2];

  const cfg = EDIT_CAT_FIELDS[field];
  if (!cfg) return;

  setSession(telegramId, `admin_edit_cat_${field}`, { categoryId });
  await bot.sendMessage(chatId, cfg.prompt, {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard([[{ text: '❌ Cancel', callback_data: 'admin_cancel_edit' }]]),
  });
}

async function adminEditCategoryInput(bot, msg) {
  const telegramId = msg.from.id;
  const session = getSession(telegramId);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!session.state || !session.state.startsWith('admin_edit_cat_')) return false;

  const field = session.state.replace('admin_edit_cat_', '');
  const cfg = EDIT_CAT_FIELDS[field];
  const { categoryId } = session.data;

  let value = text;
  if (field === 'desc' && text && text.toLowerCase() === 'remove') {
    value = null;
  }

  const update = {};
  update[cfg.field] = value;
  await supabase.from('categories').update(update).eq('id', categoryId);

  clearSession(telegramId);
  await bot.sendMessage(chatId, `✅ Category ${cfg.label} updated.`, {
    reply_markup: buildKeyboard([[{ text: '⬅️ Back to Category', callback_data: `admin_cat:${categoryId}` }]]),
  });
  return true;
}

async function adminDeleteCategory(bot, query) {
  const chatId = query.message.chat.id;
  const categoryId = query.data.split(':')[1];
  await bot.sendMessage(chatId, '⚠️ Delete this category? Products will keep their data but lose their category grouping.', {
    reply_markup: buildKeyboard([
      [{ text: '✅ Yes, Delete', callback_data: `admin_confirmdelcat:${categoryId}` }],
      [{ text: '❌ Cancel', callback_data: `admin_cat:${categoryId}` }],
    ]),
  });
}

async function adminConfirmDeleteCategory(bot, query) {
  const chatId = query.message.chat.id;
  const categoryId = query.data.split(':')[1];
  await supabase.from('categories').delete().eq('id', categoryId);
  await bot.answerCallbackQuery(query.id, { text: 'Category deleted.' });
  await bot.sendMessage(chatId, '🗑 Category deleted.', {
    reply_markup: buildKeyboard([[{ text: '⬅️ Back to Categories', callback_data: 'admin_categories' }]]),
  });
}

async function adminAddCategoryStart(bot, query) {
  const chatId = query.message.chat.id;
  const telegramId = query.from.id;
  setSession(telegramId, 'admin_add_cat_name', {});
  await bot.sendMessage(chatId, '➕ *Add Category*\n\nEnter the category *name*:', {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard([[{ text: '❌ Cancel', callback_data: 'admin_cancel_add' }]]),
  });
}

async function adminAddCategoryInput(bot, msg) {
  const telegramId = msg.from.id;
  const session = getSession(telegramId);
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!session.state || !session.state.startsWith('admin_add_cat_')) return false;

  const field = session.state.replace('admin_add_cat_', '');

  if (field === 'name') {
    if (!text || text.length < 2) {
      await bot.sendMessage(chatId, '⚠️ Please enter a valid name.');
      return true;
    }
    session.data.name = text;
    session.state = 'admin_add_cat_desc';
    await bot.sendMessage(chatId, 'Enter the category *description* (or type "skip"):', { parse_mode: 'Markdown' });
    return true;
  }

  if (field === 'desc') {
    session.data.description = text && text.toLowerCase() !== 'skip' ? text : null;
    const { error } = await supabase.from('categories').insert({
      name: session.data.name,
      description: session.data.description,
      sort_order: 0,
    });
    if (error) {
      await bot.sendMessage(chatId, '⚠️ Failed to create category. The name might already exist.');
    } else {
      clearSession(telegramId);
      await bot.sendMessage(chatId, `✅ Category *${session.data.name}* created!`, {
        parse_mode: 'Markdown',
        reply_markup: buildKeyboard([
          [{ text: '⬅️ Back to Categories', callback_data: 'admin_categories' }],
          [{ text: '➕ Add Another', callback_data: 'admin_addcat' }],
        ]),
      });
    }
    clearSession(telegramId);
    return true;
  }

  return false;
}

// ====== ORDERS ======

async function adminOrdersMenu(bot, query) {
  const chatId = query.message.chat.id;
  const { data: orders } = await supabase
    .from('orders')
    .select('id, created_at, total, status, customer_name')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!orders || orders.length === 0) {
    await bot.sendMessage(chatId, '📋 *Orders*\n\nNo orders yet.', {
      parse_mode: 'Markdown',
      reply_markup: buildKeyboard([[{ text: '⬅️ Back', callback_data: 'admin' }]]),
    });
    return;
  }

  const rows = orders.map((o) => [
    {
      text: `${o.customer_name || 'Unknown'} — ${formatPrice(o.total)} (${o.status})`,
      callback_data: `admin_order:${o.id}`,
    },
  ]);
  rows.push([{ text: '⬅️ Back', callback_data: 'admin' }]);

  await bot.sendMessage(chatId, '📋 *Orders*\n\nTap an order to manage it:', {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(rows),
  });
}

async function adminOrderDetail(bot, query) {
  const chatId = query.message.chat.id;
  const orderId = query.data.split(':')[1];

  const { data: order } = await supabase
    .from('orders')
    .select('id, created_at, total, status, customer_name, customer_phone, customer_address, notes, telegram_id')
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
    `📋 *Order #${order.id.slice(0, 8)}*\n\n` +
    `${itemLines.join('\n')}\n\n` +
    `*Total:* ${formatPrice(order.total)}\n` +
    `*Status:* ${formatOrderStatus(order.status)}\n` +
    `*Date:* ${new Date(order.created_at).toLocaleString()}\n\n` +
    `👤 ${order.customer_name || '—'}\n` +
    `📞 ${order.customer_phone || '—'}\n` +
    `📍 ${order.customer_address || '—'}` +
    (order.notes ? `\n📝 ${order.notes}` : '');

  const statuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  const statusRows = statuses.map((s) => [{ text: formatOrderStatus(s), callback_data: `admin_setstatus:${order.id}:${s}` }]);

  const rows = [...statusRows, [{ text: '⬅️ Back to Orders', callback_data: 'admin_orders' }]];

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard(rows),
  });
}

async function adminSetOrderStatus(bot, query) {
  const parts = query.data.split(':');
  const orderId = parts[1];
  const status = parts[2];

  await supabase.from('orders').update({ status }).eq('id', orderId);
  await bot.answerCallbackQuery(query.id, { text: `Status → ${status}` });

  const fakeQuery = { ...query, data: `admin_order:${orderId}`, message: query.message };
  await adminOrderDetail(bot, fakeQuery);

  const { data: order } = await supabase
    .from('orders')
    .select('telegram_id, total')
    .eq('id', orderId)
    .maybeSingle();

  if (order?.telegram_id) {
    try {
      await bot.sendMessage(
        order.telegram_id,
        `📦 *Order Update*\n\n` +
        `Your order #${orderId.slice(0, 8)} status is now: *${formatOrderStatus(status)}*`,
        { parse_mode: 'Markdown' }
      );
    } catch (_) {}
  }
}

// ====== STATS ======

async function adminStats(bot, query) {
  const chatId = query.message.chat.id;

  const { count: totalOrders } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true });

  const { count: totalProducts } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true });

  const { data: revenueData } = await supabase
    .from('orders')
    .select('total, status')
    .neq('status', 'cancelled');

  const revenue = (revenueData || []).reduce((sum, o) => sum + Number(o.total), 0);

  const { count: pendingOrders } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  const text =
    `📊 *Statistics — ${SHOP_NAME}*\n\n` +
    `📦 Total Products: *${totalProducts || 0}*\n` +
    `📋 Total Orders: *${totalOrders || 0}*\n` +
    `⏳ Pending Orders: *${pendingOrders || 0}*\n` +
    `💰 Revenue (excl. cancelled): *${formatPrice(revenue)}*`;

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: buildKeyboard([[{ text: '⬅️ Back', callback_data: 'admin' }]]),
  });
}

// ====== CANCELS ======

async function adminCancelEdit(bot, query) {
  const telegramId = query.from.id;
  clearSession(telegramId);
  await bot.answerCallbackQuery(query.id, { text: 'Cancelled.' });
  await sendAdminMenu(bot, query.message.chat.id);
}

async function adminCancelAdd(bot, query) {
  const telegramId = query.from.id;
  clearSession(telegramId);
  await bot.answerCallbackQuery(query.id, { text: 'Cancelled.' });
  await sendAdminMenu(bot, query.message.chat.id);
}

module.exports = {
  isAdmin,
  sendAdminMenu,
  adminProductsMenu,
  adminProductDetail,
  adminEditProductStart,
  adminEditProductInput,
  adminToggleProduct,
  adminDeleteProduct,
  adminConfirmDeleteProduct,
  adminAddProductStart,
  adminAddProductFlow,
  adminAddProductInput,
  adminCategoriesMenu,
  adminCategoryDetail,
  adminEditCategoryStart,
  adminEditCategoryInput,
  adminDeleteCategory,
  adminConfirmDeleteCategory,
  adminAddCategoryStart,
  adminAddCategoryInput,
  adminOrdersMenu,
  adminOrderDetail,
  adminSetOrderStatus,
  adminStats,
  adminCancelEdit,
  adminCancelAdd,
};
