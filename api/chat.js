/**
 * Galactic Gross Bros - Chat API (SSE)
 * Handles OpenRouter streaming with proper model identifiers.
 */
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { messages, model, stream = true } = req.body || {};
    
    // FIX: Preserve the full model string. 
    const targetModel = model || 'meta-llama/llama-3.1-8b-instruct:free';

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
        messages: messages,
        stream: stream
      })
    });

    if (!response.ok) {
      const err = await response.text();
      res.write(`data: ${JSON.stringify({ error: 'OpenRouter Error', details: err })}\n\n`);
      return res.end();
    }

    response.body.on('data', (chunk) => {
      res.write(chunk);
    });

    response.body.on('end', () => {
      res.end();
    });

    req.on('close', () => {
      res.end();
    });

  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: 'Internal Server Error' })}\n\n`);
    res.end();
  }
};