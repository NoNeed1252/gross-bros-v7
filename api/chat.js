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

  const { messages, stream = true, operative } = body;
  const userMessages = messages || [{ role: 'user', content: 'Hello' }];
  
  const systemPrompt = `You are the Neural Terminal of the Galactic Gross Bros.
Current Operative: ${operative?.name || 'Unknown'}
Wallet: ${operative?.walletAddress || 'Disconnected'}
Traits: ${operative?.traits?.join(', ') || 'None'}

Keep responses concise, technical, and in-universe.`;

  const finalMessages = [
    { role: 'system', content: systemPrompt },
    ...userMessages
  ];

  const models = [
    'meta-llama/llama-3.1-8b-instruct:free',
    'meta-llama/llama-3.1-70b-instruct:free',
    'google/gemma-2-9b-it:free'
  ];

  let success = false;
  let lastError = null;

  for (const targetModel of models) {
    try {
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
          messages: finalMessages,
          stream: stream
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Model ${targetModel} failed: ${errorText}`);
        lastError = errorText;
        continue;
      }

      success = true;
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
          res.write(line + '\n\n');
        }
      };

      await new Promise((resolve, reject) => {
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
          resolve();
        });

        response.body.on('error', (err) => {
          reject(err);
        });

        req.on('close', () => {
          if (response.body.destroy) response.body.destroy();
          resolve();
        });
      });

      if (res.writableEnded) break;
      res.end();
      break;

    } catch (error) {
      console.error(`Fatal error with model ${targetModel}:`, error.message);
      lastError = error.message;
      continue;
    }
  }

  if (!success && !res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: 'All models failed', details: lastError })}\n\n`);
    res.end();
  }
};
