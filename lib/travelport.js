
async function token(force = false) {
  const c = config();

  if (!c.configured) {
    throw new Error('Travelport is not configured. Add the required server environment variables in Hostinger.');
  }

  if (!force && tokenState.value && tokenState.exp > Date.now() + 120000) {
    return tokenState.value;
  }

  if (tokenState.promise) return tokenState.promise;

  tokenState.promise = (async () => {
    const form = new URLSearchParams({
      grant_type: 'password',
      username: process.env.TRAVELPORT_USERNAME,
      password: process.env.TRAVELPORT_PASSWORD,
      client_id: process.env.TRAVELPORT_CLIENT_ID,
      client_secret: process.env.TRAVELPORT_CLIENT_SECRET
    });

    const r = await fetch(roots().auth, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: form.toString(),
      signal: AbortSignal.timeout(18000)
    });

    const raw = await r.text();
    let j = {};

    try {
      j = JSON.parse(raw);
    } catch (_) {}

    if (!r.ok || !j.access_token) {
      const code = clean(j.error || j.code || 'unknown_error', 100);
      let detail = clean(
        j.error_description || j.message ||
        (Array.isArray(j.errors)
          ? j.errors.map(x => x.message || x.description || x.code).join('; ')
          : ''),
        500
      );

      // Never expose credentials in an error message.
      for (const secret of [
        process.env.TRAVELPORT_USERNAME,
        process.env.TRAVELPORT_PASSWORD,
        process.env.TRAVELPORT_CLIENT_ID,
        process.env.TRAVELPORT_CLIENT_SECRET
      ]) {
        if (secret) detail = detail.split(secret).join('[REDACTED]');
      }

      throw new Error(
        'Travelport OAuth failed (HTTP ' + r.status +
        ', ' + code + ')' +
        (detail ? ': ' + detail : '. No error description returned.')
      );
    }

    tokenState.value = j.access_token;
    tokenState.exp = Date.now() +
      Math.max(300, Math.min(86400, num(j.expires_in, 86400) - 180)) * 1000;

    return tokenState.value;
  })().finally(() => {
    tokenState.promise = null;
  });

  return tokenState.promise;
}
