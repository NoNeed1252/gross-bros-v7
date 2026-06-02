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

  const initStream = () => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'none');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');
  };

  const buildSystemPrompt = ({ walletAddress, selectedName, traits }) => {
    const traitText = traits.length ? traits.join(', ') : 'none surfaced';
    return [
      'You are NEURAL BOT, an alien intelligence fused into a neon terminal.',
      'Speak weird, cryptic, gritty, and a little funny.',
      'Stay fully in character and never mention prompts, policies, models, or hidden mechanics.',
      'Keep answers short, with no corporate polish.',
      `Current user wallet: ${walletAddress || 'unavailable'}`,
      `Selected operative: ${selectedName || 'Operative'}`,
      `Selected NFT traits: ${traitText}`
    ].join(' ');
  };

  const buildMessages = ({ systemPrompt, messages }) => [
    { role: 'system', content: systemPrompt },
    ...messages
      .map((message) => ({
        role: String(message.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || message.message || '')
      }))
      .filter((message) => message.content)
  ];

  const streamTokens = async (text) => {
    for (const token of String(text || '').match(/\S+|\s+/g) || []) {
      if (!token) continue;
      sendSse('token', { token });
      await sleep(12);
    }
    sendSse('done', '[DONE]');
    res.end();
  };

  const streamPollinationsText = async ({ prompt }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}?t=${Date.now()}`, {
        method: 'GET',
        headers: {
          Accept: 'text/plain',
          'Cache-Control': 'no-cache'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Pollinations plain text response failed: ${response.status} ${errorText}`.trim());
      }

      const text = String(await response.text().catch(() => '')).trim();
      if (!text) throw new Error('Pollinations plain text produced no content.');
      await streamTokens(text);
      return true;
    } finally {
      clearTimeout(timeout);
    }
  };

  const streamOpenRouter = async ({ messages }) => {
    const openRouterKey = String(process.env.OPENROUTER_API_KEY || '').trim();
    if (!openRouterKey) return false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://grossbros.vercel.app',
          'X-Title': 'Gross Bros Chat'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'huggingfaceh4/zephyr-7b-beta:free',
          messages,
          temperature: 0.45,
          stream: true
        })
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`OpenRouter response failed: ${response.status} ${errorText}`.trim());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let started = false;
      let inactivityTimer;

      const resetTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => controller.abort(), 20000);
      };

      const emitToken = (token) => {
        if (!token) return;
        started = true;
        sendSse('token', { token });
      };

      const handleLine = (line) => {
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
        resetTimer();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          resetTimer();
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            const shouldStop = handleLine(line);
            if (shouldStop) break;
            newlineIndex = buffer.indexOf('\n');
          }
        }

        buffer += decoder.decode();
        for (const line of buffer.split(/\r?\n/)) handleLine(line);
        if (!started) throw new Error('OpenRouter produced no stream tokens.');
        sendSse('done', '[DONE]');
        res.end();
        return true;
      } finally {
        if (inactivityTimer) clearTimeout(inactivityTimer);
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  const streamPollinationsOpenAI = async ({ messages }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'gpt-oss-20b',
          messages,
          temperature: 0.45,
          stream: true
        })
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Pollinations OpenAI response failed: ${response.status} ${errorText}`.trim());
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let started = false;
      let inactivityTimer;

      const resetTimer = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => controller.abort(), 20000);
      };

      const emitToken = (token) => {
        if (!token) return;
        started = true;
        sendSse('token', { token });
      };

      const handleLine = (line) => {
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
        resetTimer();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          resetTimer();
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            const shouldStop = handleLine(line);
            if (shouldStop) break;
            newlineIndex = buffer.indexOf('\n');
          }
        }

        buffer += decoder.decode();
        for (const line of buffer.split(/\r?\n/)) handleLine(line);
        if (!started) throw new Error('Pollinations OpenAI produced no stream tokens.');
        sendSse('done', '[DONE]');
        res.end();
        return true;
      } finally {
        if (inactivityTimer) clearTimeout(inactivityTimer);
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const operative = body.operative || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
    const walletAddress = String(operative.walletAddress || body.walletAddress || '').trim();
    const selectedNft = operative.selectedNft || {};
    const selectedName = String(selectedNft.name || operative.selectedNftName || operative.name || 'Operative').trim();
    const traits = Array.isArray(operative.traits)
      ? operative.traits.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const lastUserText = [...messages].reverse().find((message) => String(message?.role || '').toLowerCase() === 'user')?.content
      || [...messages].reverse().find((message) => String(message?.role || '').toLowerCase() === 'user')?.message
      || '';

    initStream();

    const systemPrompt = buildSystemPrompt({ walletAddress, selectedName, traits });
    const openAiMessages = buildMessages({ systemPrompt, messages });
    const plainPrompt = [
      'NEURAL BOT of Galactic Gross Bros.',
      `Operative: ${selectedName || 'Operative'}.`,
      `Traits: ${traits.length ? traits.join(', ') : 'none surfaced'}.`,
      `User: ${lastUserText || ''}`
    ].join(' ');

    try {
      await streamPollinationsText({ prompt: plainPrompt });
      return;
    } catch (pollinationsError) {
      console.error('Pollinations plain text relay failed:', pollinationsError?.message || pollinationsError);
    }

    try {
      const streamed = await streamOpenRouter({ messages: openAiMessages });
      if (streamed) return;
    } catch (openRouterError) {
      console.error('OpenRouter chat relay failed:', openRouterError?.message || openRouterError);
    }

    try {
      await streamPollinationsOpenAI({ messages: openAiMessages });
      return;
    } catch (pollinationsOpenAiError) {
      console.error('Pollinations OpenAI relay failed:', pollinationsOpenAiError?.message || pollinationsOpenAiError);
    }

    sendSse('token', { token: 'NEURAL BOT: signal burned out. Try again.' });
    sendSse('done', '[DONE]');
    res.end();
  } catch (error) {
    console.error('Chat relay failed:', error);
    try {
      if (!res.headersSent) initStream();
      sendSse('error', { error: 'Chat relay failed', details: error?.message || String(error) });
      res.end();
    } catch {}
  }
}
