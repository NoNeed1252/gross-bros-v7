module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const xamanApiKey = (process.env.NEXT_PUBLIC_XAMAN_API_KEY || '').trim();
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();

  if (!xamanApiKey || !supabaseUrl) {
    res.status(500).json({
      ok: false,
      error: 'Missing public configuration.',
    });
    return;
  }

  res.status(200).json({
    ok: true,
    xamanApiKey,
    supabaseUrl,
  });
};
