// Test command detection

function detectCommands(userMessage, aiResponse) {
    const commands = [];
    const msg = userMessage.toLowerCase();
    const response = (aiResponse || '').toLowerCase();
    
    console.log(`🔍 Detecting commands from: "${msg}"`);
    
    // Parse pairs: BTC/USDT, BTCUSDT, bitcoin, etc.
    const pairPatterns = [
        /\b([a-z]+)(\/)?usdt\b/gi,
        /\b(btc|eth|bnb|sol|ada|xrp|doge|link|api3|avax|matic|bitcoin|ethereum)\b/gi
    ];
    
    let pairs = [];
    pairPatterns.forEach(pattern => {
        let matches = userMessage.match(pattern);
        if (matches) pairs.push(...matches);
    });
    pairs = [...new Set(pairs.map(p => p.toUpperCase().replace('/', '')))];
    console.log(`pairs found: ${pairs.join(', ')}`);
    
    // Command 1: NAVIGATE - "go to", "navigate", "open", "show", "take me to"
    if (msg.includes('go to') || msg.includes('navigate') || msg.includes('open') || msg.includes('show me') || msg.includes('take me')) {
        const pageKeywords = {
            'dashboard': 'dashboard',
            'agent': 'agent',
            'strategy': 'strategy',
            'terminal': 'terminal',
            'settings': 'settings',
            'challenge': 'challenge',
            'home': 'home',
            'index': 'home',
        };
        
        for (const [keyword, page] of Object.entries(pageKeywords)) {
            if (msg.includes(keyword)) {
                console.log(`✅ Navigate command detected: ${page}`);
                commands.push({
                    type: 'navigate',
                    page: page,
                    description: `Navigate to ${page} page`
                });
                break;
            }
        }
    }
    
    // Command 2: TRADE - "buy", "sell", "short", "long", "take", "execute", "place"
    if ((msg.includes('buy') || msg.includes('sell') || msg.includes('short') || msg.includes('long') || msg.includes('take') || msg.includes('execute') || msg.includes('place')) && pairs.length > 0) {
        const side = msg.includes('sell') || msg.includes('short') ? 'sell' : 'buy';
        const pair = pairs[0]; // Use first detected pair
        
        // Extract quantity if provided
        const qtyMatch = userMessage.match(/(\d+(?:\.\d+)?)\s*(btc|eth|bnb|coins?|position)?/i);
        const quantity = qtyMatch ? parseFloat(qtyMatch[1]) : 1;
        
        // Extract stop loss and take profit if provided
        const slMatch = userMessage.match(/stop\s*(?:loss)?:?\s*\$?(\d+(?:\.\d+)?)/i);
        const tpMatch = userMessage.match(/take\s*profit:?\s*\$?(\d+(?:\.\d+)?)/i);
        
        console.log(`✅ Trade command detected: ${side.toUpperCase()} ${pair}`);
        commands.push({
            type: 'trade',
            action: 'take',
            pair: pair,
            side: side,
            quantity: quantity,
            stopLoss: slMatch ? parseFloat(slMatch[1]) : null,
            takeProfit: tpMatch ? parseFloat(tpMatch[1]) : null,
            description: `${side.toUpperCase()} ${quantity} ${pair}`
        });
    }
    
    // Command 3: ANALYZE_CHART - "analyze", "analysis", "think about", "review", "check"
    if ((msg.includes('analyze') || msg.includes('analysis') || msg.includes('think') || msg.includes('review') || msg.includes('check')) && pairs.length > 0) {
        const pair = pairs[0];
        
        // Extract timeframe if provided
        const tfMatch = userMessage.match(/(1m|5m|15m|30m|1h|2h|4h|6h|12h|1d|1w)/i);
        const timeframe = tfMatch ? tfMatch[1] : '4h';
        
        console.log(`✅ Chart analysis command detected: ${pair} (${timeframe})`);
        commands.push({
            type: 'analyze_chart',
            pair: pair,
            timeframe: timeframe,
            description: `Analyze ${pair} on ${timeframe} chart`
        });
    }
    
    console.log(`📋 Total commands detected: ${commands.length}`);
    return commands;
}

// Test cases
console.log('\n=== TEST 1: Navigate ===');
let cmds = detectCommands('open dashboard', '');
console.log('Result:', JSON.stringify(cmds, null, 2));

console.log('\n=== TEST 2: Trade ===');
cmds = detectCommands('buy bitcoin at 50000', '');
console.log('Result:', JSON.stringify(cmds, null, 2));

console.log('\n=== TEST 3: Chart Analysis ===');
cmds = detectCommands('analyze BTCUSDT on 4h', '');
console.log('Result:', JSON.stringify(cmds, null, 2));

console.log('\n=== TEST 4: Go to terminal ===');
cmds = detectCommands('go to terminal', '');
console.log('Result:', JSON.stringify(cmds, null, 2));

console.log('\n=== TEST 5: Sell ETH ===');
cmds = detectCommands('sell ethereum with stop loss 100', '');
console.log('Result:', JSON.stringify(cmds, null, 2));
