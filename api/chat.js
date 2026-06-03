export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openRouterApiKey = String(process.env.OPENROUTERAPIKEY || process.env.OPENROUTER_API_KEY || '').trim();

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

  const sendSse = (event, data) => {
    if (event) res.write('event: ' + event + '\n');
    res.write('data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n');
  };

  let sseStarted = false;
  const ensureSseStarted = () => {
    if (sseStarted) return;
    sseStarted = true;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'none');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');
  };

  const emitToken = (token) => {
    if (!token) return;
    ensureSseStarted();
    sendSse('token', { token });
  };

  const consumeEventStream = async (response, timeoutMs) => {
    if (!response?.body) return { emitted: false, finished: false };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let emitted = false;
    let finished = false;
    const controller = new AbortController();
    let timeoutId;

    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(new Error('Stream inactivity timeout')), timeoutMs);
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
        if (token) {
          emitted = true;
          emitToken(token);
        }
        if (payload?.choices?.[0]?.finish_reason) finished = true;
        return finished;
      } catch {
        emitted = true;
        emitToken(payloadText);
        return false;
      }
    };

    try {
      resetTimeout();
      while (true) {
        const readPromise = reader.read();
        const { value, done } = await Promise.race([
          readPromise,
          new Promise((_, reject) => {
            controller.signal.addEventListener('abort', () => reject(controller.signal.reason || new Error('Stream aborted')), { once: true });
          })
        ]);

        if (done) break;
        resetTimeout();
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
      if (buffer.trim()) handleBlock(buffer);
      return { emitted, finished };
    } catch {
      return { emitted, finished: false };
    } finally {
      clearTimeout(timeoutId);
      try { reader.releaseLock(); } catch {}
    }
  };

  const openRouterModels = (() => {
    const requested = String(body?.model || '').trim();
    const defaults = ['meta-llama/llama-3-70b-instruct:free', 'google/gemini-pro-1.5-exp'];
    return requested ? [requested, ...defaults.filter((model) => model !== requested)] : defaults;
  })();

  const openRouterHeaders = openRouterApiKey ? {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: 'Bearer ' + openRouterApiKey,
    'HTTP-Referer': 'https://grossbros.vercel.app',
    'X-Title': 'Gross Bros Chat'
  } : null;

  const buildOpenAiLikeRequest = (url, options = {}) => fetch(url, {
    method: 'POST',
    headers: options.headers,
    body: JSON.stringify(options.body)
  });

  const tryOpenRouter = async () => {
    if (!openRouterHeaders) return false;

    for (const model of openRouterModels) {
      const response = await buildOpenAiLikeRequest('https://openrouter.ai/api/v1/chat/completions', {
        headers: openRouterHeaders,
        body: {
          model,
          messages,
          temperature: 0.45,
          stream: true
        }
      });

      if (!response.ok) {
        await response.text().catch(() => '');
        continue;
      }

      const result = await consumeEventStream(response, 60000);
      if (result.emitted) return true;
    }

    return false;
  };

  const tryPollinationsOpenAi = async () => {
    const response = await buildOpenAiLikeRequest('https://text.pollinations.ai/openai', {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: {
        model: String(body?.pollinationsModel || body?.model || 'openai').trim() || 'openai',
        messages,
        temperature: 0.45,
        stream: true
      }
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      return false;
    }

    const result = await consumeEventStream(response, 60000);
    return result.emitted;
  };

  const tryPollinationsPlainText = async () => {
    const plainPrompt = messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    const response = await fetch('https://text.pollinations.ai/' + encodeURIComponent(plainPrompt), {
      method: 'GET',
      headers: {
        Accept: 'text/plain'
      }
    });

    if (!response.ok) {
      await response.text().catch(() => '');
      return false;
    }

    const text = String(await response.text().catch(() => '')).trim();
    if (!text) return false;

    ensureSseStarted();
    sendSse('token', { token: text });
    return true;
  };

  const tryCannedFallback = async () => {
    ensureSseStarted();
    sendSse('token', { token: 'The comms line is scrambled. Try again in a moment.' });
    return true;
  };

  const success = await tryOpenRouter() || await tryPollinationsOpenAi() || await tryPollinationsPlainText() || await tryCannedFallback();

  if (!success) {
    ensureSseStarted();
    sendSse('error', { error: 'No chat provider returned a response.' });
  }

  sendSse('done', '[DONE]');
  res.end();
}
