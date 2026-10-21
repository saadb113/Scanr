const path     = require('path');
const fs       = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express  = require('express');
const http     = require('http');
const session  = require('express-session');
const bcrypt   = require('bcrypt');
const cors     = require('cors');
const { Server } = require('socket.io');
const { connectDB } = require('./db');
const tgBot = require('./telegramBot');
const {
    User, License, AppSettings,
    Settings, Watchlist, FilterVis, PosSettings,
    Drawings, KimiSettings, KimiCache, BybitStore,
    AgentSettings, AgentSession, AgentTrade, AgentState,
    FundedChallenge, ChallengeTrade, Contact,
    Strategy, BotTrade, PriceAlert,
} = require('./models');
const autopilot      = require('./autopilot');
const dayAgent       = require('./dayAgent');
const strategyRoutes = require('./strategy_routes');
const strategyBot    = require('./strategyBot');
const { sendDiscordAlert, orderSummaryEmbed, priceAlertEmbed } = require('./discordNotifier');
const { sendTelegramMessage, orderSummaryText, priceAlertText } = require('./telegramNotifier');
const { analyzeWithAI, testAIProvider }                        = require('./aiAnalysis');

const app        = express();
const httpServer = http.createServer(app);
const PORT  = process.env.PORT || 3000;
const USER  = 'default';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
// Frontend origin(s) allowed to call this API cross-origin (Vercel frontend
// talking to this Render backend). Comma-separated for multiple (e.g. a
// preview deployment URL alongside the production one). Same-origin/local
// dev (Vite proxy) never needs this — it's only for split hosting.
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
// In production, reflecting any origin while allowing credentials is a real
// CSRF-style hole — only do that in local dev (convenient, and same-origin
// requests don't hit CORS at all anyway). Production with no FRONTEND_URL
// configured just has cross-origin calls denied, same-origin unaffected.
const corsOptions = {
    origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : !IS_PRODUCTION,
    credentials: true,
};
if (IS_PRODUCTION && !ALLOWED_ORIGINS.length) {
    console.warn('[CORS] FRONTEND_URL is not set — cross-origin requests will be denied.');
}

// Render terminates TLS in front of this app, so trust its proxy headers —
// required for `cookie.secure` below to work correctly.
if (IS_PRODUCTION) app.set('trust proxy', 1);

const io = new Server(httpServer, { cors: corsOptions });
dayAgent.setIO(io);
strategyBot.setIO(io);

app.use(cors(corsOptions));
app.use(express.json({ limit: '4mb' }));
const sessionMW = session({
    secret:            process.env.SESSION_SECRET || 'monty-fallback-secret',
    resave:            false,
    saveUninitialized: false,
    cookie: {
        maxAge:   7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        // Cross-origin (Vercel <-> Render) cookies require SameSite=None + Secure,
        // which in turn requires HTTPS — true in production, not in local dev.
        sameSite: IS_PRODUCTION ? 'none' : 'lax',
        secure:   IS_PRODUCTION,
    },
});
app.use(sessionMW);

// Share express-session with Socket.io so sockets know their userId
io.use((socket, next) => {
    const mockRes = { getHeader:()=>{}, setHeader:()=>{}, end:()=>{}, writeHead:()=>{}, on:()=>{}, once:()=>{}, removeListener:()=>{} };
    sessionMW(socket.request, mockRes, next);
});
io.on('connection', socket => {
    const uid = socket.request.session?.userId;
    if (uid) socket.join(uid);
});
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── helper: upsert single-user doc ────────────────────────────────────────
async function upsert(Model, update, uid) {
    return Model.findOneAndUpdate(
        { userId: uid || USER },
        { $set: update },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
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

// Requires logged-in session only (no license check)
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
        return res.redirect('/login');
    }
    req.appUserId = req.session.userId;
    next();
}

// Requires logged-in + active license (or admin)
async function requireActiveAuth(req, res, next) {
    // req.originalUrl (not req.path) because this is also mounted via
    // app.use('/api/', requireActiveAuth) — inside that middleware, req.path is
    // relative to the mount point (e.g. '/dashboard/summary'), which always failed
    // the '/api/' prefix check and silently redirected API callers to HTML pages
    // instead of returning JSON errors. req.originalUrl keeps the full request path.
    if (!req.session.userId) {
        if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
        return res.redirect('/login');
    }
    try {
        const user = await User.findById(req.session.userId).lean();
        if (!user) {
            req.session.destroy(() => {});
            if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
            return res.redirect('/login');
        }
        // Single-session enforcement: check session token (skip for admin)
        if (user.role !== 'admin' && req.session.sessionToken && user.activeSessionToken) {
            if (user.activeSessionToken !== req.session.sessionToken) {
                req.session.destroy(() => {});
                if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'session_ended', message: 'Your session was ended because your account was accessed from another location.' });
                return res.redirect('/login');
            }
        }
        req.appUserId = req.session.userId;
        if (user.role === 'admin') return next();
        if (user.licenseStatus === 'suspended') {
            if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'License suspended' });
            return res.redirect('/suspended');
        }
        if (user.licenseStatus === 'active' && user.licenseExpiresAt && new Date() > new Date(user.licenseExpiresAt)) {
            await Promise.all([
                User.findByIdAndUpdate(req.session.userId, { licenseStatus: 'suspended' }),
                License.findOneAndUpdate({ licenseKey: user.licenseKey }, { status: 'suspended' }),
            ]);
            if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'License expired' });
            return res.redirect('/suspended?reason=expired');
        }
        if (user.licenseStatus !== 'active') {
            if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'License not active' });
            return res.redirect('/license');
        }
        next();
    } catch (e) { res.status(500).json({ error: e.message }); }
}

// Requires admin role
function requireAdmin(req, res, next) {
    if (!req.session.userId || req.session.role !== 'admin') {
        if (req.originalUrl.startsWith('/api/')) return res.status(403).json({ error: 'Admin only' });
        return res.redirect('/');
    }
    next();
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
        req.session.userId = user._id.toString();
        req.session.role   = user.role;
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
        req.session.userId       = user._id.toString();
        req.session.role         = user.role;
        req.session.sessionToken = sessionToken;
        res.json({ ok: true, licenseStatus: user.licenseStatus, role: user.role });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
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
        const user = await User.findById(userId).select('activeSessionToken role').lean();
        if (!user) return res.status(401).json({ reason: 'user_not_found' });
        if (user.role !== 'admin' && req.session.sessionToken && user.activeSessionToken) {
            if (user.activeSessionToken !== req.session.sessionToken) {
                return res.status(401).json({ reason: 'session_replaced' });
            }
        }
        res.json({ valid: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        await License.findByIdAndUpdate(license._id, {
            status:              'active',
            activatedByUserId:   req.session.userId,
            activatedAt:         new Date(),
            deviceFingerprint:   deviceFingerprint || '',
            $addToSet:           { ipHistory: ip },
        });
        await User.findByIdAndUpdate(req.session.userId, {
            licenseKey:          license.licenseKey,
            licenseStatus:       'active',
            licenseActivatedAt:  new Date(),
            licenseExpiresAt:    license.expiresAt || null,
            deviceFingerprint:   deviceFingerprint || '',
        });
        req.session.licenseStatus = 'active';
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/license/status', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('licenseStatus licenseKey').lean();
        res.json({ status: user?.licenseStatus || 'inactive', key: user?.licenseKey });
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
        const { whatsapp, appName, telegramBotToken } = req.body;
        await AppSettings.findOneAndUpdate({ key: 'whatsapp' }, { key: 'whatsapp', value: whatsapp || '' }, { upsert: true });
        await AppSettings.findOneAndUpdate({ key: 'appName'  }, { key: 'appName',  value: appName  || '' }, { upsert: true });
        if (telegramBotToken !== undefined) {
            await AppSettings.findOneAndUpdate({ key: 'telegramBotToken' }, { key: 'telegramBotToken', value: telegramBotToken.trim() }, { upsert: true });
            tgBot.stopTelegramPolling();
            tgBot.startTelegramPolling();
        }
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Public: fetch WhatsApp number for license/suspended pages
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
        await Contact.create({ name, email, phone: phone || '', message });
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

// ═══════════════════════════════════════════════════════════════
//  ALL OTHER /api/* ROUTES REQUIRE ACTIVE AUTH
// ═══════════════════════════════════════════════════════════════
app.use('/api/', requireActiveAuth);
app.use('/api/strategy', strategyRoutes);

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
app.get('/api/pnl-calendar', async (req, res) => {
    try {
        // Use AgentTrade.closedAt grouped by date in UTC+5 (PKT) timezone
        const TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5
        const trades = await AgentTrade.find({
            userId: req.appUserId,
            closedAt: { $exists: true, $ne: null }
        }).lean();
        const data = {};
        for (const t of trades) {
            if (!t.closedAt || !t.pnl) continue;
            // Convert ISO timestamp to UTC+5 date string
            const ts = new Date(t.closedAt).getTime();
            if (isNaN(ts)) continue;
            const localDate = new Date(ts + TZ_OFFSET_MS);
            const dateStr = localDate.toISOString().slice(0, 10); // YYYY-MM-DD
            if (!data[dateStr]) data[dateStr] = { pnl: 0, trades: 0, wins: 0, losses: 0 };
            data[dateStr].pnl    += parseFloat(t.pnl || 0);
            data[dateStr].trades += 1;
            if ((t.pnl || 0) > 0) data[dateStr].wins++;
            else data[dateStr].losses++;
        }
        // Round PnL values
        for (const d of Object.keys(data)) data[d].pnl = parseFloat(data[d].pnl.toFixed(2));
        // Fallback: also include AgentSession data if no trades found
        if (!trades.length) {
            const sessions = await AgentSession.find({ userId: req.appUserId, date: { $exists: true } }).lean();
            for (const s of sessions) {
                if (!s.date) continue;
                data[s.date] = {
                    pnl:    parseFloat((s.totalPnl || 0).toFixed(2)),
                    trades: s.tradesTaken || 0,
                    wins:   s.wins || 0,
                    losses: s.losses || 0,
                };
            }
        }
        res.json({ ok: true, data });
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
app.post('/api/scan/setups', async (req, res) => {
    const uid = req.appUserId;
    if (setupsScanRunning.has(uid)) return res.json({ ok: false, error: 'Scan already in progress' });
    try {
        const { runHardFilterScan } = require('./coinScanner');
        const agDoc = await AgentSettings.findOne({ userId: uid }).lean();
        setupsScanRunning.add(uid);
        res.json({ ok: true });
        runHardFilterScan(agDoc || {}, (event, data) => {
            io.to(uid).emit(event, data);
        }, uid).catch(e => {
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

app.get('/api/telegram/config', requireActiveAuth, async (req, res) => {
    try {
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        const botUsername = tgBot.getBotUsername();
        res.json({ telegram: doc?.telegram || {}, botUsername });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/telegram/config', requireActiveAuth, async (req, res) => {
    try {
        const { alerts } = req.body;
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        const currentTg = doc?.telegram || {};
        await upsert(Settings, { telegram: { ...currentTg, alerts: alerts || currentTg.alerts || {} } }, req.appUserId);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/telegram/disconnect', requireActiveAuth, async (req, res) => {
    try {
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        const currentTg = doc?.telegram || {};
        currentTg.chatId = null; // Unlink
        await upsert(Settings, { telegram: currentTg }, req.appUserId);
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/telegram/test', requireActiveAuth, async (req, res) => {
    try {
        const doc = await Settings.findOne({ userId: req.appUserId }).lean();
        const chatId = doc?.telegram?.chatId;
        const botToken = tgBot.getBotToken();
        if (!botToken) return res.json({ ok: false, error: 'Admin has not configured Telegram' });
        if (!chatId) return res.json({ ok: false, error: 'Link your Telegram account first' });
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        const text = '✅ <b>Scanr Notifications Connected</b>\n\nTelegram alerts are working correctly.\nYou will receive trade notifications here.';
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
        if (!resp.ok) throw new Error(`Telegram API returned ${resp.status}`);
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
        if (doc?.telegram?.botToken && doc?.telegram?.chatId && doc?.telegram?.alerts?.orderSummary !== false) {
            sendTelegramMessage(doc.telegram.botToken, doc.telegram.chatId, orderSummaryText(req.body));
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

// Proxy AI analysis — frontend sends prompt, server calls selected provider
app.post('/api/ai/analyze', requireActiveAuth, async (req, res) => {
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
        res.json({ ok: true, result: raw });
    } catch(e) {
        const msg = e.message || 'AI analysis failed';
        res.json({ ok: false, error: msg });
    }
});

// ═══════════════════════════════════════════════════════════════
//  SPA PAGE ROUTES
//  The frontend (frontend/) is normally deployed separately (e.g. Vercel)
//  against this backend's API, so public-react/ won't exist here in that
//  setup — only API/socket routes above apply, and any other GET 404s as
//  JSON. If public-react/ IS present (a local single-origin build, built
//  via `npm run build` in frontend/), serve it with an SPA fallback so
//  React Router can resolve client-side routes too.
// ═══════════════════════════════════════════════════════════════
const REACT_BUILD = path.join(__dirname, 'public-react');
const REACT_INDEX = path.join(REACT_BUILD, 'index.html');
const hasReactBuild = fs.existsSync(REACT_INDEX);

if (hasReactBuild) {
    app.use(express.static(REACT_BUILD, { index: false }));
    app.get('*', (req, res) => res.sendFile(REACT_INDEX));
} else {
    app.get('*', (req, res) => res.status(404).json({ error: 'Not found' }));
}

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
                if (settings?.telegram?.botToken && settings?.telegram?.chatId && settings?.telegram?.alerts?.priceAlert !== false) {
                    sendTelegramMessage(settings.telegram.botToken, settings.telegram.chatId, priceAlertText({ symbol: alert.symbol, targetPrice: alert.targetPrice, currentPrice, direction: alert.direction }));
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
        tgBot.startTelegramPolling();
        httpServer.listen(PORT, () => {
            console.log(`RSI + MACD Scanner running at http://localhost:${PORT}`);
        });
        await autopilot.resumeOnBoot();
        await dayAgent.resumeOnBoot();
        await strategyBot.resumeActiveBots();
        setInterval(checkPriceAlerts, 30000);
    })
    .catch(err => {
        console.error('Failed to connect to MongoDB:', err.message);
        process.exit(1);
    });
