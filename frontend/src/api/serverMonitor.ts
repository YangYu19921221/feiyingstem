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
  online?: number;    // 5分钟窗活跃账号数(旧样本无此字段)
}

// 并发容量评估(带宽/CPU/内存三路外推,取最小为整体容量)
export interface CapacityInfo {
  config: { bandwidth_mbps: number };
  online: {
    active_1m: number;
    active_5m: number;
    peak_today: number;
    roles: Record<string, number>;
  };
  estimate: {
    max_users: number;
    bottleneck: 'bandwidth' | 'cpu' | 'memory';
    confidence: 'measured' | 'reference';
    by_resource: { bandwidth: number; cpu: number; memory: number };
  };
  usage: {
    bw_limit_bps: number;
    bw_machine_up: number;
    bw_app_up: number;
    bw_percent: number;
    proc_cpu_percent: number;
    req_per_s: number;
    per_user_bw: number;
    per_user_cpu: number;
  };
  pk_reference: { room8_users: number; room20_users: number; tested_at_mbps: number };
}

export interface ServerMetrics {
  interval: number;
  collecting: boolean;
  capacity: CapacityInfo;
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

export const updateCapacityConfig = async (bandwidthMbps: number): Promise<void> => {
  await axios.put(`${API_BASE_URL}/admin/server/capacity-config`, { bandwidth_mbps: bandwidthMbps });
};
