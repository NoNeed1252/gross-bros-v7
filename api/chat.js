/**
 * Galactic Gross Bros - Chat API (SSE)
 * Refactored to use Direct Gemini API as primary and Qwen 2.5 on VPS as fallback.
 */
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = {};
  if (req.body && typeof req.body === 'object') {
    body = req.body;
  } else if (req.method === 'POST' || req.method === 'PUT') {
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

  const { messages } = body;
  let success = false;
  let lastError = null;

  // 1. Direct Gemini API Fallback (Primary)
  if (process.env.GEMINI_API_KEY) {
    try {
      const contents = (messages || []).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      });

      if (response.ok) {
        await handleGeminiStream(response, res);
        success = true;
      } else {
        const errText = await response.text();
        lastError = `Gemini Error: ${errText}`;
      }
    } catch (err) {
      console.error('Gemini failed:', err.message);
      lastError = err.message;
    }
  } else {
    lastError = 'GEMINI_API_KEY not configured';
  }

  // 2. Ollama Fallback (Secondary - VPS)
  if (!success) {
    const isVercel = !!process.env.VERCEL;
    const ollamaUrl = isVercel 
      ? 'http://216.250.127.169:8443/v1/chat/completions' 
      : 'http://127.0.0.1:8443/v1/chat/completions';

    try {
      const response = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5:1.5b',
          messages: messages || [{ role: 'user', content: 'Hello' }],
          stream: true
        })
      });

      if (response.ok) {
        await handleOllamaStream(response, res);
        success = true;
      } else {
        const errText = await response.text();
        lastError = `Ollama fallback failed: ${errText}. (Previous: ${lastError})`;
      }
    } catch (err) {
      console.error('Ollama fallback failed:', err.message);
      lastError = `Ollama: ${err.message}. Previous: ${lastError}`;
    }
  }

  if (!success && !res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: 'All AI services failed', details: lastError })}\n\n`);
    res.end();
  }
};

async function handleGeminiStream(response, res) {
  for await (const chunk of response.body) {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
          }
        } catch (e) {}
      }
    }
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

async function handleOllamaStream(response, res) {
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += chunk.toString();
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith('data:')) {
        const dataText = line.slice(5).trim();
        if (dataText === '[DONE]') {
          res.write('data: [DONE]\n\n');
        } else {
          try {
            const json = JSON.parse(dataText);
            const content = json.choices?.[0]?.delta?.content || '';
            if (content) {
              res.write(`data: ${JSON.stringify({ token: content })}\n\n`);
            }
          } catch (e) {}
        }
      }
    }
  }
  res.end();
}
