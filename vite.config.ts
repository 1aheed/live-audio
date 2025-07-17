import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.SYSTEM_INSTRUCTION': JSON.stringify(env.SYSTEM_INSTRUCTION),
        'process.env.VOICE_NAME': JSON.stringify(env.VOICE_NAME),
        'process.env.ENABLE_GOOGLE_SEARCH': JSON.stringify(env.ENABLE_GOOGLE_SEARCH),
        'process.env.ENABLE_CALL_RECORDING': JSON.stringify(env.ENABLE_CALL_RECORDING)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
