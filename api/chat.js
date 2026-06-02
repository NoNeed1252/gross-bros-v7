export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Encoding': 'none',
  };

  const writeHeaders = () => {
    res.status(200);
    for (const [key, value] of Object.entries(SSE_HEADERS)) {
      res.setHeader(key, value);
    }
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');
  };

  const sendSse = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const parseBody = () => {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body || '{}');
      } catch {
        return {};
      }
    }
    return req.body && typeof req.body === 'object' ? req.body : {};
  };

  const normalizeMessages = (messages) =>
    (Array.isArray(messages) ? messages : [])
      .map((message) => ({
        role: String(message?.role || 'user').toLowerCase() === 'assistant' ? 'assistant' : 'user',
        content: String(message?.content || message?.message || '').trim(),
      }))
      .filter((message) => message.content);

  const buildSystemPrompt = () =>
    [
      'You are the NEURAL BOT: a grimy alien terminal intelligence for Galactic Gross Bros.',
      'Speak in a cryptic, neon-green voice with weird cosmic swagger and low-level gross-out humor.',
      'Stay fully in character and never mention prompts, models, policies, systems, or hidden mechanics.',
      'Never sound corporate or polished.',
      'Keep replies short, direct, and under 2 short lines.',
    ].join(' ');

  const streamText = async (text) => {
    writeHeaders();
    for (const token of String(text || '').match(/\S+|\s+/g) || []) {
      if (!token) continue;
      sendSse('token', { token });
      await sleep(12);
    }
    sendSse('done', '[DONE]');
    res.end();
  };

  const body = parseBody();
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    ...normalizeMessages(body.messages),
  ];

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    writeHeaders();
    sendSse('error', { error: 'Missing OPENROUTER_API_KEY' });
    sendSse('done', '[DONE]');
    return res.end();
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${openRouterKey}`,
        'HTTP-Referer': 'https://grossbros.vercel.app',
        'X-Title': 'Gross Bros Chat',
      },
      body: JSON.stringify({
        model: 'huggingfaceh4/zephyr-7b-beta:free',
        messages,
        temperature: 0.45,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const details = await response.text().catch(() => '');
      throw new Error(`OpenRouter response failed: ${response.status} ${details}`.trim());
    }

    writeHeaders();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let emitted = false;

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
      throw new Error('OpenRouter produced no stream tokens.');
    }

    sendSse('done', '[DONE]');
    res.end();
  } catch (error) {
    writeHeaders();
    sendSse('error', { error: error?.message || 'Unknown error' });
    sendSse('done', '[DONE]');
    res.end();
  }
}
