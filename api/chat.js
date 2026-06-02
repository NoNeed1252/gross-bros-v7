export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
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

  const messages = [
    {
      role: 'system',
      content: 'You are the NEURAL BOT for Galactic Gross Bros. Speak like a grimy alien terminal intelligence, stay fully in character, and keep replies short.'
    },
    ...[].concat(Array.isArray(body.messages) ? body.messages : []).map((message) => ({
      role: String(message?.role || 'user').toLowerCase() === 'assistant' ? 'assistant' : 'user',
      content: String(message?.content || message?.message || '').trim()
    })).filter((message) => message.content)
  ];

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${openRouterKey}`,
      'HTTP-Referer': 'https://grossbros.vercel.app',
      'X-Title': 'Gross Bros Chat'
    },
    body: JSON.stringify({
      model: 'huggingfaceh4/zephyr-7b-beta:free',
      messages,
      temperature: 0.45,
      stream: true
    })
  });

  if (!upstream.ok || !upstream.body) {
    const details = await upstream.text().catch(() => '');
    return res.status(502).json({
      error: `OpenRouter response failed: ${upstream.status} ${details}`.trim()
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
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
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
