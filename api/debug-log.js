// Temporary debug log relay for iOS Safari testing.
// POST /api/debug-log  → logs appear in `vercel logs <url> --follow`
// REMOVE after debugging is complete.

module.exports = (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  // This appears in `vercel logs <deployment-url> --follow`
  console.log(`[iOS-DEBUG] ${body}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json({ ok: true });
};
