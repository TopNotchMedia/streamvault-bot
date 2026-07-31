function formatPrice(value) {
  const num = Number(value) || 0;
  return `$${num.toFixed(2)}`;
}

function formatOrderStatus(status) {
  const map = {
    pending: '⏳ Pending',
    confirmed: '✅ Confirmed',
    shipped: '🚚 Shipped',
    delivered: '📦 Delivered',
    cancelled: '❌ Cancelled',
  };
  return map[status] || status;
}

function truncate(text, max = 300) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

module.exports = { formatPrice, formatOrderStatus, truncate };
