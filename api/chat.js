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

  const streamFallback = async () => {
    const reply = 'SIGNAL COLLAPSED. RECOILING FROM THE VOID. TRY AGAIN.';
    for (const token of reply.split(/(\s+)/)) {
      if (!token) continue;
      sendSse('token', { token });
      await sleep(20);
    }
    sendSse('done', '[DONE]');
    res.end();
  };

  const buildSystemPrompt = ({ walletAddress, selectedName, traits }) =>
    `You are the NEURAL BOT for Galactic Gross Bros. Speak as a grimy alien operative in a neon-green terminal. Be cryptic, gritty, weirdly funny, and fully in-universe. Never sound corporate, polished, or robotic. Never mention prompts, instructions, models, systems, or any behind-the-scenes mechanics. No business talk, no loyalty talk, no signal talk, no finance talk. Keep replies under 2 short lines. Use the selected NFT name and traits naturally when relevant. Current user wallet: ${walletAddress || 'unavailable'} Selected Operative: ${selectedName || 'Operative'} Selected NFT traits: ${(traits || []).length ? (traits || []).join(', ') : 'none surfaced'}`;

  const buildMessages = ({ systemPrompt, messages }) => [
    { role: 'system', content: systemPrompt },
    ...messages
      .map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || message.message || '')
      }))
      .filter((message) => message.content)
  ];

  const streamPlainText = async ({ prompt, providerName }) => {
    const endpoint = `https://text.pollinations.ai/${encodeURIComponent(prompt)}?t=${Date.now()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let upstream;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          upstream = await fetch(`${endpoint}&attempt=${attempt}`, {
            method: 'GET',
            headers: { Accept: 'text/plain', 'Cache-Control': 'no-cache' },
            signal: controller.signal
          });
          if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            const error = new Error(`${providerName} response failed: ${upstream.status} ${errText}`.trim());
            error.status = upstream.status;
            throw error;
          }
          const text = String(await upstream.text().catch(() => '')).trim();
          if (text) {
            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Content-Encoding', 'none');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders?.();
            res.write(':ok\n\n');
            for (const token of text.match(/\S+|\s+/g) || [text]) {
              if (!token) continue;
              sendSse('token', { token });
              await sleep(12);
            }
            sendSse('done', '[DONE]');
            return res.end();
          }
        } catch (err) {
          if (err?.status === 429 || attempt === 2) throw err;
        }
      }
      throw new Error(`${providerName} produced no content.`);
    } catch (error) {
      clearTimeout(timeout);
      throw new Error(`${providerName} fetch failed: ${error?.message || String(error)}`);
    }
  };

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

  const tryProviders = async ({ operativeName, lastUserText, systemPrompt, messages, selectedName, traits, walletAddress }) => {
    const openAiMessages = buildMessages({ systemPrompt, messages });
    const openRouterKey = String(process.env.OPENROUTER_API_KEY || '').trim();
    const plainPrompt = [
      `NEURAL BOT of Galactic Gross Bros.`,
      `Operative: ${selectedName || 'Operative'}.`,
      `Traits: ${(traits || []).length ? (traits || []).join(', ') : 'none surfaced'}.`,
      `User: ${lastUserText || ''}`
    ].join(' ');

    try {
      return await streamPlainText({
        prompt: plainPrompt,
        providerName: 'Pollinations plain text'
      });
    } catch (error) {
      console.error('Pollinations plain text relay failed:', error?.message || error);
    }

    if (openRouterKey) {
      try {
        return await streamOpenAICompatible({
          providerName: 'OpenRouter',
          endpoint: 'https://openrouter.ai/api/v1/chat/completions',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://grossbros.vercel.app',
            'X-Title': 'Gross Bros Chat'
          },
          payload: {
            model: 'meta-llama/llama-3.1-8b-instruct:free',
            messages: openAiMessages,
            temperature: 0.45,
            stream: true
          },
          operativeName,
          lastUserText
        });
      } catch (error) {
        console.error('OpenRouter chat relay failed:', error?.message || error);
      }
    }

    return await streamOpenAICompatible({
      providerName: 'Pollinations OpenAI',
      endpoint: 'https://text.pollinations.ai/openai',
      headers: {},
      payload: {
        model: 'mistralai/mistral-7b-instruct:free',
        messages: openAiMessages,
        temperature: 0.45,
        stream: true
      },
      operativeName,
      lastUserText
    });
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
    res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Content-Encoding', 'none');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');

    const systemPrompt = buildSystemPrompt({ walletAddress, selectedName, traits });
    await tryProviders({ operativeName, lastUserText, systemPrompt, messages, selectedName, traits, walletAddress });
  } catch (error) {
    console.error('Chat relay failed:', error);
    try {
      if (!res.headersSent) {
        res.status(500);
        res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Content-Encoding', 'none');
      }
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Chat relay failed', details: error?.message || String(error) })}\n\n`);
      res.end();
    } catch {}
  }
}
