export default async function handler(req, res) {
    const XAMAN_API_KEY = process.env.XAMAN_API_KEY || '5f30fcbe-a810-490b-8fd5-500a37568a49';
    const baseUrl = 'https://xumm.app/api/v1/platform';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const { action, uuid } = req.query;

        if (action === 'create-payload') {
            const response = await fetch(`${baseUrl}/payload`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': XAMAN_API_KEY
                },
                body: JSON.stringify({
                    txjson: { TransactionType: 'SignIn' },
                    options: { submit: false, expire: 5 }
                })
            });

            const data = await response.json();
            return res.status(response.status).json(data);
        }

        if (action === 'check-payload' && uuid) {
            const response = await fetch(`${baseUrl}/payload/${uuid}`, {
                headers: { 'X-API-Key': XAMAN_API_KEY }
            });

            const data = await response.json();
            return res.status(response.status).json(data);
        }

        return res.status(400).json({ error: 'Invalid action' });
    } catch (error) {
        console.error('Xaman proxy error:', error);
        return res.status(500).json({ error: 'Proxy error' });
    }
}
