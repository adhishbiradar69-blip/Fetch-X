import axios from 'axios';

// Production (Vercel) sets VITE_API_URL to the backend origin.
// In dev/preview we use the same-origin '/api' path, which the Vite dev
// server proxies to the FastAPI backend (see vite.config.js).
const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Network errors (backend unreachable) — show a clear message
    if (!error.response) {
      console.error(
        `[Fetch-X] Cannot reach backend at ${API_URL}. ` +
        `If this is a production deploy, set VITE_API_URL in Vercel to your backend URL. ` +
        `If running locally, make sure the backend is running on port 8000 (the Vite proxy forwards /api to it).`
      );
    }
    // A failed LOGIN attempt must NOT wipe the session or hard-redirect:
    // the user is mid-signin and the page's own error box handles it.
    const isAuthCall = typeof error.config?.url === 'string' && error.config.url.includes('/auth/');
    // 401 = the session is truly dead → wipe and re-auth.
    // 403 = authenticated but not allowed → the page's inline error state
    // handles it; destroying the session here used to log class teachers
    // out of the console whenever a leadership-only endpoint was hit.
    if (!isAuthCall && error.response?.status === 401) {
      try {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      } catch { /* ignore */ }
      if (!window.location.pathname.startsWith('/auth') && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
export { API_URL };

