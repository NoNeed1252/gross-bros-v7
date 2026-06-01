export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const send = (event, data) => {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stream = async (text) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(':ok\n\n');
    for (const token of String(text || '').match(/\S+|\s+/g) || []) {
      send('token', { token });
      await sleep(12);
    }
    send('done', '[DONE]');
    res.end();
  };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const operative = body.operative || {};
    const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
    const selectedNft = operative.selectedNft || {};
    const selectedName = String(selectedNft.name || operative.selectedNftName || operative.name || 'Operative').trim();
    const traits = Array.isArray(operative.traits) ? operative.traits.map((v) => String(v || '').trim()).filter(Boolean) : [];
    const walletAddress = String(operative.walletAddress || body.walletAddress || '').trim();
    const lastUserText = [...messages].reverse().find((m) => String(m?.role || '').toLowerCase() === 'user')?.content || [...messages].reverse().find((m) => String(m?.role || '').toLowerCase() === 'user')?.message || '';

    const prompt = [
      'NEURAL BOT of Galactic Gross Bros.',
      'Status update in 2 cryptic lines.',
      `Wallet: ${walletAddress || 'unavailable'}.`,
      `Operative: ${selectedName}.`,
      `Traits: ${traits.length ? traits.join(', ') : 'none surfaced'}.`,
      `User: ${lastUserText || ''}`
    ].join(' ');

    try {
      const upstream = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`, { headers: { Accept: 'text/plain' } });
      const text = String(await upstream.text().catch(() => '')).trim();
      if (upstream.ok && text) return await stream(text);
      throw new Error(`pollinations ${upstream.status}`);
    } catch (error) {
      console.error('pollinations failed:', error?.message || error);
      return await stream([
        `Relay fallback active for ${selectedName}.`,
        lastUserText ? `I received: ${lastUserText}.` : 'I received your directive.',
        'The neural link is alive but the outer relay is murky.',
        'Try again in a moment.'
      ].join(' '));
    }
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
