/**
 * Centralized API client reading backend base URL from Vite environment variables.
 * Automatically manages credentials, headers, query parameters, and session recovery.
 * Supports both HTTP-only cookies and Authorization Bearer headers for cross-domain stability.
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.isRefreshing = false;
    this.refreshSubscribers = [];
  }

  getToken() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('task_access_token');
  }

  getRefreshToken() {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('task_refresh_token');
  }

  setTokens(accessToken, refreshToken) {
    if (typeof window === 'undefined') return;
    if (accessToken) localStorage.setItem('task_access_token', accessToken);
    if (refreshToken) localStorage.setItem('task_refresh_token', refreshToken);
  }

  clearTokens() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('task_access_token');
    localStorage.removeItem('task_refresh_token');
  }

  buildUrl(endpoint, params = {}) {
    let url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, val);
      }
    });

    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString;
    }

    return url;
  }

  async request(endpoint, options = {}, isRetry = false) {
    const { params, ...fetchOptions } = options;
    const url = this.buildUrl(endpoint, params);

    const headers = {
      ...fetchOptions.headers
    };

    // Attach Bearer token from local storage if available for cross-domain resilience
    const token = this.getToken();
    if (token && !Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(fetchOptions.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      ...fetchOptions,
      headers,
      credentials: 'include' // Always pass HTTP-only cookies
    };

    try {
      const response = await fetch(url, config);
      const isJson = response.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await response.json() : await response.text();

      // Automatically store tokens when logging in or refreshing
      if (data?.data?.accessToken) {
        this.setTokens(data.data.accessToken, data.data.refreshToken);
      }

      // If unauthorized and not already an auth endpoint or retry, attempt silent token refresh
      if (
        response.status === 401 &&
        !isRetry &&
        !endpoint.includes('/auth/login') &&
        !endpoint.includes('/auth/refresh')
      ) {
        try {
          await this.refreshToken();
          return await this.request(endpoint, options, true);
        } catch {
          // If refresh fails, session is definitively expired
          this.clearTokens();
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('auth:session-expired'));
          }
          const error = new Error(data?.message || 'Session expired. Please log in again.');
          error.status = 401;
          error.data = data;
          throw error;
        }
      }

      if (!response.ok) {
        const error = new Error(data?.message || `Request failed with status ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } catch (error) {
      if (!error.status) {
        error.message = error.message || 'Unable to connect to PixxTechnologiees API server. Ensure the backend is running.';
      }
      throw error;
    }
  }

  async refreshToken() {
    if (this.isRefreshing) {
      return new Promise((resolve, reject) => {
        this.refreshSubscribers.push({ resolve, reject });
      });
    }

    this.isRefreshing = true;

    try {
      const storedRefreshToken = this.getRefreshToken();
      const refreshUrl = `${this.baseUrl}/auth/refresh`;
      const res = await fetch(refreshUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: storedRefreshToken ? JSON.stringify({ refreshToken: storedRefreshToken }) : undefined
      });

      if (!res.ok) {
        this.clearTokens();
        throw new Error('Failed to refresh authentication session.');
      }

      const data = await res.json();
      if (data?.data?.accessToken) {
        this.setTokens(data.data.accessToken, data.data.refreshToken);
      }
      this.refreshSubscribers.forEach((sub) => sub.resolve(data));
      this.refreshSubscribers = [];
      return data;
    } catch (err) {
      this.clearTokens();
      this.refreshSubscribers.forEach((sub) => sub.reject(err));
      this.refreshSubscribers = [];
      throw err;
    } finally {
      this.isRefreshing = false;
    }
  }

  get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  post(endpoint, body, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    });
  }

  put(endpoint, body, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined
    });
  }

  patch(endpoint, body, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined
    });
  }

  delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient(BASE_URL);
export default apiClient;
