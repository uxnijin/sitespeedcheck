// Netlify Function: fetches a target page + its linked resources server-side
// (a browser can't do this itself — CORS blocks reading timing/size of
// cross-origin sites, so this has to run on a server)

const MAX_RESOURCES = 30;
const FETCH_TIMEOUT = 7000;
const CONCURRENCY = 6;

function withTimeout(promise, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { promise: promise(controller.signal), clear: () => clearTimeout(timer) };
}

async function timedFetch(url, opts = {}) {
  const t0 = Date.now();
  const { promise, clear } = withTimeout(
    (signal) => fetch(url, { ...opts, signal, redirect: 'follow' }),
    FETCH_TIMEOUT
  );
  try {
    const res = await promise;
    return { res, ms: Date.now() - t0 };
  } finally {
    clear();
  }
}

function extractResources(html, baseUrl) {
  const found = [];
  const patterns = [
    { re: /<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["']/gi, type: 'css' },
    { re: /<script[^>]+src=["']([^"']+)["']/gi, type: 'js' },
    { re: /<img[^>]+src=["']([^"']+)["']/gi, type: 'img' },
  ];
  for (const { re, type } of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const abs = new URL(m[1], baseUrl).href;
        found.push({ url: abs, type });
      } catch { /* skip malformed */ }
    }
  }
  // dedupe by url
  const seen = new Set();
  return found.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  }).slice(0, MAX_RESOURCES);
}

async function fetchResource(item) {
  try {
    const { res, ms } = await timedFetch(item.url, { method: 'GET' });
    const buf = await res.arrayBuffer();
    
    // Extract headers for timing drawer details
    const headers = {
      'content-type': res.headers.get('content-type') || '',
      'server': res.headers.get('server') || '',
      'cache-control': res.headers.get('cache-control') || '',
      'content-encoding': res.headers.get('content-encoding') || '',
      'etag': res.headers.get('etag') || ''
    };

    return {
      url: item.url,
      type: item.type,
      status: res.status,
      ms,
      bytes: buf.byteLength,
      ok: res.ok,
      headers,
    };
  } catch (e) {
    return { url: item.url, type: item.type, status: 0, ms: FETCH_TIMEOUT, bytes: 0, ok: false, error: 'timeout or blocked', headers: {} };
  }
}

async function pool(items, worker, limit) {
  const results = [];
  let i = 0;
  async function next() {
    if (i >= items.length) return;
    const idx = i++;
    results[idx] = await worker(items[idx]);
    return next();
  }
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(next));
  return results;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  let target;
  try {
    const q = event.queryStringParameters || {};
    target = q.url;
    if (!target) throw new Error('missing url');
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    // basic sanity check it parses
    new URL(target);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'invalid url' }) };
  }

  const overallStart = Date.now();

  let mainRes, mainMs, html = '', mainBytes = 0, finalUrl = target, statusCode = 0;
  try {
    const { res, ms } = await timedFetch(target, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpeedTestByNijin/1.0)' },
    });
    mainRes = res;
    mainMs = ms;
    finalUrl = res.url || target;
    statusCode = res.status;
    html = await res.text();
    mainBytes = Buffer.byteLength(html, 'utf8');
  } catch (e) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'could not reach that site', detail: String(e.message || e) }),
    };
  }

  const resources = extractResources(html, finalUrl);
  const resourceResults = await pool(resources, fetchResource, CONCURRENCY);

  const totalBytes = mainBytes + resourceResults.reduce((a, r) => a + r.bytes, 0);
  const totalRequests = 1 + resourceResults.length;
  const totalTimeMs = Date.now() - overallStart;
  const failedCount = resourceResults.filter((r) => !r.ok).length;

  const breakdown = {};
  for (const r of [{ type: 'html', bytes: mainBytes }, ...resourceResults]) {
    breakdown[r.type] = (breakdown[r.type] || 0) + r.bytes;
  }

  const mainHeaders = {
    'content-type': mainRes.headers.get('content-type') || '',
    'server': mainRes.headers.get('server') || '',
    'cache-control': mainRes.headers.get('cache-control') || '',
    'content-encoding': mainRes.headers.get('content-encoding') || '',
    'etag': mainRes.headers.get('etag') || ''
  };

  const waterfall = [
    { url: finalUrl, type: 'html', status: statusCode, ms: mainMs, bytes: mainBytes, ok: mainRes.ok, headers: mainHeaders },
    ...resourceResults,
  ];

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      target: finalUrl,
      statusCode,
      server: mainRes.headers.get('server') || 'unknown',
      ttfbMs: mainMs,
      totalTimeMs,
      totalBytes,
      totalRequests,
      failedCount,
      breakdown,
      waterfall,
    }),
  };
};
