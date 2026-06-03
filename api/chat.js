export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const openRouterApiKey = String(process.env.OPENROUTER_API_KEY || '').trim();

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
  const normalizedMessages = incomingMessages
    .map((message) => ({
      role: String(message?.role || 'user').toLowerCase() === 'assistant' ? 'assistant' : 'user',
      content: String(message?.content || message?.message || '').trim()
    }))
    .filter((message) => message.content);

  const messages = [{ role: 'system', content: systemPrompt }, ...normalizedMessages];
  const userPrompt = normalizedMessages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n\n');
  const pollinationsPrompt = [systemPrompt, userPrompt || normalizedMessages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')]
    .filter(Boolean)
    .join('\n\n');

  const ensureSseStarted = () => {
    if (res.headersSent) return;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'none');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');
  };

  const sendSse = (event, data) => {
    ensureSseStarted();
    if (event) res.write('event: ' + event + '\n');
    res.write('data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n');
  };

  const streamSseResponse = async (response, timeoutMs) => {
    if (!response?.body) return false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let emitted = false;
    let timeoutId;

    const resetTimeout = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        try { reader.cancel(); } catch {}
      }, timeoutMs);
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

    try {
      resetTimeout();
      while (true) {
        const { value, done } = await reader.read();
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
      return emitted;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
      try { reader.releaseLock(); } catch {}
    }
  };

  const tryOpenRouter = async () => {
    if (!openRouterApiKey) return { ok: false, status: 0 };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: 'Bearer ' + openRouterApiKey,
          'HTTP-Referer': 'https://grossbros.vercel.app',
          'X-Title': 'Gross Bros Chat'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'meta-llama/llama-3.1-8b-instruct:free',
          messages,
          temperature: 0.45,
          stream: true
        })
      });

      if (response.status === 429) {
        return { ok: false, status: 429 };
      }

      if (!response.ok) {
        await response.text().catch(() => '');
        return { ok: false, status: response.status };
      }

      const emitted = await streamSseResponse(response, 60000);
      return { ok: emitted, status: response.status };
    } catch (error) {
      return { ok: false, status: error?.name === 'AbortError' ? 408 : 500 };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const tryPollinationsDirect = async () => {
    const url = 'https://text.pollinations.ai/' + encodeURIComponent(pollinationsPrompt);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
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

      sendSse('token', { token: text });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const tryCannedFallback = async () => {
    sendSse('token', { token: 'The comms line is scrambled. Try again in a moment.' });
    return true;
  };

  const openRouterAttempt = await tryOpenRouter();
  let success = openRouterAttempt.ok;

  if (!success && openRouterAttempt.status === 429) {
    success = await tryPollinationsDirect();
  }

  if (!success) {
    success = await tryCannedFallback();
  }

  if (!success) {
    sendSse('error', { error: 'No chat provider returned a response.' });
  }

  sendSse('done', '[DONE]');
  res.end();
}
