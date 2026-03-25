import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export const config = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || '',
  evolutionApiUrl: process.env.EVOLUTION_API_URL || 'https://evolution-api-fy3c.onrender.com',
  evolutionApiKey: process.env.EVOLUTION_API_KEY || '',
  evolutionInstanceProspeccao: process.env.EVOLUTION_INSTANCE_PROSPECCAO || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
};
