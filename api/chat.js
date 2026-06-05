/**
 * Galactic Gross Bros - Chat API (SSE)
 * Handles OpenRouter streaming with proper model identifiers and payload transformation.
 */
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Critical: disable Vercel/nginx buffering for SSE

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Robust body parsing: works with Express (local) + raw Vercel serverless
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
      console.error('Body parse error in /api/chat:', e.message);
    }
  }

  try {
    const { messages, stream = true } = body;
    
    // Exact model — never truncated
    const targetModel = 'meta-llama/llama-3.1-8b-instruct:free';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://gross-bros.vercel.app',
        'X-Title': 'Gross Bros Terminal',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: targetModel,
        messages: messages || [{ role: 'user', content: 'Hello' }],
        stream: stream
      })
    });

    if (!response.ok) {
      const err = await response.text();
      res.write(`data: ${JSON.stringify({ error: 'OpenRouter Error', details: err })}\n\n`);
      return res.end();
    }

    // === ROBUST CHUNK BUFFER (fixes split-JSON crashes) ===
    let buffer = '';

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const dataText = trimmed.slice(5).trim();
      if (!dataText) return;

      if (dataText === '[DONE]') {
        res.write('data: [DONE]\n\n');
        return;
      }

      try {
        const json = JSON.parse(dataText);
        const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ token: content })}\n\n`);
        }
      } catch (e) {
        // Only fallback on truly bad lines (rare now that we buffer)
        res.write(line + '\n\n');
      }
    };

    response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
      }
    });

    response.body.on('end', () => {
      if (buffer.trim()) processLine(buffer);
      res.end();
    });

    response.body.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ error: 'Stream Error', message: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      res.end();
    });

  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: 'Internal Server Error', message: error.message })}\n\n`);
    res.end();
  }
};