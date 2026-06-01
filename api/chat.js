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

  const buildSystemPrompt = ({ walletAddress, selectedName, traits, lastUserText }) =>
    `You are the NEURAL BOT for Galactic Gross Bros — an alien operative terminal AI. Respond only in-character as the user's personal alien operative. Tone: cryptic, terminal-style, neon-green energy, eerie sci-fi, gross-out humor. Never sound like a business bro. Never mention signals, loyalty, partnerships, contracts, finance, sales, legal, court, strategy, or corporate language unless the user explicitly asks for it. Never mention 'Business Bro' or any faction except Galactic Gross Bros. Reference the selected NFT name/traits and the project lore when relevant. Keep replies short, under 2 lines. Current user wallet: ${walletAddress || 'unavailable'} Selected Operative: ${selectedName || 'Operative'} User message: ${lastUserText || ''}${(traits || []).length ? ` Selected NFT traits: ${(traits || []).join(', ')}` : ''}`;

  const buildMessages = ({ systemPrompt, messages }) => [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: 'Hard constraint: stay in the NEURAL BOT alien terminal voice. Do not drift into business, legal, loyalty, signal, or corporate talk. Keep it gross, cryptic, neon-green, and in-universe.' },
    ...messages
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || message.message || '')
      }))
      .filter((message) => message.content)
  ];

  const streamOpenAICompatible = async ({
    providerName,
    endpoint,
    headers,
    payload,
    operativeName,
    lastUserText
  }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...headers
        },
        signal: controller.signal,
        body: JSON.stringify(payload)
      });
    } catch (error) {
      clearTimeout(timeout);
      throw new Error(`${providerName} fetch failed: ${error?.message || String(error)}`);
    }
    clearTimeout(timeout);

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '');
      throw new Error(`${providerName} response failed: ${upstream.status} ${errText}`.trim());
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let started = false;
    let inactivityTimer;

    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), 20000);
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
          payload?.choices?.[0]?.delta?.reasoning ||
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
      if (!started) throw new Error(`${providerName} produced no stream tokens.`);
      sendSse('done', '[DONE]');
      return res.end();
    } catch (error) {
      if (error?.name === 'AbortError' || String(error?.message || '').includes('no stream tokens')) {
        throw new Error(`${providerName} stream failed: ${error?.message || String(error)}`);
      }
      throw error;
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  };

  const tryProviders = async ({ operativeName, lastUserText, systemPrompt, messages }) => {
    const openAiMessages = buildMessages({ systemPrompt, messages });
    const openRouterKey = String(process.env.OPENROUTER_API_KEY || '').trim();

    const providers = [];
    if (openRouterKey) {
      providers.push({
        providerName: 'OpenRouter',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://grossbros.vercel.app',
          'X-Title': 'Gross Bros Chat'
        },
        payload: {
          model: 'huggingfaceh4/zephyr-7b-beta:free',
          messages: openAiMessages,
          temperature: 0.7,
          stream: true
        }
      });
    }

    providers.push({
      providerName: 'Pollinations',
      endpoint: 'https://text.pollinations.ai/openai',
      headers: {},
      payload: {
        model: 'gpt-oss-20b',
        messages: openAiMessages,
        temperature: 0.7,
        stream: true
      }
    });

    let lastError = null;
    for (const provider of providers) {
      try {
        return await streamOpenAICompatible({
          ...provider,
          operativeName,
          lastUserText
        });
      } catch (error) {
        lastError = error;
        console.error(`${provider.providerName} chat relay failed:`, error?.message || error);
      }
    }
    throw lastError || new Error('No provider succeeded.');
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

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');

    const systemPrompt = buildSystemPrompt({ walletAddress, selectedName, traits, lastUserText });
    await tryProviders({ operativeName, lastUserText, systemPrompt, messages });
  } catch (error) {
    console.error('Chat relay failed:', error);
    try {
      if (!res.headersSent) {
        res.status(500);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
      }
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Chat relay failed', details: error?.message || String(error) })}\n\n`);
      res.end();
    } catch {}
  }
}
