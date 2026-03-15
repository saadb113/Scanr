const mongoose = require('mongoose');

// ── Scanner settings (timeframe, RSI/MACD params, colors, symbol list, etc.) ──
const SettingsSchema = new mongoose.Schema({
    userId:         { type: String, default: 'default' },
    timeframe:      String,
    rsiLen:         Number,
    fastLen:        Number,
    slowLen:        Number,
    signalLen:      Number,
    cellSize:       Number,
    symbols:        [String],
    activeSort:     String,
    colors:         mongoose.Schema.Types.Mixed,
    visibility:     mongoose.Schema.Types.Mixed,
    priceType:      String,
    // Profile fields
    firstName:      String,
    lastName:       String,
    displayName:    String,
    profilePicture: String,
    appPin:         String,
    appPassword:    String,
    accentColor:    String,
    discord: {
        webhookUrl: { type: String, default: '' },
        alerts: {
            priceAlert:          { type: Boolean, default: true },
            orderSummary:        { type: Boolean, default: true },
            autopilotMilestone:  { type: Boolean, default: true },
            tpSlHit:             { type: Boolean, default: true },
            strategyBotAlerts:   { type: Boolean, default: true },
            aiAgentAlerts:       { type: Boolean, default: true },
        },
    },
    ai: {
        provider:     { type: String, default: 'glm' },   // 'glm' | 'kimi' | 'claude'
        kimiApiKey:   { type: String, default: '' },
        glmApiKey:    { type: String, default: '' },
        claudeApiKey: { type: String, default: '' },
    },
}, { timestamps: true });
SettingsSchema.index({ userId: 1 }, { unique: true });

// ── Price Alerts ──
const PriceAlertSchema = new mongoose.Schema({
    userId:              { type: String, required: true },
    symbol:              { type: String, required: true },
    targetPrice:         { type: Number, required: true },
    direction:           { type: String, required: true }, // 'above' | 'below'
    currentPriceWhenSet: { type: Number, default: 0 },
    triggered:           { type: Boolean, default: false },
    triggeredAt:         { type: Date, default: null },
    createdAt:           { type: Date, default: Date.now },
});

// ── Watchlist ──
const WatchlistSchema = new mongoose.Schema({
    userId:  { type: String, default: 'default' },
    symbols: [String],
}, { timestamps: true });
WatchlistSchema.index({ userId: 1 }, { unique: true });

// ── Filter visibility toggles ──
const FilterVisSchema = new mongoose.Schema({
    userId: { type: String, default: 'default' },
    state:  mongoose.Schema.Types.Mixed,   // { fAll: true, fOB: false, ... }
}, { timestamps: true });
FilterVisSchema.index({ userId: 1 }, { unique: true });

// ── Position calculator settings ──
const PosSettingsSchema = new mongoose.Schema({
    userId:        { type: String, default: 'default' },
    capital:       Number,
    riskPerTrade:  Number,
    risk:          Number,   // legacy alias — prefer riskPerTrade
    feeRate:       Number,
    accountType:   String,
}, { timestamps: true });
PosSettingsSchema.index({ userId: 1 }, { unique: true });

// ── Chart drawings — one doc per user, all symbols nested inside ──
// Structure: { userId, drawings: { "BTCUSDT": { "1h": [...objs] } } }
const DrawingsSchema = new mongoose.Schema({
    userId:   { type: String, default: 'default' },
    drawings: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
DrawingsSchema.index({ userId: 1 }, { unique: true });

// ── Kimi AI settings ──
const KimiSettingsSchema = new mongoose.Schema({
    userId:  { type: String, default: 'default' },
    apiKey:  String,
    model:   String,
    baseUrl: String,
}, { timestamps: true });
KimiSettingsSchema.index({ userId: 1 }, { unique: true });

// ── Kimi AI analysis cache — keyed by "SYM:TF" ──
const KimiCacheSchema = new mongoose.Schema({
    userId: { type: String, default: 'default' },
    cache:  mongoose.Schema.Types.Mixed,   // { "BTCUSDT:1h": { dir, tp, sl, ... } }
}, { timestamps: true });
KimiCacheSchema.index({ userId: 1 }, { unique: true });

// ── Bybit credentials & active account ──
const BybitStoreSchema = new mongoose.Schema({
    userId:    { type: String, default: 'default' },
    activeEnv: String,
    mainnet:   mongoose.Schema.Types.Mixed,   // { apiKey, apiSecret }
    testnet:   mongoose.Schema.Types.Mixed,
}, { timestamps: true });
BybitStoreSchema.index({ userId: 1 }, { unique: true });

// ── Autopilot persistent state ──
const AutopilotStateSchema = new mongoose.Schema({
    userId:    { type: String, default: 'default' },
    running:   { type: Boolean, default: false },
    position:  mongoose.Schema.Types.Mixed,   // { sym, entry, sl, initSl, tp, side, size, isLong }
    triggered: mongoose.Schema.Types.Mixed,   // { tp40, tp50, sl60 }
    livePrice: { type: Number, default: 0 },
    logs:      { type: [mongoose.Schema.Types.Mixed], default: [] },
    startedAt: Date,
}, { timestamps: true });
AutopilotStateSchema.index({ userId: 1 }, { unique: true });

// ── Visual Strategy Builder ──
const StrategySchema = new mongoose.Schema({
    userId:          { type: String, required: true },
    name:            { type: String, default: 'My Strategy' },
    blocks:          { type: mongoose.Schema.Types.Mixed, default: { filters: [], conditions: [], actions: [] } },
    pineScript:      { type: String, default: '' },
    isActive:        { type: Boolean, default: false },
    coins:           { type: [String], default: [] },
    timeframe:       { type: String, default: '5m' },
    scanInterval:    { type: Number, default: 30 },
    maxTradesPerDay: { type: Number, default: 3 },
}, { timestamps: true });

const BotTradeSchema = new mongoose.Schema({
    userId:        { type: String, required: true },
    strategyId:    { type: String, required: true },
    symbol:        { type: String, required: true },
    side:          { type: String, required: true },
    entryPrice:    { type: Number, default: 0 },
    exitPrice:     { type: Number, default: null },
    sl:            { type: Number, default: null },
    tp:            { type: Number, default: null },
    quantity:      { type: Number, default: 0 },
    pnl:           { type: Number, default: 0 },
    status:        { type: String, default: 'open' },
    conditionsMet: { type: mongoose.Schema.Types.Mixed, default: {} },
    openedAt:      { type: Date, default: Date.now },
    closedAt:      { type: Date, default: null },
}, { timestamps: true });

// ── Agent settings (user config) ──
const AgentSettingsSchema = new mongoose.Schema({
    userId:                { type: String, default: 'default' },
    startTime:             { type: String, default: '08:00' },
    endTime:               { type: String, default: '18:00' },
    maxTrades:             { type: Number, default: 3 },
    scanInterval:          { type: Number, default: 30 },
    cooldownMinutes:       { type: Number, default: 15 },
    minScore:              { type: Number, default: 75 },
    basePositionSize:      { type: Number, default: 0 },
    maxLossPerTradePct:    { type: Number, default: 1 },
    dailyDrawdownPct:      { type: Number, default: 5 },
    maxConsecutiveLosses:  { type: Number, default: 3 },
    minVolume:             { type: Number, default: 30 },
    atrMin:                { type: Number, default: 0 },
    atrMax:                { type: Number, default: 9999999 },
    whatsappRecipient:     String,
    emailRecipient:        String,
    notifyOnTradePlaced:   { type: Boolean, default: true },
    notifyOnTradeClosed:   { type: Boolean, default: true },
    notifyOnAgentShutdown: { type: Boolean, default: true },
    notifyOnDailySummary:  { type: Boolean, default: true },
}, { timestamps: true });
AgentSettingsSchema.index({ userId: 1 }, { unique: true });

// ── Agent day sessions ──
const AgentSessionSchema = new mongoose.Schema({
    userId:            { type: String, default: 'default' },
    date:              String,
    tradesTaken:       { type: Number, default: 0 },
    wins:              { type: Number, default: 0 },
    losses:            { type: Number, default: 0 },
    totalPnl:          { type: Number, default: 0 },
    startBalance:      Number,
    endBalance:        Number,
    maxTrades:         { type: Number, default: 3 },
    consecutiveLosses: { type: Number, default: 0 },
    startedAt:         String,
    endedAt:           String,
    endReason:         String,
}, { timestamps: true });

// ── Agent individual trades ──
const AgentTradeSchema = new mongoose.Schema({
    userId:        { type: String, default: 'default' },
    sessionId:     String,
    symbol:        String,
    side:          String,
    entryPrice:    Number,
    closePrice:    Number,
    sl:            Number,
    tp:            Number,
    pnl:           Number,
    pnlPercent:    Number,
    aiScore:       Number,
    aiConfidence:  String,
    aiReasoning:   String,
    dcaCount:      { type: Number, default: 0 },
    openedAt:      String,
    closedAt:      String,
}, { timestamps: true });

// ── Agent runtime state (for resume on boot) ──
const AgentStateSchema = new mongoose.Schema({
    userId:       { type: String, default: 'default' },
    running:      { type: Boolean, default: false },
    status:       { type: String, default: 'idle' },
    sessionId:    String,
    date:         String,
    tradesTaken:  { type: Number, default: 0 },
    startBalance: { type: Number, default: 0 },
}, { timestamps: true });
AgentStateSchema.index({ userId: 1 }, { unique: true });

// ── Auth: Users ──
const UserSchema = new mongoose.Schema({
    firstName:           { type: String, required: true },
    lastName:            { type: String, default: '' },
    email:               { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:            { type: String, required: true },
    phone:               { type: String, default: '' },
    role:                { type: String, enum: ['user', 'admin'], default: 'user' },
    licenseKey:          { type: String, default: null },
    licenseStatus:       { type: String, enum: ['inactive', 'active', 'suspended'], default: 'inactive' },
    licenseActivatedAt:  { type: Date, default: null },
    deviceFingerprint:   { type: String, default: null },
    lastIp:              { type: String, default: null },
    lastLogin:           { type: Date, default: null },
    // Single-session enforcement
    activeSessionToken:  { type: String, default: null },
    activeSessionAt:     { type: Date, default: null },
    // Security tracking
    loginHistory:        { type: [{ ip: String, userAgent: String, timestamp: Date, fingerprint: String, fingerprintMatch: Boolean }], default: [] },
    blockedAttempts:     { type: [{ timestamp: Date, ip: String, fingerprint: String }], default: [] },
    suspiciousActivity:  { type: Boolean, default: false },
}, { timestamps: true });
UserSchema.index({ email: 1 }, { unique: true });

// ── Auth: Licenses ──
const LicenseSchema = new mongoose.Schema({
    licenseKey:          { type: String, required: true, unique: true },
    buyerName:           { type: String, required: true },
    buyerContact:        { type: String, required: true },
    purchaseDate:        { type: String, required: true },
    price:               { type: Number, required: true },
    currency:            { type: String, default: 'USD' },
    status:              { type: String, enum: ['inactive', 'active', 'suspended'], default: 'inactive' },
    activatedByUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    activatedAt:         { type: Date, default: null },
    deviceFingerprint:   { type: String, default: null },
    ipHistory:           { type: [String], default: [] },
    notes:               { type: String, default: '' },
    // Transfer tracking
    transferCount:       { type: Number, default: 0 },
    maxTransfers:        { type: Number, default: 2 },
    transferHistory:     { type: [{ date: Date, adminId: mongoose.Schema.Types.ObjectId, oldFingerprint: String }], default: [] },
}, { timestamps: true });
LicenseSchema.index({ licenseKey: 1 }, { unique: true });

// ── Auth: Admin app-level settings (key/value store) ──
const AppSettingsSchema = new mongoose.Schema({
    key:   { type: String, required: true },
    value: { type: String, default: '' },
}, { timestamps: true });
AppSettingsSchema.index({ key: 1 }, { unique: true });

// ── Public contact form submissions ───────────────────────────
const ContactSchema = new mongoose.Schema({
    name:      { type: String, required: true },
    email:     { type: String, required: true },
    phone:     { type: String, default: '' },
    message:   { type: String, required: true },
    read:      { type: Boolean, default: false },
}, { timestamps: true });

// ── Funded Account Challenges ──
const FundedChallengeSchema = new mongoose.Schema({
    userId:              { type: String, default: 'default' },
    title:               { type: String, default: 'My Challenge' },
    accountSize:         { type: Number, required: true },
    profitTargetPct:     { type: Number, default: 10 },
    maxDailyDrawdownPct: { type: Number, default: 5 },
    maxTotalDrawdownPct: { type: Number, default: 10 },
    startDate:           String,
    durationDays:        { type: Number, default: 30 },
    active:              { type: Boolean, default: true },
    status:              { type: String, default: 'active' }, // 'active' | 'passed' | 'failed'
    totalPnl:            { type: Number, default: 0 },
    dailyPnl:            { type: Number, default: 0 },
    dailyDate:           String,           // date string for dailyPnl reset
    dailyDrawdown:       { type: Number, default: 0 }, // worst daily loss (negative)
    totalDrawdown:       { type: Number, default: 0 }, // worst total drawdown from peak (negative)
    peakPnl:             { type: Number, default: 0 },
    tradesCount:         { type: Number, default: 0 },
    wins:                { type: Number, default: 0 },
    losses:              { type: Number, default: 0 },
}, { timestamps: true });

const ChallengeTradeSchema = new mongoose.Schema({
    userId:      { type: String, required: true },
    challengeId: { type: String, required: true },
    symbol:      { type: String, required: true },
    side:        { type: String, required: true }, // 'long' | 'short'
    orderType:   { type: String, default: 'market' },
    entryPrice:  { type: Number, required: true },
    exitPrice:   { type: Number, default: null },
    quantity:    { type: Number, required: true },
    leverage:    { type: Number, default: 1 },
    sl:          { type: Number, default: null },
    tp:          { type: Number, default: null },
    pnl:         { type: Number, default: 0 },
    rrAchieved:  { type: Number, default: null },
    status:      { type: String, default: 'open' }, // 'open' | 'closed'
    openedAt:    { type: Date, default: Date.now },
    closedAt:    { type: Date, default: null },
}, { timestamps: true });

module.exports = {
    Settings:       mongoose.model('Settings',       SettingsSchema),
    Watchlist:      mongoose.model('Watchlist',      WatchlistSchema),
    FilterVis:      mongoose.model('FilterVis',      FilterVisSchema),
    PosSettings:    mongoose.model('PosSettings',    PosSettingsSchema),
    Drawings:       mongoose.model('Drawings',       DrawingsSchema),
    KimiSettings:   mongoose.model('KimiSettings',  KimiSettingsSchema),
    KimiCache:      mongoose.model('KimiCache',      KimiCacheSchema),
    BybitStore:     mongoose.model('BybitStore',     BybitStoreSchema),
    AutopilotState: mongoose.model('AutopilotState', AutopilotStateSchema),
    AgentSettings:  mongoose.model('AgentSettings', AgentSettingsSchema),
    AgentSession:   mongoose.model('AgentSession',  AgentSessionSchema),
    AgentTrade:     mongoose.model('AgentTrade',    AgentTradeSchema),
    AgentState:     mongoose.model('AgentState',    AgentStateSchema),
    User:             mongoose.model('User',             UserSchema),
    License:          mongoose.model('License',          LicenseSchema),
    AppSettings:      mongoose.model('AppSettings',      AppSettingsSchema),
    Contact:          mongoose.model('Contact',          ContactSchema),
    FundedChallenge:  mongoose.model('FundedChallenge',  FundedChallengeSchema),
    ChallengeTrade:   mongoose.model('ChallengeTrade',   ChallengeTradeSchema),
    Strategy:         mongoose.model('Strategy',         StrategySchema),
    BotTrade:         mongoose.model('BotTrade',         BotTradeSchema),
    PriceAlert:       mongoose.model('PriceAlert',       PriceAlertSchema),
};
