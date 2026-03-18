'use strict';

/**
 * notifier.js — Notification stubs (email disabled)
 *
 * To enable real emails, configure nodemailer or your preferred email service
 * and replace Promise.resolve() with actual email sending logic.
 */

function notifyAgentStarted(settings) { return Promise.resolve(); }
function notifyPreTrade(trade) { return Promise.resolve(); }
function notifyTradeClosed(trade, tradesToday, maxTrades) { return Promise.resolve(); }
function notifyDailySummary(session, trades) { return Promise.resolve(); }
function notifyReferralConverted(referrerId, referrerEmail, referrerName, commissionAmount) { return Promise.resolve(); }
function notifyReferralPaid(referrerId, referrerEmail, referrerName, commissionAmount) { return Promise.resolve(); }

/**
 * Send payment received notification to admin
 * @param {Object} data - Payment details
 */
function sendPaymentReceivedEmail(data) {
    console.log('[EMAIL] Payment Received Notification to Admin:');
    console.log(`  To: ${data.adminEmail}`);
    console.log(`  Subject: New Payment — ${data.buyerName} — ${data.planType} — $${data.amount}`);
    console.log(`  Buyer: ${data.buyerName} (${data.buyerEmail})`);
    console.log(`  Plan: ${data.planType}`);
    console.log(`  Amount: $${data.amount} USDT`);
    console.log(`  Network: ${data.network}`);
    console.log(`  TxID: ${data.txId}`);
    console.log(`  Payment ID: ${data.paymentId}`);
    console.log(`  Screenshot: ${data.screenshotPath}`);
    console.log(`  Action: Visit admin panel to verify payment`);
    return Promise.resolve();
}

/**
 * Send license key to user after payment verified
 * @param {Object} data - License details
 */
function sendLicenseKeyEmail(data) {
    console.log('[EMAIL] License Key sent to User:');
    console.log(`  To: ${data.userEmail}`);
    console.log(`  Subject: Your Scanr License Key is Ready! 🎉`);
    console.log(`  Hi ${data.userName},`);
    console.log(`  Your payment has been verified!`);
    console.log(`  Plan: ${data.planType}`);
    console.log(`  License Key: ${data.licenseKey}`);
    console.log(`  Instructions: Copy this key and activate your account at scanr.app/payment`);
    return Promise.resolve();
}

/**
 * Send payment rejection notification to user
 * @param {Object} data - Rejection details
 */
function sendPaymentRejectionEmail(data) {
    console.log('[EMAIL] Payment Rejection sent to User:');
    console.log(`  To: ${data.userEmail}`);
    console.log(`  Subject: Payment Verification Issue`);
    console.log(`  Hi ${data.userName},`);
    console.log(`  We were unable to verify your payment.`);
    console.log(`  Reason: ${data.reason}`);
    console.log(`  Please contact us at saadbaig789@gmail.com for assistance.`);
    return Promise.resolve();
}

module.exports = {
    notifyAgentStarted,
    notifyPreTrade,
    notifyTradeClosed,
    notifyDailySummary,
    notifyReferralConverted,
    notifyReferralPaid,
    sendPaymentReceivedEmail,
    sendLicenseKeyEmail,
    sendPaymentRejectionEmail
};
