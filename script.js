(() => {
  const $ = (id) => document.getElementById(id);
  
  // Elements
  const form = $('form');
  const goBtn = $('go');
  const goLabel = $('goLabel');
  const result = $('result');
  const note = $('note');

  // Input groups
  const compareMode = $('compareMode');
  const urlSingleGroup = $('urlSingleGroup');
  const urlCompareGroup = $('urlCompareGroup');
  const urlInput = $('urlInput');
  const urlInputA = $('urlInputA');
  const urlInputB = $('urlInputB');
  const testLocation = $('testLocation');
  const apiKeyInput = $('apiKeyInput');
  
  // Tab headers and content panels
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  // Waterfall elements
  const wfSearch = $('wfSearch');
  const filterButtons = document.querySelectorAll('.filter-btn');
  const compareWfTabs = $('compareWfTabs');
  const compWfTabA = $('compWfTabA');
  const compWfTabB = $('compWfTabB');
  
  // Breakdown elements
  const compareBreakdownTabs = $('compareBreakdownTabs');
  const compBreakTabA = $('compBreakTabA');
  const compBreakTabB = $('compBreakTabB');
  
  // History elements
  const clearHistoryBtn = $('clearHistoryBtn');
  const historyList = $('historyList');
  const trendSvg = $('trendSvg');

  // Welcome panel elements
  const welcomePanel = $('welcomePanel');
  const welcomeHistoryArea = $('welcomeHistoryArea');
  const welcomeTrendSvg = $('welcomeTrendSvg');
  const welcomeHistoryList = $('welcomeHistoryList');

  // Slide-out timing drawer
  const wfDrawer = $('wfDrawer');
  const drawerCloseBtn = $('drawerCloseBtn');

  // PageSpeed Web Vitals
  const vitalsSection = $('vitalsSection');
  const vitalsLoading = $('vitalsLoading');
  const vitalsGrid = $('vitalsGrid');
  const vFcp = $('vFcp');
  const vLcp = $('vLcp');
  const vCls = $('vCls');
  const vSpeedIndex = $('vSpeedIndex');

  // State Management
  let currentSingleData = null;      // Results for single site mode
  let currentCompareData = { A: null, B: null }; // Results for compare mode
  let activeWfTarget = 'A';          // Current waterfall inspect target ('A' or 'B')
  let activeBreakdownTarget = 'A';   // Current breakdown inspect target ('A' or 'B')
  let activeFilter = 'all';
  let searchQuery = '';

  const CATEGORIES = {
    html: { label: 'HTML', color: '#8a8a8a', class: 'wf-bar-html' },
    css: { label: 'CSS', color: '#52a975', class: 'wf-bar-css' },
    js: { label: 'JavaScript', color: '#e2a84a', class: 'wf-bar-js' },
    img: { label: 'Images', color: '#a852a9', class: 'wf-bar-img' },
    other: { label: 'Other', color: '#5f5f5f', class: 'wf-bar-other' },
    failed: { label: 'Failed', color: '#c9807a', class: 'wf-bar-failed' }
  };

  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function getCategory(type, url) {
    const t = (type || '').toLowerCase();
    if (t === 'html' || url.endsWith('.html')) return 'html';
    if (t === 'css' || url.endsWith('.css')) return 'css';
    if (t === 'js' || t === 'javascript' || url.endsWith('.js')) return 'js';
    if (t === 'img' || t === 'image' || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(url)) return 'img';
    return 'other';
  }

  function formatMarkdown(text) {
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  }

  async function getAiSummary(params) {
    const card = $('aiSummaryCard');
    const loading = $('aiSummaryLoading');
    const textField = $('aiSummaryText');

    card.hidden = false;
    loading.hidden = false;
    textField.hidden = true;

    try {
      const res = await fetch('/.netlify/functions/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      const data = await res.json();
      
      // If the API key is explicitly not configured, hide the card
      if (data.error && data.error.includes('Key is not configured')) {
        card.hidden = true;
        return;
      }

      if (data.summary) {
        try {
          const obj = JSON.parse(data.summary);
          const verdictHtml = `<div class="ai-verdict">${formatMarkdown(obj.verdict)}</div>`;
          
          let bottlenecksHtml = '';
          if (obj.bottlenecks && obj.bottlenecks.length > 0) {
            bottlenecksHtml = `
              <div class="ai-subheader">Key Findings</div>
              <ul class="ai-findings-list">
                ${obj.bottlenecks.map(b => `<li><span class="bullet">◍</span> <span>${formatMarkdown(b)}</span></li>`).join('')}
              </ul>
            `;
          }

          const recHtml = `
            <div class="ai-rec-box">
              <div class="ai-rec-lbl">Recommended Fix</div>
              <div class="ai-rec-val">${formatMarkdown(obj.recommendation)}</div>
            </div>
          `;

          textField.innerHTML = verdictHtml + bottlenecksHtml + recHtml;
        } catch (jsonErr) {
          // Fallback if parsing fails
          textField.innerHTML = `<div style="font-family: var(--font-display); font-size: 13px; line-height: 1.6; color: var(--ink-dim);">${formatMarkdown(data.summary)}</div>`;
        }
        loading.hidden = true;
        textField.hidden = false;
      } else {
        throw new Error(data.error || 'Server error generating AI summary.');
      }
    } catch (e) {
      console.warn('AI summary failed:', e);
      card.hidden = true; // Hide the card if Gemini fails to keep the UI clean
    }
  }

  // Handle location based simulated latency scaling
  function applyLocationLatency(data, location) {
    const copy = JSON.parse(JSON.stringify(data));
    let latencyOffset = 0;
    let multiplier = 1.0;

    if (location === 'eu') {
      latencyOffset = 110 + Math.random() * 20; // 110-130ms roundtrip to EU
      multiplier = 1.15;
    } else if (location === 'ap') {
      latencyOffset = 230 + Math.random() * 40; // 230-270ms roundtrip to Asia
      multiplier = 1.35;
    } else {
      return copy; // US is base
    }

    copy.ttfbMs = Math.round(copy.ttfbMs + latencyOffset);
    let maxResourceTime = 0;

    for (const r of copy.waterfall) {
      if (r.type === 'html') {
        r.ms = copy.ttfbMs;
      } else {
        r.ms = Math.round(r.ms * multiplier + (latencyOffset * 0.1));
        if (r.ms > maxResourceTime) maxResourceTime = r.ms;
      }
    }

    copy.totalTimeMs = Math.round(copy.ttfbMs + maxResourceTime + (latencyOffset * 0.2));
    return copy;
  }

  // Calculate score from 0-100 based on heuristics
  function calculateScore(data) {
    let score = 100;

    // Load time penalty: -1 pt for every 80ms over 500ms (max -35)
    if (data.totalTimeMs > 500) {
      const excess = data.totalTimeMs - 500;
      score -= Math.min(35, Math.floor(excess / 80));
    }

    // Page size penalty: -1 pt for every 80KB over 200KB (max -25)
    const excessSize = data.totalBytes - 200 * 1024;
    if (excessSize > 0) {
      score -= Math.min(25, Math.floor(excessSize / (80 * 1024)));
    }

    // Request count penalty: -1 pt for every 2 requests over 10 (max -20)
    if (data.totalRequests > 10) {
      score -= Math.min(20, Math.floor((data.totalRequests - 10) / 2));
    }

    // TTFB penalty: -1 pt for every 20ms over 150ms (max -15)
    if (data.ttfbMs > 150) {
      score -= Math.min(15, Math.floor((data.ttfbMs - 150) / 20));
    }

    // Failed requests: -10 pts per failure (max -30)
    if (data.failedCount > 0) {
      score -= Math.min(30, data.failedCount * 10);
    }

    score = Math.max(0, score);

    let grade = 'F';
    let statusText = 'Poor Performance';
    let statusClass = 'score-low';

    if (score >= 90) {
      grade = 'A';
      statusText = 'Excellent';
      statusClass = 'score-high';
    } else if (score >= 80) {
      grade = 'B';
      statusText = 'Good';
      statusClass = 'score-high';
    } else if (score >= 68) {
      grade = 'C';
      statusText = 'Fair';
      statusClass = 'score-mid';
    } else if (score >= 50) {
      grade = 'D';
      statusText = 'Passable';
      statusClass = 'score-mid';
    } else {
      grade = 'F';
      statusText = 'Needs Optimization';
      statusClass = 'score-low';
    }

    return { score, grade, statusText, statusClass };
  }

  // Generate actionable suggestions
  function generateInsights(data, rating) {
    const list = $('insightsList');
    list.innerHTML = '';
    const items = [];

    if (data.failedCount > 0) {
      items.push({
        type: 'critical',
        text: `<strong>Fix broken links:</strong> There are ${data.failedCount} failed resource requests. Resolving these prevents request timeouts and rendering blocks.`
      });
    }

    if (data.ttfbMs > 400) {
      items.push({
        type: 'warning',
        text: `<strong>Slow TTFB (${data.ttfbMs} ms):</strong> Time to First Byte is high. Consider using server response caching, content delivery networks (CDNs), or a faster hosting provider.`
      });
    }

    if (data.totalRequests > 25) {
      items.push({
        type: 'warning',
        text: `<strong>High request count (${data.totalRequests} requests):</strong> Combine small CSS and Javascript assets or defer loading non-essential assets.`
      });
    }

    if (data.totalBytes > 2 * 1024 * 1024) {
      items.push({
        type: 'warning',
        text: `<strong>Large page weight (${fmtBytes(data.totalBytes)}):</strong> Page is heavy. Compress assets and serve optimized images.`
      });
    }

    // Check resource headers compression audit
    let uncompressedCount = 0;
    for (const r of data.waterfall) {
      if (r.ok && r.bytes > 15 * 1024 && (r.type === 'html' || r.type === 'css' || r.type === 'js')) {
        const encoding = r.headers ? r.headers['content-encoding'] : '';
        if (!encoding || (!encoding.includes('gzip') && !encoding.includes('br'))) {
          uncompressedCount++;
        }
      }
    }
    if (uncompressedCount > 0) {
      items.push({
        type: 'warning',
        text: `<strong>Leverage Gzip/Brotli compression:</strong> There are ${uncompressedCount} assets served uncompressed. Enabling gzip or brotli on your hosting server will compress text files by up to 70%.`
      });
    }

    // Look for individual large resources
    for (const r of data.waterfall) {
      const category = getCategory(r.type, r.url);
      const name = r.url.split('/').pop() || r.url;

      if (category === 'img' && r.bytes > 250 * 1024) {
        items.push({
          type: 'warning',
          text: `<strong>Optimize large image:</strong> <span class="wf-url" title="${r.url}">${name}</span> is ${fmtBytes(r.bytes)}. Compress or convert it to modern formats like WebP or AVIF.`
        });
      } else if ((category === 'js' || category === 'css') && r.bytes > 120 * 1024) {
        items.push({
          type: 'info',
          text: `<strong>Minify stylesheet/script:</strong> <span class="wf-url" title="${r.url}">${name}</span> is ${fmtBytes(r.bytes)}. Ensure it is minified and gzipped.`
        });
      }
    }

    if (items.length === 0) {
      items.push({
        type: 'info',
        text: `<strong>Perfect Score!</strong> No critical issues found. Your site follows excellent performance optimization strategies.`
      });
    }

    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'insight-item';
      li.innerHTML = `
        <span class="insight-dot ${item.type}"></span>
        <span class="insight-text">${item.text}</span>
      `;
      list.appendChild(li);
    }
  }

  // Render timing drawer inspector
  function openTimingDrawer(resource) {
    $('dUrl').textContent = resource.url;
    $('dStatus').textContent = resource.status === 0 ? 'Blocked / Timeout' : `${resource.status} (${resource.ok ? 'OK' : 'Error'})`;
    $('dType').textContent = resource.type.toUpperCase();
    $('dSize').textContent = fmtBytes(resource.bytes);
    $('dTime').textContent = `${resource.ms} ms`;
    
    const encoding = resource.headers ? resource.headers['content-encoding'] : '';
    const compressionDiv = $('dCompression');
    compressionDiv.innerHTML = '';
    
    if (encoding && (encoding.includes('gzip') || encoding.includes('br'))) {
      compressionDiv.innerHTML = `<span class="comp-badge good">COMPRESSED (${encoding.toUpperCase()})</span>`;
    } else {
      const isCompressible = resource.type === 'html' || resource.type === 'css' || resource.type === 'js';
      if (isCompressible && resource.bytes > 1024) {
        compressionDiv.innerHTML = `<span class="comp-badge warn">UNCOMPRESSED</span> <span style="color: var(--grey-2); font-size:10px;">(Text assets should be zipped to save bandwidth)</span>`;
      } else {
        compressionDiv.innerHTML = `<span class="comp-badge good">N/A</span> <span style="color: var(--grey-2); font-size:10px;">(Already compressed format)</span>`;
      }
    }

    const headersPre = $('dHeaders');
    headersPre.innerHTML = '';
    if (resource.headers && Object.keys(resource.headers).length > 0) {
      for (const [key, val] of Object.entries(resource.headers)) {
        if (val) {
          headersPre.textContent += `${key}: ${val}\n`;
        }
      }
    } else {
      headersPre.textContent = 'No response headers captured for this resource.';
    }

    wfDrawer.hidden = false;
  }

  // Render Waterfall
  function renderWaterfall() {
    const body = $('wfBody');
    body.innerHTML = '';

    const data = compareMode.checked 
      ? (activeWfTarget === 'A' ? currentCompareData.A : currentCompareData.B)
      : currentSingleData;

    if (!data || !data.waterfall) return;

    // Filter resources
    const filtered = data.waterfall.filter((r) => {
      const category = getCategory(r.type, r.url);
      if (activeFilter !== 'all' && category !== activeFilter) return false;
      if (searchQuery) {
        const name = r.url.toLowerCase();
        if (!name.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      body.innerHTML = '<div style="padding: 20px; font-family: var(--font-mono); font-size:11px; text-align:center; color: var(--grey-2);">No resources match the filters.</div>';
      return;
    }

    const maxFetchMs = Math.max(...data.waterfall.map(r => r.ms));
    const mainMs = data.ttfbMs;
    const maxTimeline = Math.max(data.totalTimeMs, mainMs + maxFetchMs);

    for (const r of filtered) {
      const category = r.ok === false ? 'failed' : getCategory(r.type, r.url);
      const catConfig = CATEGORIES[category] || CATEGORIES.other;
      const name = r.url.split('/').pop() || r.url;

      const row = document.createElement('div');
      row.className = 'wf-row' + (r.ok === false ? ' failed' : '');

      const leftOffset = r.type === 'html' ? 0 : (mainMs / maxTimeline) * 100;
      const barWidth = (r.ms / maxTimeline) * 100;

      row.innerHTML = `
        <span class="wf-url" title="${r.url}">${name}</span>
        <span class="wf-type">${category}</span>
        <span class="wf-size">${fmtBytes(r.bytes)}</span>
        <span class="wf-timeline-cell">
          <span class="wf-timeline-bar ${catConfig.class}" 
                style="left: ${leftOffset.toFixed(2)}%; width: ${Math.max(1.5, barWidth).toFixed(2)}%;" 
                data-time="${r.ms} ms"></span>
        </span>
      `;
      row.addEventListener('click', () => openTimingDrawer(r));
      body.appendChild(row);
    }
  }

  // Render breakdowns
  function renderBreakdowns() {
    const data = compareMode.checked 
      ? (activeBreakdownTarget === 'A' ? currentCompareData.A : currentCompareData.B)
      : currentSingleData;

    if (!data || !data.waterfall) return;

    const typeSize = {};
    const typeReq = {};
    const domainSize = {};
    const domainReq = {};
    
    let totalSize = 0;
    let totalReq = 0;

    for (const r of data.waterfall) {
      const category = getCategory(r.type, r.url);
      const size = r.bytes || 0;
      
      typeSize[category] = (typeSize[category] || 0) + size;
      typeReq[category] = (typeReq[category] || 0) + 1;
      
      totalSize += size;
      totalReq += 1;

      try {
        const host = new URL(r.url).hostname;
        domainSize[host] = (domainSize[host] || 0) + size;
        domainReq[host] = (domainReq[host] || 0) + 1;
      } catch {
        domainSize['Other'] = (domainSize['Other'] || 0) + size;
        domainReq['Other'] = (domainReq['Other'] || 0) + 1;
      }
    }

    function populateStackedBar(stats, total, elementBar, elementLegend, colorMap) {
      elementBar.innerHTML = '';
      elementLegend.innerHTML = '';

      const items = Object.keys(stats).map(key => ({
        key,
        value: stats[key],
        pct: (stats[key] / total) * 100
      })).sort((a, b) => b.value - a.value);

      for (const item of items) {
        if (item.pct <= 0) continue;
        
        const segment = document.createElement('div');
        segment.className = 'bar-segment';
        const color = colorMap[item.key] ? colorMap[item.key].color : '#555';
        segment.style.backgroundColor = color;
        segment.style.width = `${item.pct}%`;
        segment.title = `${item.key}: ${item.pct.toFixed(1)}%`;
        elementBar.appendChild(segment);

        const isSize = typeof item.value === 'number' && item.value > 100;
        const formattedVal = isSize ? fmtBytes(item.value) : `${item.value} reqs`;

        const legendItem = document.createElement('div');
        legendItem.className = 'legend-item';
        legendItem.innerHTML = `
          <span class="legend-color" style="background-color: ${color}"></span>
          <div class="legend-info">
            <span class="legend-label">${colorMap[item.key] ? colorMap[item.key].label : item.key}</span>
            <span class="legend-value">${formattedVal} (${item.pct.toFixed(1)}%)</span>
          </div>
        `;
        elementLegend.appendChild(legendItem);
      }
    }

    const domainColors = {};
    const domainKeys = Object.keys(domainSize).sort((a,b) => domainSize[b] - domainSize[a]);
    const palette = ['#8a8a8a', '#52a975', '#e2a84a', '#a852a9', '#c9807a', '#70cbc4', '#9a70cb'];
    domainKeys.forEach((key, index) => {
      domainColors[key] = {
        label: key,
        color: palette[index % palette.length]
      };
    });

    populateStackedBar(typeSize, totalSize, $('typeSizeBar'), $('typeSizeLegend'), CATEGORIES);
    populateStackedBar(typeReq, totalReq, $('typeReqBar'), $('typeReqLegend'), CATEGORIES);
    populateStackedBar(domainSize, totalSize, $('domainBar'), $('domainLegend'), domainColors);
  }

  // Fetch PageSpeed / Lighthouse Web Vitals asynchronously (Single Mode only)
  async function runPageSpeedAudit(targetUrl) {
    vitalsSection.hidden = false;
    vitalsLoading.hidden = false;
    vitalsGrid.hidden = true;

    try {
      const savedKey = localStorage.getItem('pagespeed_api_key') || '';
      let apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&category=performance`;
      if (savedKey) {
        apiUrl += `&key=${encodeURIComponent(savedKey)}`;
      }

      const res = await fetch(apiUrl);
      
      if (res.status === 429) {
        throw new Error('API Rate Limit Exceeded (429). Enter an API Key in Advanced Settings to bypass.');
      }

      const apiData = await res.json();
      
      if (apiData.lighthouseResult && apiData.lighthouseResult.audits) {
        const audits = apiData.lighthouseResult.audits;
        
        vFcp.textContent = audits['first-contentful-paint'] ? audits['first-contentful-paint'].displayValue : 'N/A';
        vLcp.textContent = audits['largest-contentful-paint'] ? audits['largest-contentful-paint'].displayValue : 'N/A';
        vCls.textContent = audits['cumulative-layout-shift'] ? audits['cumulative-layout-shift'].displayValue : 'N/A';
        vSpeedIndex.textContent = audits['speed-index'] ? audits['speed-index'].displayValue : 'N/A';

        // Update single score card to average Google Lighthouse performance
        const lhScore = Math.round(apiData.lighthouseResult.categories.performance.score * 100);
        if (lhScore && currentSingleData) {
          const combinedScore = Math.round((calculateScore(currentSingleData).score + lhScore) / 2);
          
          $('scoreVal').textContent = `${combinedScore}/100`;
          
          let grade = 'F';
          let statusClass = 'score-low';
          let statusText = 'Poor';

          if (combinedScore >= 90) { grade = 'A'; statusClass = 'score-high'; statusText = 'Excellent'; }
          else if (combinedScore >= 80) { grade = 'B'; statusClass = 'score-high'; statusText = 'Good'; }
          else if (combinedScore >= 68) { grade = 'C'; statusClass = 'score-mid'; statusText = 'Fair'; }
          else if (combinedScore >= 50) { grade = 'D'; statusClass = 'score-mid'; statusText = 'Passable'; }

          $('scoreGrade').textContent = grade;
          $('scoreBar').style.strokeDasharray = `${combinedScore}, 100`;
          $('scoreBar').className.baseVal = `score-fg-circle ${statusClass}`;
          $('scoreStatus').textContent = `${statusText} (${combinedScore} / 100 with Lighthouse)`;
        }

        vitalsLoading.hidden = true;
        vitalsGrid.hidden = false;
      } else {
        throw new Error(apiData.error ? apiData.error.message : 'Invalid API response structure.');
      }
    } catch (e) {
      console.warn('Lighthouse fetch failed', e);
      // Hide the entire section if Google API rate limits us or fails to keep the UI clean
      vitalsSection.hidden = true;
    }
  }

  // Draw History SVG Line trend chart for target elements
  function drawHistoryTrendChart(targetSvg) {
    if (!targetSvg) return;

    const saved = localStorage.getItem('speed_test_history');
    if (!saved) return;

    const rawList = JSON.parse(saved);
    const list = rawList.slice(0, 10).reverse();
    if (list.length < 2) return;

    // Viewport coordinates
    const w = 500;
    const h = 150;
    const paddingX = 40;
    const paddingY = 20;
    const graphWidth = w - paddingX * 2;
    const graphHeight = h - paddingY * 2;

    const maxPoints = list.length;
    let points = [];
    let pathD = '';
    let areaD = `M ${paddingX} ${h - paddingY} `;

    list.forEach((item, index) => {
      const score = item.score || 0;
      const x = paddingX + (index / (maxPoints - 1)) * graphWidth;
      const y = h - paddingY - (score / 100) * graphHeight;
      points.push({ x, y, score, target: item.target });

      if (index === 0) {
        pathD += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      } else {
        pathD += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      areaD += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
    });

    areaD += `L ${points[maxPoints - 1].x.toFixed(1)} ${h - paddingY} Z`;

    const gradientId = `trendGrad_${targetSvg.id}`;

    let svgContent = `
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--grey-1)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--grey-1)" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <!-- Grid lines -->
      <line x1="${paddingX}" y1="${paddingY}" x2="${w - paddingX}" y2="${paddingY}" stroke="var(--line-soft)" stroke-width="1"/>
      <line x1="${paddingX}" y1="${paddingY + graphHeight / 2}" x2="${w - paddingX}" y2="${paddingY + graphHeight / 2}" stroke="var(--line-soft)" stroke-dasharray="2,2"/>
      <line x1="${paddingX}" y1="${h - paddingY}" x2="${w - paddingX}" y2="${h - paddingY}" stroke="var(--line-soft)" stroke-width="1"/>
      
      <!-- Axis Labels -->
      <text x="${paddingX - 10}" y="${paddingY + 4}" fill="var(--grey-2)" font-size="9" font-family="var(--font-mono)" text-anchor="end">100</text>
      <text x="${paddingX - 10}" y="${h - paddingY + 4}" fill="var(--grey-2)" font-size="9" font-family="var(--font-mono)" text-anchor="end">0</text>
      
      <!-- Filled Area -->
      <path d="${areaD}" fill="url(#${gradientId})" stroke="none"/>
      <!-- Glowing trend line -->
      <path d="${pathD}" class="trend-line"/>
    `;

    points.forEach((pt) => {
      svgContent += `
        <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="4.5" class="trend-dot">
          <title>${pt.target}\nScore: ${pt.score}</title>
        </circle>
      `;
    });

    targetSvg.innerHTML = svgContent;
  }

  // Render history lists
  function renderHistoryListInto(element, onClickItem) {
    element.innerHTML = '';
    const saved = localStorage.getItem('speed_test_history');
    if (!saved) return false;

    const list = JSON.parse(saved);
    if (list.length === 0) return false;

    for (const item of list) {
      const row = document.createElement('div');
      row.className = 'history-item';
      
      const badgeClass = `badge-${item.grade.toLowerCase()}`;

      row.innerHTML = `
        <div class="history-meta">
          <span class="history-url" title="${item.target}">${item.target}</span>
          <span class="history-time">${item.timeString} — ${item.totalRequests} reqs, ${fmtBytes(item.totalBytes)}, ${item.totalTimeMs}ms</span>
        </div>
        <div class="history-score">
          <span class="history-badge ${badgeClass}">${item.grade}</span>
        </div>
      `;
      row.addEventListener('click', () => onClickItem(item.fullData));
      element.appendChild(row);
    }
    return true;
  }

  // Populate all history structures
  function renderHistoryTabs() {
    // 1. Render tab history list
    const tabHistoryContainer = $('historyList');
    renderHistoryListInto(tabHistoryContainer, (fullData) => {
      loadSavedResults(fullData);
    });

    // 2. Render welcome/home history lists
    const welcomeHistoryContainer = $('welcomeHistoryList');
    const hasHistory = renderHistoryListInto(welcomeHistoryContainer, (fullData) => {
      loadSavedResults(fullData);
    });

    if (hasHistory) {
      welcomeHistoryArea.hidden = false;
      drawHistoryTrendChart(welcomeTrendSvg);
      drawHistoryTrendChart(trendSvg);
    } else {
      welcomeHistoryArea.hidden = true;
      tabHistoryContainer.innerHTML = '<div style="padding: 30px; font-family: var(--font-mono); font-size:11px; text-align:center; color: var(--grey-2);">No test history available yet.</div>';
    }
  }

  function loadSavedResults(fullData) {
    welcomePanel.hidden = true;
    result.hidden = false;

    if (fullData.isCompare) {
      compareMode.checked = true;
      toggleCompareModeUI();
      currentCompareData = fullData;
      renderCompareMode(fullData.A, fullData.B);
    } else {
      compareMode.checked = false;
      toggleCompareModeUI();
      currentSingleData = fullData;
      renderSingleMode(fullData);
    }
    switchTab('summary');
  }

  // Render single site results
  function renderSingleMode(data) {
    currentSingleData = data;
    const rating = calculateScore(data);
    
    // Display panels
    $('singleScoreCard').hidden = false;
    $('compareScores').hidden = true;
    $('singleHeadline').hidden = false;
    $('compareMetricsGrid').hidden = true;
    $('singleMeta').hidden = false;
    
    compareWfTabs.hidden = true;
    compareBreakdownTabs.hidden = true;

    $('scoreGrade').textContent = rating.grade;
    $('scoreVal').textContent = `${rating.score}/100`;
    
    const path = $('scoreBar');
    path.className.baseVal = `score-fg-circle ${rating.statusClass}`;
    path.style.strokeDasharray = `${rating.score}, 100`;
    
    // Reset loading messages
    const loadingLabel = vitalsLoading.querySelector('span:last-child');
    if (loadingLabel) {
      loadingLabel.textContent = 'Auditing page performance with Lighthouse...';
    }
    $('scoreStatus').textContent = `${rating.statusText} (${rating.score} / 100)`;

    $('hlTime').textContent = data.totalTimeMs;
    $('hlSize').textContent = fmtBytes(data.totalBytes);
    $('hlReq').textContent = data.totalRequests;

    $('mUrl').textContent = data.target;
    $('mStatus').textContent = data.statusCode;
    $('mServer').textContent = data.server;
    $('mTtfb').textContent = data.ttfbMs + ' ms';
    $('mFailed').textContent = data.failedCount;

    generateInsights(data, rating);
    saveToHistory(data, rating);

    renderWaterfall();
    renderBreakdowns();
    
    getAiSummary({
      url: data.target,
      totalTimeMs: data.totalTimeMs,
      totalBytes: data.totalBytes,
      totalRequests: data.totalRequests,
      ttfbMs: data.ttfbMs,
      failedCount: data.failedCount
    });

    runPageSpeedAudit(data.target);
  }

  // Render comparison competitor results
  function renderCompareMode(dataA, dataB) {
    currentCompareData.A = dataA;
    currentCompareData.B = dataB;
    
    const ratingA = calculateScore(dataA);
    const ratingB = calculateScore(dataB);

    $('singleScoreCard').hidden = true;
    $('compareScores').hidden = false;
    $('singleHeadline').hidden = true;
    $('compareMetricsGrid').hidden = false;
    $('singleMeta').hidden = true;
    vitalsSection.hidden = true; 

    compareWfTabs.hidden = false;
    compareBreakdownTabs.hidden = false;

    $('compNameA').textContent = dataA.target.replace(/^https?:\/\//i, '').split('/')[0];
    $('compNameB').textContent = dataB.target.replace(/^https?:\/\//i, '').split('/')[0];
    
    $('scoreGradeA').textContent = ratingA.grade;
    $('scoreValA').textContent = `${ratingA.score}/100`;
    $('scoreBarA').className.baseVal = `score-fg-circle ${ratingA.statusClass}`;
    $('scoreBarA').style.strokeDasharray = `${ratingA.score}, 100`;

    $('scoreGradeB').textContent = ratingB.grade;
    $('scoreValB').textContent = `${ratingB.score}/100`;
    $('scoreBarB').className.baseVal = `score-fg-circle ${ratingB.statusClass}`;
    $('scoreBarB').style.strokeDasharray = `${ratingB.score}, 100`;

    $('colNameA').textContent = dataA.target.replace(/^https?:\/\//i, '').split('/')[0];
    $('colNameB').textContent = dataB.target.replace(/^https?:\/\//i, '').split('/')[0];

    function populateComparisonRow(elA, elB, valA, valB, formatFn, isLowerBetter = true) {
      elA.textContent = formatFn(valA);
      elB.textContent = formatFn(valB);
      
      elA.className = 'metric-val';
      elB.className = 'metric-val';

      if (valA === valB) return;

      const isAWin = isLowerBetter ? (valA < valB) : (valA > valB);
      if (isAWin) {
        elA.classList.add('winner-pill');
        elB.classList.add('loser-pill');
      } else {
        elB.classList.add('winner-pill');
        elA.classList.add('loser-pill');
      }
    }

    populateComparisonRow($('compScoreA'), $('compScoreB'), ratingA.score, ratingB.score, (v) => `${v}/100`, false);
    populateComparisonRow($('compTimeA'), $('compTimeB'), dataA.totalTimeMs, dataB.totalTimeMs, (v) => `${v} ms`);
    populateComparisonRow($('compSizeA'), $('compSizeB'), dataA.totalBytes, dataB.totalBytes, fmtBytes);
    populateComparisonRow($('compReqA'), $('compReqB'), dataA.totalRequests, dataB.totalRequests, (v) => v);
    populateComparisonRow($('compTtfbA'), $('compTtfbB'), dataA.ttfbMs, dataB.ttfbMs, (v) => `${v} ms`);
    populateComparisonRow($('compFailedA'), $('compFailedB'), dataA.failedCount, dataB.failedCount, (v) => v);

    const insightsList = $('insightsList');
    insightsList.innerHTML = '';
    
    const li = document.createElement('li');
    li.className = 'insight-item';
    
    if (ratingA.score !== ratingB.score) {
      const winnerName = ratingA.score > ratingB.score ? dataA.target : dataB.target;
      const cleanWinner = winnerName.replace(/^https?:\/\//i, '').split('/')[0];
      const scoreDiff = Math.abs(ratingA.score - ratingB.score);
      li.innerHTML = `<span class="insight-dot info"></span><span class="insight-text"><strong>${cleanWinner}</strong> performs better overall. It has a higher performance rating by ${scoreDiff} points.</span>`;
    } else {
      li.innerHTML = `<span class="insight-dot info"></span><span class="insight-text">Both targets scored equal performance points (${ratingA.score}/100). Check resource timelines to inspect micro delays.</span>`;
    }
    insightsList.appendChild(li);

    const comboPayload = {
      isCompare: true,
      A: dataA,
      B: dataB,
      target: `${dataA.target.replace(/^https?:\/\//i, '').split('/')[0]} vs ${dataB.target.replace(/^https?:\/\//i, '').split('/')[0]}`,
      totalTimeMs: Math.max(dataA.totalTimeMs, dataB.totalTimeMs),
      totalBytes: dataA.totalBytes + dataB.totalBytes,
      totalRequests: dataA.totalRequests + dataB.totalRequests
    };
    saveToHistory(comboPayload, { score: Math.round((ratingA.score + ratingB.score)/2), grade: ratingA.score >= ratingB.score ? ratingA.grade : ratingB.grade, statusClass: ratingA.statusClass });

    renderWaterfall();
    renderBreakdowns();

    getAiSummary({
      isCompare: true,
      urlA: dataA.target,
      timeA: dataA.totalTimeMs,
      sizeA: fmtBytes(dataA.totalBytes),
      reqsA: dataA.totalRequests,
      ttfbA: dataA.ttfbMs,
      urlB: dataB.target,
      timeB: dataB.totalTimeMs,
      sizeB: fmtBytes(dataB.totalBytes),
      reqsB: dataB.totalRequests,
      ttfbB: dataB.ttfbMs
    });
  }

  // Save successful run to history list
  function saveToHistory(data, rating) {
    try {
      const saved = localStorage.getItem('speed_test_history');
      let list = saved ? JSON.parse(saved) : [];
      
      const exists = list.some(item => {
        if (item.target === data.target) {
          return (Date.now() - item.id) < 15000;
        }
        return false;
      });
      if (exists) return;

      const newEntry = {
        id: Date.now(),
        target: data.target,
        score: rating.score,
        grade: rating.grade,
        statusClass: rating.statusClass,
        totalTimeMs: data.totalTimeMs,
        totalBytes: data.totalBytes,
        totalRequests: data.totalRequests,
        timeString: new Date().toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) + ' ' + 
                     new Date().toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'}),
        fullData: data
      };

      list.unshift(newEntry);
      
      if (list.length > 10) {
        list = list.slice(0, 10);
      }

      localStorage.setItem('speed_test_history', JSON.stringify(list));
      renderHistoryTabs();
    } catch (e) {
      console.error('History write failed', e);
    }
  }

  // Setup tab switcher logic
  function switchTab(tabName) {
    tabButtons.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    tabContents.forEach(content => {
      if (content.id === `content-${tabName}`) {
        content.hidden = false;
      } else {
        content.hidden = true;
      }
    });
  }

  // Toggle Single/Compare inputs
  function toggleCompareModeUI() {
    if (compareMode.checked) {
      urlSingleGroup.hidden = true;
      urlCompareGroup.hidden = false;
    } else {
      urlSingleGroup.hidden = false;
      urlCompareGroup.hidden = true;
    }
  }

  // Cursor card spotlights
  document.addEventListener('mousemove', (e) => {
    const cards = document.querySelectorAll('.sidebar-card, .input-group, .welcome-panel, .dashboard-card, .history-card, .vital-card, .insight-item, .timing-inspector');
    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--mouse-x', `${x}px`);
      card.style.setProperty('--mouse-y', `${y}px`);
    });
  });

  // UI Event hooks
  compareMode.addEventListener('change', toggleCompareModeUI);

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.getAttribute('data-tab'));
    });
  });

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter');
      renderWaterfall();
    });
  });

  wfSearch.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderWaterfall();
  });

  // Switch Timelines (Site A / B) in Compare Mode
  compWfTabA.addEventListener('click', () => {
    compWfTabA.classList.add('active');
    compWfTabB.classList.remove('active');
    activeWfTarget = 'A';
    renderWaterfall();
  });
  compWfTabB.addEventListener('click', () => {
    compWfTabB.classList.add('active');
    compWfTabA.classList.remove('active');
    activeWfTarget = 'B';
    renderWaterfall();
  });

  // Switch Breakdowns (Site A / B) in Compare Mode
  compBreakTabA.addEventListener('click', () => {
    compBreakTabA.classList.add('active');
    compBreakTabB.classList.remove('active');
    activeBreakdownTarget = 'A';
    renderBreakdowns();
  });
  compBreakTabB.addEventListener('click', () => {
    compBreakTabB.classList.add('active');
    compBreakTabA.classList.remove('active');
    activeBreakdownTarget = 'B';
    renderBreakdowns();
  });

  // Drawer Close Button
  drawerCloseBtn.addEventListener('click', () => {
    wfDrawer.hidden = true;
  });

  // Clear History
  clearHistoryBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your test history?')) {
      localStorage.removeItem('speed_test_history');
      renderHistoryTabs();
      // Show default panel and hide result panel
      result.hidden = true;
      welcomePanel.hidden = false;
    }
  });

  // Handle Google API Key changes
  apiKeyInput.addEventListener('input', (e) => {
    localStorage.setItem('pagespeed_api_key', e.target.value.trim());
  });

  // Form submit speed test
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    wfDrawer.hidden = true; 
    $('aiSummaryCard').hidden = true;
    welcomePanel.hidden = true; // Hide welcome screen on new run

    const loc = testLocation.value;

    if (compareMode.checked) {
      const urlA = urlInputA.value.trim();
      const urlB = urlInputB.value.trim();
      if (!urlA || !urlB) return;

      goBtn.disabled = true;
      goLabel.textContent = 'Testing both…';
      note.textContent = 'fetching assets concurrently server-side';
      result.hidden = true;

      try {
        const fetchA = fetch(`/.netlify/functions/analyze?url=${encodeURIComponent(urlA)}`).then(r => r.json());
        const fetchB = fetch(`/.netlify/functions/analyze?url=${encodeURIComponent(urlB)}`).then(r => r.json());

        const [resA, resB] = await Promise.all([fetchA, fetchB]);

        if (resA.error) {
          note.textContent = `Site A Error: ${resA.error}`;
          welcomePanel.hidden = false;
        } else if (resB.error) {
          note.textContent = `Site B Error: ${resB.error}`;
          welcomePanel.hidden = false;
        } else {
          note.textContent = '';
          const dataA = applyLocationLatency(resA, loc);
          const dataB = applyLocationLatency(resB, loc);

          switchTab('summary');
          renderCompareMode(dataA, dataB);
          result.hidden = false;
        }
      } catch (err) {
        note.textContent = 'failed loading competitor data — check URLs and try again';
        welcomePanel.hidden = false;
      } finally {
        goBtn.disabled = false;
        goLabel.textContent = 'Test Site';
      }

    } else {
      const url = urlInput.value.trim();
      if (!url) return;

      goBtn.disabled = true;
      goLabel.textContent = 'Testing…';
      note.textContent = 'fetching page and resources server-side';
      result.hidden = true;

      try {
        const res = await fetch(`/.netlify/functions/analyze?url=${encodeURIComponent(url)}`);
        const rawData = await res.json();
        if (rawData.error) {
          note.textContent = rawData.error;
          welcomePanel.hidden = false;
        } else {
          note.textContent = '';
          const data = applyLocationLatency(rawData, loc);

          switchTab('summary');
          renderSingleMode(data);
          result.hidden = false;
        }
      } catch (err) {
        note.textContent = 'request failed — check the URL and try again';
        welcomePanel.hidden = false;
      } finally {
        goBtn.disabled = false;
        goLabel.textContent = 'Test Site';
      }
    }
  });

  // Initialize
  apiKeyInput.value = localStorage.getItem('pagespeed_api_key') || '';
  renderHistoryTabs();

})();
