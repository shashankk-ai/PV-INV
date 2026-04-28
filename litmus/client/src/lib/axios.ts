import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('litmus_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem('litmus_refresh_token');
      if (refreshToken) {
        try {
          const { data } = await axios.post('/api/auth/refresh', { refresh_token: refreshToken });
          const newAccess = data.data.access_token;
          sessionStorage.setItem('litmus_access_token', newAccess);
          localStorage.setItem('litmus_refresh_token', data.data.refresh_token);
          original.headers.Authorization = `Bearer ${newAccess}`;
          return api(original);
        } catch {
          sessionStorage.removeItem('litmus_access_token');
          localStorage.removeItem('litmus_refresh_token');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
