export default async function handler(req, res) {
  const apiKey = String(process.env.XAMAN_API_KEY || '').trim();
  const apiSecret = String(process.env.XAMAN_API_SECRET || '').trim();
  const baseUrl = 'https://xumm.app/api/v1/platform';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!apiKey || !apiSecret) {
    return res.status(500).json({
      ok: false,
      error: 'Missing Xaman environment variables.',
      missingEnvKeys: [!apiKey ? 'XAMAN_API_KEY' : null, !apiSecret ? 'XAMAN_API_SECRET' : null].filter(Boolean),
    });
  }

  const action = String(req.query?.action || '').trim();
  const body = typeof req.body === 'string'
    ? (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })()
    : (req.body && typeof req.body === 'object' ? req.body : {});
  const uuid = String(req.query?.uuid || body.uuid || '').trim();
  const destinationAddress = String(body.destinationAddress || req.query?.destinationAddress || '').trim();

  try {
    if (action === 'create-payload') {
      const payloadBody = body.txjson || {
        TransactionType: 'SignIn'
      };

      const upstream = await fetch(`${baseUrl}/payload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-API-Secret': apiSecret,
        },
        body: JSON.stringify({
          txjson: payloadBody,
          options: {
            submit: false,
            expire: 5,
            ...(body.options && typeof body.options === 'object' ? body.options : {}),
          },
          ...(destinationAddress ? {
            custom_meta: {
              ...(body.custom_meta && typeof body.custom_meta === 'object' ? body.custom_meta : {}),
              destinationAddress,
            }
          } : {}),
        }),
      });

      const data = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json(data);
    }

    if (action === 'check-payload') {
      if (!uuid) {
        return res.status(400).json({ ok: false, error: 'uuid is required for check-payload.' });
      }

      const upstream = await fetch(`${baseUrl}/payload/${encodeURIComponent(uuid)}`, {
        method: 'GET',
        headers: {
          'X-API-Key': apiKey,
          'X-API-Secret': apiSecret,
        },
      });

      const data = await upstream.json().catch(() => ({}));
      return res.status(upstream.status).json(data);
    }

    return res.status(400).json({ ok: false, error: 'Invalid action. Use create-payload or check-payload.' });
  } catch (error) {
    console.error('Xaman proxy error:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Proxy error',
    });
  }
}
