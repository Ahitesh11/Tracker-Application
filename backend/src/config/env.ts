import 'dotenv/config';
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
export const env = { port, host: process.env.HOST || '127.0.0.1', origins: (process.env.CORS_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(value=>value.trim()).filter(Boolean) };
