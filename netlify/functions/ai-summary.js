const fetch = globalThis.fetch;

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
      body: JSON.stringify({ error: 'Gemini API Key is not configured in environment variables (.env).' })
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

Provide a concise 3-sentence comparison report. Use bold highlights (using **double asterisks**) to identify the winner of the performance duel and specify the single most impactful reason why they won. Keep the tone friendly, professional, and technical.`;
    } else {
      prompt = `You are an expert web performance auditor. Analyze the performance metrics of this site:
URL: ${params.url}
- Load Time: ${params.totalTimeMs} ms
- Page Size: ${params.totalBytes} bytes
- Total Requests: ${params.totalRequests}
- TTFB: ${params.ttfbMs} ms
- Failed Requests: ${params.failedCount}

Provide a concise 3-4 sentence performance summary. Highlight the primary bottlenecks and suggest the absolute single most impactful optimization they should implement immediately. Use bold highlights (using **double asterisks**) for key stats or actions. Keep the tone friendly, professional, and actionable.`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const summary = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
      ? data.candidates[0].content.parts[0].text
      : 'Could not parse response from Gemini API.';

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
      body: JSON.stringify({ error: error.message })
    };
  }
};
