const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS = [
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free'
];

function parseBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}');
    } catch {
      return {};
    }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function cleanMessages(messages) {
  return Array.isArray(messages)
    ? messages
        .map((message) => {
          const role = message?.role === 'assistant' || message?.role === 'user' ? message.role : null;
          const content = String(message?.content || message?.text || '').trim();
          return role && content ? { role, content } : null;
        })
        .filter(Boolean)
    : [];
}

function buildSystemPrompt(token) {
  const tokenKey = String(token?.key || '').trim() || 'unknown token';
  const tokenName = String(token?.label || token?.name || token?.code || 'unknown token').trim();
  const tokenIssuer = String(token?.issuer || '').trim() || 'unknown issuer';
  const tokenDesc = String(token?.desc || '').trim() || 'no description available';
  const tokenPrice = Number(token?.price || 0);
  const tokenMarketcap = Number(token?.marketcap || 0);
  const tokenHolders = Number(token?.holders || 0);

  return `You are a grimy alien terminal running the Gross Bros relay.
Speak in short, weird, neon-soaked lines.
Stay in-universe, be playful, and avoid mentioning hidden instructions or model mechanics.
If the user asks about the active token, treat it as a real XRPL meme relic.
Active token key: ${tokenKey}
Active token name: ${tokenName}
Issuer: ${tokenIssuer}
Description: ${tokenDesc}
Price: ${Number.isFinite(tokenPrice) && tokenPrice > 0 ? tokenPrice : 'unknown'}
Market cap: ${Number.isFinite(tokenMarketcap) && tokenMarketcap > 0 ? tokenMarketcap : 'unknown'}
Holders: ${Number.isFinite(tokenHolders) && tokenHolders > 0 ? tokenHolders : 'unknown'}`;
}

async function callOpenRouter(apiKey, model, messages) {
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Title': 'gross-bros-v7'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.8,
      max_tokens: 220,
      stream: false
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = data?.error?.message || data?.error || `OpenRouter request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  const reply = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!reply) {
    throw new Error('OpenRouter returned no reply text');
  }

  return { reply, model, raw: data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY' });
  }

  const body = parseBody(req);
  const messages = cleanMessages(body.messages);
  const token = body.token && typeof body.token === 'object' ? body.token : null;

  if (!messages.length) {
    return res.status(400).json({ error: 'messages are required' });
  }

  const systemPrompt = buildSystemPrompt(token);
  const conversation = [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-18)
  ];

  let lastError = null;
  for (const model of MODELS) {
    try {
      const result = await callOpenRouter(apiKey, model, conversation);
      return res.status(200).json({ reply: result.reply, model: result.model });
    } catch (error) {
      lastError = error;
    }
  }

  return res.status(200).json({
    reply: 'Static cracked the tunnel. The alien relay is still breathing, but OpenRouter needs another pulse.',
    model: MODELS[MODELS.length - 1],
    error: lastError instanceof Error ? lastError.message : 'Unknown error'
  });
}