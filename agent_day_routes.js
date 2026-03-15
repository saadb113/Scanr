'use strict';

const express     = require('express');
const router      = express.Router();
const agent       = require('./dayAgent');
const notifier    = require('./notifier');
const { AgentSettings, AgentSession, AgentTrade, AppSettings } = require('./models');

// ── Start / Stop ──────────────────────────────────────────────

router.post('/start', async (req, res) => {
    const result = await agent.startAgent(req.session.userId);
    res.json(result);
});

router.post('/stop', async (req, res) => {
    const result = await agent.stopAgent('manual');
    res.json(result);
});

// ── Status ────────────────────────────────────────────────────

router.get('/status', (req, res) => {
    res.json(agent.getStatus());
});

// ── Settings ──────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
    try {
        const s = await AgentSettings.findOne({ userId: req.session.userId }).lean();
        res.json({ ok: true, settings: s || {} });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/settings', async (req, res) => {
    try {
        const body = req.body;
        // strip any fields that could be used for injection
        const allowed = [
            'startTime','endTime','maxTrades','scanInterval','cooldownMinutes','minScore',
            'basePositionSize','maxLossPerTradePct','dailyDrawdownPct','maxConsecutiveLosses',
            'minVolume','atrMin','atrMax','timeframe','customCoins','emailRecipient',
            'notifyOnAgentShutdown','notifyOnTradePlaced','notifyOnTradeClosed','notifyOnDailySummary',
        ];
        const update = {};
        for (const k of allowed) { if (body[k] !== undefined) update[k] = body[k]; }
        const s = await AgentSettings.findOneAndUpdate(
            { userId: req.session.userId }, { $set: update }, { upsert: true, new: true }
        );
        res.json({ ok: true, settings: s });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── Test Email ────────────────────────────────────────────────

router.post('/test-email', async (req, res) => {
    try {
        const settings  = await AgentSettings.findOne({ userId: req.session.userId }).lean();
        const recipient = settings?.emailRecipient || process.env.EMAIL_RECIPIENT;
        if (!recipient) return res.status(400).json({ ok: false, error: 'No email recipient configured in Agent settings or .env' });
        const appNameDoc = await AppSettings.findOne({ key: 'appName' }).lean();
        const appName    = appNameDoc?.value || 'Agent';
        await notifier.sendEmail(
            `🤖 ${appName} Agent — Test Email`,
            `Test message sent at ${new Date().toLocaleTimeString('en-US', { hour12: false })} PST.\nEmail notifications are working correctly.`,
            recipient
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ── History ───────────────────────────────────────────────────

router.get('/history', async (req, res) => {
    try {
        const limit    = Math.min(parseInt(req.query.limit) || 30, 100);
        const sessions = await AgentSession.find({ userId: req.session.userId })
            .sort({ date: -1 })
            .limit(limit)
            .lean();
        res.json({ ok: true, sessions });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/history/:sessionId', async (req, res) => {
    try {
        const sessionId = req.params.sessionId.replace(/[^a-f0-9]/gi, '');
        const trades    = await AgentTrade.find({ sessionId, userId: req.session.userId })
            .sort({ openedAt: 1 })
            .lean();
        res.json({ ok: true, trades });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/today', async (req, res) => {
    try {
        const status = agent.getStatus();
        if (!status.sessionId) return res.json({ ok: true, trades: [] });
        const trades = await AgentTrade.find({ sessionId: status.sessionId, userId: req.session.userId })
            .sort({ openedAt: 1 })
            .lean();
        res.json({ ok: true, trades });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
