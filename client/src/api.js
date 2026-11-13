const bootstrap = (typeof window !== 'undefined' && window.joona && window.joona.bootstrap) || {};

export const apiBase = bootstrap.apiBase || 'http://127.0.0.1:4321';
const token = bootstrap.apiToken || '';

export const isDesktopApp = Boolean(
  typeof window !== 'undefined' && window.joona && window.joona.bootstrap
);

export const appInfo = {
  version: bootstrap.appVersion || '2.0.0',
  practice: Boolean(bootstrap.practice),
  timezone: bootstrap.timezone || 'Asia/Karachi',
  packaged: Boolean(bootstrap.packaged),
};

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

function queryString(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

const json = (method, body) => ({
  method,
  body: JSON.stringify(body === undefined ? {} : body),
});

export const api = {
  // Current POS endpoints
  createOrder: (payload) => request('/api/orders', json('POST', payload)),
  listOrders: (params = {}) => request(`/api/orders${queryString(params)}`),
  searchOrders: (q) => request(`/api/orders/search${queryString({ q })}`),
  getOrder: (id) => request(`/api/orders/${encodeURIComponent(id)}`),

  // Legacy sale endpoints (kept so old data and scripts keep working)
  createSale: (payload) => request('/api/sales', json('POST', payload)),
  listSales: (params = {}) => request(`/api/sales${queryString(params)}`),

  // Menu, portions and owner pricing
  menu: () => request('/api/menu'),
  product: (id) => request(`/api/menu/products/${encodeURIComponent(id)}`),
  createProduct: (payload) => request('/api/menu/products', json('POST', payload)),
  updateProduct: (id, payload) =>
    request(`/api/menu/products/${encodeURIComponent(id)}`, json('PUT', payload)),
  createPortion: (productId, payload) =>
    request(`/api/menu/products/${encodeURIComponent(productId)}/portions`, json('POST', payload)),
  updatePortion: (id, payload) =>
    request(`/api/menu/portions/${encodeURIComponent(id)}`, json('PUT', payload)),
  deletePortion: (id) =>
    request(`/api/menu/portions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Expenses
  expenses: (params = {}) => request(`/api/expenses${queryString(params)}`),
  addExpense: (payload) => request('/api/expenses', json('POST', payload)),
  deleteExpense: (id) =>
    request(`/api/expenses/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Reports
  summary: (date) => request(`/api/summary${queryString({ date })}`),
  dashboard: () => request('/api/dashboard'),
  dailyReport: (date) => request(`/api/reports/daily${queryString({ date })}`),
  monthlyReport: (month) => request(`/api/reports/monthly${queryString({ month })}`),

  // Settings, storage, health
  settings: () => request('/api/settings'),
  updateSettings: (payload) => request('/api/settings', json('PUT', payload)),
  storage: () => request('/api/storage'),
  verify: () => request('/api/verify'),
  meta: () => request('/api/meta'),
  health: () => request('/api/health'),
};
