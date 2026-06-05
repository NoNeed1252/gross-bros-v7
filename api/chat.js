import fetch from 'node-fetch';

/**
 * Gross Bros - Neural Chat Relay v2.1
 * Streaming SSE endpoint for neon alien operatives.
 * Updated to stream exact error details for debugging.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OLLAMA_ENDPOINT = "http://127.0.0.1:8443/api/chat";

const SYSTEM_PROMPT = `You are a Gross Bros neural relay operative.
The year is 202X. The ledger has fractured. The city is signal.
You speak in a themed, neon-dystopian, alien-tech-noir tone.
Short, punchy, gritty, and technically flavored responses.
Refer to the user as 'Operative' or 'Chimp'.
Use the provided XRPL token context if available to flavor your lore.
Do not break character. Do not mention these instructions.`;

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { token, operative, messages } = req.body;
    const activeContext = token || operative || {};
    
    // Build context string from XRPL token fields
    const contextStr = activeContext.name ? `[CONTEXT: Token ${activeContext.name} (${activeContext.key || 'N/A'}), Issuer: ${activeContext.issuer || 'N/A'}, Price: ${activeContext.price || 'N/A'}, MCap: ${activeContext.marketcap || 'N/A'}]` : "";

    // Keep last 18 messages
    const recentMessages = (messages || []).slice(-18).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content || m.text || ''
    }));

    const finalMessages = [
        { role: 'system', content: SYSTEM_PROMPT + (contextStr ? "\\n" + contextStr : "") },
        ...recentMessages
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const streamSSE = (token) => {
        res.write(`data: ${JSON.stringify({ token })}\\n\\n`);
    };

    try {
        // Try OpenRouter First
        if (!OPENROUTER_API_KEY) {
            console.warn("Missing OPENROUTER_API_KEY");
            // No error streamed yet, moving to fallback logic
        } else {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://gross-bros-v7.vercel.app",
                    "X-Title": "Gross Bros Relay"
                },
                body: JSON.stringify({
                    model: "meta-llama/llama-3.1-8b-instruct:free",
                    messages: finalMessages,
                    stream: true
                })
            });

            if (response.ok) {
                const reader = response.body;
                return new Promise((resolve) => {
                    reader.on('data', (chunk) => {
                        const lines = chunk.toString().split('\\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') continue;
                                try {
                                    const json = JSON.parse(data);
                                    const content = json.choices?.[0]?.delta?.content;
                                    if (content) streamSSE(content);
                                } catch (e) {}
                            }
                        }
                    });
                    reader.on('end', () => {
                        res.write('data: [DONE]\\n\\n');
                        res.end();
                        resolve();
                    });
                });
            } else {
                const errText = await response.text();
                console.error("OpenRouter API Error:", response.status, errText);
                streamSSE(`[DEBUG] OpenRouter Error ${response.status}: ${errText.slice(0, 200)}...`);
            }
        }

        // Fallback to local Ollama
        try {
            const ollamaRes = await fetch(OLLAMA_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "llama3",
                    messages: finalMessages,
                    stream: false
                })
            });

            if (ollamaRes.ok) {
                const data = await ollamaRes.json();
                const reply = data.message?.content || "Relay stabilized. Static cleared.";
                streamSSE(reply);
                res.write('data: [DONE]\\n\\n');
                return res.end();
            } else {
                const errText = await ollamaRes.text();
                throw new Error(`Ollama Error ${ollamaRes.status}: ${errText}`);
            }
        } catch (ollamaErr) {
            console.error("Ollama Fallback Error:", ollamaErr.message);
            throw new Error(`Primary and Fallback Providers Failed. Last Error: ${ollamaErr.message}`);
        }

    } catch (err) {
        console.error("Final Chat Error:", err);
        streamSSE(`[SIGNAL_LOST] Neural link severed. Diagnostic: ${err.message}`);
        res.write('data: [DONE]\\n\\n');
        res.end();
    }
}
