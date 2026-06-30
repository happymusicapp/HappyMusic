/* ═══════════════════════════════════════════════
   HAPPY MUSIC – functions/api/token.js
   Cloudflare Pages Function
   Troca o código OAuth por access_token no servidor,
   mantendo o client_secret fora do navegador.

   Rota: POST /api/token
═══════════════════════════════════════════════ */

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { code, code_verifier, redirect_uri } = body;

    if (!code || !code_verifier || !redirect_uri) {
      return new Response(
        JSON.stringify({ error: 'missing_params' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // client_id e client_secret ficam como variáveis de ambiente,
    // nunca expostos no código do frontend.
    const params = new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri,
      grant_type:    'authorization_code',
      code_verifier,
    });

    const googleRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    const data = await googleRes.json();

    return new Response(JSON.stringify(data), {
      status: googleRes.status,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'server_error', error_description: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
