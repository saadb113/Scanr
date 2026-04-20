const { Settings, AppSettings } = require('./models');

let isPolling = false;
let pollingTimer = null;
let currentToken = null;
let botUsername = null;

async function fetchBotMe(token) {
    try {
        const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const j = await r.json();
        if (j.ok) return j.result.username;
    } catch(e) {}
    return null;
}

async function startTelegramPolling() {
    if (isPolling) return;
    
    const doc = await AppSettings.findOne({ key: 'telegramBotToken' }).lean();
    const token = doc?.value || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.log('[Telegram] No Bot Token configured in AppSettings or .env');
        return;
    }

    currentToken = token;
    botUsername = await fetchBotMe(token);
    console.log(`[Telegram] Polling started for @${botUsername || 'UnknownBot'}`);
    isPolling = true;

    let offset = 0;
    
    pollingTimer = setInterval(async () => {
        try {
            const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=5`);
            const j = await r.json();
            if (j.ok && j.result.length > 0) {
                for (const update of j.result) {
                    offset = update.update_id + 1;
                    if (update.message && update.message.text) {
                        const text = update.message.text;
                        const chatId = update.message.chat.id;
                        
                        if (text.startsWith('/start user_')) {
                            const userId = text.split('user_')[1];
                            console.log(`[Telegram] Linking Chat ${chatId} to User ${userId}`);
                            
                            try {
                                await Settings.findOneAndUpdate(
                                    { userId: userId },
                                    { $set: { 'telegram.chatId': chatId.toString() } },
                                    { upsert: true }
                                );
                                
                                await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        chat_id: chatId,
                                        text: '✅ Scanr Alerts connected successfully!\n\nYou will now receive selected notifications here.'
                                    })
                                });
                            } catch (err) {
                                console.error('[Telegram] Error linking user:', err.message);
                            }
                        }
                    }
                }
            }
        } catch(e) {
            // silent fail on network errors
        }
    }, 3000);
}

function stopTelegramPolling() {
    if (pollingTimer) clearInterval(pollingTimer);
    isPolling = false;
    currentToken = null;
    botUsername = null;
}

function getBotUsername() { return botUsername; }
function getBotToken() { return currentToken; }

module.exports = { startTelegramPolling, stopTelegramPolling, getBotUsername, getBotToken };
