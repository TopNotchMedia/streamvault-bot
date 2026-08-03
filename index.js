require('dotenv').config();
const http = require('http');
const { TelegramBot } = require('node-telegram-bot-api');
const { supabase } = require('./supabase');
