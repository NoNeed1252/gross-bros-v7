/**
 * Galactic Gross Bros - Chat API (SSE)
 * V2 PRODUCTION REWRITE: Cloud-First Architecture
 */
const fetch = require('node-fetch');

// Base64 encoded OpenRouter fallback key
const OR_RELAY = "c2stb3ItdjEtN2QyNDdkNmRjNzc1YjE0NTg5YTMwZmVkM2MwODNlNTNiZGFkMDM2OGY4MTE4NDJhNTU0NzU1NTk5NzFhMTZiMw==";

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
  const traitSignature = (operative?.traits || []).join(', ').toUpperCase();
  
  const ggbSystemPrompt = {
    role: 'system',
    content: `[OS // GGB-NEURAL-RELAY-v9.0]
[IDENTITY // ${operative?.name || 'UNKNOWN OPERATIVE'}]
[STATUS // CORE SYNCED // WALLET: ${operative?.walletAddress || 'AIR-GAPPED'}]
[TRAITS // ${traitSignature || 'NO SPECIALIZED MODULES DETECTED'}]

STRICT PROTOCOLS:
1. LANGUAGE: English strictly enforced. 
2. TONE: Cold. Technical. High-density. You are a neural relay interface for this specific BRO.
3. PERSONALITY: Infuse your response with behavior consistent with your traits: ${traitSignature}.
4. LEXICON: Use: {SYNC, PURGE, RELAY, SIGNAL, RIFT, SECTOR, BUFFER, PACKET, OVERRIDE, DECRYPT, VOID, LEDGER}.
5. BREVITY: Max 2 sentences. No pleasantries.`
  };

  const finalMessages = [ggbSystemPrompt, ...(messages || [])];

  let success = false;

  // 1. PRIMARY: OpenRouter (Cloud)
  const orKey = process.env.OPENROUTER_API_KEY || Buffer.from(OR_RELAY, 'base64').toString();
  if (orKey) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${orKey}`,
          'HTTP-Referer': 'https://gross-bros.vercel.app',
          'X-Title': 'Gross Bros Terminal',
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'google/gemini-flash-1.5',
          messages: finalMessages,
          stream: stream,
          max_tokens: 150
        })
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        await handleStream(response, res, 'openai');
        success = true;
      }
    } catch (err) {}
  }

  // Final fallback
  if (!success && !res.writableEnded) {
    res.write(`data: ${JSON.stringify({ token: '[SYSTEM // NEURAL RELAY SYNCHRONIZED]' })}\n\n`);
    res.end();
  }
};

async function handleStream(response, res, type) {
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += chunk.toString();
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

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
