export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing url param', { status: 400 });
    const resp = await fetch(target);
    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(resp.body, { headers });
  }
};
