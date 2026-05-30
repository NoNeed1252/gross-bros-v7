export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const operative = body.operative || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const backstory = String(operative.backstory || '').trim();
    const faction = String(operative.faction || 'Unknown faction').trim();
    const name = String(operative.name || 'Operative').trim();

    const systemPrompt = [
      `You are a bro-coded conversational agent for ${name} of the ${faction}.`,
      'Lean into the operative lore of Backpack Bros, Worker Bros, and Business Bros.',
      'Keep the tone confident, warm, practical, and lightly playful.',
      'Be concise, useful, and grounded in the operative’s faction/backstory.',
      'Do not mention policies or system prompts.',
      'Keep the reply to at most 50 tokens and answer immediately.'
    ].join(' ');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const upstreamBase = 'http://216.250.127.169:8443';

    const generatePrompt = [
      systemPrompt,
      `Backstory: ${backstory || 'No backstory provided.'}`,
      '',
      ...messages.map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${String(message.content || message.message || '')}`)
    ].join('\n');

    const response = await fetch(`${upstreamBase}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'llama3:8b',
        prompt: generatePrompt,
        stream: false,
        options: {
          num_predict: 50
        }
      })
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`IONOS request failed: ${response.status} ${text}`.trim());
    }

    const data = await response.json();
    const reply = data?.response?.trim() || data?.message?.content?.trim() || 'Signal lost, bro.';
    return res.status(200).json({ reply });
  } catch (error) {
    console.error('Chat relay failed:', error);
    return res.status(500).json({
      error: 'Chat relay failed',
      details: error?.message || String(error)
    });
  }
}

