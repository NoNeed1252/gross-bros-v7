export default async function handler(req, res) {
  // Merge query and body params to ensure 'action' is always found regardless of request method
  const action = req.query.action || (req.body && req.body.action);
  const uuid = req.query.uuid || (req.body && req.body.uuid);

  console.log(`Xaman API Request: Action=${action}, Method=${req.method}`);

  if (action === 'create-payload') {
    try {
      const response = await fetch('https://xumm.app/api/v1/platform/payload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.XAMAN_API_KEY,
          'X-API-Secret': process.env.XAMAN_API_SECRET
        },
        // Re-wrap the body to ensure we only send valid Xaman payload fields
        body: JSON.stringify({
          txjson: {
            TransactionType: 'SignIn'
          }
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        console.error('Xaman API Error Response:', data);
        return res.status(response.status).json({ error: 'Xaman API rejection', details: data });
      }

      return res.status(200).json(data);
    } catch (err) {
      console.error('Fetch error in create-payload:', err);
      return res.status(500).json({ error: 'Internal fetch error', message: err.message });
    }
  }

  if (action === 'check-payload') {
    if (!uuid) return res.status(400).json({ error: 'Missing uuid for check-payload' });
    
    try {
      const response = await fetch(`https://xumm.app/api/v1/platform/payload/${uuid}`, {
        headers: {
          'X-API-Key': process.env.XAMAN_API_KEY,
          'X-API-Secret': process.env.XAMAN_API_SECRET
        }
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      console.error('Fetch error in check-payload:', err);
      return res.status(500).json({ error: 'Internal fetch error', message: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action or parameters', received: { action, query: req.query, body: req.body } });
}
