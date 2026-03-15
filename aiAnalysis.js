'use strict';

const TRADING_SYSTEM_PROMPT = `You are an expert crypto trader analyzing chart data. You MUST respond ONLY with valid JSON, no markdown, no explanation outside JSON.
Response format:
{
  "direction": "LONG" or "SHORT" or "NEUTRAL",
  "entry": number,
  "sl": number,
  "tp": number,
  "rr": "<e.g. 1:2.3>",
  "confidence": "LOW" or "MEDIUM" or "HIGH",
  "score": 0-100,
  "reasoning": "max 150 chars explanation"
}`;

async function callKimi(prompt, settings) {
    const apiKey = (settings.ai?.kimiApiKey || '').trim();
    if (!apiKey) throw new Error('No Kimi API key found. Go to Settings → Integrations → AI Analysis to add your API key.');

    const maskedKey = apiKey.length > 8 ? apiKey.slice(0, 4) + '***' + apiKey.slice(-4) : '***';
    console.log('[Kimi] Sending request, key:', maskedKey);

    const res = await fetch('https://api.moonshot.ai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model:       'kimi-k2-0905-preview',
            temperature: 0.3,
            messages: [
                { role: 'system', content: TRADING_SYSTEM_PROMPT },
                { role: 'user',   content: prompt },
            ],
        }),
    });
    const data = await res.json();
    if (data.error) {
        if (data.error.type === 'rate_limit_exceeded' || res.status === 429)
            throw new Error('AI rate limit reached. Try again in a few minutes or switch to a different AI provider in Settings.');
        throw new Error('AI analysis failed: ' + (data.error.message || JSON.stringify(data.error)));
    }
    if (!res.ok) throw new Error(`AI analysis failed: Kimi returned ${res.status}`);
    return data.choices[0].message.content;
}

async function callGLM(prompt, settings) {
    const apiKey = (settings.ai?.glmApiKey || '').trim();
    if (!apiKey) throw new Error('No GLM API key found. Go to Settings → Integrations → AI Analysis to add your API key.');

    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model:           'glm-4-flash',
            temperature:      0.3,
            max_tokens:       1024,
            response_format:  { type: 'json_object' },
            messages: [
                { role: 'system', content: TRADING_SYSTEM_PROMPT },
                { role: 'user',   content: prompt },
            ],
        }),
    });
    const data = await res.json();
    if (data.error) {
        if (res.status === 429)
            throw new Error('AI rate limit reached. Try again in a few minutes or switch to a different AI provider in Settings.');
        throw new Error('AI analysis failed: ' + (data.error.message || JSON.stringify(data.error)));
    }
    if (!res.ok) throw new Error(`AI analysis failed: GLM returned ${res.status}`);
    return data.choices[0].message.content;
}

async function callClaude(prompt, settings) {
    const apiKey = (settings.ai?.claudeApiKey || '').trim();
    if (!apiKey) throw new Error('Anthropic API key not set. Add it in Settings → Integrations → AI Analysis.');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
            'Content-Type':      'application/json',
            'x-api-key':         apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model:      'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system:     TRADING_SYSTEM_PROMPT,
            messages:   [{ role: 'user', content: prompt }],
        }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (!res.ok) throw new Error(`AI analysis failed: Claude returned ${res.status}`);
    return data.content[0].text;
}

async function analyzeWithAI(prompt, userSettings) {
    const provider = userSettings?.ai?.provider || 'glm';
    console.log('[AI Analysis] Using provider:', provider);
    let raw;
    switch (provider) {
        case 'claude': raw = await callClaude(prompt, userSettings); break;
        case 'kimi':   raw = await callKimi(prompt, userSettings);   break;
        case 'glm':
        default:       raw = await callGLM(prompt, userSettings);    break;
    }
    // Extract the JSON object regardless of any preamble/postamble the model adds
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1).trim();
    // Fallback: strip markdown fences
    return raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
}

// Test connectivity for a provider using a minimal prompt
async function testAIProvider(settings) {
    const provider = settings?.ai?.provider || 'glm';
    const testPrompt = 'Respond with this exact JSON only: {"status": "connected", "provider": "' + provider + '"}';
    try {
        switch (provider) {
            case 'claude': {
                const apiKey = (settings?.ai?.claudeApiKey || '').trim();
                if (!apiKey) throw new Error('No Anthropic API key set');
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
                    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 50, system: 'Reply only with valid JSON.', messages: [{ role: 'user', content: testPrompt }] }),
                });
                const d = await res.json();
                if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
                return { ok: true, provider: 'claude', message: 'Connected to Claude Sonnet' };
            }
            case 'kimi': {
                const apiKey = (settings?.ai?.kimiApiKey || '').trim();
                if (!apiKey) throw new Error('No Kimi API key set');
                const maskedKey = apiKey.length > 8 ? apiKey.slice(0, 4) + '***' + apiKey.slice(-4) : '***';
                console.log('[Kimi test] key:', maskedKey);
                const res = await fetch('https://api.moonshot.ai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: 'kimi-k2-0905-preview', temperature: 0, max_tokens: 50, messages: [{ role: 'user', content: testPrompt }] }),
                });
                const d = await res.json();
                if (d.error) throw new Error(d.error.message || 'Kimi error');
                return { ok: true, provider: 'kimi', message: 'Connected to Kimi K2' };
            }
            case 'glm':
            default: {
                const apiKey = (settings?.ai?.glmApiKey || '').trim();
                if (!apiKey) throw new Error('No GLM API key set');
                const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: 'glm-4-flash', temperature: 0.1, max_tokens: 50, messages: [{ role: 'user', content: testPrompt }] }),
                });
                const d = await res.json();
                if (d.error) throw new Error(d.error.message || 'GLM error');
                return { ok: true, provider: 'glm', message: 'Connected to GLM-4-Flash' };
            }
        }
    } catch (e) { return { ok: false, error: e.message }; }
}

// ── Trade post-analysis (free-text, not JSON) ─────────────────────────────
const TRADE_REVIEW_SYSTEM = `You are a professional crypto futures trading coach. Analyze the provided trade and write a concise review in exactly 3 short paragraphs:
1) Performance: Was the PnL and risk-reward acceptable?
2) Observations: What went right or wrong (entry, SL/TP placement, timing)?
3) Suggestion: One specific improvement for next time.
Total response must be under 160 words. Write in plain text, no markdown headers, no bullet points.`;

async function callTradeReviewClaude(prompt, settings) {
    const apiKey = (settings.ai?.claudeApiKey || '').trim();
    if (!apiKey) throw new Error('Anthropic API key not set. Go to Settings → Integrations → AI Analysis.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 350, system: TRADE_REVIEW_SYSTEM, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (!res.ok) throw new Error(`Claude returned ${res.status}`);
    return data.content[0].text;
}

async function callTradeReviewKimi(prompt, settings) {
    const apiKey = (settings.ai?.kimiApiKey || '').trim();
    if (!apiKey) throw new Error('Kimi API key not set. Go to Settings → Integrations → AI Analysis.');
    const res = await fetch('https://api.moonshot.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'kimi-k2-0905-preview', temperature: 0.4, max_tokens: 350, messages: [{ role: 'system', content: TRADE_REVIEW_SYSTEM }, { role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (!res.ok) throw new Error(`Kimi returned ${res.status}`);
    return data.choices[0].message.content;
}

async function callTradeReviewGLM(prompt, settings) {
    const apiKey = (settings.ai?.glmApiKey || '').trim();
    if (!apiKey) throw new Error('GLM API key not set. Go to Settings → Integrations → AI Analysis.');
    const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: 'glm-4-flash', temperature: 0.4, max_tokens: 350, messages: [{ role: 'system', content: TRADE_REVIEW_SYSTEM }, { role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (!res.ok) throw new Error(`GLM returned ${res.status}`);
    return data.choices[0].message.content;
}

async function analyzeTradeWithAI(trade, strategy, userSettings) {
    const duration = trade.closedAt && trade.openedAt
        ? Math.round((new Date(trade.closedAt) - new Date(trade.openedAt)) / 60000) + ' min'
        : 'still open';
    const rr = (trade.sl && trade.tp && trade.entryPrice)
        ? Math.abs((trade.tp - trade.entryPrice) / (trade.entryPrice - trade.sl)).toFixed(2)
        : 'N/A';
    const prompt = [
        `Symbol: ${trade.symbol}`,
        `Side: ${(trade.side || '').toUpperCase()}`,
        `Entry: ${trade.entryPrice}  |  Exit: ${trade.exitPrice ?? 'open'}`,
        `SL: ${trade.sl ?? 'none'}  |  TP: ${trade.tp ?? 'none'}  |  R:R: 1:${rr}`,
        `Qty: ${trade.quantity}  |  PnL: ${(trade.pnl || 0) >= 0 ? '+' : ''}${(trade.pnl || 0).toFixed(2)} USDT`,
        `Status: ${trade.status}  |  Duration: ${duration}`,
        `Strategy: ${strategy?.name ?? 'Unknown'}`,
    ].join('\n');

    const provider = userSettings?.ai?.provider || 'glm';
    switch (provider) {
        case 'claude': return callTradeReviewClaude(prompt, userSettings);
        case 'kimi':   return callTradeReviewKimi(prompt, userSettings);
        case 'glm':
        default:       return callTradeReviewGLM(prompt, userSettings);
    }
}

module.exports = { analyzeWithAI, testAIProvider, analyzeTradeWithAI };
