require('dotenv').config();
const { supabase } = require('../src/supabase');

async function main() {
  const telegramId = process.argv[2];
  if (!telegramId) {
    console.error('Usage: node scripts/add-admin.js <your-telegram-id>');
    console.error('Find your Telegram ID by messaging @userinfobot on Telegram.');
    process.exit(1);
  }

  const id = parseInt(telegramId, 10);
  if (isNaN(id)) {
    console.error('Telegram ID must be a number.');
    process.exit(1);
  }

  const { data, error } = await supabase
    .from('admins')
    .upsert({ telegram_id: id })
    .select('id, telegram_id')
    .single();

  if (error) {
    console.error('Failed to add admin:', error.message);
    process.exit(1);
  }

  console.log(`Admin added: Telegram ID ${data.telegram_id}`);
  console.log('You can now use /admin in the bot.');
  process.exit(0);
}

main();
