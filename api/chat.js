export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sendSse = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const streamFallback = async (message) => {
    const text = message || 'Unable to reach the model right now.';
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    for (const token of text.split(/(\s+)/)) {
      if (!token) continue;
      sendSse('token', { token });
      await delay(20);
    }
    sendSse('done', '[DONE]');
    return res.end();
  };

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const operative = body.operative || {};
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const operativeName = String(operative.name || 'Gross Bros Operative').trim();
  const walletAddress = String(operative.walletAddress || body.walletAddress || '').trim();
  const selectedNft = operative.selectedNft || {};
  const selectedName = String(selectedNft.name || operative.selectedNftName || operativeName).trim();
  const traits = Array.isArray(operative.traits)
    ? operative.traits.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  const lastUserText = [...messages]
    .reverse()
    .find((message) => String(message?.role || '').toLowerCase() === 'user')?.content
    || [...messages].reverse().find((message) => String(message?.role || '').toLowerCase() === 'user')?.message
    || '';

  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return await streamFallback('OpenRouter API key is missing.');
  }

  const systemPrompt = [
    'You are Gross Bros Neural Bot, the in-universe assistant for the Gross Bros project.',
    'Speak like a cryptic alien terminal with neon-green energy, mischievous humor, and occasional gross-out references.',
    'Stay in character at all times.',
    'Keep responses short, vivid, and useful. Prefer 1-3 brief lines.',
    `Operative name: ${operativeName}`,
    `Selected NFT: ${selectedName}`,
    `Traits: ${traits.length ? traits.join(', ') : 'none provided'}`,
    `Wallet: ${walletAddress || 'unavailable'}`,
    `Latest user message: ${lastUserText || ''}`
  ].join('\n');

  const openRouterMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || message.message || '')
      }))
      .filter((message) => message.content)
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  let upstream;
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://grossbros.vercel.app',
        'X-Title': 'Gross Bros Chat'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'huggingfaceh4/zephyr-7b-beta:free',
        messages: openRouterMessages,
        temperature: 0.7,
        stream: true
      })
    });
  } catch (error) {
    clearTimeout(timeout);
    return await streamFallback('OpenRouter request failed.');
  }
  clearTimeout(timeout);

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '');
    console.error('OpenRouter relay failed:', upstream.status, errText);
    return await streamFallback('The model is temporarily unavailable.');
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write(':ok\n\n');

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let started = false;
  let inactivityTimer;

  const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), 15000);
  };

  const emitToken = (token) => {
    if (!token) return;
    started = true;
    sendSse('token', { token });
  };

  const processLine = (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return false;
    const payloadText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!payloadText || payloadText === '[DONE]') return false;

    try {
      const payload = JSON.parse(payloadText);
      const token = String(
        payload?.choices?.[0]?.delta?.content ||
        payload?.choices?.[0]?.message?.content ||
        payload?.token ||
        payload?.content ||
        payload?.text ||
        ''
      );
      if (token) emitToken(token);
      if (payload?.choices?.[0]?.finish_reason) return true;
    } catch {
      emitToken(payloadText);
    }

    return false;
  };

  try {
    resetInactivityTimer();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetInactivityTimer();
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const shouldStop = processLine(line);
        if (shouldStop) break;
        newlineIndex = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) processLine(line);

    if (!started) throw new Error('OpenRouter produced no stream tokens.');
    sendSse('done', '[DONE]');
    return res.end();
  } catch (error) {
    if (error?.name === 'AbortError' || String(error?.message || '').includes('no stream tokens')) {
      return await streamFallback('The stream was interrupted.');
    }
    console.error('Chat relay failed:', error);
    res.status(500);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Chat relay failed', details: error?.message || String(error) })}\n\n`);
    return res.end();
  } finally {
    if (inactivityTimer) clearTimeout(inactivityTimer);
  }
}
