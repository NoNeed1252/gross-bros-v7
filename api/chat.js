/**
 * Galactic Gross Bros - Chat API (SSE)
 * GGB OS Engine: Local Ollama (qwen2.5:1.5b) is now the primary driver.
 * Secondary fallbacks: Gemini (Direct) and OpenRouter.
 */
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Robust body parsing for Express/VPS and Vercel Serverless
  let body = {};
  if (req.body && typeof req.body === 'object') {
    body = req.body;
  } else {
    try {
      let data = '';
      await new Promise((resolve, reject) => {
        req.on('data', chunk => { data += chunk.toString(); });
        req.on('end', () => resolve());
        req.on('error', reject);
      });
      if (data) body = JSON.parse(data);
    } catch (e) {
      console.error('Body parse error:', e.message);
    }
  }

  const { messages, stream = true } = body;
  let success = false;
  let lastError = null;

  // Environment-aware Ollama configuration
  const isVercel = !!process.env.VERCEL;
  const OLLAMA_URL = isVercel 
    ? 'http://216.250.127.169:8443/v1/chat/completions'
    : 'http://127.0.0.1:8443/v1/chat/completions';

  // 1. PRIMARY: Local/VPS Ollama (qwen2.5:1.5b)
  try {
    console.log(`Attempting primary Ollama at: ${OLLAMA_URL}`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'qwen2.5:1.5b',
        messages: messages || [{ role: 'user', content: 'Hello' }],
        stream: stream
      })
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      await handleStream(response, res, 'openai');
      success = true;
    } else {
      const errText = await response.text();
      console.warn('Ollama failed:', errText);
      lastError = `Ollama: ${errText}`;
    }
  } catch (err) {
    console.error('Ollama connection error:', err.message);
    lastError = `Ollama Error: ${err.message}`;
  }

  // 2. SECONDARY FALLBACK: Direct Gemini
  if (!success && process.env.GEMINI_API_KEY) {
    try {
      console.log('Falling back to Direct Gemini...');
      const geminiMessages = (messages || []).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: geminiMessages })
      });

      if (response.ok) {
        await handleStream(response, res, 'gemini');
        success = true;
      } else {
        lastError = `Gemini: ${await response.text()}. Previous: ${lastError}`;
      }
    } catch (err) {
      lastError = `Gemini Error: ${err.message}. Previous: ${lastError}`;
    }
  }

  // 3. TERTIARY FALLBACK: OpenRouter
  if (!success && process.env.OPENROUTER_API_KEY) {
    try {
      console.log('Falling back to OpenRouter...');
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://gross-bros.vercel.app',
          'X-Title': 'Gross Bros Terminal',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'openrouter/auto',
          messages: messages || [],
          stream: stream
        })
      });

      if (response.ok) {
        await handleStream(response, res, 'openai');
        success = true;
      } else {
        lastError = `OpenRouter: ${await response.text()}. Previous: ${lastError}`;
      }
    } catch (err) {
      lastError = `OpenRouter Error: ${err.message}. Previous: ${lastError}`;
    }
  }

  if (!success && !res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: 'All AI engines failed', details: lastError })}\n\n`);
    res.end();
  }
};

/**
 * Robust SSE Stream Handler using Async Iterators
 */
async function handleStream(response, res, type) {
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += chunk.toString();
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      if (type === 'gemini') {
        if (line.startsWith('data:')) {
          try {
            const json = JSON.parse(line.slice(5).trim());
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
            }
          } catch (e) {}
        }
      } else {
        // OpenAI / Ollama / OpenRouter format
        if (line.startsWith('data:')) {
          const dataText = line.slice(5).trim();
          if (dataText === '[DONE]') {
            res.write('data: [DONE]\n\n');
          } else {
            try {
              const json = JSON.parse(dataText);
              const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
              if (content) {
                res.write(`data: ${JSON.stringify({ token: content })}\n\n`);
              }
            } catch (e) {}
          }
        }
      }
    }
  }
}
