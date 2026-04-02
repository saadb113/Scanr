/**
 * chatbot.js - Floating AI Chatbot Widget Controller
 * Handles all interactions with the chatbot UI and backend
 */

class ScanrChatbot {
    constructor(io) {
        this.io = io;
        this.socket = null;
        this.isOpen = false;
        this.messages = [];
        this.isLoading = false;
        this.unreadCount = 0;
        this.init();
    }

    init() {
        // Socket.io connection
        if (typeof io !== 'undefined') {
            try {
                this.socket = this.io();
                
                // Log connection status
                this.socket.on('connect', () => {
                    console.log('✓ Chatbot socket connected:', this.socket.id);
                });
                
                this.socket.on('disconnect', () => {
                    console.log('✗ Chatbot socket disconnected');
                });
                
                this.socket.on('connect_error', (error) => {
                    console.error('✗ Chatbot connection error:', error);
                });
            } catch (error) {
                console.error('Failed to initialize socket:', error);
            }
        } else {
            console.warn('Socket.io not available for chatbot');
        }

        this.cacheElements();
        this.attachEventListeners();
        this.loadChatHistory();
    }

    cacheElements() {
        this.widget = document.getElementById('ai-chatbot-widget');
        this.toggle = document.getElementById('chatbot-toggle');
        this.window = document.getElementById('chatbot-window');
        this.messagesContainer = document.getElementById('chatbot-messages');
        this.input = document.getElementById('chatbot-input');
        this.sendBtn = document.getElementById('chatbot-send');
        this.clearBtn = document.getElementById('chatbot-clear');
        this.minimizeBtn = document.getElementById('chatbot-minimize');
        this.unreadBadge = document.getElementById('chatbot-unread-badge');
        this.loadingIndicator = document.getElementById('chatbot-loading');
    }

    attachEventListeners() {
        // Toggle window
        this.toggle.addEventListener('click', () => this.toggleWindow());
        
        // Send message
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Clear chat
        this.clearBtn.addEventListener('click', () => this.clearChat());

        // Minimize
        this.minimizeBtn.addEventListener('click', () => this.toggleWindow());

        // Quick buttons
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.input.value = e.target.dataset.query;
                this.input.focus();
            });
        });

        // Socket listeners
        if (this.socket) {
            this.socket.on('chat:user', (data) => {
                this.addMessage('user', data.message, data.timestamp);
                // DON'T clear loading state yet - wait for assistant response
            });

            this.socket.on('chat:assistant', (data) => {
                // Use the same response handling as HTTP
                this.handleChatResponse(data);
                this.markAsRead();
            });

            this.socket.on('chat:error', (data) => {
                this.addMessage('assistant', `⚠️ ${data.message}`, data.timestamp);
                this.clearLoadingState();
            });

            this.socket.on('chat:history', (messages) => {
                this.messages = (messages || []).map(m => ({
                    ...m,
                    content: m.role === 'assistant'
                        ? this.normalizeAssistantContent(m.content)
                        : String(m.content ?? ''),
                }));
                this.renderMessages();
            });

            this.socket.on('chat:cleared', () => {
                this.messages = [];
                this.renderMessages();
                this.showWelcome();
            });
        }
    }

    toggleWindow() {
        this.isOpen = !this.isOpen;
        if (this.isOpen) {
            this.window.style.display = 'flex';
            this.input.focus();
            this.markAsRead();
        } else {
            this.window.style.display = 'none';
        }
    }

    async sendMessage() {
        const message = this.input.value.trim();
        if (!message) return;

        this.input.value = '';
        this.input.placeholder = 'Thinking...';
        this.disableInput();
        this.showLoadingState();

        // Don't add user message here - let the server echo it back via 'chat:user' event
        // This prevents duplicate messages

        // Send via Socket.io if available, otherwise via HTTP
        if (this.socket && this.socket.connected) {
            console.log('📤 Sending via Socket.io...');
            this.socket.emit('chat:send', { message });
        } else {
            console.log('📤 Sending via HTTP...');
            // Fallback to HTTP
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message }),
                });

                const data = await response.json();
                console.log('📡 API response:', data);
                
                if (response.ok && data.ok) {
                    // Parse the response to extract message and action
                    this.handleChatResponse(data);
                } else if (data.ok) {
                    this.handleChatResponse(data);
                } else {
                    console.error('✗ Response not ok:', data);
                    this.addMessage('assistant', '⚠️ Unable to process your message. Please try again.');
                }
            } catch (error) {
                console.error('✗ Chat error:', error);
                this.addMessage('assistant', '⚠️ Connection error. Please check your connection and try again.');
            }
            this.clearLoadingState();
        }

        this.input.placeholder = 'Ask me anything about Scanr...';
        this.enableInput();
    }

    async handleChatResponse(data) {
        try {
            // Parse the message from data
            let chatData = data.message;
            
            // If the message is a JSON string, parse it
            if (typeof chatData === 'string') {
                // Clean up markdown code blocks if present
                let cleaned = chatData
                    .replace(/```json/g, '')
                    .replace(/```/g, '')
                    .trim();
                
                try {
                    chatData = JSON.parse(cleaned);
                } catch (parseError) {
                    // Attempt to recover JSON object if model adds extra text around it
                    const firstBrace = cleaned.indexOf('{');
                    const lastBrace = cleaned.lastIndexOf('}');
                    if (firstBrace !== -1 && lastBrace > firstBrace) {
                        const jsonCandidate = cleaned.slice(firstBrace, lastBrace + 1);
                        try {
                            chatData = JSON.parse(jsonCandidate);
                        } catch (innerParseError) {
                            // keep fallback behavior below
                        }
                    }
                }

                if (typeof chatData === 'string') {
                    // If it's not JSON, display as plain text and still execute backend action if available
                    console.log('📝 Plain text response (not JSON)');
                    this.addMessage('assistant', data.message, data.timestamp);
                    const fallbackAction = this.resolveIncomingAction(data, null);
                    if (fallbackAction && fallbackAction.type && fallbackAction.type !== 'none') {
                        console.log(`🎯 Executing fallback action: ${fallbackAction.type}`);
                        await this.executeAction(fallbackAction);
                    }
                    this.clearLoadingState();
                    return;
                }
            }

            // Extract message and action from parsed data
            const displayMessage = chatData.message || chatData.reply || 'No message';
            const action = this.resolveIncomingAction(data, chatData);

            console.log('✅ Parsed action:', action);
            
            // Display the message
            this.addMessage('assistant', displayMessage, data.timestamp);
            
            // Execute the action if present and not 'none'
            if (action && action.type && action.type !== 'none') {
                console.log(`🎯 Executing action: ${action.type}`);
                await this.executeAction(action);
            }
            
            this.clearLoadingState();
        } catch (error) {
            console.error('❌ Error handling response:', error);
            this.addMessage('assistant', '⚠️ Error processing response');
            this.clearLoadingState();
        }
    }

    resolveIncomingAction(data, chatData) {
        // Priority: backend computed action -> model JSON action -> first command fallback
        if (data && data.action && data.action.type) {
            return this.withCloseActionOverride(data.action, data, chatData);
        }
        if (chatData && chatData.action && chatData.action.type) {
            return this.withCloseActionOverride(chatData.action, data, chatData);
        }
        if (data && Array.isArray(data.commands) && data.commands.length > 0) {
            const first = data.commands[0];
            return this.withCloseActionOverride({ type: first.type, payload: first.payload || first }, data, chatData);
        }
        return { type: 'none' };
    }

    withCloseActionOverride(action, data, chatData) {
        if (!action || !action.type) return { type: 'none' };

        const rawText = [
            typeof data?.message === 'string' ? data.message : '',
            typeof chatData?.message === 'string' ? chatData.message : '',
        ].join(' ');

        const closeIntent = /\b(close|closing|closed|exit|flatten|square\s*off|cloes)\b/i.test(rawText);
        if (closeIntent && action.type === 'placeTrade') {
            const srcSymbol = action?.payload?.symbol || chatData?.action?.payload?.symbol || null;
            return {
                type: 'closePosition',
                payload: {
                    symbol: srcSymbol || null,
                    closeAll: /\ball\b/i.test(rawText),
                },
            };
        }

        return action;
    }

    normalizeAssistantContent(content) {
        if (content == null) return '';
        if (typeof content === 'object') {
            return content.message || JSON.stringify(content);
        }

        if (typeof content === 'string') {
            const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
            if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
                try {
                    const parsed = JSON.parse(cleaned);
                    if (parsed && typeof parsed.message === 'string') return parsed.message;
                } catch (_) {
                    // keep original string
                }
            }
            return content;
        }

        return String(content);
    }

    normalizeTradePayload(rawTrade) {
        const t = rawTrade?.payload ? rawTrade.payload : rawTrade || {};

        let symbol = t.symbol || t.pair || 'BTC';
        symbol = String(symbol).toUpperCase().replace(/\s+/g, '');
        symbol = symbol.replace(/(PERP|PERPETUALS?|FUTURES?|SPOT|MARGIN)/g, '');
        if (!symbol.endsWith('USDT')) symbol = `${symbol}USDT`;

        let direction = (t.direction || t.side || 'BUY').toString().toUpperCase();
        if (!['BUY', 'SELL'].includes(direction)) direction = 'BUY';

        const size = Number(t.size ?? t.quantity ?? 1);
        const marketType = (t.marketType || 'spot').toString().toLowerCase();
        const orderType = (t.orderType || (String(t.entry || '').toLowerCase() === 'mkt' ? 'Market' : 'Limit')).toString();

        const entry = Number(t.entry ?? t.price ?? 0);
        const sl = Number(t.sl ?? t.stopLoss ?? 0);
        const tp = Number(t.tp ?? t.takeProfit ?? 0);

        return {
            symbol,
            direction,
            size: Number.isFinite(size) && size > 0 ? size : 1,
            marketType: ['spot', 'futures', 'margin'].includes(marketType) ? marketType : 'spot',
            orderType: /^market$/i.test(orderType) ? 'Market' : 'Limit',
            entry: Number.isFinite(entry) ? entry : 0,
            sl: Number.isFinite(sl) ? sl : 0,
            tp: Number.isFinite(tp) ? tp : 0,
        };
    }

    async executeAction(action) {
        console.log('🚀 Executing action:', action);
        
        switch (action.type) {
            case 'navigate':
                await this.executeNavigate(action);
                break;
            
            case 'runScanner':
                await this.executeRunScanner(action);
                break;
            
            case 'analyzeChart':
                await this.executeAnalyzeChart(action);
                break;
            
            case 'placeTrade':
                await this.executePlaceTrade(action);
                break;
            
            case 'askMarketType':
                await this.executeAskMarketType(action);
                break;

            case 'closePosition':
                await this.executeClosePosition(action);
                break;

            case 'fetchAccount':
                await this.executeFetchAccount(action);
                break;
            
            default:
                console.log('⚠️ Unknown action type:', action.type);
        }
    }

    async executeNavigate(action) {
        try {
            let url = action.payload?.url;
            if (!url) {
                console.error('❌ No URL in navigate action');
                return;
            }
            
            // Sanitize URL - remove /public/ prefix and .html extension if present
            url = url.replace(/^\/public\//i, '/').replace(/\.html$/i, '');
            if (!url.startsWith('/')) url = '/' + url;
            
            console.log(`📍 Navigating to: ${url}`);
            // Small delay so user can read the message
            await new Promise(resolve => setTimeout(resolve, 1000));
            window.location.href = url;
        } catch (error) {
            console.error('Navigate error:', error);
        }
    }

    async executeRunScanner(action) {
        try {
            console.log('🔍 Running scanner...');
            
            // Check if we're already on setups page
            if (window.location.pathname.includes('setups')) {
                // Click the run button
                const runBtn = document.getElementById('runScannerBtn');
                if (runBtn) {
                    runBtn.click();
                    this.addMessage('assistant', '✅ Scanner started!');
                } else {
                    this.addMessage('assistant', '⚠️ Could not find scanner button');
                }
            } else {
                // Navigate to setups page and run scanner
                sessionStorage.setItem('autoRunScanner', 'true');
                await new Promise(resolve => setTimeout(resolve, 500));
                window.location.href = '/setups';
            }
        } catch (error) {
            console.error('Run scanner error:', error);
            this.addMessage('assistant', '⚠️ Failed to run scanner');
        }
    }

    async executeAnalyzeChart(action) {
        try {
            const { symbol, timeframe } = action.payload || {};
            if (!symbol) {
                console.error('❌ No symbol for chart analysis');
                return;
            }
            
            console.log(`📊 Analyzing ${symbol} on ${timeframe || '4h'}`);
            
            const response = await fetch('/api/chat/analyze/chart', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    pair: symbol, 
                    timeframe: timeframe || '4h' 
                }),
            });
            
            const result = await response.json();
            if (response.ok && result.ok) {
                const analysis = result.analysis;
                const trend = (analysis.trend || 'neutral').toString();
                const direction = trend === 'uptrend' ? 'LONG' : trend === 'downtrend' ? 'SHORT' : trend.toUpperCase();
                const confidence = trend === 'uptrend' || trend === 'downtrend' ? 68 : 52;
                const reasoning = `Trend: ${analysis.trend || 'neutral'} | RSI: ${analysis.rsi || 'N/A'} | MACD: ${analysis.macd || 'N/A'} vs Signal: ${analysis.signal || 'N/A'} | Suggested action: ${analysis.action || 'hold'}`;
                
                // Format analysis response with structured layout
                const msg = `📊 **${symbol} (${timeframe || '4h'})**

📈 **Direction**: ${direction}
💰 **Entry**: Market
🛑 **Stop Loss**: Dynamic
🎯 **Take Profit**: Dynamic
📊 **RR Ratio**: Pending setup
🎪 **Confidence**: ${confidence}%

📝 **Reasoning**:
${reasoning}

⚠️ **Warnings**: ${analysis.warnings || 'None'}`;
                
                this.addMessage('assistant', msg);
            } else {
                this.addMessage('assistant', `⚠️ Analysis failed: ${result.message}`);
            }
        } catch (error) {
            console.error('Analyze chart error:', error);
            this.addMessage('assistant', '⚠️ Failed to analyze chart');
        }
    }

    async executePlaceTrade(action) {
        try {
            let trade = this.normalizeTradePayload(action.payload);
            if (!trade) {
                console.error('❌ No trade data');
                return;
            }

            // Auto-fill missing market prices for cleaner confirmation UX
            if (!trade.entry || trade.entry <= 0) {
                try {
                    const baseSymbol = trade.symbol.replace('USDT', '');
                    const r = await fetch('/api/chat/test/price', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symbol: baseSymbol }),
                    });
                    const d = await r.json();
                    const p = Number(d.price || 0);
                    if (p > 0) {
                        trade.entry = p;
                        trade.sl = trade.sl > 0 ? trade.sl : Number((p * 0.98).toFixed(2));
                        trade.tp = trade.tp > 0 ? trade.tp : Number((p * 1.03).toFixed(2));
                    }
                } catch (e) {
                    console.warn('Price enrichment failed:', e.message);
                }
            }
            
            console.log('💹 Showing trade confirmation:', trade);
            
            // Create and show trade confirmation card
            this.showTradeConfirmation(trade);
        } catch (error) {
            console.error('Place trade error:', error);
            this.addMessage('assistant', '⚠️ Failed to prepare trade');
        }
    }

    async executeAskMarketType(action) {
        try {
            const tradeData = this.normalizeTradePayload(action.payload);
            if (!tradeData) {
                console.error('❌ No trade data for market type selection');
                return;
            }
            
            console.log('📊 Asking for market type');
            
            // Create market type selection card
            const card = document.createElement('div');
            card.className = 'market-type-card';
            card.innerHTML = `
                <div class="confirm-header">💭 Which market would you like to trade?</div>
                <div class="market-type-buttons">
                    <button class="btn-market-type spot" onclick="window.scanrChatbot?.selectMarketType('spot', ${JSON.stringify(tradeData).replace(/"/g, '&quot;')})">
                        📊 Spot<br><small>Buy & hold coins</small>
                    </button>
                    <button class="btn-market-type futures" onclick="window.scanrChatbot?.selectMarketType('futures', ${JSON.stringify(tradeData).replace(/"/g, '&quot;')})">
                        📈 Futures<br><small>Leverage trading</small>
                    </button>
                    <button class="btn-market-type margin" onclick="window.scanrChatbot?.selectMarketType('margin', ${JSON.stringify(tradeData).replace(/"/g, '&quot;')})">
                        💳 Margin<br><small>Borrow & trade</small>
                    </button>
                </div>
            `;
            
            this.messagesContainer.appendChild(card);
            this.scrollToBottom();
        } catch (error) {
            console.error('Ask market type error:', error);
            this.addMessage('assistant', '⚠️ Failed to ask market type');
        }
    }

    async executeClosePosition(action) {
        try {
            const payload = action?.payload || {};
            const symbol = payload.symbol || null;
            const closeAll = !!payload.closeAll;

            this.addMessage(
                'assistant',
                closeAll
                    ? `⏳ Closing all open positions${symbol ? ` for ${symbol}` : ''}...`
                    : `⏳ Closing open position${symbol ? ` for ${symbol}` : ''}...`
            );

            const response = await fetch('/api/chat/position/close', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symbol, closeAll }),
            });

            const result = await response.json();
            if (response.ok && result.ok) {
                this.addMessage('assistant', `✅ ${result.message}`);

                // Verify position state after close to avoid false-positive confirmations
                try {
                    await new Promise(resolve => setTimeout(resolve, 1200));
                    const verifyRes = await fetch('/api/dashboard/futures-positions', { credentials: 'include' });
                    const verifyJson = await verifyRes.json();
                    const open = (verifyJson?.positions || []).filter(p => Number(p.size) > 0);

                    if (closeAll && open.length > 0) {
                        this.addMessage('assistant', `⚠️ ${open.length} position(s) are still open after close request.`);
                    } else if (!closeAll && symbol) {
                        const sym = String(symbol).toUpperCase();
                        const stillOpen = open.some(p => String(p.symbol).toUpperCase() === sym);
                        if (stillOpen) {
                            this.addMessage('assistant', `⚠️ ${sym} is still open. The close request was sent but not fully closed yet.`);
                        }
                    }
                } catch (verifyErr) {
                    console.warn('Close verification failed:', verifyErr.message);
                }
            } else {
                this.addMessage('assistant', `❌ Close failed: ${result.message || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Close position error:', error);
            this.addMessage('assistant', '⚠️ Failed to close position');
        }
    }

    async executeFetchAccount(action) {
        try {
            const payload = action?.payload || {};
            const includeBalance = payload.includeBalance !== false;
            const includeAssets = payload.includeAssets !== false;
            const includePositions = !!payload.includePositions;
            const includeOrders = !!payload.includeOrders;

            this.addMessage('assistant', '⏳ Fetching your account data...');

            const calls = [];
            if (includeBalance) calls.push(fetch('/api/dashboard/summary', { credentials: 'include' }).then(r => r.json()).then(d => ({ key: 'summary', data: d })));
            if (includeAssets) calls.push(fetch('/api/dashboard/spot-assets', { credentials: 'include' }).then(r => r.json()).then(d => ({ key: 'assets', data: d })));
            if (includePositions) calls.push(fetch('/api/dashboard/futures-positions', { credentials: 'include' }).then(r => r.json()).then(d => ({ key: 'positions', data: d })));
            if (includeOrders) calls.push(fetch('/api/dashboard/orders', { credentials: 'include' }).then(r => r.json()).then(d => ({ key: 'orders', data: d })));

            const results = await Promise.all(calls);
            const map = {};
            results.forEach(r => { map[r.key] = r.data; });

            const lines = ['📊 **Account Snapshot**'];

            if (map.summary?.balance) {
                const b = map.summary.balance;
                lines.push(`💰 **Balance**: Available $${Number(b.available || 0).toFixed(2)} | Total $${Number(b.total || 0).toFixed(2)} (${b.mode || 'mainnet'})`);
            }

            if (map.assets?.coins) {
                const coins = map.assets.coins;
                if (coins.length === 0) {
                    lines.push('🪙 **Assets**: No spot assets found');
                } else {
                    const top = coins
                        .map(c => ({ coin: c.coin, usd: Number(c.usdValue || 0) }))
                        .sort((a, b) => b.usd - a.usd)
                        .slice(0, 8)
                        .map(c => `${c.coin} ($${c.usd.toFixed(2)})`)
                        .join(', ');
                    lines.push(`🪙 **Assets**: ${top}`);
                }
            }

            if (map.positions?.positions) {
                const positions = map.positions.positions || [];
                lines.push(`📈 **Open Positions**: ${positions.length}`);
            }

            if (map.orders?.orders) {
                const orders = map.orders.orders || [];
                lines.push(`📋 **Open Orders**: ${orders.length}`);
            }

            this.addMessage('assistant', lines.join('\n'));
        } catch (error) {
            console.error('Fetch account error:', error);
            this.addMessage('assistant', `⚠️ Failed to fetch account data: ${error.message}`);
        }
    }

    selectMarketType(marketType, tradeData) {
        try {
            console.log(`✅ Selected market: ${marketType}`);
            
            // Add market type to trade data
            tradeData.marketType = marketType;
            
            // Show confirmation with market type
            const marketLabels = {
                spot: '📊 Spot',
                futures: '📈 Futures',
                margin: '💳 Margin'
            };
            
            // Remove the market type selection buttons
            const card = this.messagesContainer.querySelector('.market-type-card');
            if (card) card.remove();
            
            // Show selected market type
            this.addMessage('assistant', `${marketLabels[marketType]} market selected ✅`);
            
            // Show the trade confirmation
            this.showTradeConfirmation(tradeData);
        } catch (error) {
            console.error('Select market type error:', error);
            this.addMessage('assistant', '⚠️ Failed to select market type');
        }
    }

    showTradeConfirmation(trade) {
        // Create confirmation card
        const marketLabels = {
            spot: '📊 Spot',
            futures: '📈 Futures',
            margin: '💳 Margin'
        };
        
        const marketType = trade.marketType || 'spot';
        const marketLabel = marketLabels[marketType] || 'Spot';
        const entryLabel = Number(trade.entry) > 0 ? `$${trade.entry}` : 'Market';
        const slLabel = Number(trade.sl) > 0 ? `$${trade.sl}` : 'Auto';
        const tpLabel = Number(trade.tp) > 0 ? `$${trade.tp}` : 'Auto';
        
        const card = document.createElement('div');
        card.className = 'trade-confirm-card';
        card.innerHTML = `
            <div class="confirm-header">⚠️ Confirm Trade</div>
            <div class="confirm-details">
                <div><strong>${trade.symbol} ${trade.direction}</strong></div>
                <div>Market: ${marketLabel}</div>
                <div>Entry: ${entryLabel}</div>
                <div>SL: ${slLabel} | TP: ${tpLabel}</div>
                <div>Size: ${trade.size}</div>
            </div>
            <div class="confirm-buttons">
                <button class="btn-confirm" onclick="window.scanrChatbot?.confirmTrade(${JSON.stringify(trade).replace(/"/g, '&quot;')})">✅ Confirm</button>
                <button class="btn-cancel" onclick="window.scanrChatbot?.cancelTrade()">❌ Cancel</button>
            </div>
        `;
        
        this.messagesContainer.appendChild(card);
        this.scrollToBottom();
    }

    async confirmTrade(trade) {
        try {
            console.log('💳 Confirming trade:', trade);
            
            const response = await fetch('/api/chat/trade/execute', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(trade),
            });
            
            const result = await response.json();
            if (response.ok && result.ok) {
                this.addMessage('assistant', 
                    `✅ Order placed!\n${trade.symbol} ${trade.direction} @ $${trade.entry}`);
            } else {
                this.addMessage('assistant', 
                    `❌ Order failed: ${result.message || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('Confirm trade error:', error);
            this.addMessage('assistant', '⚠️ Failed to place trade');
        }
    }

    cancelTrade() {
        this.addMessage('assistant', '❌ Trade cancelled');
    }

    addMessage(role, content, timestamp = null) {
        const normalizedContent = role === 'assistant'
            ? this.normalizeAssistantContent(content)
            : String(content ?? '');

        const msg = {
            role,
            content: normalizedContent,
            timestamp: timestamp || new Date().toISOString(),
        };

        // Remove welcome message when first real message arrives
        if (this.messages.length === 0 && role === 'user') {
            this.messagesContainer.innerHTML = '';
        }

        this.messages.push(msg);
        this.renderMessage(msg);
        this.ensureTypingAtBottom();
        this.scrollToBottom();

        // Show unread badge if chat is closed
        if (!this.isOpen && role === 'assistant') {
            this.unreadCount++;
            this.updateUnreadBadge();
        }
    }

    renderMessage(msg) {
        const msgEl = document.createElement('div');
        msgEl.className = `chatbot-message ${msg.role}`;
        
        const contentEl = document.createElement('div');
        contentEl.className = `message-content ${msg.role}`;
        contentEl.textContent = msg.content;
        
        // Format links in assistant messages
        if (msg.role === 'assistant') {
            contentEl.innerHTML = this.formatMessage(msg.content);
        }

        msgEl.appendChild(contentEl);

        const timeEl = document.createElement('div');
        timeEl.className = 'message-timestamp';
        timeEl.textContent = this.formatTime(msg.timestamp);
        msgEl.appendChild(timeEl);

        this.messagesContainer.appendChild(msgEl);
    }

    renderMessages() {
        this.messagesContainer.innerHTML = '';
        if (this.messages.length === 0) {
            this.showWelcome();
        } else {
            this.messages.forEach(msg => this.renderMessage(msg));
        }
        this.ensureTypingAtBottom();
        this.scrollToBottom();
    }

    showWelcome() {
        this.messagesContainer.innerHTML = `
            <div class="chatbot-welcome">
                <div class="welcome-icon">👋</div>
                <h3>Welcome to Scanr AI!</h3>
                <p>Ask me about trading strategies, platform features, risk management, or technical analysis.</p>
                <div class="quick-buttons">
                    <button class="quick-btn" data-query="How do I use the autonomous agent?">Agent Help</button>
                    <button class="quick-btn" data-query="What are the best risk management practices?">Risk Mgmt</button>
                    <button class="quick-btn" data-query="Explain RSI and MACD signals">Indicators</button>
                </div>
            </div>
        `;

        // Re-attach quick button listeners
        document.querySelectorAll('.quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.input.value = e.target.dataset.query;
                this.input.focus();
            });
        });
    }

    showLoadingState() {
        this.isLoading = true;
        this.clearLoadingState();
        // Show typing animation
        const typingEl = document.createElement('div');
        typingEl.className = 'chatbot-message assistant typing-indicator';
        typingEl.id = 'typing-indicator';
        typingEl.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
        this.messagesContainer.appendChild(typingEl);
        this.scrollToBottom();
    }

    clearLoadingState() {
        this.isLoading = false;
        // Remove typing indicator
        const typingEl = document.getElementById('typing-indicator');
        if (typingEl) {
            typingEl.remove();
        }
    }

    ensureTypingAtBottom() {
        const typingEl = document.getElementById('typing-indicator');
        if (!typingEl || !this.messagesContainer) return;
        this.messagesContainer.appendChild(typingEl);
    }

    async clearChat() {
        if (confirm('Clear all chat history?')) {
            if (this.socket && this.socket.connected) {
                this.socket.emit('chat:clear');
            } else {
                try {
                    await fetch('/api/chat/history/clear', { method: 'POST' });
                    this.messages = [];
                    this.renderMessages();
                    this.showWelcome();
                } catch (error) {
                    console.error('Clear error:', error);
                }
            }
        }
    }

    async loadChatHistory() {
        if (this.socket) {
            this.socket.emit('chat:request-history');
        } else {
            try {
                const response = await fetch('/api/chat/history');
                if (response.ok) {
                    const data = await response.json();
                    if (data.ok) {
                        this.messages = (data.messages || []).map(m => ({
                            ...m,
                            content: m.role === 'assistant'
                                ? this.normalizeAssistantContent(m.content)
                                : String(m.content ?? ''),
                        }));
                        this.renderMessages();
                    }
                }
            } catch (error) {
                console.error('Load history error:', error);
            }
        }
    }

    disableInput() {
        this.input.disabled = true;
        this.sendBtn.disabled = true;
    }

    enableInput() {
        this.input.disabled = false;
        this.sendBtn.disabled = false;
    }

    markAsRead() {
        this.unreadCount = 0;
        this.updateUnreadBadge();
    }

    updateUnreadBadge() {
        if (this.unreadCount > 0) {
            this.unreadBadge.textContent = this.unreadCount > 9 ? '9+' : this.unreadCount;
            this.unreadBadge.style.display = 'flex';
        } else {
            this.unreadBadge.style.display = 'none';
        }
    }

    scrollToBottom() {
        setTimeout(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }, 0);
    }

    formatMessage(text) {
        // Convert URLs to links
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        let formatted = text.replace(urlRegex, '<a href="$1" target="_blank" style="color: #667eea; text-decoration: underline;">$1</a>');
        
        // Convert markdown-style formatting
        formatted = formatted
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
        
        return formatted;
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) return 'Now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return date.toLocaleDateString();
    }
}

// Initialize chatbot when document is ready
document.addEventListener('DOMContentLoaded', () => {
    if (typeof io !== 'undefined') {
        window.scanrChatbot = new ScanrChatbot(io);
    }
});
