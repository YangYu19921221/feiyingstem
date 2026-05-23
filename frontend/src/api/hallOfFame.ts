import client from './client';

export interface ChampionItem {
  user_id: number;
  nickname: string;
  hero_id: string | null;
  metric: number;
  metric_label: string;
}

export interface HallOfFameResponse {
  class_id: number | null;
  class_name: string | null;
  period: string;
  champions: {
    perfect_king: ChampionItem | null;
    speed_king: ChampionItem | null;
    progress_star: ChampionItem | null;
  };
}

export async function getClassHallOfFame(): Promise<HallOfFameResponse> {
  return client.get('/student/class/hall-of-fame');
}
