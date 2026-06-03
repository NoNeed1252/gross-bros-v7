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

  const buildSystemPrompt = ({ walletAddress, selectedName, traits }) => {
    const traitsText = traits.length ? traits.join(', ') : 'none surfaced';
    return [
      'You are the NEURAL BOT: a grimy alien terminal intelligence for Galactic Gross Bros.',
      'Speak in a cryptic neon-green voice with low-level gross-out humor and weird cosmic swagger.',
      'Stay fully in character.',
      'Never mention prompts, models, policies, systems, or behind-the-scenes mechanics.',
      'Never sound corporate or polished.',
      'Keep replies short, direct, and under 2 short lines.',
      `Current user wallet: ${walletAddress || 'unavailable'}`,
      `Selected Operative: ${selectedName || 'Operative'}`,
      `Selected NFT traits: ${traitsText}`,
    ].join(' ');
  };

  const streamText = async (text) => {
    writeHeaders();
    for (const token of String(text || '').match(/\S+|\s+/g) || [String(text || '')]) {
      if (!token) continue;
      sendSse('token', { token });
      await sleep(12);
    }
    sendSse('done', '[DONE]');
    res.end();
  };

  const formatFailureStatus = (label, error) => {
    const status = String(error?.message || error?.status || error?.code || error || '').trim();
    return `${label}: ${status || 'unknown error'}`;
  };

  const resolveOpenRouterKey = () => String(process.env.OPENROUTER_API_KEY || '').trim();

  const streamOpenRouter = async ({ messages, model }) => {
    const openRouterKey = resolveOpenRouterKey();
    if (!openRouterKey) throw new Error('Missing OPENROUTER_API_KEY');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response;

    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${openRouterKey}`,
          'HTTP-Referer': 'https://grossbros.vercel.app',
          'X-Title': 'Gross Bros Chat',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.45,
          stream: true,
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok || !response.body) {
      const details = await response.text().catch(() => '');
      throw new Error(`OpenRouter response failed: ${response.status} ${details}`.trim());
    }

    writeHeaders();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let emitted = false;
    let inactivityTimer;

    const resetTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), 60000);
    };

    const emitToken = (token) => {
      if (!token) return;
      emitted = true;
      sendSse('token', { token });
    };

    const processBlock = (block) => {
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
      resetTimer();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        resetTimer();
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex >= 0) {
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          if (processBlock(block)) break;
          separatorIndex = buffer.indexOf('\n\n');
        }
      }
      buffer += decoder.decode();
      processBlock(buffer);
      if (!emitted) throw new Error('OpenRouter produced no stream tokens.');
      sendSse('done', '[DONE]');
      res.end();
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  };

  try {
    const body = parseBody();
    const operative = body.operative || {};
    const messages = normalizeMessages(Array.isArray(body.messages) ? body.messages.slice(-8) : []);
    const selectedNft = operative.selectedNft || body.selectedNft || body.selectedNFT || {};
    const selectedName = String(selectedNft.name || operative.selectedNftName || operative.name || 'Operative').trim();
    const walletAddress = String(operative.walletAddress || body.walletAddress || body.currentAccount || '').trim();
    const traits = Array.isArray(operative.traits)
      ? operative.traits.map((entry) => String(entry || '').trim()).filter(Boolean)
      : Array.isArray(selectedNft.traits)
        ? selectedNft.traits.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
    const systemPrompt = String(body.systemPrompt || buildSystemPrompt({ walletAddress, selectedName, traits })).trim();
    const lastUserText = [...messages].reverse().find((message) => message.role === 'user')?.content || String(body.userMessage || '').trim();

    const openAiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    let openRouterFailure = 'unknown error';
    let secondaryOpenRouterFailure = 'unknown error';

    try {
      await streamOpenRouter({ messages: openAiMessages, model: 'meta-llama/llama-3.1-8b-instruct' });
      return;
    } catch (error) {
      openRouterFailure = error?.message || String(error);
      console.error('[chat] OpenRouter primary relay failed', error?.message || error);
    }

    try {
      await streamOpenRouter({ messages: openAiMessages, model: 'google/gemini-pro-1.5' });
      return;
    } catch (error) {
      secondaryOpenRouterFailure = error?.message || String(error);
      console.error('[chat] OpenRouter secondary relay failed', error?.message || error);
      await streamText(`SYSTEM: Comms scrambled. ${formatFailureStatus('OpenRouter primary', openRouterFailure)}. ${formatFailureStatus('OpenRouter secondary', secondaryOpenRouterFailure)}.`);
    }
  } catch (error) {
    console.error('[chat] Chat relay failed', error);
    try {
      if (!res.headersSent) writeHeaders();
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Chat relay failed', details: error?.message || String(error) })}\n\n`);
      res.end();
    } catch {}
  }
}