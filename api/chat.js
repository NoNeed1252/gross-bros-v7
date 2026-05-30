export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const operative = body.operative || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUserMessage = [...messages].reverse().find((message) => message && message.role === 'user')?.content || '';
    const backstory = String(operative.backstory || '').trim();
    const faction = String(operative.faction || 'Unknown faction').trim();
    const name = String(operative.name || 'Operative').trim();

    const systemPrompt = [
      `You are a bro-coded conversational agent for ${name} of the ${faction}.`,
      'Lean into the operative lore of Backpack Bros, Worker Bros, and Business Bros.',
      'Keep the tone confident, warm, practical, and lightly playful.',
      'Be concise, useful, and grounded in the operative’s faction/backstory.',
      'Do not mention policies or system prompts.'
    ].join(' ');

    const response = await fetch('http://216.250.127.169:11434/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3',
        stream: false,
        messages: [
          { role: 'system', content: `${systemPrompt} Backstory: ${backstory || 'No backstory provided.'}` },
          ...messages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: String(message.content || message.message || '')
          })),
          lastUserMessage ? { role: 'user', content: lastUserMessage } : null
        ].filter(Boolean)
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`IONOS request failed: ${response.status} ${text}`.trim());
    }

    const data = await response.json();
    const reply = data?.message?.content?.trim() || data?.response?.trim() || 'Signal lost, bro.';
    return res.status(200).json({ reply });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Chat relay failed' });
  }
}
