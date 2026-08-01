import axios from 'axios';
import './_axiosBootstrap';
import { API_BASE_URL } from '../config/env';

// ===== 服务器实时监控(仅平台管理员) =====

export interface MonitorSample {
  t: number;          // epoch 秒
  cpu: number;        // 0-100
  mem: number;        // 0-100
  net_up: number;     // B/s
  net_down: number;   // B/s
  disk_read: number;  // B/s
  disk_write: number; // B/s
}

export interface ServerMetrics {
  interval: number;
  collecting: boolean;
  static: {
    hostname: string;
    os: string;
    arch: string;
    python: string;
    cores_logical: number;
    cores_physical: number;
  };
  now: {
    cpu: number;
    per_core: number[];
    load_avg: number[] | null;
    cpu_freq_mhz: number | null;
    temperature: number | null;
    mem: { total: number; used: number; available: number; percent: number };
    swap: { total: number; used: number; percent: number } | null;
    disk: { total: number; used: number; free: number; percent: number };
    net_up: number;
    net_down: number;
    net_total: { sent: number; recv: number } | null;
    disk_read: number;
    disk_write: number;
    uptime_seconds: number;
    process_count: number;
    connections: { total: number; established: number; listen: number } | null;
    service: {
      rss: number;
      cpu: number;
      threads: number;
      fds: number | null;
      uptime_seconds: number;
    };
    db: { main_bytes: number; wal_bytes: number } | null;
  };
  history: MonitorSample[];
}

export const fetchServerMetrics = async (): Promise<ServerMetrics> => {
  const r = await axios.get(`${API_BASE_URL}/admin/server/metrics`);
  return r.data;
};
