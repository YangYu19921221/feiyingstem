import axios from 'axios';
import { onUnauthorized, isUnauthorizedError } from './_authInterceptors';

// 给“全局 axios”注册请求/响应拦截器
// - 自动注入 Bearer token
// - 401 统一跳登录
// 不同 api/*.ts 都直接用 raw axios，需要确保拦截器在任何请求前就已经装好。
// 模块只执行一次（ES module 单例），所以这里没有重复注册风险。

let installed = false;

export function ensureAxiosAuthInstalled() {
  if (installed) return;
  installed = true;

  axios.interceptors.request.use(
    (config) => {
      const token = localStorage.getItem('access_token');
      if (token && config.headers) {
        (config.headers as any).Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => Promise.reject(error),
  );

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      if (isUnauthorizedError(error)) onUnauthorized();
      return Promise.reject(error);
    },
  );
}

// 任意 import 这个模块都会立刻装上拦截器
ensureAxiosAuthInstalled();
