// Extra information shown next to the integration cards (web addresses the owner must paste into a provider, etc.).
export function hubExtras(req) {
  const base = `${req.protocol}://${req.get('host')}`;
  return {
    twilio_hooks: { bridge: `${base}/api/hooks/twilio/bridge`, status: `${base}/api/hooks/twilio/status` },
  };
}
