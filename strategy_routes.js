'use strict';

const express    = require('express');
const router     = express.Router();
const bot        = require('./strategyBot');
const { Strategy, BotTrade } = require('./models');

// GET /api/strategy — all strategies for user
router.get('/', async (req, res) => {
    try {
        const list = await Strategy.find({ userId: req.session.userId }).sort({ updatedAt: -1 }).lean();
        res.json({ ok: true, strategies: list });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Note: specific named routes must come before /:id
// GET /api/strategy/bot/status
router.get('/bot/status', (req, res) => {
    res.json({ ok: true, ...bot.getStatus(req.session.userId) });
});

// GET /api/strategy/bot/log
router.get('/bot/log', (req, res) => {
    res.json({ ok: true, logs: bot.getLogs(req.session.userId) });
});

// POST /api/strategy — create new
router.post('/', async (req, res) => {
    try {
        const { name, blocks, pineScript, coins, timeframe, scanInterval, maxTradesPerDay } = req.body;
        const s = await Strategy.create({
            userId: req.session.userId,
            name: name || 'My Strategy',
            blocks: blocks || { filters: [], conditions: [], actions: [] },
            pineScript: pineScript || '',
            coins: coins || [],
            timeframe: timeframe || '5m',
            scanInterval: scanInterval || 30,
            maxTradesPerDay: maxTradesPerDay || 3,
        });
        res.json({ ok: true, strategy: s });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PUT /api/strategy/:id — update
router.put('/:id', async (req, res) => {
    try {
        const s = await Strategy.findOneAndUpdate(
            { _id: req.params.id, userId: req.session.userId },
            { $set: req.body },
            { new: true }
        );
        if (!s) return res.status(404).json({ ok: false, error: 'Not found' });
        res.json({ ok: true, strategy: s });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE /api/strategy/:id
router.delete('/:id', async (req, res) => {
    try {
        const s = await Strategy.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
        if (!s) return res.status(404).json({ ok: false, error: 'Not found' });
        if (s.isActive) await bot.stopBot(req.session.userId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/strategy/:id/activate — start bot
router.post('/:id/activate', async (req, res) => {
    try {
        const s = await Strategy.findOne({ _id: req.params.id, userId: req.session.userId }).lean();
        if (!s) return res.status(404).json({ ok: false, error: 'Not found' });
        const result = await bot.startBot(req.session.userId, req.params.id);
        res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/strategy/:id/stop — stop bot
router.post('/:id/stop', async (req, res) => {
    try {
        const result = await bot.stopBot(req.session.userId);
        res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET /api/strategy/:id/trades — bot trade history
router.get('/:id/trades', async (req, res) => {
    try {
        const trades = await BotTrade.find({
            userId: req.session.userId,
            strategyId: req.params.id,
        }).sort({ openedAt: -1 }).limit(200).lean();
        res.json({ ok: true, trades });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
