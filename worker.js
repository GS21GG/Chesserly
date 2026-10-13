export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname !== '/api/explorer') return env.ASSETS.fetch(request);

    const db = u.searchParams.get('db') === 'lichess' ? 'lichess' : 'masters';
    const play = u.searchParams.get('play') || '';
    if (!env.LICHESS_TOKEN) return Response.json({ error: 'LICHESS_TOKEN missing in Worker' }, { status: 500 });
    const target = play
      ? `https://explorer.lichess.ovh/${db}?play=${encodeURIComponent(play)}`
      : `https://explorer.lichess.ovh/${db}`;

    const r = await fetch(target, {
      headers: { Authorization: `Bearer ${env.LICHESS_TOKEN}`, Accept: 'application/json' },
    });
    if (r.status === 204) return new Response(null, { status: 204 });
    if (!r.ok) {
      return Response.json({ error: `Explorer error (${r.status})` }, { status: r.status });
    }
    return Response.json(await r.json());
  },
};