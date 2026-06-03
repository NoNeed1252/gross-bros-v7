export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openRouterApiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!openRouterApiKey) {
    return res.status(500).json({ error: 'Missing OPENROUTER_API_KEY' });
  }

  const body = typeof req.body === 'string'
    ? (() => {
        try {
          return JSON.parse(req.body || '{}');
        } catch {
          return {};
        }
      })()
    : (req.body && typeof req.body === 'object' ? req.body : {});

  const incomingMessages = Array.isArray(body?.messages) ? body.messages : [];
  const systemPrompt = 'You are the Neural Bot for Galactic Gross Bros. Speak like a grimy alien terminal intelligence, stay fully in character, and keep replies short.';
  const messages = [
    { role: 'system', content: systemPrompt },
    ...incomingMessages.map((message) => ({
      role: String(message?.role || 'user').toLowerCase() === 'assistant' ? 'assistant' : 'user',
      content: String(message?.content || message?.message || '').trim()
    })).filter((message) => message.content)
  ];

  const models = [
    'meta-llama/llama-3-70b-instruct:free',
    'google/gemini-pro-1.5-exp'
  ];

  const buildRequest = (model) => fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: 'Bearer ' + openRouterApiKey,
      'HTTP-Referer': 'https://grossbros.vercel.app',
      'X-Title': 'Gross Bros Chat'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.45,
      stream: true
    })
  });

  let upstream;
  let upstreamModel = models[0];
  let upstreamError = '';

  for (const model of models) {
    upstreamModel = model;
    const response = await buildRequest(model);
    if (response.ok && response.body) {
      upstream = response;
      break;
    }

    const details = await response.text().catch(() => '');
    upstreamError = (`OpenRouter response failed for ${model}: ${response.status} ${details}`).trim();
  }

  if (!upstream || !upstream.body) {
    return res.status(502).json({
      error: upstreamError || `OpenRouter response failed for ${upstreamModel}`
    });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Encoding', 'none');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(':ok\n\n');

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let emitted = false;

  const sendSse = (event, data) => {
    if (event) res.write('event: ' + event + '\n');
    res.write('data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n');
  };

  const emitToken = (token) => {
    if (!token) return;
    emitted = true;
    sendSse('token', { token });
  };

  const handleBlock = (block) => {
    const text = String(block || '').trim();
    if (!text) return false;

    const payloadText = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('')
      .trim();

    if (!payloadText || payloadText === '[DONE]') return false;

    try {
      const payload = JSON.parse(payloadText);
      const token = String(
        payload?.choices?.[0]?.delta?.content ||
        payload?.choices?.[0]?.delta?.reasoning ||
        payload?.choices?.[0]?.message?.content ||
        payload?.content ||
        payload?.text ||
        ''
      );
      if (token) emitToken(token);
      return Boolean(payload?.choices?.[0]?.finish_reason);
    } catch {
      emitToken(payloadText);
      return false;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (handleBlock(block)) break;
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  handleBlock(buffer);

  if (!emitted) {
    sendSse('error', { error: 'OpenRouter produced no stream tokens.' });
  }

  sendSse('done', '[DONE]');
  res.end();
}
