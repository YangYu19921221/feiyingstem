/**
 * WebSocket实时竞赛连接管理
 * 使用 reconnecting-websocket 库实现稳定的自动重连
 */

import ReconnectingWebSocket from 'reconnecting-websocket';
import { COMPETITION_WS_URL } from '../config/env';

export interface RankUpdate {
  user_id: number;
  nickname: string;
  avatar_url?: string;
  old_rank?: number;
  new_rank?: number;
  score_delta: number;
}

export interface LeaderboardData {
  type: string;
  updated_at: string;
  my_rank?: number;
  my_score?: number;
  rankings: Array<{
    rank: number;
    user_id: number;
    nickname: string;
    avatar_url?: string;
    score: number;
    accuracy_rate: number;
    max_combo: number;
    is_me: boolean;
    rank_tier_emoji?: string;
  }>;
  total_participants: number;
  online_users: number;
}

export interface WebSocketMessage {
  type: string;
  data?: any;
  message?: string;
  timestamp?: string;
  leaderboard?: LeaderboardData;
}

type MessageHandler = (message: WebSocketMessage) => void;

class CompetitionWebSocket {
  private rws: ReconnectingWebSocket | null = null;
  private messageHandlers: Map<string, MessageHandler[]> = new Map();
  private token: string | null = null;
  private seasonId: number = 1;

  /**
   * 连接WebSocket
   */
  connect(token: string, seasonId: number = 1) {
    // 如果已经连接,先断开
    if (this.rws) {
      console.log('⚠️ 断开已有的WebSocket连接');
      this.disconnect();
    }

    this.token = token;
    this.seasonId = seasonId;

    const wsUrl = `${COMPETITION_WS_URL}?token=${token}&season_id=${seasonId}`;

    console.log('🔌 正在连接WebSocket...', wsUrl);

    // 使用 ReconnectingWebSocket,配置自动重连
    this.rws = new ReconnectingWebSocket(wsUrl, [], {
      maxRetries: 10,
      connectionTimeout: 5000,
      maxReconnectionDelay: 10000,
      minReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1.3,
      debug: true,
    });

    this.rws.addEventListener('open', () => {
      console.log('✅ WebSocket连接成功!');
    });

    this.rws.addEventListener('message', (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error('❌ 解析WebSocket消息失败:', error);
      }
    });

    this.rws.addEventListener('error', (error) => {
      console.error('❌ WebSocket错误:', error);
    });

    this.rws.addEventListener('close', () => {
      console.log('🔌 WebSocket连接已关闭');
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.rws) {
      this.rws.close();
      this.rws = null;
    }
  }

  /**
   * 发送消息
   */
  send(message: any) {
    if (this.rws && this.rws.readyState === WebSocket.OPEN) {
      this.rws.send(JSON.stringify(message));
    } else {
      console.warn('⚠️ WebSocket未连接,无法发送消息');
    }
  }

  /**
   * 请求排行榜
   */
  requestLeaderboard(boardType: 'daily' | 'weekly' | 'overall' = 'daily') {
    this.send({
      type: 'get_leaderboard',
      board_type: boardType
    });
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(message: WebSocketMessage) {
    console.log('📩 收到消息:', message.type);

    // 触发对应类型的处理器
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }

    // 触发通用处理器
    const allHandlers = this.messageHandlers.get('*');
    if (allHandlers) {
      allHandlers.forEach(handler => handler(message));
    }

    // 处理ping消息
    if (message.type === 'ping') {
      this.send({ type: 'pong' });
    }
  }

  /**
   * 注册消息处理器
   */
  on(messageType: string, handler: MessageHandler) {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, []);
    }
    this.messageHandlers.get(messageType)!.push(handler);
  }

  /**
   * 移除消息处理器
   */
  off(messageType: string, handler: MessageHandler) {
    const handlers = this.messageHandlers.get(messageType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 获取连接状态
   */
  isConnected(): boolean {
    return this.rws !== null && this.rws.readyState === WebSocket.OPEN;
  }
}

// 导出单例
export const competitionWS = new CompetitionWebSocket();
