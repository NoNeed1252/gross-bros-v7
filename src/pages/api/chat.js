import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const config = {
  api: {
    bodyParser: true,
    externalResolver: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages } = req.body;

  try {
    // Set headers to disable buffering and support SSE streaming on Railway
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'none');
    res.setHeader('X-Accel-Buffering', 'no');

    const stream = await openai.chat.completions.create({
      model: 'meta-llama/llama-3-70b-instruct:free',
      messages: messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      res.write(text);
    }
    res.end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}