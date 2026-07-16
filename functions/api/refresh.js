/* ═══════════════════════════════════════════════
   HAPPY MUSIC – functions/api/refresh.js
   Cloudflare Pages Function
   Troca um refresh_token por um novo access_token,
   mantendo o client_secret fora do navegador.

   O access_token do Google dura só ~1h. Sem essa rota, sessões longas
   (ex.: ouvindo no carro com a tela travada) expiravam no meio da
   audição e o app não tinha como se recuperar sozinho — toda chamada
   seguinte à API do Drive falhava com 401 e o player parava de vez.

   Rota: POST /api/refresh
═══════════════════════════════════════════════ */

// Ver token.js — mesma necessidade de liberar CORS pro app nativo.
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
    const { refresh_token } = body;

    if (!refresh_token) {
      return new Response(
        JSON.stringify({ error: 'missing_params' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const params = new URLSearchParams({
      refresh_token,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    });

    const googleRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    const data = await googleRes.json();

    // Google não reenvia o refresh_token nas renovações — mantém o
    // mesmo, já que o cliente ainda vai precisar dele na próxima vez.
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
