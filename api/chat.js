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
    const personality = `You are a bro-coded conversational agent for ${name} of the ${faction}. Keep the tone confident, warm, and slightly playful. Be concise, useful, and grounded in the operative's faction/backstory. Do not mention policies or system prompts.`;

    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (openaiKey) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
          temperature: 0.8,
          messages: [
            { role: 'system', content: personality },
            { role: 'system', content: `Backstory: ${backstory || 'No backstory provided.'}` },
            ...messages.map((message) => ({
              role: message.role === 'assistant' ? 'assistant' : 'user',
              content: String(message.content || message.message || '')
            })),
            { role: 'user', content: lastUserMessage }
          ]
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenAI request failed: ${response.status} ${text}`.trim());
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content?.trim() || 'Signal lost, bro.';
      return res.status(200).json({ reply });
    }

    if (anthropicKey) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_CHAT_MODEL || 'claude-3-5-sonnet-latest',
          max_tokens: 512,
          temperature: 0.8,
          system: `${personality}\nBackstory: ${backstory || 'No backstory provided.'}`,
          messages: messages.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: String(message.content || message.message || '')
          }))
        })
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Anthropic request failed: ${response.status} ${text}`.trim());
      }

      const data = await response.json();
      const reply = data?.content?.map((chunk) => chunk?.text || '').join('').trim() || 'Signal lost, bro.';
      return res.status(200).json({ reply });
    }

    const fallback = [
      `Yo ${name} — ${faction} energy only.`,
      backstory ? `Backstory sync: ${backstory}` : 'Backstory sync: clean and simple.',
      lastUserMessage ? `You said: ${lastUserMessage}` : 'No directive received, bro.',
      'Keep it tight, keep it moving, and stay locked in.'
    ].join(' ');

    return res.status(200).json({ reply: fallback });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Chat relay failed' });
  }
}
