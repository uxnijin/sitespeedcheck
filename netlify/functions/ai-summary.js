const https = require('https');
const fs = require('fs');
const path = require('path');

// Ephemeral in-memory container cache
const memoryCache = new Map();
const cacheFile = '/tmp/gemini-ai-cache.json';

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(data),
          json: () => {
            try {
              return Promise.resolve(JSON.parse(data));
            } catch (err) {
              return Promise.reject(new Error(`Failed to parse JSON: ${data}`));
            }
          }
        });
      });
    });

    req.on('error', (e) => reject(e));
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Request wrapper with exponential backoff for HTTP 429 rate limit retries
async function httpsPostWithRetry(url, body, retries = 3, baseDelay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await httpsPost(url, body);
      
      if (response.status === 429) {
        if (i === retries - 1) {
          throw new Error('Gemini API rate limited (429) after maximum retry attempts.');
        }
        const delay = baseDelay * Math.pow(2, i) + (Math.random() * 200); // Exponential backoff with jitter
        console.warn(`Gemini rate limited (429). Retrying in ${Math.round(delay)}ms (attempt ${i + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return response;
    } catch (err) {
      if (i === retries - 1) {
        throw err;
      }
      const delay = baseDelay * Math.pow(2, i) + (Math.random() * 200);
      console.warn(`Request failed. Retrying in ${Math.round(delay)}ms due to error: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Get cached summary if it exists and has not expired (24 hours)
function getCachedSummary(key) {
  // 1. Check in-memory Map
  if (memoryCache.has(key)) {
    const entry = memoryCache.get(key);
    if (Date.now() - entry.timestamp < 24 * 60 * 60 * 1000) {
      console.log(`Serving cached summary for "${key}" from memory.`);
      return entry.summary;
    }
  }

  // 2. Check local writeable filesystem /tmp/ backup
  try {
    if (fs.existsSync(cacheFile)) {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cache[key] && (Date.now() - cache[key].timestamp < 24 * 60 * 60 * 1000)) {
        // Hydrate memory cache
        memoryCache.set(key, cache[key]);
        console.log(`Serving cached summary for "${key}" from /tmp/ file storage.`);
        return cache[key].summary;
      }
    }
  } catch (e) {
    console.warn('Cache file read failed:', e);
  }
  return null;
}

// Save summary response to cache
function setCachedSummary(key, summary) {
  const entry = { summary, timestamp: Date.now() };
  memoryCache.set(key, entry);

  try {
    let cache = {};
    if (fs.existsSync(cacheFile)) {
      cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
    cache[key] = entry;
    fs.writeFileSync(cacheFile, JSON.stringify(cache), 'utf8');
  } catch (e) {
    console.warn('Cache file write failed:', e);
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    try {
      const envPath = path.join(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/GEMINI_API_KEY=(.*)/);
        if (match) {
          apiKey = match[1].trim();
        }
      }
    } catch (e) {
      console.warn('Failed to read local .env:', e);
    }
  }

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Gemini API Key is not configured in environment variables (GEMINI_API_KEY).' })
    };
  }

  try {
    // Parameter payloads are already stripped of waterfall assets and raw trace metrics
    const params = JSON.parse(event.body);
    let prompt = '';
    let cacheKey = '';

    if (params.isCompare) {
      cacheKey = `compare:${params.urlA}:${params.urlB}`;
      prompt = `You are an expert web performance auditor. Compare the loading speed performance of these two sites:
Site A: ${params.urlA}
- Load Time: ${params.timeA} ms
- Page Size: ${params.sizeA}
- Requests: ${params.reqsA}
- TTFB: ${params.ttfbA} ms

Site B: ${params.urlB}
- Load Time: ${params.timeB} ms
- Page Size: ${params.sizeB}
- Requests: ${params.reqsB}
- TTFB: ${params.ttfbB} ms

Respond ONLY with a valid JSON object matching this schema. Do not include markdown formatting or backticks around the JSON.
{
  "verdict": "A 1-sentence benchmark summary verdict with an emoji (e.g. 'Site A is a lightweight racer that completely outruns Site B! 🏁')",
  "bottlenecks": [
    "Comparison highlight 1 (using metrics highlights like **45% lighter** or **320ms faster**)",
    "Comparison highlight 2"
  ],
  "recommendation": "The most impactful action the slower site should take to bridge the gap (1-2 sentences)."
}`;
    } else {
      cacheKey = `single:${params.url}`;
      prompt = `You are an expert web performance auditor. Analyze the performance metrics of this site:
URL: ${params.url}
- Load Time: ${params.totalTimeMs} ms
- Page Size: ${params.totalBytes} bytes
- Total Requests: ${params.totalRequests}
- TTFB: ${params.ttfbMs} ms
- Failed Requests: ${params.failedCount}

Respond ONLY with a valid JSON object matching this schema. Do not include markdown formatting or backticks around the JSON.
{
  "verdict": "A 1-sentence engaging summary verdict with an emoji (e.g. 'Your site is built like a bullet train, but some heavy cargo is slowing it down! 🚀')",
  "bottlenecks": [
    "Bottleneck 1 (mentioning specific stats like load time or size)",
    "Bottleneck 2"
  ],
  "recommendation": "The absolute single most impactful optimization they should implement immediately (1-2 sentences)."
}`;
    }

    // 1. Check Caching Layer
    const cachedResponse = getCachedSummary(cacheKey);
    if (cachedResponse) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ summary: cachedResponse, cached: true })
      };
    }

    // 2. Invoke API with Exponential Backoff
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const response = await httpsPostWithRetry(apiUrl, {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const summary = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
      ? data.candidates[0].content.parts[0].text
      : '{"verdict":"Could not parse response.","bottlenecks":[],"recommendation":""}';

    // 3. Populate Caching Layer
    setCachedSummary(cacheKey, summary);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ summary, cached: false })
    };
  } catch (error) {
    console.error('AI summary handler failed:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message, stack: error.stack })
    };
  }
};
