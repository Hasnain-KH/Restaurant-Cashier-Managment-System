const bootstrap = (typeof window !== 'undefined' && window.joona && window.joona.bootstrap) || {};

export const apiBase = bootstrap.apiBase || 'http://127.0.0.1:4321';
const token = bootstrap.apiToken || '';

export const isDesktopApp = Boolean(
  typeof window !== 'undefined' && window.joona && window.joona.bootstrap
);

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-joona-token': token } : {}),
        ...(options.headers || {}),
      },
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        payload && payload.error
          ? payload.error
          : 'The local database could not complete this request.';
      throw new Error(message);
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('The local data service is taking too long. Please try again.');
    }
    if (error.message === 'Failed to fetch' || error.name === 'TypeError') {
      throw new Error(
        'Cannot reach the local data service. Please restart Joona Biryani and try again.'
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  createSale: (payload) =>
    request('/api/sales', { method: 'POST', body: JSON.stringify(payload) }),
  listSales: (params = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    const query = search.toString();
    return request(`/api/sales${query ? `?${query}` : ''}`);
  },
  summary: (date) => request(`/api/summary?date=${encodeURIComponent(date)}`),
  dashboard: () => request('/api/dashboard'),
  dailyReport: (date) => request(`/api/reports/daily?date=${encodeURIComponent(date)}`),
  monthlyReport: (month) => request(`/api/reports/monthly?month=${encodeURIComponent(month)}`),
  settings: () => request('/api/settings'),
  updateSettings: (payload) =>
    request('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  storage: () => request('/api/storage'),
};
