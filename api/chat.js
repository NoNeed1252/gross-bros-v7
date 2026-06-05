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

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { messages, stream = true } = req.body || {};
    
    // Explicitly use the full model string as requested by the owner.
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

    // Transform OpenRouter/OpenAI stream to a format the current frontend can parse
    response.body.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.trim().startsWith('data:')) {
          const dataText = line.trim().slice(5).trim();
          if (dataText === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          try {
            const json = JSON.parse(dataText);
            const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
            if (content) {
              res.write(`data: ${JSON.stringify({ token: content })}\n\n`);
            }
          } catch (e) {
            // Fallback: send raw if parsing fails
            res.write(line + '\n\n');
          }
        }
      }
    });

    response.body.on('end', () => {
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