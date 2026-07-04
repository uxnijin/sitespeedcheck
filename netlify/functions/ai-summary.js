const https = require('https');

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

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    try {
      const fs = require('fs');
      const path = require('path');
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
    const params = JSON.parse(event.body);
    let prompt = '';

    if (params.isCompare) {
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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
    const response = await httpsPost(apiUrl, {
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

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ summary })
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
