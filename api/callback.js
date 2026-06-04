export default async function handler(req, res) {
  // Set headers to allow the redirect and avoid CORS issues
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  // Handle Xaman (Xumm) callback redirect
  // Typically, Xaman appends result details or a payload UUID to the callback URL
  // We redirect the user back to the home page so the frontend can check the payload status
  const { payload_uuidv4 } = req.query;

  // Redirecting to root ensures the user doesn't stay on a blank /api/callback page.
  // The frontend script in index.html handles the polling logic.
  return res.redirect(302, '/');
}
