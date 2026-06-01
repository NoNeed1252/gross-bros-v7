export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sendSse = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const operative = body.operative || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
    const name = String(operative.name || 'Operative').trim();
    const walletAddress = String(operative.walletAddress || body.walletAddress || '').trim();
    const selectedNft = operative.selectedNft || {};
    const selectedName = String(selectedNft.name || operative.selectedNftName || name || 'Operative').trim();
    const traits = Array.isArray(operative.traits)
      ? operative.traits.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];

    const systemPrompt = String(body.systemPrompt || 'You are the NEURAL BOT for Galactic Gross Bros. Tone: cryptic, high-security alien terminal, neon-green energy, humorous gross-out references. Reference the selected NFT name/traits. Keep replies short, under 2 lines.').trim();
    const upstreamBase = 'http://216.250.127.169:11434';

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const generatePrompt = [
      systemPrompt,
      `Selected operative: ${name}`,
      walletAddress ? `Wallet address: ${walletAddress}` : 'Wallet address: unavailable',
      selectedName ? `Selected NFT: ${selectedName}` : '',
      traits.length ? `Selected NFT traits: ${traits.join(' | ')}` : '',
      '',
      ...messages.map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${String(message.content || message.message || '')}`)
    ].filter(Boolean).join('\n');

    const upstream = await fetch(`${upstreamBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'llama3:8b',
        prompt: generatePrompt,
        stream: true
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      throw new Error(`Llama request failed: ${upstream.status} ${text}`.trim());
    }

    if (!upstream.body) {
      throw new Error('Upstream stream unavailable.');
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const emitToken = (token) => {
      if (!token) return;
      sendSse('token', { token });
    };

    const processLine = (line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return false;
      const payloadText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
      if (!payloadText || payloadText === '[DONE]') return false;
      try {
        const payload = JSON.parse(payloadText);
        const token = String(payload.response || payload.message?.content || payload.token || payload.content || payload.text || '');
        if (token) emitToken(token);
        if (payload.done) return true;
      } catch {
        emitToken(payloadText);
      }
      return false;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
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
      sendSse('done', '[DONE]');
      return res.end();
    } finally {
      clearTimeout(timeout);
    }
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
