export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sendSse = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const streamFallback = async (operativeName, lastUserText) => {
    const reply = [
      `Relay fallback active for ${operativeName}.`,
      lastUserText ? `I received: ${lastUserText}.` : 'I received your directive.',
      'The neural link is alive, but the upstream provider is unavailable.',
      'Try again in a moment or shorten the prompt.'
    ].join(' ');
    for (const token of reply.split(/(\s+)/)) {
      if (!token) continue;
      sendSse('token', { token });
      await sleep(20);
    }
    sendSse('done', '[DONE]');
    res.end();
  };

  const streamOpenRouter = async ({
    operativeName,
    walletAddress,
    selectedName,
    traits,
    messages,
    lastUserText
  }) => {
    const apiKey = process.env.OPENROUTER_API_KEY || ''; 
    if (!apiKey) {
      return await streamFallback(operativeName, lastUserText);
    }

    const systemPrompt = `You are the NEURAL BOT for Galactic Gross Bros — an alien operative terminal AI. The user holds a specific Gross Bros NFT. Respond in-character as their personal operative. Tone: cryptic, high-security alien terminal, neon-green energy, humorous gross-out references. Reference the selected NFT name/traits and the overall project lore (galactic gross bros faction). Keep replies short, terminal-style, under 2 lines. Current user wallet: ${walletAddress || 'unavailable'} Selected Operative: ${selectedName || 'Operative'} Selected NFT traits: ${(traits || []).join(', ') || 'none surfaced'} User message: ${lastUserText || ''}`;

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
      return await streamFallback(operativeName, lastUserText);
    }
    clearTimeout(timeout);

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '');
      console.error('OpenRouter relay failed:', upstream.status, errText);
      return await streamFallback(operativeName, lastUserText);
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
      const remaining = buffer.split(/\r?\n/);
      for (const line of remaining) processLine(line);
      if (!started) {
        throw new Error('OpenRouter produced no stream tokens.');
      }
      sendSse('done', '[DONE]');
      return res.end();
    } catch (error) {
      if (error?.name === 'AbortError' || String(error?.message || '').includes('no stream tokens')) {
        return await streamFallback(operativeName, lastUserText);
      }
      throw error;
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const operative = body.operative || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
    const operativeName = String(operative.name || 'Operative').trim();
    const walletAddress = String(operative.walletAddress || body.walletAddress || '').trim();
    const selectedNft = operative.selectedNft || {};
    const selectedName = String(selectedNft.name || operative.selectedNftName || operativeName || 'Operative').trim();
    const traits = Array.isArray(operative.traits)
      ? operative.traits.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];

    const lastUserText = [...messages]
      .reverse()
      .find((message) => String(message?.role || '').toLowerCase() === 'user')?.content
      || [...messages].reverse().find((message) => String(message?.role || '').toLowerCase() === 'user')?.message
      || '';

    await streamOpenRouter({
      operativeName,
      walletAddress,
      selectedName,
      traits,
      messages,
      lastUserText
    });
  } catch (error) {
    console.error('Chat relay failed:', error);
    try {
      res.status(500);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Chat relay failed', details: error?.message || String(error) })}\n\n`);
      res.end();
    } catch {}
  }
}
