import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config/env';

const instance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
instance.interceptors.response.use(
  (response) => {
    return response.data;
  },
  (error) => {
    // 统一错误处理
    if (error.response) {
      // 服务器返回错误（404 不打印，由调用方处理）
      if (error.response.status !== 404) {
        console.error('API Error:', error.response.data);
      }
      // 保留原始的error对象,这样可以访问error.response.status
      return Promise.reject(error);
    } else if (error.request) {
      // 请求发出但没有收到响应
      console.error('Network Error:', error.request);
      return Promise.reject(new Error('网络错误,请检查您的网络连接'));
    } else {
      // 其他错误
      console.error('Error:', error.message);
      return Promise.reject(error);
    }
  }
);

// 类型安全的包装：拦截器已返回 response.data，覆盖返回类型
const api = {
  get: <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    instance.get(url, config) as any,
  post: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> =>
    instance.post(url, data, config) as any,
  put: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> =>
    instance.put(url, data, config) as any,
  patch: <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> =>
    instance.patch(url, data, config) as any,
  delete: <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    instance.delete(url, config) as any,
};

export default api;
