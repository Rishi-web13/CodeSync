function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required environment variable ${name}. See server/.env.example.`);
    process.exit(1);
  }
  return v;
}
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const env = {
  port: num('PORT', 4000),
  webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  // AI help assistant. Works with Groq (default, has a free tier) or xAI Grok: both speak the OpenAI chat API.
  // The provider is detected from the key itself (gsk_... = Groq, xai-... = xAI), so a key in any of the names below works.
  ai: (() => {
    const apiKey = (process.env.GROQ_API_KEY || process.env.GROK_API_KEY || process.env.XAI_API_KEY || process.env.AI_API_KEY || '').trim();
    const provider = apiKey.startsWith('xai-') ? 'xai' : apiKey.startsWith('gsk_') ? 'groq' : (process.env.AI_PROVIDER ?? 'groq');
    const d = provider === 'xai'
      ? { baseUrl: 'https://api.x.ai/v1', model: 'grok-4.3', fallback: '' }
      : { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', fallback: 'llama-3.1-8b-instant' };
    return {
      provider,
      apiKey,
      model: process.env.AI_MODEL || process.env.GROQ_MODEL || process.env.XAI_MODEL || d.model,
      // Used automatically if the main model is rate-limited, busy or unavailable.
      fallbackModel: process.env.AI_FALLBACK_MODEL ?? d.fallback,
      baseUrl: (process.env.AI_BASE_URL || process.env.XAI_BASE_URL || d.baseUrl).replace(/\/+$/, ''),
    };
  })(),
  exec: {
    enabled: (process.env.EXEC_ENABLED ?? 'true') !== 'false',
    timeoutMs: num('EXEC_TIMEOUT_MS', 10_000),
    memoryMb: num('EXEC_MEMORY_MB', 256),
    cpus: num('EXEC_CPUS', 0.5),
    pidsLimit: num('EXEC_PIDS_LIMIT', 128),
    maxOutputBytes: num('EXEC_MAX_OUTPUT_BYTES', 65_536),
  },
};
