/**
 * fingerprint.js — Device fingerprint generator.
 * Exposes window.getDeviceFingerprint() which returns a short alphanumeric hash.
 * Must be loaded before any auth form submission.
 */
(function () {
    'use strict';

    function djb2(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
            hash = hash >>> 0; // keep unsigned 32-bit
        }
        return hash.toString(36);
    }

    function getDeviceFingerprint() {
        const parts = [
            navigator.userAgent || '',
            navigator.language  || '',
            screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
            (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return ''; } })(),
            navigator.platform          || '',
            String(navigator.hardwareConcurrency || ''),
            String(navigator.deviceMemory        || ''),
        ];
        return djb2(parts.join('|'));
    }

    window.getDeviceFingerprint = getDeviceFingerprint;
})();
