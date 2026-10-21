import { useEffect, useState } from 'react';
import { api } from '../api/client';

const PRICING_CACHE_KEY = 'scanr_pricing';
const PRICING_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIFETIME = { original: 49, discounted: null, displayPrice: 49, discountPct: null };

function readPricingCache() {
  try {
    const raw = sessionStorage.getItem(PRICING_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !parsed?.data) return null;
    if (Date.now() - parsed.ts > PRICING_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
function writePricingCache(data) {
  try {
    sessionStorage.setItem(PRICING_CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* ignore */
  }
}

// Shared across Pricing / Setup Guide / Home. The legacy pages' backing
// endpoint (/api/settings/pricing) doesn't exist server-side (confirmed —
// not defined anywhere in server.js), so this always resolves to the
// hardcoded $49 default in production today. Kept faithfully in case the
// endpoint gets implemented later; callers just get DEFAULT_LIFETIME meanwhile.
export function useLifetimePrice() {
  const [pricing, setPricing] = useState({ lifetime: readPricingCache()?.lifetime || DEFAULT_LIFETIME, discountLabel: 'Limited Time Offer' });

  useEffect(() => {
    api.get('/api/settings/pricing')
      .then((data) => {
        writePricingCache(data);
        setPricing({ lifetime: data?.lifetime || DEFAULT_LIFETIME, discountLabel: data?.discountLabel || 'Limited Time Offer' });
      })
      .catch(() => {
        const cached = readPricingCache();
        if (cached) setPricing({ lifetime: cached.lifetime || DEFAULT_LIFETIME, discountLabel: cached.discountLabel || 'Limited Time Offer' });
      });
  }, []);

  return pricing;
}
