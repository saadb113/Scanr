require('dotenv').config();

const express  = require('express');
const http     = require('http');
const path     = require('path');
const session  = require('express-session');
const bcrypt   = require('bcrypt');
const multer   = require('multer');
const { Server } = require('socket.io');
const { connectDB } = require('./db');
const mongoose = require('mongoose');
const {
    User, License, AppSettings, Payment,
    Settings, Watchlist, FilterVis, PosSettings,
    Drawings, KimiSettings, KimiCache, BybitStore,
    FundedChallenge, ChallengeTrade, Contact,
    Strategy, BotTrade, PriceAlert,
} = require('./models');
const autopilot      = require('./autopilot');
const strategyRoutes = require('./strategy_routes');
const strategyBot    = require('./strategyBot');
const setupsScanner  = require('./setups_routes');
const { sendDiscordAlert, orderSummaryEmbed, priceAlertEmbed, newRegistrationEmbed, newContactEmbed, newPaymentSubmissionEmbed } = require('./discordNotifier');
const { analyzeWithAI, testAIProvider }                        = require('./aiAnalysis');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });
strategyBot.setIO(io);
const PORT  = process.env.PORT || 3000;
const USER  = 'default';

app.use(express.json({ limit: '4mb' }));
const sessionMW = session({
    secret:            process.env.SESSION_SECRET || 'SCANR-fallback-secret',
    resave:            false,
    saveUninitialized: false,
    cookie:            { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true },
});
app.use(sessionMW);

// Share express-session with Socket.io so sockets know their userId
io.use((socket, next) => {
    const mockRes = { getHeader:()=>{}, setHeader:()=>{}, end:()=>{}, writeHead:()=>{}, on:()=>{}, once:()=>{}, removeListener:()=>{} };
    sessionMW(socket.request, mockRes, next);
});
io.on('connection', socket => {
    const uid = socket.request.session?.userId;
    if (uid) {
        socket.join(uid);
        console.log('[Socket.io] User', uid, 'connected');
    } else {
        console.log('[Socket.io] Connection without userId');
    }
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Bybit public market proxy (CORS/geoblock mitigation) ─────────
const bybitProxyHits = new Map();
const bybitProxyCache = new Map();
const BYBIT_PROXY_CACHE_TTL_MS = 3000;
function bybitProxyAllow(ip) {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxHits = 500;
    const hits = (bybitProxyHits.get(ip) || []).filter(ts => now - ts < windowMs);
    if (hits.length >= maxHits) {
        bybitProxyHits.set(ip, hits);
        return false;
    }
    hits.push(now);
    bybitProxyHits.set(ip, hits);
    return true;
}
function bybitProxyBypassRateLimit(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const host = (req.hostname || '').toLowerCase();
    return host === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function bybitProxyCacheKey(endpoint, params = {}) {
    if (params.symbol || params.interval || params.limit) {
        return `${endpoint}|${params.symbol || ''}|${params.interval || ''}|${params.limit || ''}`;
    }
    return endpoint + '|' + new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
app.get('/api/proxy/bybit', requireActiveAuth, async (req, res) => {
    try {
        const { endpoint, ...params } = req.query || {};
        if (!endpoint || typeof endpoint !== 'string') {
            return res.status(400).json({ ok: false, error: 'Missing endpoint' });
        }
        if (!endpoint.startsWith('market/') || endpoint.includes('..') || endpoint.includes('://')) {
            return res.status(400).json({ ok: false, error: 'Invalid endpoint' });
        }
        const cacheKey = bybitProxyCacheKey(endpoint, params);
        const now = Date.now();
        const cached = bybitProxyCache.get(cacheKey);
        if (cached && now - cached.ts < BYBIT_PROXY_CACHE_TTL_MS) return res.status(cached.status).json(cached.body);

        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        if (!bybitProxyBypassRateLimit(req) && !bybitProxyAllow(ip)) {
            if (cached) return res.status(cached.status).json(cached.body);
            await sleep(1000);
            if (!bybitProxyAllow(ip)) {
                return res.status(503).json({ ok: false, error: 'Proxy temporarily busy, please retry' });
            }
        }

        const url = new URL(`https://api.bybit.com/v5/${endpoint}`);
        Object.entries(params).forEach(([k, v]) => {
            if (v != null) url.searchParams.set(k, String(v));
        });
        const doFetch = async () => {
            const response = await fetch(url.toString());
            let data;
            try { data = await response.json(); }
            catch { data = { ok: false, error: 'Invalid upstream response' }; }
            return { response, data };
        };

        let { response, data } = await doFetch();
        const upstreamRateLimited = !response.ok && response.status === 429;
        const upstreamRetRateLimited = data && (data.retCode === 10006 || /rate.?limit/i.test(String(data.retMsg || data.error || '')));
        if (upstreamRateLimited || upstreamRetRateLimited) {
            await sleep(1000);
            ({ response, data } = await doFetch());
        }

        if (!response.ok || (data && data.retCode && data.retCode !== 0)) {
            if (cached) return res.status(cached.status).json(cached.body);
            return res.status(response.ok ? 502 : response.status).json({ ok: false, error: 'Upstream market data unavailable' });
        }

        bybitProxyCache.set(cacheKey, { ts: now, status: 200, body: data });
        return res.json(data);
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── Binance public market proxy ───────────────────────────────────
app.get('/api/proxy/binance', requireActiveAuth, async (req, res) => {
    try {
        const { path: apiPath, ...params } = req.query || {};
        if (!apiPath || typeof apiPath !== 'string') {
            return res.status(400).json({ ok: false, error: 'Missing path' });
        }
        if (!apiPath.startsWith('/') || apiPath.includes('..') || apiPath.includes('://')) {
            return res.status(400).json({ ok: false, error: 'Invalid path' });
        }
        const base = apiPath.startsWith('/fapi/') ? 'https://fapi.binance.com' : 'https://api.binance.com';
        const url = new URL(base + apiPath);
        Object.entries(params).forEach(([k, v]) => {
            if (v != null) url.searchParams.set(k, String(v));
        });
        const r = await fetch(url.toString());
        const d = await r.json();
        if (!r.ok) return res.status(r.status).json(d);
        return res.json(d);
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ── helper: upsert single-user doc ────────────────────────────────────────
async function upsert(Model, update, uid) {
    return Model.findOneAndUpdate(
        { userId: uid || USER },
        { $set: update },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
}

async function getAdminDiscordWebhook() {
    const envWebhook = process.env.ADMIN_DISCORD_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL || '';
    try {
        const admins = await User.find({ role: 'admin' }).select('_id').lean();
        if (!admins.length) return envWebhook;
        const adminIds = admins.map(a => String(a._id));
        const settingsDoc = await Settings.findOne({
            userId: { $in: adminIds },
            'discord.webhookUrl': { $exists: true, $ne: '' },
        }).sort({ updatedAt: -1 }).lean();
        return settingsDoc?.discord?.webhookUrl || envWebhook;
    } catch {
        return envWebhook;
    }
}

async function notifyAdminDiscord(embed) {
    try {
        const webhook = await getAdminDiscordWebhook();
        if (!webhook) return;
        await sendDiscordAlert(webhook, embed);
    } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════
//  AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════

// Simple in-memory rate limiter: max 5 login attempts per IP per 15 min
const _loginAttempts = new Map();
function _checkRateLimit(ip) {
    const now = Date.now(), window = 15 * 60 * 1000, max = 5;
    const list = (_loginAttempts.get(ip) || []).filter(t => now - t < window);
    _loginAttempts.set(ip, list);
    return list.length < max;
}
function _recordAttempt(ip) {
    const list = _loginAttempts.get(ip) || [];
    list.push(Date.now());
    _loginAttempts.set(ip, list);
}

function normalizeTimezone(tz) {
    const fallback = 'UTC';
    if (!tz || typeof tz !== 'string') return fallback;
    try {
        Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
        return tz;
    } catch {
        return fallback;
    }
}

function getTodayInTimezone(tz) {
    return new Date().toLocaleDateString('en-CA', { timeZone: normalizeTimezone(tz) });
}

function getNextMidnightIsoForTimezone(tz) {
    const safeTz = normalizeTimezone(tz);
    const now = new Date();
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: safeTz }));
    const tzNextMidnight = new Date(tzNow);
    tzNextMidnight.setHours(24, 0, 0, 0);
    const deltaMs = tzNextMidnight.getTime() - tzNow.getTime();
    return new Date(now.getTime() + deltaMs).toISOString();
}

async function checkAiAnalysisLimit(req, res, next) {
    try {
        const user = await User.findById(req.appUserId).select('accountTier aiAnalysisCount aiAnalysisDate aiAnalysisTimezone').lean();
        if (!user) return res.status(401).json({ error: 'Not authenticated' });

        const requestedTz = req.body?.timezone;
        const userTimezone = normalizeTimezone(requestedTz || user.aiAnalysisTimezone || 'UTC');
        const today = getTodayInTimezone(userTimezone);
        const resetNeeded = user.aiAnalysisDate !== today;
        const isPremium = user.accountTier === 'premium';
        const currentCount = resetNeeded ? 0 : (user.aiAnalysisCount || 0);

        // Persist timezone and/or day rollover before limit check.
        if (resetNeeded || user.aiAnalysisTimezone !== userTimezone) {
            await User.findByIdAndUpdate(req.appUserId, {
                aiAnalysisCount: currentCount,
                aiAnalysisDate: today,
                aiAnalysisTimezone: userTimezone,
            });
        }

        req.aiLimit = {
            isPremium,
            timezone: userTimezone,
            today,
            used: currentCount,
            limit: 3,
        };

        if (!isPremium && currentCount >= 3) {
            return res.status(429).json({
                error: 'limit_reached',
                message: 'Daily AI analysis limit reached',
                limit: 3,
                used: 3,
                resetsAt: 'midnight in your timezone',
            });
        }

        return next();
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// Requires logged-in session only (no license check)
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
        return res.redirect('/login');
    }
    req.appUserId = req.session.userId;
    next();
}

// Requires logged-in + active license (or admin)
async function requireActiveAuth(req, res, next) {
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
        return res.redirect('/login');
    }
    try {
        const user = await User.findById(req.session.userId).lean();
        if (!user) {
            req.session.destroy(() => {});
            if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
            return res.redirect('/login');
        }
        // Single-session enforcement: check session token (skip for admin)
        if (user.role !== 'admin' && req.session.sessionToken && user.activeSessionToken) {
            if (user.activeSessionToken !== req.session.sessionToken) {
                req.session.destroy(() => {});
                if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'session_ended', message: 'Your session was ended because your account was accessed from another location.' });
                return res.redirect('/login');
            }
        }
        req.appUserId = req.session.userId;
        if (user.role === 'admin') return next();
        // Check suspension status
        if (user.licenseStatus === 'suspended') {
            if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'License suspended' });
            return res.redirect('/suspended');
        }
        // Check license expiration only for premium users
        if (user.licenseStatus === 'active' && user.licenseExpiresAt && new Date() > new Date(user.licenseExpiresAt)) {
            await Promise.all([
                User.findByIdAndUpdate(req.session.userId, { licenseStatus: 'suspended' }),
                License.findOneAndUpdate({ licenseKey: user.licenseKey }, { status: 'suspended' }),
            ]);
            if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'License expired' });
            return res.redirect('/suspended?reason=expired');
        }
        // With free tier system, all users (free and premium) can access the platform
        // Only premium users should get premium features, which are protected by checkPremium middleware
        return next();
    } catch (e) { 
        console.error('[Auth] Error:', e.message);
        return res.status(500).json({ error: e.message }); 
    }
}

// Requires admin role
function requireAdmin(req, res, next) {
    if (!req.session.userId || req.session.role !== 'admin') {
        if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Admin only' });
        return res.redirect('/');
    }
    next();
}

// Requires logged-in + premium tier
async function checkPremium(req, res, next) {
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
        return res.redirect('/login');
    }
    try {
        const user = await User.findById(req.session.userId).select('accountTier').lean();
        if (!user) {
            if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
            return res.redirect('/login');
        }

        // Keep session tier synchronized with DB tier.
        req.session.accountTier = user.accountTier || 'free';
        if (!req.session.user) req.session.user = {};
        req.session.user.accountTier = req.session.accountTier;

        if (user.accountTier !== 'premium') {
            if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'premium_required', message: 'This feature requires Premium access' });
            return res.redirect('/');
        }

        return next();
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// ═══════════════════════════════════════════════════════════════
//  AUTH ROUTES  (no protection — public)
// ═══════════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
    try {
        const { firstName, lastName, email, password } = req.body;
        if (!firstName || !lastName || !email || !password)
            return res.status(400).json({ error: 'All fields are required' });
        if (password.length < 6)
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        const existing = await User.findOne({ email: email.toLowerCase().trim() });
        if (existing) return res.status(400).json({ error: 'An account with this email already exists' });
        const hash = await bcrypt.hash(password, 10);
        const user = await User.create({
            firstName: firstName.trim(),
            lastName:  lastName.trim(),
            email:     email.toLowerCase().trim(),
            password:  hash,
        });
        req.session.userId         = user._id.toString();
        req.session.role           = user.role;
        req.session.accountTier    = user.accountTier;
        req.session.user = {
            id: user._id.toString(),
            email: user.email,
            firstName: user.firstName,
            accountTier: user.accountTier || 'free',
            licenseStatus: user.licenseStatus || 'inactive'
        };
        notifyAdminDiscord(newRegistrationEmbed({
            userId: user._id.toString(),
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            accountTier: user.accountTier || 'free',
        }));

        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const ip          = req.ip || req.socket.remoteAddress || 'unknown';
        const userAgent   = req.headers['user-agent'] || '';
        if (!_checkRateLimit(ip))
            return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
        const { email, password, deviceFingerprint } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password are required' });
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            _recordAttempt(ip);
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Generate new session token for single-session enforcement
        const sessionToken = require('crypto').randomUUID();
        // Build login history entry
        const fingerprintMatch = !user.deviceFingerprint || !deviceFingerprint || user.deviceFingerprint === deviceFingerprint;
        const histEntry = { ip, userAgent, timestamp: new Date(), fingerprint: deviceFingerprint || '', fingerprintMatch };
        // Update user: session token, last login, login history (capped at 20)
        const updatedUser = await User.findByIdAndUpdate(user._id, {
            lastIp:              ip,
            lastLogin:           new Date(),
            activeSessionToken:  sessionToken,
            activeSessionAt:     new Date(),
            $push: { loginHistory: { $each: [histEntry], $slice: -20 } },
            $addToSet: { },
        }, { new: true }).lean();
        // Track IP on license
        if (user.licenseKey) {
            await License.findOneAndUpdate({ licenseKey: user.licenseKey }, { $addToSet: { ipHistory: ip } });
        }
        // Suspicious activity detection
        const allFingerprints = (updatedUser?.loginHistory || []).map(h => h.fingerprint).filter(Boolean);
        const uniqueFingerprints = new Set(allFingerprints);
        const licenseDoc = user.licenseKey ? await License.findOne({ licenseKey: user.licenseKey }).lean() : null;
        const uniqueIPs = (licenseDoc?.ipHistory || []).length;
        if (user.role !== 'admin' && (uniqueIPs > 5 || uniqueFingerprints.size >= 3)) {
            await User.findByIdAndUpdate(user._id, { suspiciousActivity: true });
        }
        req.session.userId         = user._id.toString();
        req.session.role           = user.role;
        req.session.accountTier    = updatedUser.accountTier;
        req.session.sessionToken   = sessionToken;
        req.session.user = {
            id: user._id.toString(),
            email: user.email,
            firstName: user.firstName,
            accountTier: updatedUser.accountTier || 'free',
            licenseStatus: user.licenseStatus || 'inactive'
        };
        res.json({ ok: true, licenseStatus: user.licenseStatus, role: user.role });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('-password').lean();
        if (!user) return res.json({});
        // Merge profile fields from Settings (profilePicture, displayName, and
        // name overrides saved via the profile settings form)
        const settings = await Settings.findOne({ userId: req.session.userId }).lean();
        if (settings) {
            if (settings.firstName)      user.firstName      = settings.firstName;
            if (settings.lastName)       user.lastName       = settings.lastName;
            if (settings.displayName)    user.displayName    = settings.displayName;
            if (settings.profilePicture) user.profilePicture = settings.profilePicture;
        }
        res.json(user);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/session-check', async (req, res) => {
    const userId = req.session && req.session.userId;
    if (!userId) return res.status(401).json({ reason: 'no_session' });
    try {
        const user = await User.findById(userId).select('activeSessionToken role accountTier email firstName licenseStatus').lean();
        if (!user) return res.status(401).json({ reason: 'user_not_found' });
        if (user.role !== 'admin' && req.session.sessionToken && user.activeSessionToken) {
            if (user.activeSessionToken !== req.session.sessionToken) {
                return res.status(401).json({ reason: 'session_replaced' });
            }
        }

        req.session.accountTier = user.accountTier || 'free';
        req.session.user = {
            id: userId,
            email: user.email,
            firstName: user.firstName,
            accountTier: req.session.accountTier,
            licenseStatus: user.licenseStatus || 'inactive'
        };

        res.json({
            valid: true,
            accountTier: req.session.accountTier,
            user: req.session.user
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/refresh-session', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId)
            .select('email firstName accountTier licenseStatus role')
            .lean();
        if (!user) return res.status(404).json({ error: 'User not found' });

        req.session.role = user.role;
        req.session.accountTier = user.accountTier || 'free';
        req.session.user = {
            id: req.session.userId,
            email: user.email,
            firstName: user.firstName,
            accountTier: req.session.accountTier,
            licenseStatus: user.licenseStatus || 'inactive'
        };

        res.json({ ok: true, user: req.session.user });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  LICENSE ROUTES  (require login, not necessarily active)
// ═══════════════════════════════════════════════════════════════

app.post('/api/license/activate', requireAuth, async (req, res) => {
    try {
        const { key, deviceFingerprint } = req.body;
        if (!key) return res.status(400).json({ error: 'License key is required' });
        const license = await License.findOne({ licenseKey: key.trim().toUpperCase() });
        if (!license)
            return res.status(400).json({ error: 'Invalid license key' });
        if (license.status === 'suspended')
            return res.status(400).json({ error: 'This license has been suspended. Contact admin.' });
        if (license.status === 'active')
            return res.status(400).json({ error: 'This license key is already in use' });
        const ip = req.ip || req.socket.remoteAddress || 'unknown';

        // Fetch current user
        const user = await User.findById(req.session.userId);
        if (!user) return res.status(400).json({ error: 'User not found' });

        // Activate license
        await License.findByIdAndUpdate(license._id, {
            status:              'active',
            activatedByUserId:   req.session.userId,
            activatedAt:         new Date(),
            deviceFingerprint:   deviceFingerprint || '',
            $addToSet:           { ipHistory: ip },
        });
        await user.save();

        await User.findByIdAndUpdate(req.session.userId, {
            licenseKey:          license.licenseKey,
            licenseStatus:       'active',
            licenseActivatedAt:  new Date(),
            licenseExpiresAt:    license.expiresAt || null,
            deviceFingerprint:   deviceFingerprint || '',
            accountTier:         'premium',
            premiumActivatedAt:  new Date(),
            premiumPlan:         'lifetime',
        });
        req.session.licenseStatus = 'active';
        req.session.accountTier = 'premium';
        if (!req.session.user) req.session.user = {};
        req.session.user.accountTier = 'premium';
        req.session.user.licenseStatus = 'active';
        req.session.user.id = req.session.userId;
        req.session.user.email = user.email;
        req.session.user.firstName = user.firstName;

        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/license/status', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('licenseStatus licenseKey accountTier').lean();
        res.json({ status: user?.licenseStatus || 'inactive', key: user?.licenseKey, accountTier: user?.accountTier || 'free' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/api/admin/licenses', requireAdmin, async (req, res) => {
    try {
        const licenses = await License.find()
            .populate('activatedByUserId', 'firstName lastName email')
            .sort({ createdAt: -1 }).lean();
        res.json(licenses);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/licenses/create', requireAdmin, async (req, res) => {
    try {
        const { buyerName, buyerContact, purchaseDate, price, currency, notes, expiresAmount, expiresUnit } = req.body;
        if (!buyerName || !buyerContact || !purchaseDate || price == null)
            return res.status(400).json({ error: 'buyerName, buyerContact, purchaseDate and price are required' });
        // Calculate expiry date if provided
        const unitMs  = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000, months: 2592000000 };
        const expiresAt = (expiresAmount && expiresUnit && unitMs[expiresUnit])
            ? new Date(Date.now() + parseInt(expiresAmount) * unitMs[expiresUnit])
            : null;
        // Generate SCAN-XXXX-XXXX-XXXX-XXXX
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const seg   = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const key   = `SCAN-${seg()}-${seg()}-${seg()}-${seg()}`;
        const license = await License.create({
            licenseKey:   key,
            buyerName:    buyerName.trim(),
            buyerContact: buyerContact.trim(),
            purchaseDate: new Date(purchaseDate),
            price:        parseFloat(price),
            currency:     currency || 'USD',
            notes:        notes || '',
            expiresAt,
        });
        res.json({ ok: true, key, license });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/licenses/suspend/:id', requireAdmin, async (req, res) => {
    try {
        const license = await License.findByIdAndUpdate(req.params.id, { status: 'suspended' }, { new: true });
        if (license?.activatedByUserId)
            await User.findByIdAndUpdate(license.activatedByUserId, { licenseStatus: 'suspended' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/licenses/reactivate/:id', requireAdmin, async (req, res) => {
    try {
        const license = await License.findByIdAndUpdate(req.params.id, { status: 'active' }, { new: true });
        if (license?.activatedByUserId)
            await User.findByIdAndUpdate(license.activatedByUserId, { licenseStatus: 'active' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/licenses/transfer/:id', requireAdmin, async (req, res) => {
    try {
        const license = await License.findById(req.params.id);
        if (!license) return res.status(404).json({ error: 'Not found' });
        if (license.transferCount >= license.maxTransfers)
            return res.status(400).json({ error: `Transfer limit reached (${license.maxTransfers} transfers allowed). Contact admin directly to override.` });
        const oldFingerprint = license.deviceFingerprint;
        await License.findByIdAndUpdate(req.params.id, {
            deviceFingerprint: null,
            $inc: { transferCount: 1 },
            $push: { transferHistory: { date: new Date(), adminId: req.session.userId, oldFingerprint: oldFingerprint || '' } },
        });
        if (license.activatedByUserId)
            await User.findByIdAndUpdate(license.activatedByUserId, { deviceFingerprint: null });
        res.json({ ok: true, transferCount: license.transferCount + 1, maxTransfers: license.maxTransfers });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/licenses/:id', requireAdmin, async (req, res) => {
    try {
        const license = await License.findById(req.params.id);
        if (!license) return res.status(404).json({ error: 'Not found' });
        await License.findByIdAndDelete(req.params.id);
        // If the license was active, revoke the linked user's access immediately
        if (license.status === 'active' && license.activatedByUserId) {
            await User.findByIdAndUpdate(license.activatedByUserId, { licenseStatus: 'inactive', licenseKey: null });
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 }).lean();
        res.json(users);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/reset-ai-limit', requireAdmin, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.id, {
            aiAnalysisCount: 0,
            aiAnalysisDate: null,
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/analysis/stats', requireAdmin, async (req, res) => {
    try {
        const todayUtc = getTodayInTimezone('UTC');
        const agg = await User.aggregate([
            { $match: { aiAnalysisDate: todayUtc } },
            { $group: { _id: null, total: { $sum: '$aiAnalysisCount' } } }
        ]);
        res.json({ totalToday: agg[0]?.total || 0 });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/suspend/:id', requireAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { licenseStatus: 'suspended' }, { new: true });
        if (user?.licenseKey)
            await License.findOneAndUpdate({ licenseKey: user.licenseKey }, { status: 'suspended' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/reactivate/:id', requireAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { licenseStatus: 'active' }, { new: true });
        if (user?.licenseKey)
            await License.findOneAndUpdate({ licenseKey: user.licenseKey }, { status: 'active' });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/flag-suspicious/:id', requireAdmin, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.id, { suspiciousActivity: true });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/clear-security-logs', requireAdmin, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.id, {
            loginHistory: [],
            suspiciousActivity: false,
            blockedAttempts: []
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'Not found' });
        if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin accounts' });
        await User.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Change user account tier (admin endpoint)
app.post('/api/admin/users/:id/tier', requireAdmin, async (req, res) => {
    try {
        const { accountTier } = req.body;
        if (!['free', 'premium'].includes(accountTier)) {
            return res.status(400).json({ error: 'Invalid tier' });
        }
        
        const user = await User.findByIdAndUpdate(
            req.params.id,
            {
                accountTier,
                premiumActivatedAt: accountTier === 'premium' ? new Date() : null,
                premiumPlan: accountTier === 'premium' ? 'lifetime' : null
            },
            { new: true }
        );
        
        res.json({ ok: true, accountTier: user.accountTier });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:id/detail', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password').lean();
        if (!user) return res.status(404).json({ error: 'Not found' });
        const license = user.licenseKey ? await License.findOne({ licenseKey: user.licenseKey }).lean() : null;
        const uniqueIPs  = new Set((license?.ipHistory || [])).size;
        const uniqueFps  = new Set((user.loginHistory || []).map(h => h.fingerprint).filter(Boolean)).size;
        res.json({ user, license, uniqueIPs, uniqueFingerprints: uniqueFps });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:id/clear-device-lock', requireAdmin, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.params.id, { deviceFingerprint: null });
        // Also clear on the associated license
        const user = await User.findById(req.params.id).select('licenseKey').lean();
        if (user?.licenseKey) await License.findOneAndUpdate({ licenseKey: user.licenseKey }, { deviceFingerprint: null });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/revenue', requireAdmin, async (req, res) => {
    try {
        const licenses = await License.find().lean();
        const total     = licenses.length;
        const revenue   = licenses.reduce((s, l) => s + (l.price || 0), 0);
        const active    = licenses.filter(l => l.status === 'active').length;
        const inactive  = licenses.filter(l => l.status === 'inactive').length;
        const suspended = licenses.filter(l => l.status === 'suspended').length;
        const monthly   = {};
        licenses.forEach(l => {
            if (!l.purchaseDate) return;
            const d   = new Date(l.purchaseDate);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (!monthly[key]) monthly[key] = { count: 0, revenue: 0, currency: l.currency || 'USD' };
            monthly[key].count++;
            monthly[key].revenue += l.price || 0;
        });
        res.json({ total, revenue, active, inactive, suspended, monthly });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
        const docs = await AppSettings.find().lean();
        const obj  = {};
        docs.forEach(d => { obj[d.key] = d.value; });
        res.json(obj);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings', requireAdmin, async (req, res) => {
    try {
    const { emailAdmin, appName,
                walletTRC20, walletERC20, walletBEP20, pricePlanStandard, pricePlanPKR,
                pricing_lifetime_original, pricing_lifetime_discounted,
                pricing_discount_label } = req.body;

        // Admin email (replaces old whatsapp)
        await AppSettings.findOneAndUpdate({ key: 'emailAdmin' }, { key: 'emailAdmin', value: emailAdmin || 'support@scanr.me' }, { upsert: true });

        // App name
        await AppSettings.findOneAndUpdate({ key: 'appName'  }, { key: 'appName',  value: appName  || '' }, { upsert: true });

        // Wallet addresses
        if (walletTRC20 !== undefined) {
            await AppSettings.findOneAndUpdate({ key: 'walletTRC20' }, { key: 'walletTRC20', value: walletTRC20 || '' }, { upsert: true });
        }
        if (walletERC20 !== undefined) {
            await AppSettings.findOneAndUpdate({ key: 'walletERC20' }, { key: 'walletERC20', value: walletERC20 || '' }, { upsert: true });
        }
        if (walletBEP20 !== undefined) {
            await AppSettings.findOneAndUpdate({ key: 'walletBEP20' }, { key: 'walletBEP20', value: walletBEP20 || '' }, { upsert: true });
        }

        // Prices
        if (pricePlanStandard !== undefined) {
            await AppSettings.findOneAndUpdate({ key: 'pricePlanStandard' }, { key: 'pricePlanStandard', value: String(pricePlanStandard) }, { upsert: true });
        }
        if (pricePlanPKR !== undefined) {
            await AppSettings.findOneAndUpdate({ key: 'pricePlanPKR' }, { key: 'pricePlanPKR', value: String(pricePlanPKR) }, { upsert: true });
        }

        // Dynamic pricing settings
        if (pricing_lifetime_original !== undefined) {
            await AppSettings.findOneAndUpdate(
                { key: 'pricing_lifetime_original' },
                { key: 'pricing_lifetime_original', value: String(pricing_lifetime_original) },
                { upsert: true }
            );
        }
        if (pricing_lifetime_discounted !== undefined) {
            await AppSettings.findOneAndUpdate(
                { key: 'pricing_lifetime_discounted' },
                { key: 'pricing_lifetime_discounted', value: pricing_lifetime_discounted === '' || pricing_lifetime_discounted === null ? '' : String(pricing_lifetime_discounted) },
                { upsert: true }
            );
        }
        if (pricing_discount_label !== undefined) {
            await AppSettings.findOneAndUpdate(
                { key: 'pricing_discount_label' },
                { key: 'pricing_discount_label', value: String(pricing_discount_label || '').trim() },
                { upsert: true }
            );
        }

        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  PAYMENT SYSTEM (USDT Direct Payments)
// ═══════════════════════════════════════════════════════════════

// Setup multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads', 'payments');
        require('fs').mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const ext = path.extname(file.originalname);
        cb(null, `${timestamp}_${rand}${ext}`);
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const mimes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!mimes.includes(file.mimetype)) {
            return cb(new Error('Only JPG, PNG, and WebP images allowed'));
        }
        if (file.size > 5 * 1024 * 1024) { // 5MB max
            return cb(new Error('File too large (max 5MB)'));
        }
        cb(null, true);
    }
});

// POST /api/payment/submit — Submit payment proof (requires auth)
app.post('/api/payment/submit', requireAuth, upload.single('screenshot'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Screenshot is required' });

        const { fullName, email, phone, txId, network, message, planType, amount } = req.body;
        if (!txId || !network || !planType || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get user info
        const user = await User.findById(req.appUserId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Check if user already has a pending payment
        const existingPayment = await Payment.findOne({
            userId: req.appUserId,
            status: 'pending'
        });
        if (existingPayment) {
            return res.status(400).json({ error: 'You already have a pending payment' });
        }

        // Create payment record
        const payment = await Payment.create({
            userId: req.appUserId,
            buyerName: fullName || user.name || user.email,
            buyerEmail: email || user.email,
            buyerPhone: phone || '',
            planType,
            amount: parseFloat(amount),
            txId: txId.trim(),
            network,
            screenshotPath: `/uploads/payments/${req.file.filename}`,
            message: message || '',
            status: 'pending'
        });

        notifyAdminDiscord(newPaymentSubmissionEmbed({
            paymentId: payment._id.toString(),
            userId: payment.userId,
            buyerName: payment.buyerName,
            buyerEmail: payment.buyerEmail,
            buyerPhone: payment.buyerPhone,
            planType: payment.planType,
            amount: payment.amount,
            network: payment.network,
            txId: payment.txId,
            screenshotPath: payment.screenshotPath,
            createdAt: payment.createdAt,
        }));

        // Send email notification to admin
        const notifier = require('./notifier');
        try {
            await notifier.sendPaymentReceivedEmail({
                adminEmail: process.env.ADMIN_EMAIL || 'support@scanr.me',
                buyerName: payment.buyerName,
                buyerEmail: payment.buyerEmail,
                planType: payment.planType,
                amount: payment.amount,
                network: payment.network,
                txId: payment.txId,
                paymentId: payment._id,
                screenshotPath: payment.screenshotPath
            });
        } catch (emailErr) {
            console.error('Failed to send admin notification email:', emailErr);
        }

        res.json({
            ok: true,
            payment: payment.toObject(),
            message: 'Payment proof submitted successfully!'
        });
    } catch (e) {
        if (req.file) {
            require('fs').unlink(path.join(__dirname, 'uploads', 'payments', req.file.filename), () => {});
        }
        res.status(500).json({ error: e.message });
    }
});

// GET /api/payment/my-status — Get current user's payment status
app.get('/api/payment/my-status', requireAuth, async (req, res) => {
    try {
        const payment = await Payment.findOne({ userId: req.appUserId })
            .sort({ createdAt: -1 })
            .lean();

        if (!payment) {
            return res.json({ payment: null });
        }

        res.json({ payment });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/payment/clear-pending — Clear user's pending payment
app.post('/api/payment/clear-pending', requireAuth, async (req, res) => {
    try {
        const result = await Payment.deleteOne({
            userId: req.appUserId,
            status: 'pending'
        });
        
        res.json({
            ok: true,
            message: 'Pending payment cleared. You can now submit a new payment.'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/license/my-license — Get current user's license status
app.get('/api/license/my-license', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.appUserId).lean();
        res.json({
            status: user.licenseStatus,
            expiresAt: user.licenseExpiresAt
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/payments — List all payments (admin only)
app.get('/api/admin/payments', requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const payments = await Payment.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await Payment.countDocuments();

        res.json({
            payments,
            total,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/payment/verify/:paymentId — Verify payment and issue license key
app.post('/api/admin/payment/verify/:paymentId', requireAdmin, async (req, res) => {
    try {
        const { licenseKey: customKey } = req.body;
        const payment = await Payment.findById(req.params.paymentId);
        if (!payment) return res.status(404).json({ error: 'Payment not found' });
        if (payment.status !== 'pending') return res.status(400).json({ error: 'Payment already processed' });

        // Generate or use custom license key
        let licenseKey = customKey;
        if (!licenseKey) {
            // Generate SCAN-XXXX-XXXX-XXXX-XXXX format (matching licenses tab)
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            licenseKey = `SCAN-${seg()}-${seg()}-${seg()}-${seg()}`;
        }

        // Get user to link license
        const user = await User.findById(payment.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Calculate expiry based on plan type
        let expiresAt = null;
        if (payment.planType === 'monthly') {
            const expiry = new Date();
            expiry.setMonth(expiry.getMonth() + 1);
            expiresAt = expiry.toISOString();
        } else if (payment.planType === 'yearly') {
            const expiry = new Date();
            expiry.setFullYear(expiry.getFullYear() + 1);
            expiresAt = expiry.toISOString();
        }
        // lifetime has no expiry (null)

        // Create license record
        const license = await License.create({
            licenseKey,
            buyerName: payment.buyerName,
            buyerContact: payment.buyerEmail,
            purchaseDate: new Date().toISOString().split('T')[0],
            price: payment.amount,
            currency: 'USD',
            status: 'inactive',
            notes: `Payment: ${payment.network} txId: ${payment.txId}`,
            userId: payment.userId,
            expiresAt
        });

        // Upgrade user immediately after payment verification.
        await User.findByIdAndUpdate(payment.userId, {
            accountTier: 'premium',
            premiumActivatedAt: new Date(),
            premiumPlan: ['monthly', 'yearly'].includes(payment.planType) ? payment.planType : 'lifetime'
        });

        // Update payment
        payment.status = 'verified';
        payment.licenseKeyIssued = licenseKey;
        payment.verifiedAt = new Date();
        await payment.save();

        // Send email to user with license key
        const notifier = require('./notifier');
        try {
            await notifier.sendLicenseKeyEmail({
                userEmail: payment.buyerEmail,
                userName: payment.buyerName,
                licenseKey,
                planType: payment.planType
            });
        } catch (emailErr) {
            console.error('Failed to send license key email:', emailErr);
        }

        // Emit Socket.io event to user for real-time update
        io.to(payment.userId).emit('payment_verified', { licenseKey });

        res.json({
            ok: true,
            licenseKey,
            message: 'License key generated and sent to user'
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/payment/reject/:paymentId — Reject payment
app.post('/api/admin/payment/reject/:paymentId', requireAdmin, async (req, res) => {
    try {
        const { reason } = req.body;
        const payment = await Payment.findById(req.params.paymentId);

        if (!payment) return res.status(404).json({ error: 'Payment not found' });
        if (payment.status !== 'pending') return res.status(400).json({ error: 'Payment already processed' });

        payment.status = 'rejected';
        payment.rejectionReason = reason || 'Payment could not be verified';
        payment.rejectedAt = new Date();
        await payment.save();

        // Send rejection email
        const notifier = require('./notifier');
        try {
            await notifier.sendPaymentRejectionEmail({
                userEmail: payment.buyerEmail,
                userName: payment.buyerName,
                reason: payment.rejectionReason
            });
        } catch (emailErr) {
            console.error('Failed to send rejection email:', emailErr);
        }

        // Emit Socket.io event to user for real-time update
        io.to(payment.userId).emit('payment_rejected', { reason: payment.rejectionReason });

        res.json({ ok: true, message: 'Payment rejected' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

function parseNum(value, fallback) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

function buildPlanPricing(originalValue, discountedValue, fallbackOriginal) {
    const original = parseNum(originalValue, fallbackOriginal);
    const discountedParsed = parseFloat(discountedValue);
    const hasDiscount = Number.isFinite(discountedParsed) && discountedParsed > 0 && discountedParsed < original;
    const discounted = hasDiscount ? discountedParsed : null;
    const discountPct = hasDiscount ? Math.round(((original - discounted) / original) * 100) : null;
    return {
        original,
        discounted,
        displayPrice: hasDiscount ? discounted : original,
        discountPct
    };
}

// Public: fetch wallet addresses
app.get('/api/payment/wallet-addresses', async (req, res) => {
    try {
        const trc20 = await AppSettings.findOne({ key: 'walletTRC20' });
        const erc20 = await AppSettings.findOne({ key: 'walletERC20' });
        const bep20 = await AppSettings.findOne({ key: 'walletBEP20' });

        res.json({
            walletTRC20: trc20?.value || '',
            walletERC20: erc20?.value || '',
            walletBEP20: bep20?.value || ''
        });
    } catch (e) { res.json({ walletTRC20: '', walletERC20: '', walletBEP20: '' }); }
});

// Public: fetch normalized pricing settings
app.get('/api/settings/pricing', async (req, res) => {
    try {
        const keys = [
            'pricing_lifetime_original',
            'pricing_lifetime_discounted',
            'pricing_discount_label'
        ];
        const docs = await AppSettings.find({ key: { $in: keys } }).lean();
        const map = {};
        docs.forEach(d => { map[d.key] = d.value; });

        const lifetime = buildPlanPricing(map.pricing_lifetime_original, map.pricing_lifetime_discounted, 49);
        const anyDiscount = Boolean(lifetime.discountPct);
        const discountLabelRaw = String(map.pricing_discount_label || '').trim();

        res.json({
            lifetime,
            discountLabel: anyDiscount ? (discountLabelRaw || null) : null
        });
    } catch (e) {
        const lifetime = buildPlanPricing(null, null, 49);
        res.json({ lifetime, discountLabel: null });
    }
});

// Public: fetch payment prices
app.get('/api/payment/prices', async (req, res) => {
    try {
        const keys = [
            'pricing_lifetime_original',
            'pricing_lifetime_discounted'
        ];
        const docs = await AppSettings.find({ key: { $in: keys } }).lean();
        const map = {};
        docs.forEach(d => { map[d.key] = d.value; });

        const lifetime = buildPlanPricing(map.pricing_lifetime_original, map.pricing_lifetime_discounted, 49);

        res.json({
            priceLifetime: lifetime.displayPrice,
            priceMonthly: lifetime.displayPrice,
            priceYearly: lifetime.displayPrice
        });
    } catch (e) {
        res.json({ priceLifetime: 49, priceMonthly: 49, priceYearly: 49 });
    }
});

// Public: fetch admin email
app.get('/api/public/admin-email', async (req, res) => {
    try {
        const doc = await AppSettings.findOne({ key: 'emailAdmin' });
        res.json({ email: doc?.value || 'support@scanr.me' });
    } catch (e) { res.json({ email: 'support@scanr.me' }); }
});

// Public: fetch WhatsApp number (DEPRECATED - kept for backward compat)
app.get('/api/public/whatsapp', async (req, res) => {
    try {
        const doc = await AppSettings.findOne({ key: 'whatsapp' }).lean();
        res.json({ whatsapp: doc?.value || '' });
    } catch (e) { res.json({ whatsapp: '' }); }
});

// Public: fetch app name for all pages
app.get('/api/public/app-name', async (req, res) => {
    try {
        const doc = await AppSettings.findOne({ key: 'appName' }).lean();
        res.json({ appName: doc?.value || '' });
    } catch (e) { res.json({ appName: '' }); }
});

app.post('/api/public/contact', async (req, res) => {
    try {
        const { name, email, phone, message } = req.body;
        if (!name || !email || !message) return res.status(400).json({ error: 'Name, email and message are required.' });
        const contact = await Contact.create({ name, email, phone: phone || '', message });
        notifyAdminDiscord(newContactEmbed({
            name: contact.name,
            email: contact.email,
            phone: contact.phone,
            message: contact.message,
            createdAt: contact.createdAt,
        }));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: contact form submissions ────────────────────────────
app.get('/api/admin/contacts', requireAdmin, async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ createdAt: -1 }).lean();
        res.json(contacts);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/contacts/:id/read', requireAdmin, async (req, res) => {
    try {
        await Contact.findByIdAndUpdate(req.params.id, { read: true });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/contacts/:id', requireAdmin, async (req, res) => {
    try {
        await Contact.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Apex Scanner (Setups) - MUST BE BEFORE requireActiveAuth MIDDLEWARE ──────────────────────────────────────
app.get('/api/setups/status', checkPremium, (req, res) => {
    console.log('[Setups Status] GET /api/setups/status');
    const uid = req.appUserId || req.session.userId;
    res.json({ scanning: setupsScanner.getScanStatus(uid) });
});

app.get('/api/setups/signals', checkPremium, async (req, res) => {
    console.log('[Setups Signals] GET /api/setups/signals');
    try {
        const uid = req.appUserId || req.session.userId;
        const signals = await setupsScanner.getLastSignals(uid);
        res.json({ signals });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/setups/signals', checkPremium, async (req, res) => {
    console.log('[Setups Signals] DELETE /api/setups/signals');
    try {
        const uid = req.appUserId || req.session.userId;
        await setupsScanner.clearLastSignals(uid);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/setups/run', checkPremium, (req, res, next) => {
    // Manually call the async middleware wrapper
    requireActiveAuth(req, res, () => {
        try {
            console.log('[Setups Endpoint] POST /api/setups/run called');
            console.log('[Setups Endpoint] appUserId:', req.appUserId);
            
            if (!req.appUserId) {
                console.error('[Setups Endpoint] No appUserId!');
                return res.status(401).json({ error: 'Not authenticated' });
            }
            
            if (setupsScanner.getScanStatus(req.appUserId)) {
                console.log('[Setups Endpoint] Scan already in progress');
                return res.status(400).json({ error: 'Scan already running' });
            }
            
            const {coins, accountSize, riskPercent, rrRatio, minScore} = req.query;
            const options = {
                coins: parseInt(coins) || 50,
                accountSize: parseFloat(accountSize) || 1000,
                riskPercent: parseFloat(riskPercent) || 1,
                rrRatio: parseFloat(rrRatio) || 1.5,
                minScore: parseInt(minScore) || 35,
            };
            
            console.log('[Setups Endpoint] Starting scan with options:', options);
            
            // Start scan asynchronously
            setupsScanner.runApexScanner(io, req.appUserId, options).catch(err => {
                console.error('[Setups Endpoint] Scan error:', err.message);
            });
            
            console.log('[Setups Endpoint] Sending response');
            res.json({ ok: true, message: 'Scan started' });
        } catch (err) {
            console.error('[Setups Endpoint] Exception:', err.message, err.stack);
            res.status(500).json({ error: err.message });
        }
    });
});

// TEST ENDPOINT - SIMPLE VERSION WITHOUT MIDDLEWARE
app.post('/test-scan', (req, res) => {
    console.log('[TEST] Test endpoint called');
    res.json({ ok: true, test: 'works' });
});

// ═══════════════════════════════════════════════════════════════
//  ALL OTHER /api/* ROUTES REQUIRE ACTIVE AUTH
// ═══════════════════════════════════════════════════════════════
app.use('/api/', (req, res, next) => {
    requireActiveAuth(req, res, next);
});
app.use('/api/strategy', checkPremium, strategyRoutes);

// ─────────────────────────────────────────────────────────────
//  API ROUTES  (all protected by requireActiveAuth above)
// ─────────────────────────────────────────────────────────────

// ── Scanner settings ──────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
    try {
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        res.json(doc || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/settings', async (req, res) => {
    try {
        const { appPassword, appPin, firstName, lastName, ...rest } = req.body;
        // Sync name to User model so /api/auth/me returns updated name
        const userUpdate = {};
        if (firstName !== undefined) userUpdate.firstName = firstName;
        if (lastName  !== undefined) userUpdate.lastName  = lastName;
        if (Object.keys(userUpdate).length) {
            await User.findByIdAndUpdate(req.appUserId, userUpdate);
        }
        // Handle password change
        if (appPassword) {
            if (appPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
            const hash = await bcrypt.hash(appPassword, 10);
            await User.findByIdAndUpdate(req.appUserId, { password: hash });
        }
        // Save settings (firstName/lastName included so profLoad can repopulate)
        const settingsBody = { ...rest };
        if (firstName !== undefined) settingsBody.firstName = firstName;
        if (lastName  !== undefined) settingsBody.lastName  = lastName;
        await upsert(Settings, settingsBody, req.appUserId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/settings', async (req, res) => {
    try {
        await Settings.deleteOne({ userId: req.appUserId });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Watchlist ──────────────────────────────────────────────────
app.get('/api/watchlist', async (req, res) => {
    try {
        const doc = await Watchlist.findOne({ userId: req.appUserId }).lean();
        res.json(doc ? doc.symbols : []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/watchlist', async (req, res) => {
    try {
        await upsert(Watchlist, { symbols: req.body.symbols || [] }, req.appUserId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Filter visibility ──────────────────────────────────────────
app.get('/api/filter-vis', async (req, res) => {
    try {
        const doc = await FilterVis.findOne({ userId: req.appUserId }).lean();
        res.json(doc ? doc.state : {});
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/filter-vis', async (req, res) => {
    try {
        await upsert(FilterVis, { state: req.body }, req.appUserId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Position calculator settings ──────────────────────────────
app.get('/api/pos-settings', async (req, res) => {
    try {
        const doc = await PosSettings.findOne({ userId: req.appUserId }).lean();
        res.json(doc || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/pos-settings', async (req, res) => {
    try {
        const body = { ...req.body };
        // Normalize: accept riskPerTrade or legacy risk field
        if (body.riskPerTrade == null && body.risk != null) body.riskPerTrade = body.risk;
        const doc = await upsert(PosSettings, body, req.appUserId);
        res.json({ ok: true, settings: doc });
    } catch (e) {
        console.error('[pos-settings] error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ── Chart drawings ─────────────────────────────────────────────
app.get('/api/drawings', async (req, res) => {
    try {
        const doc = await Drawings.findOne({ userId: req.appUserId }).lean();
        res.json(doc ? doc.drawings : {});
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/drawings/:sym/:tf', async (req, res) => {
    try {
        const { sym, tf } = req.params;
        const objs = req.body.objs || [];
        const doc  = await Drawings.findOne({ userId: req.appUserId });
        const drawings = (doc && doc.drawings) ? { ...doc.drawings } : {};
        if (objs.length > 0) {
            if (!drawings[sym]) drawings[sym] = {};
            drawings[sym][tf] = objs;
        } else {
            if (drawings[sym]) {
                delete drawings[sym][tf];
                if (Object.keys(drawings[sym]).length === 0) delete drawings[sym];
            }
        }
        await upsert(Drawings, { drawings }, req.appUserId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/drawings/:sym/:tf', async (req, res) => {
    try {
        const { sym, tf } = req.params;
        const doc = await Drawings.findOne({ userId: req.appUserId });
        if (doc && doc.drawings) {
            const drawings = { ...doc.drawings };
            if (drawings[sym]) {
                delete drawings[sym][tf];
                if (Object.keys(drawings[sym]).length === 0) delete drawings[sym];
            }
            await upsert(Drawings, { drawings }, req.appUserId);
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/drawings/:sym', async (req, res) => {
    try {
        const { sym } = req.params;
        const doc = await Drawings.findOne({ userId: req.appUserId });
        if (doc && doc.drawings) {
            const drawings = { ...doc.drawings };
            delete drawings[sym];
            await upsert(Drawings, { drawings }, req.appUserId);
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/drawings', async (req, res) => {
    try {
        await upsert(Drawings, { drawings: {} }, req.appUserId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Kimi AI settings ───────────────────────────────────────────
app.get('/api/kimi-settings', async (req, res) => {
    try {
        const doc = await KimiSettings.findOne({ userId: req.appUserId }).lean();
        res.json(doc || {});
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/kimi-settings', async (req, res) => {
    try {
        const body = { ...req.body };
        if (body.apiKey)  body.apiKey  = body.apiKey.trim();
        if (body.baseUrl) body.baseUrl = body.baseUrl.trim();
        await upsert(KimiSettings, body, req.appUserId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/kimi-settings/test', async (req, res) => {
    try {
        const doc = await KimiSettings.findOne({ userId: req.appUserId }).lean();
        if (!doc?.apiKey) return res.json({ ok: false, error: 'No API key stored in database' });
        const maskedKey = doc.apiKey.slice(0, 6) + '…' + doc.apiKey.slice(-4);
        const base = (doc.baseUrl || 'https://api.moonshot.ai/v1').trim();
        const resp = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${doc.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: doc.model || 'moonshot-v1-8k',
                messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
                temperature: 0, max_tokens: 5,
            }),
        });
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            return res.json({ ok: false, error: `Kimi API returned ${resp.status}`, maskedKey, detail: body.slice(0, 200) });
        }
        res.json({ ok: true, maskedKey, model: doc.model || 'moonshot-v1-8k', baseUrl: base });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Kimi AI cache ──────────────────────────────────────────────
app.get('/api/kimi-cache', async (req, res) => {
    try {
        const doc = await KimiCache.findOne({ userId: req.appUserId }).lean();
        res.json(doc ? doc.cache : {});
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/kimi-cache', async (req, res) => {
    try {
        const { key, value } = req.body;
        const doc   = await KimiCache.findOne({ userId: req.appUserId });
        const cache = (doc && doc.cache) ? { ...doc.cache } : {};
        cache[key]  = value;
        await upsert(KimiCache, { cache }, req.appUserId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/kimi-cache', async (req, res) => {
    try {
        const { key } = req.body || {};
        if (key) {
            const doc   = await KimiCache.findOne({ userId: req.appUserId });
            const cache = (doc && doc.cache) ? { ...doc.cache } : {};
            delete cache[key];
            await upsert(KimiCache, { cache }, req.appUserId);
        } else {
            await upsert(KimiCache, { cache: {} }, req.appUserId);
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bybit credentials ──────────────────────────────────────────
app.get('/api/bybit-store', async (req, res) => {
    try {
        const doc = await BybitStore.findOne({ userId: req.appUserId }).lean();
        if (!doc) return res.json({});
        res.json({ activeEnv: doc.activeEnv, mainnet: doc.mainnet, testnet: doc.testnet });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/bybit-store', async (req, res) => {
    try {
        await upsert(BybitStore, req.body, req.appUserId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bybit/test', async (req, res) => {
    try {
        const doc = await BybitStore.findOne({ userId: req.appUserId }).lean();
        const env = doc?.activeEnv || 'mainnet';
        const cred = doc?.[env];
        if (!cred?.apiKey || !cred?.apiSecret) return res.json({ ok: false, error: 'No API credentials saved.' });
        const result = await dashBybitReq({ ...cred, env }, 'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
        if (result.retCode === 0) {
            const equity = result.result?.list?.[0]?.totalEquity;
            res.json({ ok: true, equity, env });
        } else {
            res.json({ ok: false, error: result.retMsg, env });
        }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/bybit/proxy', async (req, res) => {
    try {
        const doc = await BybitStore.findOne({ userId: req.appUserId }).lean();
        const env = doc?.activeEnv || 'mainnet';
        const cred = doc?.[env];
        if (!cred?.apiKey || !cred?.apiSecret) return res.status(400).json({ retCode: -1, retMsg: 'No API credentials saved.' });
        
        const { path, body } = req.body;
        if (!path) return res.status(400).json({ retCode: -1, retMsg: 'Missing path.' });
        
        // Check if this is a write operation (order placement, position change, etc.)
        const isWriteOp = /order|position|cancel|amend|switchLeverage|setRiskLimit|setMarginMode/i.test(path);
        
        // Free users can only read, not write
        if (isWriteOp) {
            const user = await User.findById(req.appUserId).select('accountTier').lean();
            if (user?.accountTier === 'free') {
                return res.status(403).json({ retCode: -1, retMsg: 'Trading is a premium feature. Upgrade to Premium to place orders.' });
            }
        }
        
        const crypto = require('crypto');
        const base = env === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
        const ts = Date.now().toString();
        const recv = '20000';
        const bodyStr = JSON.stringify(body || {});
        const sign = crypto.createHmac('sha256', cred.apiSecret)
            .update(ts + cred.apiKey + recv + bodyStr)
            .digest('hex');
        const r = await fetch(base + path, {
            method: 'POST',
            headers: {
                'X-BAPI-API-KEY':     cred.apiKey,
                'X-BAPI-SIGN':        sign,
                'X-BAPI-SIGN-TYPE':   '2',
                'X-BAPI-TIMESTAMP':   ts,
                'X-BAPI-RECV-WINDOW': recv,
                'Content-Type':       'application/json',
            },
            body: bodyStr,
        });
        const data = await r.json();
        res.json(data);
    } catch (e) { res.status(500).json({ retCode: -1, retMsg: e.message }); }
});

// ── PnL Calendar ───────────────────────────────────────────────
app.get('/api/pnl-calendar', checkPremium, async (req, res) => {
    try {
        res.json({ ok: true, data: {} });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Funded Account Challenges ──────────────────────────────────
app.get('/api/challenge', async (req, res) => {
    try {
        const docs = await FundedChallenge.find({ userId: req.appUserId }).sort({ createdAt: -1 }).lean();
        res.json({ ok: true, challenges: docs });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/challenge', async (req, res) => {
    try {
        const { title, accountSize, profitTargetPct, maxDailyDrawdownPct, maxTotalDrawdownPct, startDate, durationDays } = req.body;
        if (!accountSize) return res.status(400).json({ ok: false, error: 'Account size is required' });
        const doc = await FundedChallenge.create({
            userId: req.appUserId, title: title || 'My Challenge',
            accountSize: parseFloat(accountSize),
            profitTargetPct:     parseFloat(profitTargetPct)     || 10,
            maxDailyDrawdownPct: parseFloat(maxDailyDrawdownPct) || 5,
            maxTotalDrawdownPct: parseFloat(maxTotalDrawdownPct) || 10,
            startDate: startDate || new Date().toISOString().split('T')[0],
            durationDays: parseInt(durationDays) || 30,
        });
        res.json({ ok: true, challenge: doc });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.delete('/api/challenge/:id', async (req, res) => {
    try {
        await FundedChallenge.deleteOne({ _id: req.params.id, userId: req.appUserId });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Challenge detail routes ────────────────────────────────────
const BNFUT = 'https://fapi.binance.com/fapi/v1/ticker/price';

async function bnPrice(symbol) {
    const r = await fetch(`${BNFUT}?symbol=${symbol.toUpperCase()}`);
    const d = await r.json();
    return parseFloat(d.price);
}

async function recalcChallenge(challenge) {
    const uid = challenge.userId;
    const cid = challenge._id.toString();
    const trades = await ChallengeTrade.find({ challengeId: cid, userId: uid, status: 'closed' }).lean();
    const today  = new Date().toISOString().split('T')[0];

    let totalPnl = 0, dailyPnl = 0, wins = 0, losses = 0;
    let peakPnl = 0, totalDrawdown = 0, dailyDrawdown = 0;
    let runningPnl = 0;

    for (const t of trades) {
        const pnl = t.pnl || 0;
        totalPnl += pnl;
        runningPnl += pnl;
        if (runningPnl > peakPnl) peakPnl = runningPnl;
        const dd = runningPnl - peakPnl;
        if (dd < totalDrawdown) totalDrawdown = dd;
        const tDate = t.closedAt ? new Date(t.closedAt).toISOString().split('T')[0] : null;
        if (tDate === today) { dailyPnl += pnl; }
        if (pnl > 0) wins++; else losses++;
    }
    // Compute worst daily PnL among all days
    const byDay = {};
    for (const t of trades) {
        const d = t.closedAt ? new Date(t.closedAt).toISOString().split('T')[0] : 'unknown';
        byDay[d] = (byDay[d] || 0) + (t.pnl || 0);
    }
    for (const v of Object.values(byDay)) { if (v < dailyDrawdown) dailyDrawdown = v; }

    const maxDD     = challenge.accountSize * (challenge.maxTotalDrawdownPct / 100);
    const maxDayDD  = challenge.accountSize * (challenge.maxDailyDrawdownPct / 100);
    const target    = challenge.accountSize * (challenge.profitTargetPct / 100);
    let status = challenge.status === 'passed' || challenge.status === 'failed' ? challenge.status : 'active';
    if (status === 'active') {
        if (totalPnl >= target)             status = 'passed';
        else if (-dailyPnl >= maxDayDD)     status = 'failed';
        else if (-totalDrawdown >= maxDD)   status = 'failed';
    }

    await FundedChallenge.updateOne({ _id: challenge._id }, {
        totalPnl, dailyPnl, dailyDate: today, peakPnl,
        dailyDrawdown, totalDrawdown, tradesCount: trades.length, wins, losses, status,
    });
    return { totalPnl, dailyPnl, dailyDrawdown, totalDrawdown, wins, losses, tradesCount: trades.length, status };
}

app.get('/api/challenge/:id', async (req, res) => {
    try {
        const doc = await FundedChallenge.findOne({ _id: req.params.id, userId: req.appUserId }).lean();
        if (!doc) return res.status(404).json({ ok: false, error: 'Not found' });
        res.json({ ok: true, challenge: doc });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/challenge/:id/trades', async (req, res) => {
    try {
        const trades = await ChallengeTrade.find({ challengeId: req.params.id, userId: req.appUserId })
            .sort({ openedAt: -1 }).lean();
        res.json({ ok: true, trades });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/challenge/:id/trades/open', async (req, res) => {
    try {
        const trades = await ChallengeTrade.find({ challengeId: req.params.id, userId: req.appUserId, status: 'open' })
            .sort({ openedAt: -1 }).lean();
        res.json({ ok: true, trades });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/challenge/:id/trade/place', async (req, res) => {
    try {
        const challenge = await FundedChallenge.findOne({ _id: req.params.id, userId: req.appUserId });
        if (!challenge) return res.status(404).json({ ok: false, error: 'Challenge not found' });
        if (challenge.status !== 'active') return res.status(400).json({ ok: false, error: 'Challenge is not active' });
        const { symbol, side, orderType, quantity, leverage, sl, tp } = req.body;
        if (!symbol || !side || !quantity) return res.status(400).json({ ok: false, error: 'symbol, side, quantity required' });
        if (!sl || !tp) return res.status(400).json({ ok: false, error: 'Stop loss and take profit are required' });
        // Fetch current price from Binance Futures
        const entryPrice = await bnPrice(symbol);
        const trade = await ChallengeTrade.create({
            userId: req.appUserId, challengeId: req.params.id,
            symbol: symbol.toUpperCase(), side: side.toLowerCase(),
            orderType: orderType || 'market',
            entryPrice, quantity: parseFloat(quantity),
            leverage: parseInt(leverage) || 1,
            sl: parseFloat(sl), tp: parseFloat(tp),
            status: 'open',
        });
        res.json({ ok: true, trade });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/challenge/:id/trade/close', async (req, res) => {
    try {
        const challenge = await FundedChallenge.findOne({ _id: req.params.id, userId: req.appUserId });
        if (!challenge) return res.status(404).json({ ok: false, error: 'Challenge not found' });
        const { tradeId } = req.body;
        if (!tradeId) return res.status(400).json({ ok: false, error: 'tradeId required' });
        const trade = await ChallengeTrade.findOne({ _id: tradeId, challengeId: req.params.id, userId: req.appUserId, status: 'open' });
        if (!trade) return res.status(404).json({ ok: false, error: 'Open trade not found' });
        // Fetch current price
        const exitPrice = await bnPrice(trade.symbol);
        // Calculate PnL: (exitPrice - entryPrice) / entryPrice * quantity * leverage * (side === 'long' ? 1 : -1)
        const dir  = trade.side === 'long' ? 1 : -1;
        const pnl  = ((exitPrice - trade.entryPrice) / trade.entryPrice) * trade.quantity * (trade.leverage || 1) * dir;
        const rrAchieved = trade.sl && trade.tp
            ? parseFloat((Math.abs(exitPrice - trade.entryPrice) / Math.abs(trade.sl - trade.entryPrice)).toFixed(2))
            : null;
        await ChallengeTrade.updateOne({ _id: tradeId }, { exitPrice, pnl, rrAchieved, status: 'closed', closedAt: new Date() });
        const metrics = await recalcChallenge(challenge);
        res.json({ ok: true, exitPrice, pnl, metrics });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/challenge/:id/daily-pnl', async (req, res) => {
    try {
        const challenge = await FundedChallenge.findOne({ _id: req.params.id, userId: req.appUserId }).lean();
        if (!challenge) return res.status(404).json({ ok: false, error: 'Not found' });
        const trades = await ChallengeTrade.find({ challengeId: req.params.id, userId: req.appUserId, status: 'closed' }).lean();
        const byDay = {};
        for (const t of trades) {
            const d = t.closedAt ? new Date(t.closedAt).toISOString().split('T')[0] : null;
            if (!d) continue;
            byDay[d] = (byDay[d] || 0) + (t.pnl || 0);
        }
        // Fill dates from startDate to today
        const start  = new Date(challenge.startDate);
        const end    = new Date();
        const result = [];
        let running  = 0;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const ds  = d.toISOString().split('T')[0];
            const pnl = byDay[ds] || 0;
            running  += pnl;
            result.push({ date: ds, pnl: parseFloat(pnl.toFixed(2)), running: parseFloat(running.toFixed(2)) });
        }
        res.json({ ok: true, data: result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Dashboard summary ──────────────────────────────────────────
async function dashBybitReq(creds, method, path, params = {}) {
    const crypto = require('crypto');
    const base   = creds.env === 'testnet' ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';
    const ts     = Date.now().toString();
    const recv   = '20000';
    const qs     = new URLSearchParams(params).toString();
    const sign   = crypto.createHmac('sha256', creds.apiSecret).update(ts + creds.apiKey + recv + qs).digest('hex');
    const r = await fetch(`${base}${path}${qs ? '?' + qs : ''}`, {
        headers: { 'X-BAPI-API-KEY': creds.apiKey, 'X-BAPI-SIGN': sign, 'X-BAPI-TIMESTAMP': ts, 'X-BAPI-RECV-WINDOW': recv },
    });
    return r.json();
}

function dashCalcRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) gains += d; else losses -= d;
    }
    let avgG = gains / period, avgL = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        avgG = (avgG * (period - 1) + Math.max(0, d)) / period;
        avgL = (avgL * (period - 1) + Math.max(0, -d)) / period;
    }
    return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
}

app.get('/api/dashboard/summary', async (req, res) => {
    try {
        const bybitDoc = await BybitStore.findOne({ userId: req.appUserId }).lean();
        const env      = bybitDoc?.activeEnv || 'mainnet';
        const cred     = bybitDoc?.[env];
        const creds    = cred?.apiKey && cred?.apiSecret ? { ...cred, env } : null;

        let balance = { available: 0, total: 0, mode: env };
        if (creds) {
            try {
                const r = await dashBybitReq(creds, 'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
                const w = r.result?.list?.[0];
                balance.total     = parseFloat(w?.totalEquity)           || 0;
                balance.available = parseFloat(w?.totalAvailableBalance) || 0;
            } catch {}
        }

        let openPositions = [];
        if (creds) {
            try {
                const r = await dashBybitReq(creds, 'GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
                openPositions = (r.result?.list || []).filter(p => +p.size > 0);
            } catch {}
        }
        const primaryPos = openPositions[0] || null;
        let openPosition = null;
        if (primaryPos) {
            const ep   = parseFloat(primaryPos.avgPrice);
            const mp   = parseFloat(primaryPos.markPrice);
            const upnl = parseFloat(primaryPos.unrealisedPnl);
            const pct  = ep > 0 ? (upnl / (ep * parseFloat(primaryPos.size))) * 100 : 0;
            openPosition = { symbol: primaryPos.symbol, side: primaryPos.side, entryPrice: ep, markPrice: mp, unrealizedPnl: upnl, pnlPercent: parseFloat(pct.toFixed(2)) };
        }

        const wlDoc  = await Watchlist.findOne({ userId: req.appUserId }).lean();
        const syms   = (wlDoc?.symbols || []).filter(Boolean);
        const openSymMap = {};
        openPositions.forEach(p => { openSymMap[p.symbol] = parseFloat(p.unrealisedPnl); });

        const watchlist = await Promise.all(syms.map(async sym => {
            try {
                const [tkRes, klRes] = await Promise.all([
                    fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`).then(r => r.json()),
                    fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=5m&limit=50`).then(r => r.json()),
                ]);
                const price    = parseFloat(tkRes.lastPrice) || 0;
                const change24 = parseFloat(tkRes.priceChangePercent) || 0;
                const closes   = Array.isArray(klRes) ? klRes.map(c => parseFloat(c[4])) : [];
                const rsi      = dashCalcRSI(closes);
                const hasPos   = sym in openSymMap;
                return { symbol: sym, price, rsi: parseFloat(rsi.toFixed(1)), change24h: parseFloat(change24.toFixed(2)), hasPosition: hasPos, positionPnl: hasPos ? openSymMap[sym] : null };
            } catch {
                return { symbol: sym, price: 0, rsi: 50, change24h: 0, hasPosition: sym in openSymMap, positionPnl: null };
            }
        }));

        res.json({ balance, openPosition, watchlist });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dashboard tab endpoints ─────────────────────────────────────
async function getDashCreds(userId) {
    const doc  = await BybitStore.findOne({ userId }).lean();
    const env  = doc?.activeEnv || 'mainnet';
    const cred = doc?.[env];
    if (!cred?.apiKey || !cred?.apiSecret) return null;
    return { ...cred, env };
}
app.get('/api/dashboard/spot-assets', async (req, res) => {
    try {
        const creds = await getDashCreds(req.appUserId);
        if (!creds) return res.json({ ok: true, coins: [] });
        const r = await dashBybitReq(creds, 'GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' });
        const coins = (r.result?.list?.[0]?.coin || []).filter(c =>
            parseFloat(c.walletBalance) > 0 || parseFloat(c.usdValue) > 0
        );
        res.json({ ok: true, coins });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/dashboard/futures-positions', async (req, res) => {
    try {
        const creds = await getDashCreds(req.appUserId);
        if (!creds) return res.json({ ok: true, positions: [] });
        const r = await dashBybitReq(creds, 'GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
        const positions = (r.result?.list || []).filter(p => +p.size > 0);
        res.json({ ok: true, positions });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.get('/api/dashboard/orders', async (req, res) => {
    try {
        const creds = await getDashCreds(req.appUserId);
        if (!creds) return res.json({ ok: true, orders: [] });
        const r = await dashBybitReq(creds, 'GET', '/v5/order/realtime', { category: 'linear', settleCoin: 'USDT' });
        const orders = r.result?.list || [];
        res.json({ ok: true, orders });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});
// ═══════════════════════════════════════════════════════════════
app.get('/api/autopilot/status', async (req, res) => {
    try { res.json(await autopilot.getStatus(req.appUserId)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/autopilot/start', async (req, res) => {
    try { await autopilot.apStart(req.appUserId, req.body); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/autopilot/stop', async (req, res) => {
    try { autopilot.apStop(req.appUserId); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Scan Setups ────────────────────────────────────────────────
const setupsScanRunning = new Set();
app.post('/api/scan/setups', checkPremium, async (req, res) => {
    const uid = req.appUserId;
    if (setupsScanRunning.has(uid)) return res.json({ ok: false, error: 'Scan already in progress' });
    try {
        const user = await User.findById(uid).select('accountTier').lean();
        const { runHardFilterScan } = require('./coinScanner');
        setupsScanRunning.add(uid);
        res.json({ ok: true });
        runHardFilterScan({ accountTier: user?.accountTier || 'free' }, (event, data) => {
            io.to(uid).emit(event, data);
        }).catch(e => {
            io.to(uid).emit('setups:done', { error: e.message, candidates: [] });
        }).finally(() => { setupsScanRunning.delete(uid); });
    } catch (e) {
        setupsScanRunning.delete(uid);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  DISCORD INTEGRATION
// ═══════════════════════════════════════════════════════════════

app.get('/api/discord/config', requireActiveAuth, async (req, res) => {
    try {
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        res.json(doc?.discord || {});
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/discord/config', requireActiveAuth, async (req, res) => {
    try {
        const { webhookUrl, alerts } = req.body;
        await upsert(Settings, { discord: { webhookUrl: webhookUrl || '', alerts: alerts || {} } }, req.appUserId);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/discord/test', requireActiveAuth, async (req, res) => {
    try {
        const { webhookUrl } = req.body;
        if (!webhookUrl) return res.json({ ok: false, error: 'No webhook URL provided' });
        const resp = await fetch(webhookUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ embeds: [{ title: '✅ Scanr Notifications Connected', description: 'Discord alerts are working correctly.\nYou will receive trade notifications here.', color: 0x00e5a0 }] }),
        });
        if (!resp.ok) throw new Error(`Discord returned ${resp.status}`);
        res.json({ ok: true });
    } catch(e) { res.json({ ok: false, error: e.message }); }
});

// Called from frontend after placing an order to send Discord notification (server-side only)
app.post('/api/discord/notify/order', requireActiveAuth, async (req, res) => {
    res.json({ ok: true }); // respond instantly
    try {
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        if (doc?.discord?.webhookUrl && doc?.discord?.alerts?.orderSummary !== false) {
            sendDiscordAlert(doc.discord.webhookUrl, orderSummaryEmbed(req.body));
        }
    } catch(_) {}
});

// ═══════════════════════════════════════════════════════════════
//  PRICE ALERTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/alerts/price', requireActiveAuth, async (req, res) => {
    try {
        const alerts = await PriceAlert.find({ userId: req.appUserId, triggered: false }).sort({ createdAt: -1 }).lean();
        res.json(alerts);
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/alerts/price', requireActiveAuth, async (req, res) => {
    try {
        const { symbol, targetPrice, direction, currentPriceWhenSet } = req.body;
        if (!symbol || !targetPrice || !direction) return res.status(400).json({ error: 'Missing fields' });
        const count = await PriceAlert.countDocuments({ userId: req.appUserId, triggered: false });
        if (count >= 10) return res.status(400).json({ error: 'Max 10 active alerts allowed' });
        const alert = await PriceAlert.create({ userId: req.appUserId, symbol: symbol.toUpperCase(), targetPrice: parseFloat(targetPrice), direction, currentPriceWhenSet: parseFloat(currentPriceWhenSet) || 0 });
        res.json({ ok: true, alert });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/alerts/price/:id', requireActiveAuth, async (req, res) => {
    try {
        await PriceAlert.deleteOne({ _id: req.params.id, userId: req.appUserId });
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  AI ANALYSIS ROUTES
// ═══════════════════════════════════════════════════════════════

// Get AI settings — with migration from legacy KimiSettings collection
app.get('/api/ai/settings', requireActiveAuth, async (req, res) => {
    try {
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        const ai  = doc?.ai || {};
        // Migration: if no kimiApiKey yet, pull from legacy KimiSettings
        if (!ai.kimiApiKey) {
            const legacy = await KimiSettings.findOne({ userId: req.appUserId }).lean();
            if (legacy?.apiKey) ai.kimiApiKey = legacy.apiKey;
        }
        res.json({ provider: ai.provider === 'gemini' ? 'glm' : (ai.provider || 'glm'), kimiApiKey: ai.kimiApiKey || '', glmApiKey: ai.glmApiKey || '', claudeApiKey: ai.claudeApiKey || '' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/settings', requireActiveAuth, async (req, res) => {
    try {
        const { provider, kimiApiKey, glmApiKey, claudeApiKey } = req.body;
        await upsert(Settings, { ai: { provider: provider || 'glm', kimiApiKey: kimiApiKey || '', glmApiKey: glmApiKey || '', claudeApiKey: claudeApiKey || '' } }, req.appUserId);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai/test', requireActiveAuth, async (req, res) => {
    try {
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        const result = await testAIProvider(doc);
        res.json(result);
    } catch(e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/analysis/usage', requireActiveAuth, async (req, res) => {
    try {
        const user = await User.findById(req.appUserId).select('accountTier aiAnalysisCount aiAnalysisDate aiAnalysisTimezone').lean();
        if (!user) return res.status(401).json({ error: 'Not authenticated' });

        const tz = normalizeTimezone(user.aiAnalysisTimezone || 'UTC');
        const today = getTodayInTimezone(tz);
        const resetNeeded = user.aiAnalysisDate !== today;
        const used = resetNeeded ? 0 : (user.aiAnalysisCount || 0);

        if (resetNeeded) {
            await User.findByIdAndUpdate(req.appUserId, { aiAnalysisCount: 0, aiAnalysisDate: today, aiAnalysisTimezone: tz });
        }

        const isPremium = user.accountTier === 'premium';
        res.json({
            used: isPremium ? 0 : used,
            limit: 3,
            isPremium,
            resetsAt: getNextMidnightIsoForTimezone(tz),
            timezone: tz,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Proxy AI analysis — frontend sends prompt, server calls selected provider
async function handleAiAnalyze(req, res) {
    try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ ok: false, error: 'No prompt provided' });
        let settings = await Settings.findOne({ userId: req.appUserId }).lean();
        // Migration fallback: pull kimi key from legacy collection if needed
        if (!settings?.ai?.kimiApiKey) {
            const legacy = await KimiSettings.findOne({ userId: req.appUserId }).lean();
            if (legacy?.apiKey) {
                if (!settings) settings = {};
                if (!settings.ai) settings.ai = {};
                settings.ai.kimiApiKey = legacy.apiKey;
            }
        }
        const raw = await analyzeWithAI(prompt, settings);

        if (!req.aiLimit?.isPremium) {
            await User.findByIdAndUpdate(req.appUserId, {
                aiAnalysisCount: (req.aiLimit?.used || 0) + 1,
                aiAnalysisDate: req.aiLimit?.today || getTodayInTimezone(req.aiLimit?.timezone || 'UTC'),
                aiAnalysisTimezone: req.aiLimit?.timezone || 'UTC',
            });
        }

        res.json({ ok: true, result: raw });
    } catch(e) {
        const msg = e.message || 'AI analysis failed';
        res.json({ ok: false, error: msg });
    }
}

app.post('/api/ai/analyze', requireActiveAuth, checkAiAnalysisLimit, handleAiAnalyze);
app.post('/api/analysis/analyze', requireActiveAuth, checkAiAnalysisLimit, handleAiAnalyze);

// ═══════════════════════════════════════════════════════════════
//  SPA PAGE ROUTES
// ═══════════════════════════════════════════════════════════════
const PUB = (name) => path.join(__dirname, 'public', name);

// Public auth pages
app.get('/login',    (req, res) => res.sendFile(PUB('login.html')));
app.get('/register', (req, res) => res.sendFile(PUB('register.html')));

// Public landing pages (no auth required)
app.get('/',            (req, res) => res.sendFile(PUB('home.html')));
app.get('/features',    (req, res) => res.sendFile(PUB('features.html')));
app.get('/pricing',     (req, res) => res.sendFile(PUB('pricing.html')));
app.get('/setup-guide', (req, res) => res.sendFile(PUB('setup-guide.html')));
app.get('/terms',       (req, res) => res.sendFile(PUB('terms.html')));
app.get('/privacy',     (req, res) => res.sendFile(PUB('privacy.html')));
app.get('/refund',      (req, res) => res.sendFile(PUB('refund.html')));

// Requires login but not active license
app.get('/license',   requireAuth, (req, res) => res.sendFile(PUB('license.html')));
app.get('/suspended', requireAuth, (req, res) => res.sendFile(PUB('suspended.html')));
app.get('/payment',   requireAuth, (req, res) => res.sendFile(PUB('payment.html')));
app.get('/payments',  requireAuth, (req, res) => res.redirect('/payment'));
app.get('/referral',  requireAuth, (req, res) => res.redirect('/dashboard'));

// Admin only
app.get('/admin', requireAdmin, (req, res) => res.sendFile(PUB('admin.html')));

// App pages — require active license
const DASHBOARD = PUB('dashboard.html');
const SETTINGS  = PUB('settings.html');
const TERMINAL  = PUB('terminal.html');
app.get('/dashboard',  requireActiveAuth, (req, res) => res.sendFile(DASHBOARD));
app.get('/scanner',    requireActiveAuth, (req, res) => res.sendFile(PUB('index.html')));
app.get('/settings',   requireActiveAuth, (req, res) => res.sendFile(SETTINGS));
app.get('/terminal',   requireActiveAuth, (req, res) => res.sendFile(TERMINAL));
app.get('/setups',     requireActiveAuth, (req, res) => res.sendFile(PUB('setups.html')));
app.get('/coin-detail',requireActiveAuth, (req, res) => res.sendFile(PUB('pages/coin-detail.html')));
app.get('/calendar',   requireActiveAuth, (req, res) => res.sendFile(PUB('calendar.html')));
app.get('/challenge',  requireActiveAuth, (req, res) => res.sendFile(PUB('challenge.html')));
app.get('/challenge/:id', requireActiveAuth, (req, res) => res.sendFile(PUB('challenge-detail.html')));
app.get('/strategy',  requireActiveAuth, (req, res) => res.sendFile(PUB('strategy.html')));
app.get('*',           requireActiveAuth, (req, res) => res.sendFile(PUB('index.html')));

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
async function createAdminIfNeeded() {
    const existing = await User.findOne({ role: 'admin' });
    if (existing) return;
    const email    = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
        console.log('No ADMIN_EMAIL/ADMIN_PASSWORD in .env — skipping admin creation.');
        return;
    }
    const hash = await bcrypt.hash(password, 10);
    await User.create({ firstName: 'Admin', lastName: '', email: email.toLowerCase(), password: hash, role: 'admin', licenseStatus: 'active' });
    console.log(`Admin account created: ${email}`);
}

// Price alert checker — runs every 30 seconds
async function checkPriceAlerts() {
    try {
        const alerts = await PriceAlert.find({ triggered: false }).lean();
        if (!alerts.length) return;
        // Group by symbol to batch fetch
        const symbols = [...new Set(alerts.map(a => a.symbol))];
        const prices = {};
        await Promise.all(symbols.map(async sym => {
            try {
                const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`);
                const j = await r.json();
                if (j.price) prices[sym] = parseFloat(j.price);
            } catch(_) {}
        }));
        for (const alert of alerts) {
            const currentPrice = prices[alert.symbol];
            if (!currentPrice) continue;
            const triggered =
                (alert.direction === 'above' && currentPrice >= alert.targetPrice) ||
                (alert.direction === 'below' && currentPrice <= alert.targetPrice);
            if (!triggered) continue;
            await PriceAlert.findByIdAndUpdate(alert._id, { triggered: true, triggeredAt: new Date() });
            // Emit to user's socket room
            io.to(alert.userId).emit('price_alert:triggered', { ...alert, currentPrice });
            // Send Discord notification
            try {
                const settings = await Settings.findOne({ userId: alert.userId }).lean();
                if (settings?.discord?.webhookUrl && settings?.discord?.alerts?.priceAlert !== false) {
                    sendDiscordAlert(settings.discord.webhookUrl, priceAlertEmbed({ symbol: alert.symbol, targetPrice: alert.targetPrice, currentPrice, direction: alert.direction }));
                }
            } catch(_) {}
        }
    } catch(e) { console.error('[PriceAlerts] checker error:', e.message); }
}

connectDB()
    .then(async () => {
        // Drop stale singleton_1 index from AppSettings (leftover from old schema)
        try { await AppSettings.collection.dropIndex('singleton_1'); } catch (_) {}
        await createAdminIfNeeded();
        // One-time cleanup for removed social posting collections
        try {
            await mongoose.connection.db.collection('twi' + 'ttersettings').deleteMany({});
            await mongoose.connection.db.collection('twi' + 'tterposthistories').deleteMany({});
        } catch (e) {
            console.warn('[Startup cleanup] Removed collections cleanup skipped:', e.message);
        }
        // One-time cleanup for removed AI Agent collections
        try {
            const cleanupKey = '__agent_cleanup_done__';
            const done = await AppSettings.findOne({ key: cleanupKey }).lean();
            if (!done) {
                const namesToDrop = ['agenttrades', 'agentsettings', 'agentlogs', 'agentsessions', 'agentstates'];
                const existing = await mongoose.connection.db.listCollections().toArray();
                const existingSet = new Set(existing.map(c => c.name));
                for (const name of namesToDrop) {
                    if (existingSet.has(name)) await mongoose.connection.db.dropCollection(name);
                }
                await AppSettings.updateOne(
                    { key: cleanupKey },
                    { $set: { value: new Date().toISOString() } },
                    { upsert: true }
                );
            }
        } catch (e) {
            console.warn('[Startup cleanup] Agent collections cleanup skipped:', e.message);
        }
        // ── Migrate existing premium license users to new tier system ──
        try {
            const migrationKey = '__premium_tier_migration_done__';
            const migrated = await AppSettings.findOne({ key: migrationKey }).lean();
            if (!migrated) {
                const result = await User.updateMany(
                    { licenseStatus: 'active' },
                    { 
                        $set: { 
                            accountTier: 'premium',
                            premiumActivatedAt: new Date(),
                            premiumPlan: 'lifetime'
                        } 
                    }
                );
                console.log(`[Startup migration] Upgraded ${result.modifiedCount} users with active licenses to premium tier`);
                await AppSettings.updateOne(
                    { key: migrationKey },
                    { $set: { value: new Date().toISOString() } },
                    { upsert: true }
                );
            }
        } catch (e) {
            console.warn('[Startup migration] Premium tier migration skipped:', e.message);
        }
        httpServer.listen(PORT, () => {
            console.log(`\n╔═══════════════════════════════════════════════════╗`);
            console.log(`║  🚀 RSI + MACD Scanner running at http://localhost:${PORT}  ║`);
            console.log(`║  ✅ SETUPS ROUTES REGISTERED (before middleware)   ║`);
            console.log(`╚═══════════════════════════════════════════════════╝\n`);
        });
        await autopilot.resumeOnBoot();
        await strategyBot.resumeActiveBots();
        setInterval(checkPriceAlerts, 30000);
    })
    .catch(err => {
        console.error('Failed to connect to MongoDB:', err.message);
        process.exit(1);
    });

