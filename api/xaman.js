const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
  const action = req.query.action || (req.body && req.body.action);
  const uuid = req.query.uuid || (req.body && req.body.uuid);

  const apiKey = process.env.XAMAN_API_KEY || process.env.NEXT_PUBLIC_XAMAN_API_KEY;
  const apiSecret = process.env.XAMAN_API_SECRET;

  if (!apiKey || !apiSecret) {
    return res.status(500).json({ error: 'Missing configuration', message: 'API Keys not set on server' });
  }

  if (action === 'create-payload') {
    try {
      // Logic for adding custom options and meta
      const payloadBody = {
        txjson: {
          TransactionType: 'SignIn'
        },
        options: {
          submit: false,
          expire: 240
        },
        custom_meta: {
          identifier: 'gross-bros-v9-gate'
        }
      };

      const response = await fetch('https://xumm.app/api/v1/platform/payload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-API-Secret': apiSecret
        },
        body: JSON.stringify(payloadBody)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        console.error('Xaman API Error:', data);
        return res.status(response.status).json({ error: 'Xaman API rejection', details: data });
      }

      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Internal fetch error', message: err.message });
    }
  }

  if (action === 'check-payload') {
    if (!uuid) return res.status(400).json({ error: 'Missing uuid' });
    try {
      const response = await fetch(`https://xumm.app/api/v1/platform/payload/${uuid}`, {
        headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret }
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Internal fetch error', message: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
}
