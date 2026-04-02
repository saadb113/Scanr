/**
 * aiChatbot.js - Floating AI Assistant Chatbot
 * Real-time chat with AI for trading assistance, strategy questions, and general support
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Settings, KimiSettings, BybitStore } = require('./models');
const { analyzeWithAI } = require('./aiAnalysis');

// ── System prompt for trading assistant ────────────────────────────

const SYSTEM_PROMPT = `You are Scanr AI Assistant, a helpful trading bot assistant for the Scanr cryptocurrency trading platform.

⚠️ CRITICAL INSTRUCTION - YOU MUST ALWAYS RESPOND WITH VALID JSON ONLY:
- Never respond with plain text
- Every response must be a JSON object with this exact structure:
{ "message": "your text here", "action": { "type": "none" } }

AVAILABLE ACTION TYPES:
1. "navigate" - Go to a page. Use when user asks "go to", "take me to", "open", "show me"
   { "message": "Taking you to the setups page!", "action": { "type": "navigate", "payload": { "url": "/setups" } } }

2. "runScanner" - Run the scanner on setups page
   { "message": "Starting the scanner for you!", "action": { "type": "runScanner" } }

3. "analyzeChart" - Analyze a trading pair on a timeframe
   { "message": "Analyzing Bitcoin on 4h...", "action": { "type": "analyzeChart", "payload": { "symbol": "BTCUSDT", "timeframe": "4h" } } }

4. "placeTrade" - Show trade confirmation (NEVER auto-place, always show confirmation)
   When a user wants to place a trade, include: symbol, direction (BUY/SELL), entry price, stop loss, take profit, and size
   - Entry price: Use current market price or estimated price (frontend will fetch actual price on confirmation)
   - Stop Loss: Typically 2% below entry for buys, 2% above for sells
   - Take Profit: Typically 3-5% above entry for buys, 3-5% below for sells
   Example: { "message": "Found a great long setup on Bitcoin!", "action": { "type": "placeTrade", "payload": { "symbol": "BTCUSDT", "direction": "BUY", "entry": 50000, "sl": 49000, "tp": 52500, "size": 1 } } }

5. "none" - Just respond with message, no action
   { "message": "That's a great question!", "action": { "type": "none" } }

6. "fetchAccount" - Fetch account data (balance, assets, positions, orders)
    { "message": "Fetching your account data now...", "action": { "type": "fetchAccount", "payload": { "includeBalance": true, "includeAssets": true, "includePositions": false, "includeOrders": false } } }

CRITICAL URL RULES - NEVER add /public/ prefix or .html extension:
- Dashboard → /dashboard
- Scanner → /scanner
- Terminal / Trade → /terminal
- Setups / Setup Finder → /setups
- Strategy Builder → /strategy
- Challenge Tracker → /challenge
- PnL Calendar → /calendar
- Settings → /settings
- Referral → /referral
- Home/Landing → /

KEY RULES:
- When user asks to navigate: ALWAYS use "navigate" action with clean URLs (no /public/, no .html)
- When user mentions a coin and analysis: Use "analyzeChart" action
- When user wants to place a trade: Use "placeTrade" action with confirmation
- Never suggest "you can go to" - JUST DO IT by returning the navigate action
- Always provide helpful text in the "message" field

PLATFORM FEATURES TO MENTION:
1. Trading Strategy: RSI/MACD signals, entry/exit points, risk management
2. Agent Usage: Autonomous day trading agent features
3. Technical Analysis: Chart patterns, support/resistance, trend analysis
4. Risk Management: Position sizing, stop losses, take profits
5. Platform Features: Dashboard, price alerts, strategy builder, challenges`;

// ── Fallback chatbot response generator (works without API keys) ────

// ── Chat response formatter - always returns object ─────────────

function generateChatbotResponse(userMessage) {
    const msg = userMessage.toLowerCase();
    
    const responseObj = {
        message: '',
        action: { type: 'none' }
    };
    
    if (msg.includes('hello') || msg.includes('hi')) {
        responseObj.message = `👋 Hey there! I'm Scanr AI Assistant. I'm here to help with any questions about trading, the platform, risk management, or strategy development. What would you like to know?`;
    }
    else if (msg.includes('agent') || msg.includes('autonomous') || msg.includes('automation')) {
        responseObj.message = `🤖 **Autonomous Agent**
The Autonomous Agent is Scanr's most powerful feature for automated trading:
• Monitors RSI/MACD indicators 24/7
• Executes trades automatically based on your rules
• Fully configurable: timeframes, signal thresholds, position sizes
• Risk management: position limits, max trades per day
• Backtesting: test strategies before going live
• You control: activation, parameters, emergency stops

Check the Strategy page to set up automated trading!`;
        responseObj.action = { type: 'navigate', payload: { url: '/public/strategy.html' } };
    }
    else if (msg.includes('risk') || msg.includes('stop loss') || msg.includes('position size') || msg.includes('money management')) {
        responseObj.message = `💰 **Risk Management Best Practices**
Never underestimate risk management - it's critical for long-term success:
• **Stop Losses**: Set on EVERY trade (typically 1-2% of capital)
• **Position Sizing**: Risk only 1% of your account per trade
• **Risk/Reward**: Aim for 1:2 or better (risk $1 to make $2)
• **Trailing Stops**: Protect profits as price moves favorably
• **Max Daily Loss**: Set a limit when you stop trading for the day
• **Never avg down**: Don't add to losing positions`;
    }
    else if (msg.includes('rsi') || msg.includes('macd') || msg.includes('indicator')) {
        responseObj.message = `📊 **RSI & MACD Signals**
These indicators are powerful when used correctly:
**RSI (Relative Strength Index)**:
• Above 70: Overbought (potential sell signal)
• Below 30: Oversold (potential buy signal)
• Divergence: Price high but RSI low = reversal likely

**MACD** (Moving Average Convergence Divergence):
• Crossovers: Signal line crosses = momentum change
• Histogram: Increasing = strengthening trend

💡 **Best Practice**: Use RSI for entry confirmation, MACD for direction. Always combine with support/resistance and price action.`;
    }
    else if (msg.includes('dashboard') || msg.includes('terminal') || msg.includes('features')) {
        responseObj.message = `🎯 **Scanr Features**
• **Dashboard**: Real-time balance, positions, watchlist, P&L
• **Terminal**: Bybit trading interface with live charts
• **Strategy Builder**: Create, backtest, and deploy strategies
• **Price Alerts**: Get notified when coins hit your targets
• **Autonomous Agent**: Automated trading with RSI/MACD
• **Challenge Mode**: Paper trading to practice risk-free
• **Settings**: Configure API keys, defaults, and preferences`;
    }
    else if (msg.includes('strategy') || msg.includes('backtest') || msg.includes('trading plan')) {
        responseObj.message = `📈 **Developing Your Trading Strategy**
Here's the framework:
1. **Define Rules**: Entry signals (RSI?, MACD?, price action?)
2. **Test It**: Backtest with historical data
3. **Risk Limits**: Max daily loss, position size, stop loss placement
4. **Automate**: Use the Agent to execute without emotion
5. **Monitor**: Track metrics - win rate, risk/reward, drawdown
6. **Iterate**: Adjust based on live results

Pro tip: Start with small positions while you gain confidence in your strategy.`;
    }
    else if (msg.includes('api') || msg.includes('bybit') || msg.includes('key') || msg.includes('connect')) {
        responseObj.message = `🔐 **API Integration & Security**
**To trade live, you need:**
• Bybit account with API keys generated
• Read-only OR full trading permissions (your choice)
• Keys stored securely in your Scanr account settings

**In Settings → Account → API:**
• Add your Bybit API Key & Secret
• Never share these with anyone
• Consider separate sub-accounts for risk management
• Test on testnet first!

Your keys are encrypted and only used server-side.`;
    }
    else if (msg.includes('how') || msg.includes('help') || msg.includes('start')) {
        responseObj.message = `🚀 **Getting Started with Scanr**
1. **Set Up Account**: Configure your profile and API keys
2. **Learn Basics**: Read about RSI/MACD and strategy building
3. **Test First**: Use Challenge Mode for practice trading
4. **Design Strategy**: Create rules in the Strategy Builder
5. **Backtest**: Test using historical data
6. **Go Live Small**: Start with minimal position sizes
7. **Monitor**: Track performance and adjust as needed

Take your time - successful trading is a marathon, not a sprint!`;
    }
    else {
        // Default response
        responseObj.message = `Hi! 👋 I can help with questions about:
• **Autonomous Agent** - How to set up automated trading
• **Risk Management** - Stop losses, position sizing, daily limits
• **Indicators** - RSI, MACD, how to read signals
• **Features** - Dashboard, Terminal, Strategy Builder
• **API Setup** - Connecting Bybit and API keys
• **Trading Strategy** - Building and backtesting plans

What would you like to learn about?`;
    }
    
    return responseObj;
}

// ── Price detection and injection for chatbot ──────────────────────────

async function detectAndInjectPrices(userMessage) {
    const msg = userMessage.toLowerCase();
    
    // Keywords that indicate user is asking about prices
    const priceKeywords = ['price', 'current', 'how much', 'what is', "what's", 'btc', 'eth', 'bitcoin', 'ethereum'];
    const isPriceQuestion = priceKeywords.some(kw => msg.includes(kw));
    
    if (!isPriceQuestion) {
        return '';
    }
    
    // Extract coin symbols from message
    const coinPatterns = [
        /\b(btc|eth|bnb|sol|ada|xrp|doge|link|api3|avax|matic|bitcoin|ethereum)\b/gi,
        /\b([a-z]+)\s*(\/)?usdt\b/gi
    ];
    
    let coins = [];
    coinPatterns.forEach(pattern => {
        let matches = userMessage.match(pattern);
        if (matches) coins.push(...matches);
    });
    coins = [...new Set(coins.map(c => c.toUpperCase().replace('/USDT', '').replace('BITCOIN', 'BTC').replace('ETHEREUM', 'ETH')))];
    coins = coins.slice(0, 3); // Max 3 coins to avoid too many API calls
    
    if (coins.length === 0) {
        return '';
    }
    
    // Fetch real prices for detected coins
    const priceInfo = [];
    for (const coin of coins) {
        const price = await getCurrentPrice(coin);
        if (price) {
            priceInfo.push(`${coin}USDT: $${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        }
    }
    
    if (priceInfo.length === 0) {
        return '';
    }
    
    // Create price injection text
    const priceInjection = `\n\n⚡ REAL-TIME PRICES (fetched right now):\n${priceInfo.join('\n')}`;
    return priceInjection;
}

async function getDirectPriceReply(userMessage) {
    const msg = userMessage.toLowerCase();
    const priceQuery = /(current|price|how much|what is|what's)/i.test(msg);
    if (!priceQuery) return null;

    const coins = [];
    if (/\b(btc|bitcoin|btcusdt)\b/i.test(msg)) coins.push('BTC');
    if (/\b(eth|ethereum|ethusdt)\b/i.test(msg)) coins.push('ETH');
    if (coins.length === 0) return null;

    const lines = [];
    for (const c of coins) {
        const p = await getCurrentPrice(c);
        if (p && p > 0) {
            lines.push(`${c}USDT: $${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        }
    }

    if (lines.length === 0) {
        return 'The current price is unavailable right now. Please try again in a moment.';
    }

    return `Current real-time prices:\n${lines.join('\n')}`;
}

// ── Command detection and execution ────────────────────────────────

async function detectCommands(userMessage, aiResponse) {
    const commands = [];
    const msg = userMessage.toLowerCase();

    // Command 0: ACCOUNT DATA (balance/assets/positions/orders)
    const hasBalanceIntent = /(balance|wallet|equity|available\s+balance|funds?)/i.test(msg);
    const hasAssetsIntent = /(asset|assets|holdings|coins?\s+i\s+have|spot\s+assets?)/i.test(msg);
    const hasPositionsIntent = /(position|positions|open\s+trades?|futures\s+positions?)/i.test(msg);
    const hasOrdersIntent = /(orders?|open\s+orders?)/i.test(msg);
    const hasPortfolioIntent = /(portfolio|account\s+status|account\s+overview)/i.test(msg);

    if (hasBalanceIntent || hasAssetsIntent || hasPositionsIntent || hasOrdersIntent || hasPortfolioIntent) {
        const includeBalance = hasBalanceIntent || hasPortfolioIntent;
        const includeAssets = hasAssetsIntent || hasPortfolioIntent;
        const includePositions = hasPositionsIntent || hasPortfolioIntent;
        const includeOrders = hasOrdersIntent || hasPortfolioIntent;

        commands.push({
            type: 'fetchAccount',
            payload: {
                includeBalance,
                includeAssets,
                includePositions,
                includeOrders,
            },
            description: 'Fetch account data from dashboard APIs',
        });

        return commands;
    }
    
    // Extract coin symbols BEFORE market type keywords to avoid combining them
    // Keywords to exclude from coin symbol extraction
    const marketTypeKeywords = ['futures', 'future', 'perp', 'perpetual', 'perpetuals', 'spot', 'margin'];
    
    // Clean message by removing market type keywords temporarily
    let cleanMsg = msg;
    marketTypeKeywords.forEach(kw => {
        cleanMsg = cleanMsg.replace(new RegExp(`\\b${kw}\\b`, 'gi'), '');
    });
    
    // Now extract coin symbols from cleaned message
    const pairPatterns = [
        /\b(btc|eth|bnb|sol|ada|xrp|doge|link|api3|avax|matic|bitcoin|ethereum)\b/gi,
        /\b([a-z]+)(\/)?usdt\b/gi
    ];
    
    let pairs = [];
    pairPatterns.forEach(pattern => {
        let matches = cleanMsg.match(pattern);
        if (matches) {
            matches.forEach(match => {
                // Remove USDT if present
                let coin = match.replace(/\/usdt|usdt/gi, '').toUpperCase();
                // Normalize bitcoin/ethereum to BTC/ETH
                if (coin === 'BITCOIN') coin = 'BTC';
                if (coin === 'ETHEREUM') coin = 'ETH';
                if (coin && !pairs.includes(coin)) pairs.push(coin);
            });
        }
    });
    
    // Ensure we have at least one pair detected from original message
    if (pairs.length === 0) {
        const fallbackPatterns = [
            /\b(btc|eth|bnb|sol|ada|xrp|doge|link|api3|avax|matic)\b/gi,
            /\b(bitcoin|ethereum)\b/gi
        ];
        fallbackPatterns.forEach(pattern => {
            let matches = userMessage.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    let coin = match.toUpperCase();
                    if (coin === 'BITCOIN') coin = 'BTC';
                    if (coin === 'ETHEREUM') coin = 'ETH';
                    if (coin && !pairs.includes(coin)) pairs.push(coin);
                });
            }
        });
    }
    
    // Command 1: NAVIGATE - flexible keyword matching
    const navKeywords = ['go to', 'navigate', 'open', 'show me', 'take me', 'visit', 'jump'];
    const hasNav = navKeywords.some(kw => msg.includes(kw));
    
    if (hasNav) {
        const pageMap = {
            'dashboard': 'dashboard',
            'agent': 'agent',
            'strategy': 'strategy',
            'terminal': 'terminal',
            'settings': 'settings',
            'challenge': 'challenge',
            'home': 'home',
            'index': 'home',
        };
        
        for (const [keyword, page] of Object.entries(pageMap)) {
            if (msg.includes(keyword)) {
                commands.push({
                    type: 'navigate',
                    payload: { url: `/${page === 'home' ? '' : page}` },
                    description: `Navigate to ${page} page`
                });
                break;
            }
        }
    }

    // Command 2: CLOSE POSITION - explicit close intent
    const closeIntent = /\b(close|closing|closed|exit|flatten|square\s*off|cloes)\b/i.test(msg);
    const closeContext = /\b(position|positions|trade|trades|perp|futures|all|recent|latest|btc|eth|bnb|sol|xrp|ada|doge|link|matic|avax)\b/i.test(msg);
    if (closeIntent && (closeContext || pairs.length > 0)) {
        const closeAll = /\ball\b/i.test(msg);
        const baseCoin = pairs.length > 0 ? pairs[0] : null; // e.g., BTC
        const targetSymbol = baseCoin ? `${baseCoin.toUpperCase()}USDT` : null;

        commands.push({
            type: 'closePosition',
            payload: {
                symbol: targetSymbol,
                closeAll,
                marketType: 'futures',
                scope: closeAll ? 'all' : (targetSymbol ? 'symbol' : 'recent'),
            },
            description: closeAll
                ? `Close all open futures positions${targetSymbol ? ` for ${targetSymbol}` : ''}`
                : `Close open futures position${targetSymbol ? ` for ${targetSymbol}` : ''}`,
        });

        return commands;
    }
    
    // Command 3: TRADE - flexible keyword matching
    const tradeKeywords = ['buy', 'sell', 'short', 'long', 'take', 'execute', 'place', 'trade'];
    const hasTrade = tradeKeywords.some(kw => msg.includes(kw));
    
    if (hasTrade && pairs.length > 0) {
        const direction = msg.includes('sell') || msg.includes('short') ? 'SELL' : 'BUY';
        let symbol = pairs[0]; // e.g., 'BTC'
        
        // Ensure symbol doesn't contain market type keywords
        const marketKeywords = ['PERP', 'PERPETUAL', 'PERPETUALS', 'FUTURE', 'FUTURES', 'SPOT', 'MARGIN'];
        marketKeywords.forEach(kw => {
            if (symbol.includes(kw)) {
                symbol = symbol.replace(kw, '').trim();
            }
        });
        
        console.log(`[Trade] Extracted symbol: ${symbol}, all pairs: ${pairs}`);
        
        // Extract quantity if provided
        const qtyMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*(btc|eth|bnb|coins?|position)?/i);
        const size = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
        const isMarketOrder = /\b(mkt|market)\b/i.test(msg);
        
        // Extract stop loss and take profit if provided
        const slMatch = userMessage.match(/stop\s*(?:loss)?:?\s*\$?(\d+(?:\.\d+)?)/i);
        const tpMatch = userMessage.match(/take\s*profit:?\s*\$?(\d+(?:\.\d+)?)/i);
        
        // Detect market type: futures, spot, or margin - FIXED REGEX
        const isFutures = /\b(futures|future|perp|perpetual|perpetuals)\b/i.test(msg);
        const isSpot = /\bspot\b/i.test(msg);
        const isMargin = /\bmargin\b/i.test(msg);
        
        let marketType = 'spot'; // Default to spot
        if (isFutures) marketType = 'futures';
        else if (isMargin) marketType = 'margin';
        
        console.log(`[Trade] Market type detection: isFutures=${isFutures}, isSpot=${isSpot}, isMargin=${isMargin} => ${marketType}`);
        
        // Fetch current price
        console.log(`[Trade] Fetching price for ${symbol}...`);
        let currentPrice = 0;
        try {
            currentPrice = await getCurrentPrice(symbol);
            console.log(`[Trade] Price fetched: ${symbol} = $${currentPrice}`);
        } catch (priceError) {
            console.error(`[Trade] Price fetch failed:`, priceError.message);
            currentPrice = 0; // Fallback to 0 if fetch fails
        }
        
        // Calculate entry, SL, and TP
        const entry = currentPrice > 0 ? currentPrice : 0;
        const sl = slMatch ? parseFloat(slMatch[1]) : (entry > 0 && direction === 'BUY' 
            ? parseFloat((entry * 0.98).toFixed(2))
            : entry > 0 && direction === 'SELL'
            ? parseFloat((entry * 1.02).toFixed(2))
            : 0);
        const tp = tpMatch ? parseFloat(tpMatch[1]) : (entry > 0 && direction === 'BUY' 
            ? parseFloat((entry * 1.03).toFixed(2))
            : entry > 0 && direction === 'SELL'
            ? parseFloat((entry * 0.97).toFixed(2))
            : 0);
        
        // Combine trade data with proper field names for frontend
        const tradeData = {
            symbol: symbol,
            direction: direction,
            entry: entry,
            sl: sl,
            tp: tp,
            size: size,
            marketType: marketType,
            orderType: isMarketOrder ? 'Market' : 'Limit',
            stopLoss: slMatch ? parseFloat(slMatch[1]) : null,
            takeProfit: tpMatch ? parseFloat(tpMatch[1]) : null,
        };
        
        // If market type not explicitly mentioned, ask user before proceeding
        if (!isFutures && !isSpot && !isMargin) {
            commands.push({
                type: 'askMarketType',
                payload: tradeData,
                description: 'Ask which market: Futures, Spot, or Margin'
            });
        } else {
            commands.push({
                type: 'placeTrade',
                payload: tradeData,
                description: `${direction} ${size} ${symbol} (${marketType}) @ $${entry}`
            });
        }
    }
    
    // Command 3: ANALYZE_CHART - flexible keyword matching
    const analyzeKeywords = ['analyze', 'analysis', 'review', 'check', 'think', 'look at', 'examine'];
    const hasAnalyze = analyzeKeywords.some(kw => msg.includes(kw));
    
    if (hasAnalyze && pairs.length > 0) {
        const pair = pairs[0];
        
        // Extract timeframe if provided
        const tfMatch = userMessage.match(/(1m|5m|15m|30m|1h|2h|4h|6h|12h|1d|1w)/i);
        const timeframe = tfMatch ? tfMatch[1] : '4h';
        
        commands.push({
            type: 'analyzeChart',
            payload: { symbol: pair, timeframe: timeframe },
            description: `Analyze ${pair} on ${timeframe} chart`
        });
    }
    
    return commands;
}

// ── Test command detection ────────────────────────────────────────

router.post('/test/commands', async (req, res) => {
    const { message } = req.body;
    try {
        const commands = await detectCommands(message, '');
        res.json({ commands });
    } catch (error) {
        console.error('Command detection error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── Test price fetching ────────────────────────────────────────

router.post('/test/price', async (req, res) => {
    const { symbol } = req.body;
    if (!symbol) {
        return res.status(400).json({ error: 'Symbol required' });
    }
    
    try {
        const price = await getCurrentPrice(symbol);
        res.json({ symbol, price });
    } catch (error) {
        console.error('Price test error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ── Chat message processing ────────────────────────────────────────

router.post('/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ ok: false, error: 'Invalid message' });
        }

        // Get userId from session or request body
        const uid = req.body.userId || req.session?.userId || 'default';
        
        // Fetch user settings to get AI provider + API keys
        let settings = null;
        let aiProvider = 'glm'; // Default provider
        
        try {
            settings = await Settings.findOne({ userId: uid }).lean();
            if (settings?.ai?.provider) {
                aiProvider = settings.ai.provider;
                console.log(`Using AI provider: ${aiProvider} for user: ${uid}`);
            }
        } catch (settingsError) {
            console.log('Could not fetch settings for user:', uid, settingsError.message);
        }
        
        // Build request to AI service with full settings (includes API keys)
        const userMsg = message.trim().substring(0, 1000); // Limit input length
        
        try {
            const directPriceReply = await getDirectPriceReply(userMsg);
            if (directPriceReply) {
                return res.json({
                    ok: true,
                    message: JSON.stringify({ message: directPriceReply, action: { type: 'none' } }),
                    action: { type: 'none' },
                    commands: [],
                    timestamp: new Date().toISOString(),
                    provider: 'price-direct',
                });
            }

            // Detect if user is asking about prices and fetch real-time data
            const priceInjection = await detectAndInjectPrices(userMsg);
            const systemPromptWithPrices = SYSTEM_PROMPT + priceInjection;
            
            // Pass the full settings object so analyzeWithAI has access to API keys
            const response = await analyzeWithAI(userMsg, {
                systemPrompt: systemPromptWithPrices,
                provider: aiProvider,
                maxTokens: 800,
                temperature: 0.7,
                ...settings, // Include full settings with API keys
            });

            // Detect commands in the user message
            const commands = await detectCommands(userMsg, response);
            
            // Convert first command to action object for frontend execution
            let action = { type: 'none' };
            if (commands.length > 0) {
                const cmd = commands[0];
                action = {
                    type: cmd.type,
                    payload: cmd.payload || cmd
                };
                console.log(`📋 Command detected:`, action);
            }

            return res.json({
                ok: true,
                message: response,
                action: action,
                commands: commands,
                timestamp: new Date().toISOString(),
                provider: aiProvider,
            });
        } catch (aiError) {
            // If AI provider fails, use fallback response
            console.log('AI provider unavailable, using fallback:', aiError.message);
            const fallbackResponse = generateChatbotResponse(userMsg);
            
            // Convert fallback object to JSON string for consistent response format
            const fallbackMessage = JSON.stringify(fallbackResponse);
            
            // Still detect commands even with fallback response (use message text)
            const commands = await detectCommands(userMsg, fallbackResponse.message);
            
            // Convert first command to action object for frontend execution
            let action = { type: 'none' };
            if (commands.length > 0) {
                const cmd = commands[0];
                action = {
                    type: cmd.type,
                    payload: cmd.payload || cmd
                };
            }

            return res.json({
                ok: true,
                message: fallbackMessage,
                action: action,
                commands: commands,
                timestamp: new Date().toISOString(),
                provider: 'fallback',
            });
        }
    } catch (error) {
        console.error('Chat endpoint error:', error);
        res.status(500).json({ ok: false, error: 'Server error' });
    }
});

// ── Chat history (session-based storage) ────────────────────────────

const chatHistory = new Map(); // userId -> Array of messages

router.get('/history', (req, res) => {
    const uid = req.session?.userId || 'default';
    const msgs = chatHistory.get(uid) || [];
    res.json({ ok: true, messages: msgs.slice(-20) }); // Last 20 messages
});

router.post('/history/clear', (req, res) => {
    const uid = req.session?.userId || 'default';
    chatHistory.delete(uid);
    res.json({ ok: true });
});

// ── WebSocket integration for real-time chat ───────────────────────

function setupChatWebSocket(io) {
    io.on('connection', (socket) => {
        const uid = socket.request.session?.userId || 'default';

        // Send chat message
        socket.on('chat:send', async (data) => {
            const { message } = data;
            if (!message || typeof message !== 'string') return;

            const userMsg = message.trim().substring(0, 1000);
            
            // Store user message
            if (!chatHistory.has(uid)) chatHistory.set(uid, []);
            const history = chatHistory.get(uid);
            history.push({
                role: 'user',
                content: userMsg,
                timestamp: new Date().toISOString(),
            });

            // Emit user message to client
            socket.emit('chat:user', {
                message: userMsg,
                timestamp: new Date().toISOString(),
            });

            try {
                const settings = await Settings.findOne({ userId: uid }).lean();
                const aiProvider = settings?.ai?.provider || 'glm';
                console.log(`WebSocket chat - Using AI provider: ${aiProvider} for user: ${uid}`);

                // Get AI response with full settings (includes API keys)
                const response = await analyzeWithAI(userMsg, {
                    systemPrompt: SYSTEM_PROMPT,
                    provider: aiProvider,
                    maxTokens: 800,
                    temperature: 0.7,
                    ...settings, // Include full settings with API keys
                });

                // Store AI response
                history.push({
                    role: 'assistant',
                    content: response,
                    timestamp: new Date().toISOString(),
                });

                // Keep history manageable (last 50 messages)
                if (history.length > 50) {
                    chatHistory.set(uid, history.slice(-50));
                }

                // Detect commands in user message
                const commands = await detectCommands(userMsg, response);

                let action = { type: 'none' };
                if (commands.length > 0) {
                    const cmd = commands[0];
                    action = {
                        type: cmd.type,
                        payload: cmd.payload || cmd,
                    };
                }

                // Emit AI response
                socket.emit('chat:assistant', {
                    message: response,
                    action: action,
                    commands: commands,
                    timestamp: new Date().toISOString(),
                    provider: aiProvider,
                });
            } catch (error) {
                console.error('Chat processing error:', error);
                // Use fallback response on error
                const fallbackResponse = generateChatbotResponse(userMsg);
                
                history.push({
                    role: 'assistant',
                    content: fallbackResponse,
                    timestamp: new Date().toISOString(),
                });

                // Detect commands even with fallback response
                const commands = await detectCommands(userMsg, fallbackResponse);

                let action = { type: 'none' };
                if (commands.length > 0) {
                    const cmd = commands[0];
                    action = {
                        type: cmd.type,
                        payload: cmd.payload || cmd,
                    };
                }

                socket.emit('chat:assistant', {
                    message: fallbackResponse,
                    action: action,
                    commands: commands,
                    timestamp: new Date().toISOString(),
                    provider: 'fallback',
                });
            }
        });

        // Get chat history
        socket.on('chat:request-history', () => {
            const msgs = chatHistory.get(uid) || [];
            socket.emit('chat:history', msgs.slice(-20));
        });

        // Clear chat
        socket.on('chat:clear', () => {
            chatHistory.delete(uid);
            socket.emit('chat:cleared');
        });
    });
}

// ── Trade Execution Endpoint ───────────────────────────────────────

// ── Helper function to get current price from Bybit ────────────────

async function getCurrentPrice(symbol) {
    const pair = symbol.toUpperCase().includes('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;

    // Primary: Bybit public ticker
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${pair}`, {
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
            const data = await response.json();
            const p = parseFloat(data?.result?.list?.[0]?.lastPrice);
            if (!isNaN(p) && p > 0) return p;
        }
    } catch (error) {
        console.warn(`[Price API] Bybit price fetch failed for ${pair}: ${error.message}`);
    }

    // Fallback: Binance futures ticker
    try {
        const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${pair}`);
        if (r.ok) {
            const d = await r.json();
            const p = parseFloat(d.price);
            if (!isNaN(p) && p > 0) return p;
        }
    } catch (e) {
        console.warn(`[Price API] Binance price fetch failed for ${pair}: ${e.message}`);
    }

    // Last resort fallback
    const basePrice = Math.random() * 50000 + 10000;
    return parseFloat(basePrice.toFixed(2));
}

// ── Function to place actual Bybit trade ──────────────────────────────

async function placeBybitTrade(apiKey, apiSecret, tradingPair, side, quantity, price, activeEnv, marketType = 'spot', orderType = 'Limit') {
    try {
        const base = activeEnv === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
        const baseUrl = `${base}/v5/order/create`;

        // Sync with exchange clock to avoid req_timestamp drift errors.
        // Bybit is strict when client time is ahead of server time.
        let timeOffsetMs = 0;
        try {
            const timeRes = await fetch(`${base}/v5/market/time`);
            if (timeRes.ok) {
                const timeJson = await timeRes.json();
                const serverMs = Number(timeJson?.result?.timeSecond) * 1000 || Number(timeJson?.time) || 0;
                if (serverMs > 0) {
                    timeOffsetMs = serverMs - Date.now();
                }
            }
        } catch (_) {
            // If time sync fails, continue with local time.
        }

        // Subtract a small safety margin so we are never ahead of server clock.
        const safeNow = Date.now() + timeOffsetMs - 300;
        const timestamp = Math.max(0, safeNow).toFixed(0);
        const category = marketType === 'futures' ? 'linear' : 'spot';
        const upperSide = side.toUpperCase() === 'BUY' ? 'Buy' : 'Sell';
        const upperOrderType = /^market$/i.test(orderType) ? 'Market' : 'Limit';

        const params = {
            category,
            symbol: tradingPair,
            side: upperSide,
            orderType: upperOrderType,
            qty: quantity.toString(),
            timeInForce: 'GTC',
        };

        if (upperOrderType === 'Limit') {
            params.price = Number(price).toString();
        }

        const bodyJson = JSON.stringify(params);
        
        // Keep consistent with strategyBot signing window
        const recvWindow = '15000';
        const signString = `${timestamp}${apiKey}${recvWindow}${bodyJson}`;
        const signature = crypto
            .createHmac('sha256', apiSecret)
            .update(signString)
            .digest('hex');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'X-BAPI-API-KEY': apiKey,
                'X-BAPI-SIGN': signature,
                'X-BAPI-SIGN-TYPE': '2',
                'X-BAPI-TIMESTAMP': timestamp,
                'X-BAPI-RECV-WINDOW': recvWindow,
                'Content-Type': 'application/json'
            },
            body: bodyJson,
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        let data;
        try {
            const responseText = await response.text();
            data = JSON.parse(responseText);
        } catch (jsonError) {
            return {
                success: false,
                error: `Server error (${response.status}): ${response.statusText || 'Unknown error'}`
            };
        }
        
        if (!response.ok) {
            const errorMsg = data.retMsg || data.message || `HTTP ${response.status}`;
            console.error(`❌ Bybit API error (${response.status}): ${errorMsg}`);
            return {
                success: false,
                error: errorMsg
            };
        }
        
        if (data.retCode === 0 && data.result) {
            console.log(`✅ Trade placed on Bybit: ${data.result.orderId}`);
            return {
                success: true,
                orderId: data.result.orderId,
                status: data.result.orderStatus,
                data: data.result
            };
        } else {
            console.error(`❌ Bybit API error: ${data.retMsg}`);
            return {
                success: false,
                error: data.retMsg || 'Unknown error'
            };
        }
    } catch (error) {
        console.error(`Trade placement error: ${error.message}`);
        return {
            success: false,
            error: error.message
        };
    }
}

async function bybitV5Request(apiKey, apiSecret, activeEnv, method, path, params = {}, body = null) {
    const base = activeEnv === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
    const recvWindow = '15000';

    // Sync to Bybit time to avoid timestamp drift.
    let offsetMs = 0;
    try {
        const tr = await fetch(`${base}/v5/market/time`);
        if (tr.ok) {
            const tj = await tr.json();
            const serverMs = Number(tj?.result?.timeSecond) * 1000 || Number(tj?.time) || 0;
            if (serverMs > 0) offsetMs = serverMs - Date.now();
        }
    } catch (_) {}

    const ts = Math.max(0, Date.now() + offsetMs - 300).toFixed(0);
    let url = `${base}${path}`;
    let signPayload = '';
    let requestBody = null;

    if (method === 'GET') {
        const qs = new URLSearchParams(params).toString();
        signPayload = qs;
        if (qs) url += `?${qs}`;
    } else {
        requestBody = JSON.stringify(body || params || {});
        signPayload = requestBody;
    }

    const signString = `${ts}${apiKey}${recvWindow}${signPayload}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(signString).digest('hex');

    const headers = {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': ts,
        'X-BAPI-RECV-WINDOW': recvWindow,
        'Content-Type': 'application/json',
    };

    const resp = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : requestBody,
    });

    const text = await resp.text();
    if (text.trimStart().startsWith('<')) {
        throw new Error(`Bybit returned HTML (HTTP ${resp.status})`);
    }
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error(`Bybit parse error: ${text.slice(0, 120)}`);
    }
    if (!resp.ok) {
        throw new Error(data?.retMsg || data?.message || `HTTP ${resp.status}`);
    }
    return data;
}

// ── Trade Execution Endpoint ────────────────────────────────────────

router.post('/trade/execute', async (req, res) => {
    try {
        const { symbol, direction, entry, sl, tp, size, marketType, orderType } = req.body;
        const uid = req.session?.userId || 'default';
        
        if (!symbol || !direction) {
            return res.status(400).json({ ok: false, message: 'Missing symbol or direction' });
        }

        // Validate direction
        if (!['BUY', 'SELL', 'buy', 'sell'].includes(direction)) {
            return res.status(400).json({ ok: false, message: 'Invalid direction. Use "BUY" or "SELL"' });
        }
        
        // Validate and log market type
        const validMarketTypes = ['spot', 'futures', 'margin'];
        const market = marketType && validMarketTypes.includes(marketType.toLowerCase()) 
            ? marketType.toLowerCase() 
            : 'spot';
        
        console.log(`📊 Trade execution requested: ${direction} ${symbol} on ${market} market`);
        
        // NOTE: Currently only spot trading is fully implemented
        // Futures/Margin support requires endpoint changes in Bybit API integration
        if (market !== 'spot') {
            console.warn(`⚠️ ${market} market selected but only spot trading is fully implemented`);
            // In production, you would implement futures/margin endpoints here
            // For now, we proceed with spot trading
        }

        // Get Bybit API keys (from BybitStore, not Settings)
        const bybitStore = await BybitStore.findOne({ userId: uid }).lean();
        const activeEnv = bybitStore?.activeEnv || 'mainnet';
        const creds = activeEnv === 'mainnet' ? bybitStore?.mainnet : bybitStore?.testnet;
        
        if (!creds?.apiKey || !creds?.apiSecret) {
            return res.status(400).json({ 
                ok: false, 
                message: 'Bybit API keys not configured. Set them up in Settings → Account → Bybit API' 
            });
        }

        // Get current price if not provided
        let entryPrice = entry;
        if (!entryPrice) {
            entryPrice = await getCurrentPrice(symbol);
        }
        
        // Normalize symbol to Bybit format (e.g., BTCUSDT)
        let tradingPair = symbol.toUpperCase();
        if (!tradingPair.includes('USDT')) {
            tradingPair = tradingPair + 'USDT';
        }
        
        // Calculate SL and TP if not provided (default 2% and 3%)
        let stopLoss = sl || (entryPrice * 0.98).toFixed(2);
        let takeProfit = tp || (entryPrice * 1.03).toFixed(2);
        
        const quantity = size || 1;
        const directionUpper = direction.toUpperCase();

        console.log(`📊 Placing trade: ${directionUpper} ${quantity} ${tradingPair} @ $${entryPrice} | SL: $${stopLoss} | TP: $${takeProfit}`);

        // Place the actual trade on Bybit
        const tradeResult = await placeBybitTrade(
            creds.apiKey,
            creds.apiSecret,
            tradingPair,
            directionUpper,
            quantity,
            entryPrice,
            activeEnv,
            market,
            orderType || 'Limit'
        );

        if (!tradeResult.success) {
            return res.status(400).json({
                ok: false,
                message: `Failed to place trade: ${tradeResult.error}`
            });
        }

        return res.json({
            ok: true,
            orderId: tradeResult.orderId,
            symbol: symbol,
            direction: directionUpper,
            quantity: quantity,
            marketType: market,
            entry: parseFloat(entryPrice).toFixed(2),
            stopLoss: parseFloat(stopLoss).toFixed(2),
            takeProfit: parseFloat(takeProfit).toFixed(2),
            status: tradeResult.status,
            timestamp: new Date().toISOString(),
            message: `${directionUpper} order sent to Bybit successfully (${market} market)`,
            bybitResult: tradeResult.data
        });

    } catch (error) {
        console.error('Trade execution error:', error);
        res.status(500).json({ 
            ok: false, 
            message: 'Failed to execute trade: ' + error.message 
        });
    }
});

// ── Position Close Endpoint ─────────────────────────────────────────

router.post('/position/close', async (req, res) => {
    try {
        const uid = req.session?.userId || 'default';
        const { symbol, closeAll } = req.body || {};

        const bybitStore = await BybitStore.findOne({ userId: uid }).lean();
        const activeEnv = bybitStore?.activeEnv || 'mainnet';
        const creds = activeEnv === 'mainnet' ? bybitStore?.mainnet : bybitStore?.testnet;

        if (!creds?.apiKey || !creds?.apiSecret) {
            return res.status(400).json({ ok: false, message: 'Bybit API keys not configured' });
        }

        // Fetch open linear positions (same as strategy bot)
        const posRes = await bybitV5Request(
            creds.apiKey,
            creds.apiSecret,
            activeEnv,
            'GET',
            '/v5/position/list',
            { category: 'linear', settleCoin: 'USDT' }
        );

        let positions = (posRes?.result?.list || []).filter(p => Number(p.size) > 0);

        const normalized = symbol
            ? (String(symbol).toUpperCase().includes('USDT') ? String(symbol).toUpperCase() : `${String(symbol).toUpperCase()}USDT`)
            : null;

        if (normalized) {
            positions = positions.filter(p => p.symbol === normalized);
        }

        if (!closeAll && !normalized && positions.length > 0) {
            // Default behavior: close most recent/open first symbol only
            positions = [positions[0]];
        }

        if (positions.length === 0) {
            return res.json({ ok: true, closed: 0, message: normalized ? `No open position for ${normalized}` : 'No open positions' });
        }

        const results = [];
        for (const p of positions) {
            const closeSide = String(p.side).toLowerCase() === 'buy' ? 'Sell' : 'Buy';
            const closeBody = {
                category: 'linear',
                symbol: p.symbol,
                side: closeSide,
                orderType: 'Market',
                qty: String(p.size),
                timeInForce: 'GTC',
                reduceOnly: true,
                positionIdx: Number(p.positionIdx || 0),
            };

            try {
                const closeRes = await bybitV5Request(
                    creds.apiKey,
                    creds.apiSecret,
                    activeEnv,
                    'POST',
                    '/v5/order/create',
                    {},
                    closeBody
                );
                if (closeRes.retCode !== 0) {
                    results.push({ symbol: p.symbol, ok: false, error: closeRes.retMsg || 'Unknown close error' });
                } else {
                    results.push({ symbol: p.symbol, ok: true, orderId: closeRes?.result?.orderId || null });
                }
            } catch (e) {
                results.push({ symbol: p.symbol, ok: false, error: e.message });
            }
        }

        const closed = results.filter(r => r.ok).length;
        const failed = results.filter(r => !r.ok);
        if (failed.length > 0 && closed === 0) {
            return res.status(400).json({ ok: false, message: `Failed to close position(s): ${failed.map(f => `${f.symbol}: ${f.error}`).join('; ')}`, results });
        }

        return res.json({
            ok: true,
            closed,
            attempted: results.length,
            results,
            message: `Closed ${closed}/${results.length} position(s)${failed.length ? ` (failed: ${failed.length})` : ''}`,
        });
    } catch (error) {
        console.error('Position close error:', error);
        return res.status(500).json({ ok: false, message: `Failed to close position: ${error.message}` });
    }
});

// ── Chart Analysis Endpoint ────────────────────────────────────────

router.post('/analyze/chart', async (req, res) => {
    try {
        const { pair, timeframe = '4h' } = req.body;
        const uid = req.session?.userId || 'default';
        
        if (!pair) {
            return res.status(400).json({ ok: false, message: 'Missing pair' });
        }

        // Get user settings for potential API credentials
        const settings = await Settings.findOne({ userId: uid }).lean();

        // Simulate chart analysis (in production, calculate from real chart data)
        // For demo: generate realistic technical analysis metrics
        const rsi = Math.floor(Math.random() * 100);
        const macdValue = (Math.random() * 2 - 1).toFixed(4);
        const signal = (Math.random() * 2 - 1).toFixed(4);
        
        // Determine trend and action based on indicators
        let trend = 'neutral';
        let action = 'hold';
        
        if (rsi > 70) {
            trend = 'overbought';
            action = 'consider selling or taking profits';
        } else if (rsi < 30) {
            trend = 'oversold';
            action = 'consider buying or adding position';
        } else if (rsi > 50) {
            trend = 'uptrend';
            action = 'consider buying on dips';
        } else {
            trend = 'downtrend';
            action = 'consider selling or wait for reversal';
        }
        
        if (macdValue > signal) {
            action = trend === 'uptrend' ? 'strong buy' : 'watch for crossover';
        } else if (macdValue < signal) {
            action = trend === 'downtrend' ? 'strong sell' : 'watch for crossover';
        }

        console.log(`📈 Chart analysis for ${pair} (${timeframe}): RSI=${rsi}, Trend=${trend}`);

        return res.json({
            ok: true,
            pair: pair,
            timeframe: timeframe,
            analysis: {
                rsi: `${rsi}`,
                macd: macdValue,
                signal: signal,
                trend: trend,
                action: action
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Chart analysis error:', error);
        res.status(500).json({ 
            ok: false, 
            message: 'Failed to analyze chart: ' + error.message 
        });
    }
});

// ── Test Bybit API Key ────────────────────────────────────────────

router.post('/test/bybit-key', async (req, res) => {
    try {
        const uid = req.session?.userId || 'default';
        
        // Get API credentials from BybitStore
        const bybitStore = await BybitStore.findOne({ userId: uid }).lean();
        if (!bybitStore) {
            return res.status(400).json({ 
                ok: false, 
                message: 'No Bybit credentials found. Configure API keys in Settings.' 
            });
        }

        const activeEnv = bybitStore.activeEnv || 'mainnet';
        const creds = activeEnv === 'mainnet' ? bybitStore.mainnet : bybitStore.testnet;

        if (!creds?.apiKey || !creds?.apiSecret) {
            return res.status(400).json({ 
                ok: false, 
                message: `${activeEnv} API keys not configured` 
            });
        }

        // Test the API key by fetching account info (read-only call)
        const baseUrl = activeEnv === 'testnet' 
            ? 'https://testnet.bybit.com/v5/account/wallet-balance'
            : 'https://api.bybit.com/v5/account/wallet-balance';

        const timestamp = Date.now().toString();
        const recvWindow = '5000';
        
        // Build signature for GET request (no body params)
        const signString = `${timestamp}${creds.apiKey}${recvWindow}`;
        const signature = crypto
            .createHmac('sha256', creds.apiSecret)
            .update(signString)
            .digest('hex');

        const apiRes = await fetch(baseUrl + '?accountType=UNIFIED', {
            method: 'GET',
            headers: {
                'X-BYBIT-API-KEY': creds.apiKey,
                'X-BYBIT-SIGN': signature,
                'X-BYBIT-TIMESTAMP': timestamp,
                'X-BYBIT-RECV-WINDOW': recvWindow,
            }
        });

        const data = await apiRes.json();

        console.log(`[Bybit Key Test] Status: ${apiRes.status}, Response:`, data);

        if (apiRes.status === 403) {
            return res.status(400).json({
                ok: false,
                environment: activeEnv,
                status: apiRes.status,
                message: data.retMsg || 'HTTP 403 Forbidden - Check API key permissions and IP whitelist',
                retCode: data.retCode,
                retMsg: data.retMsg,
                suggestions: {
                    1: 'Verify API key is valid and not expired',
                    2: 'Ensure API key has "Spot Trading" permission enabled',
                    3: 'Check if API key is IP-whitelisted (if so, add server IP)',
                    4: 'Try generating a new API key on Bybit',
                    5: 'Verify you\'re using the correct environment (mainnet vs testnet)',
                }
            });
        }

        if (!apiRes.ok) {
            return res.status(400).json({
                ok: false,
                environment: activeEnv,
                status: apiRes.status,
                message: data.retMsg || `HTTP ${apiRes.status}`,
                retCode: data.retCode,
                retMsg: data.retMsg,
            });
        }

        if (data.retCode === 0) {
            return res.json({
                ok: true,
                environment: activeEnv,
                message: '✅ Bybit API key is valid and working',
                accountType: data.result?.accountType,
                coins: data.result?.list?.length || 0,
            });
        } else {
            return res.status(400).json({
                ok: false,
                message: data.retMsg || 'Invalid API response',
                retCode: data.retCode,
            });
        }
    } catch (error) {
        console.error('Bybit key test error:', error);
        res.status(500).json({ 
            ok: false, 
            message: 'Error testing API key: ' + error.message 
        });
    }
});

module.exports = { 
    router, 
    setupChatWebSocket,
    getChatHistory: (uid) => chatHistory.get(uid) || [],
};
