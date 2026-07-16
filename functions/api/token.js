/* ═══════════════════════════════════════════════
   HAPPY MUSIC – functions/api/token.js
   Cloudflare Pages Function
   Troca o código OAuth por access_token no servidor,
   mantendo o client_secret fora do navegador.

   Rota: POST /api/token
═══════════════════════════════════════════════ */

// O app Android (Capacitor) chama essa rota de dentro da WebView, cuja
// origem é local (ex.: https://localhost) — diferente do domínio real
// do site. Sem CORS liberado aqui, o navegador bloqueia a resposta
// mesmo a chamada chegando certinho no servidor.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { code, code_verifier, redirect_uri } = body;

    if (!code || !code_verifier || !redirect_uri) {
      return new Response(
        JSON.stringify({ error: 'missing_params' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
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
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'server_error', error_description: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
}
