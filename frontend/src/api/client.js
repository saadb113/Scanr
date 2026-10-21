// Thin fetch wrapper. The Express backend still owns auth via session cookies,
// so every request must carry credentials for the proxy (dev) / cross-origin
// (prod, when the frontend and backend are on different hosts — e.g.
// Vercel + Render) cookie to work.
//
// VITE_API_URL points at the backend's own origin when it's deployed
// separately (set in Vercel's project env vars). Left unset, requests stay
// relative — same-origin in a single-origin deploy, or proxied by Vite in
// local dev (see vite.config.js).
export const API_BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // some endpoints (e.g. logout) may return empty bodies
  }

  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: (path, body) => request(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: (path, body) => request(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
};
