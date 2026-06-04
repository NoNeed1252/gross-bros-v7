export default async function handler(req, res) {
  const { action, uuid } = req.query;

  if (action === 'create-payload') {
    const response = await fetch('https://xumm.app/api/v1/platform/payload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.XAMAN_API_KEY,
        'X-API-Secret': process.env.XAMAN_API_SECRET
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    return res.status(200).json(data);
  }

  if (action === 'check-payload') {
    const response = await fetch(`https://xumm.app/api/v1/platform/payload/${uuid}`, {
      headers: {
        'X-API-Key': process.env.XAMAN_API_KEY,
        'X-API-Secret': process.env.XAMAN_API_SECRET
      }
    });
    const data = await response.json();
    return res.status(200).json(data);
  }

  res.status(400).json({ error: 'Invalid action' });
}
