/* ═══════════════════════════════════════════════
   HAPPY MUSIC – functions/api/youtube-search.js
   Cloudflare Pages Function
   Pesquisa vídeos no YouTube usando a YouTube Data
   API v3, mantendo a chave da API fora do navegador
   (nunca exposta no código do cliente).

   Rota: GET /api/youtube-search?q=termo+de+busca
═══════════════════════════════════════════════ */

// Ver token.js — mesma necessidade de liberar CORS pro app nativo.
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*' };

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();

    if (!q) {
      return new Response(
        JSON.stringify({ error: 'missing_query' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    if (!env.YOUTUBE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'server_misconfigured', error_description: 'YOUTUBE_API_KEY não configurada.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    const params = new URLSearchParams({
      part:       'snippet',
      type:       'video',
      maxResults: '12',
      safeSearch: 'moderate',
      q,
      key: env.YOUTUBE_API_KEY,
    });

    const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data  = await ytRes.json();

    if (!ytRes.ok) {
      return new Response(
        JSON.stringify({ error: 'youtube_api_error', error_description: data?.error?.message || 'Falha na busca.' }),
        { status: ytRes.status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }

    // Devolve só o que a UI precisa — não repassa a resposta bruta do
    // Google (menos dado trafegado, e não vaza detalhes internos da API).
    const results = (data.items || [])
      .filter(item => item.id?.videoId)
      .map(item => ({
        id:        item.id.videoId,
        title:     item.snippet?.title || 'Sem título',
        channel:   item.snippet?.channelTitle || null,
        thumbnail: item.snippet?.thumbnails?.medium?.url
                 || item.snippet?.thumbnails?.default?.url
                 || `https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,
      }));

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'server_error', error_description: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    );
  }
}
