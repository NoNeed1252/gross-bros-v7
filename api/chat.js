/**
 * Galactic Gross Bros - Chat API (SSE)
 * Handles OpenRouter streaming with automatic live-model rotation and local Ollama port 8443 failover.
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

  const { messages, stream = true } = body;

  // Active OpenRouter free models as of June 2026
  const openRouterModels = [
    'deepseek/deepseek-r1:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen-2.5-7b-instruct:free',
    'google/gemma-2-9b-it:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'openrouter/auto'
  ];

  let success = false;
  let lastError = null;

  // 1. Try OpenRouter list
  for (const model of openRouterModels) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer \${process.env.OPENROUTER_API_KEY}\`,
          'HTTP-Referer': 'https://gross-bros.vercel.app',
          'X-Title': 'Gross Bros Terminal',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: messages || [{ role: 'user', content: 'Hello' }],
          stream: stream
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(\`OpenRouter model \${model} failed:\`, errText);
        lastError = \`OpenRouter (\${model}): \${errText}\`;
        continue;
      }

      await handleStream(response, res);
      success = true;
      break;
    } catch (err) {
      console.error(\`Error with OpenRouter model \${model}:\`, err.message);
      lastError = err.message;
    }
  }

  // 2. Local Ollama port 8443 failover
  if (!success) {
    console.log('OpenRouter exhausted. Falling back to local Ollama on port 8443...');
    try {
      const response = await fetch('http://127.0.0.1:8443/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama3',
          messages: messages || [{ role: 'user', content: 'Hello' }],
          stream: stream
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(\`Ollama failed: \${errText}\`);
      }

      await handleStream(response, res);
      success = true;
    } catch (err) {
      console.error('Ollama fallback failed:', err.message);
      lastError = \`Ollama: \${err.message}. Previous: \${lastError}\`;
    }
  }

  if (!success && !res.writableEnded) {
    res.write(\`data: \${JSON.stringify({ error: 'All AI services failed', details: lastError })}\\n\\n\`);
    res.end();
  }
};

async function handleStream(response, res) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const dataText = trimmed.slice(5).trim();
      if (!dataText) return;

      if (dataText === '[DONE]') {
        res.write('data: [DONE]\\n\\n');
        return;
      }

      try {
        const json = JSON.parse(dataText);
        const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
        if (content) {
          res.write(\`data: \${JSON.stringify({ token: content })}\\n\\n\`);
        }
      } catch (e) {
        res.write(line + '\\n\\n');
      }
    };

    response.body.on('data', (chunk) => {
      buffer += chunk.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
      }
    });

    response.body.on('end', () => {
      if (buffer.trim()) processLine(buffer);
      resolve();
    });

    response.body.on('error', (err) => {
      reject(err);
    });
  });
}
