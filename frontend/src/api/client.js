// Thin fetch wrapper. The Express backend still owns auth via session cookies,
// so every request must carry credentials for the proxy (dev) / same-origin (prod) cookie to work.
async function request(path, options = {}) {
  const res = await fetch(path, {
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
