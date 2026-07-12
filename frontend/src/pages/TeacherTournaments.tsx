/**
 * 教师端 - PK 晋级赛
 * 列表 + 创建(选班级/单元范围/每组人数)+ 赛程全景(分组积分 + 淘汰赛对阵树)。
 * 全自动流转:老师只管建赛,组内打完自动出线、淘汰赛自动生成、一路到冠军。
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { API_BASE_URL } from '../config/env';
import { tournamentApi, type TournamentListItem, type TournamentDetail, type TournamentMatch } from '../api/tournament';
import { toast } from '../components/Toast';

interface ClassOption { id: number; name: string; student_count: number }
interface BookOption { id: number; name: string; unit_count: number }
interface UnitOption { id: number; name: string; unit_number: number }

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('access_token')}` });

const STAGE_LABEL: Record<string, string> = { group: '小组赛', ko: '淘汰赛', consolation: '安慰赛(黑马组)' };

export default function TeacherTournaments() {
  const navigate = useNavigate();
  const [list, setList] = useState<TournamentListItem[]>([]);
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setLoading(true);
    try { setList(await tournamentApi.list()); }
    catch { toast.error('加载赛事失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // 进行中的赛事定时刷新赛程(对局在别处打,结果自动推进,这里近实时看到)
  useEffect(() => {
    if (!detail || detail.status !== 'running') return;
    const t = setInterval(async () => {
      try { setDetail(await tournamentApi.detail(detail.id)); } catch { /* 静默 */ }
    }, 15000);
    return () => clearInterval(t);
  }, [detail?.id, detail?.status]);

  const openDetail = async (id: number) => {
    try { setDetail(await tournamentApi.detail(id)); }
    catch { toast.error('加载赛程失败'); }
  };

  const del = async (id: number, name: string) => {
    if (!window.confirm(`确定删除赛事「${name}」?对阵和成绩将一并清除。`)) return;
    try { await tournamentApi.remove(id); toast.success('已删除'); loadList(); if (detail?.id === id) setDetail(null); }
    catch { toast.error('删除失败'); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/teacher/dashboard')} className="p-2 -ml-2 hover:bg-gray-100 rounded-lg">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2 flex-1">⚔️ PK 晋级赛</h1>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-sm font-semibold shadow hover:shadow-md transition">
            + 创建赛事
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-6 grid md:grid-cols-[320px_1fr] gap-5">
        {/* 左:赛事列表 */}
        <div className="space-y-2.5">
          {loading ? (
            <div className="text-center py-10 text-gray-400 text-sm">加载中…</div>
          ) : list.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center text-gray-400 text-sm shadow-sm">
              还没有赛事,点右上角创建一个吧
            </div>
          ) : list.map(t => (
            <button key={t.id} onClick={() => openDetail(t.id)}
              className={`w-full text-left bg-white rounded-xl p-3.5 shadow-sm border transition hover:shadow-md ${
                detail?.id === t.id ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-100'}`}>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-800 flex-1 truncate">{t.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  t.status === 'finished' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                  {t.status === 'finished' ? '已结束' : '进行中'}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs text-gray-400">{t.created_at ? new Date(t.created_at).toLocaleDateString('zh-CN') : ''}</span>
                <span onClick={(e) => { e.stopPropagation(); del(t.id, t.name); }}
                  className="text-xs text-red-400 hover:text-red-600 cursor-pointer">删除</span>
              </div>
            </button>
          ))}
        </div>

        {/* 右:赛程全景 */}
        <div>
          {!detail ? (
            <div className="bg-white rounded-2xl p-10 text-center text-gray-400 shadow-sm">
              ← 选一个赛事查看分组和对阵
            </div>
          ) : (
            <TournamentBoard detail={detail} onRefresh={() => openDetail(detail.id)} />
          )}
        </div>
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadList(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

function TournamentBoard({ detail, onRefresh }: { detail: TournamentDetail; onRefresh: () => void }) {
  const koMatches = detail.matches.filter(m => m.stage === 'ko');
  const consMatches = detail.matches.filter(m => m.stage === 'consolation');
  const koRounds = groupByRound(koMatches);
  const consRounds = groupByRound(consMatches);

  return (
    <div className="space-y-5">
      {/* 冠军横幅 */}
      {detail.status === 'finished' && detail.champion_name && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="bg-gradient-to-r from-amber-400 to-yellow-300 rounded-2xl p-5 text-center shadow-lg">
          <div className="text-4xl mb-1">👑</div>
          <p className="text-amber-900 font-bold text-lg">冠军 · {detail.champion_name}</p>
          {detail.consolation_champion_name && (
            <p className="text-amber-800/80 text-sm mt-1">🐎 黑马奖 · {detail.consolation_champion_name}</p>
          )}
        </motion.div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-bold text-gray-800">{detail.name}</h2>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>每组 {detail.group_size} 人 · {detail.word_count} 词/场</span>
          <button onClick={onRefresh} className="px-2 py-1 rounded-lg bg-white border border-gray-200 hover:bg-gray-50">🔄 刷新</button>
        </div>
      </div>

      {/* 小组赛积分榜 */}
      <div className="grid sm:grid-cols-2 gap-3">
        {detail.groups.map(g => (
          <div key={g.group_no} className="bg-white rounded-xl p-3 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 mb-2">第 {g.group_no} 组</p>
            <div className="space-y-1">
              {g.players.map((p, i) => (
                <div key={p.user_id} className={`flex items-center gap-2 text-sm px-2 py-1 rounded-lg ${
                  p.qualified ? 'bg-green-50' : ''}`}>
                  <span className="w-4 text-xs text-gray-400 font-mono">{i + 1}</span>
                  <span className="flex-1 truncate text-gray-800">{p.name}</span>
                  {p.qualified && <span className="text-[10px] text-green-600">✅出线</span>}
                  <span className="text-xs font-mono text-gray-500">{p.points}分</span>
                  <span className="text-[10px] text-gray-400">{p.wins}胜{p.losses}负</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 淘汰赛对阵树 */}
      {koRounds.length > 0 && (
        <BracketView title="🏆 淘汰赛" rounds={koRounds} />
      )}
      {consRounds.length > 0 && (
        <BracketView title="🐎 安慰赛(黑马组)" rounds={consRounds} />
      )}
    </div>
  );
}

function BracketView({ title, rounds }: { title: string; rounds: TournamentMatch[][] }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <p className="text-sm font-semibold text-gray-700 mb-3">{title}</p>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {rounds.map((round, ri) => (
          <div key={ri} className="flex flex-col gap-2 min-w-[160px]">
            <p className="text-xs text-gray-400 text-center">
              {roundName(round.length, ri === rounds.length - 1)}
            </p>
            {round.map(m => (
              <div key={m.id} className="border border-gray-150 rounded-lg overflow-hidden text-sm">
                <MatchRow name={m.p1_name} score={m.p1_score} win={m.winner_id === m.p1_id} done={m.status !== 'pending'} />
                <div className="h-px bg-gray-100" />
                <MatchRow name={m.p2_name} score={m.p2_score} win={m.winner_id === m.p2_id} done={m.status !== 'pending'} bye={!m.p2_id} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchRow({ name, score, win, done, bye }: { name: string; score: number | null; win: boolean; done: boolean; bye?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 ${win ? 'bg-green-50' : 'bg-white'}`}>
      <span className={`flex-1 truncate ${win ? 'font-semibold text-green-700' : bye ? 'text-gray-300' : 'text-gray-700'}`}>{name}</span>
      {win && <span className="text-[10px]">👑</span>}
      {done && score != null && <span className="text-xs font-mono text-gray-400">{score}</span>}
    </div>
  );
}

function groupByRound(matches: TournamentMatch[]): TournamentMatch[][] {
  const byRound: Record<number, TournamentMatch[]> = {};
  matches.forEach(m => { (byRound[m.round_no] ??= []).push(m); });
  return Object.keys(byRound).sort((a, b) => +a - +b).map(k => byRound[+k].sort((a, b) => a.bracket_pos - b.bracket_pos));
}

function roundName(count: number, isLast: boolean): string {
  if (isLast && count === 1) return '决赛';
  if (count === 1) return '决赛';
  if (count === 2) return '半决赛';
  if (count <= 4) return '四分之一决赛';
  return `${count} 场`;
}

// ============ 创建赛事弹窗 ============

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [books, setBooks] = useState<BookOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [selClasses, setSelClasses] = useState<number[]>([]);
  const [selBook, setSelBook] = useState<number | null>(null);
  const [selUnits, setSelUnits] = useState<number[]>([]);
  const [groupSize, setGroupSize] = useState(4);
  const [wordCount, setWordCount] = useState(8);
  const [hasConsolation, setHasConsolation] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    axios.get(`${API_BASE_URL}/teacher/classes`, { headers: auth() }).then(r => {
      const l = Array.isArray(r.data) ? r.data : (r.data?.items ?? []);
      setClasses(l);
    }).catch(() => {});
    axios.get(`${API_BASE_URL}/teacher/books`, { headers: auth() }).then(r => setBooks(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selBook) { setUnits([]); return; }
    axios.get(`${API_BASE_URL}/teacher/books/${selBook}/units`, { headers: auth() })
      .then(r => setUnits(r.data)).catch(() => setUnits([]));
  }, [selBook]);

  const toggle = (arr: number[], set: (v: number[]) => void, id: number) =>
    set(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);

  const submit = async () => {
    if (!name.trim()) return toast.error('给赛事起个名字');
    if (selClasses.length === 0) return toast.error('至少选一个班级');
    if (selUnits.length === 0) return toast.error('至少选一个单元作为词库范围');
    setSubmitting(true);
    try {
      const r = await tournamentApi.create({
        name: name.trim(), class_ids: selClasses, unit_ids: selUnits,
        group_size: groupSize, word_count: wordCount, has_consolation: hasConsolation,
      });
      toast.success(`赛事已创建 · ${r.player_count} 人参赛,已自动分组`);
      onCreated();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '创建失败');
    } finally { setSubmitting(false); }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-4">
        <h2 className="text-lg font-bold text-gray-800">创建 PK 晋级赛</h2>

        <div>
          <label className="text-sm text-gray-600 font-medium">赛事名称</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="如:Unit 1-4 期中晋级赛"
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 focus:border-transparent" />
        </div>

        <div>
          <label className="text-sm text-gray-600 font-medium">参赛班级 <span className="text-gray-400 font-normal">(可多选)</span></label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {classes.map(c => (
              <button key={c.id} onClick={() => toggle(selClasses, setSelClasses, c.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                  selClasses.includes(c.id) ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                {c.name} <span className="opacity-60">({c.student_count})</span>
              </button>
            ))}
            {classes.length === 0 && <span className="text-sm text-gray-400">暂无班级</span>}
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-600 font-medium">词库范围</label>
          <select value={selBook ?? ''} onChange={e => { setSelBook(Number(e.target.value) || null); setSelUnits([]); }}
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
            <option value="">选单词本…</option>
            {books.map(b => <option key={b.id} value={b.id}>{b.name}（{b.unit_count} 单元）</option>)}
          </select>
          {units.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 max-h-40 overflow-y-auto">
              {units.map(u => (
                <button key={u.id} onClick={() => toggle(selUnits, setSelUnits, u.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs border transition ${
                    selUnits.includes(u.id) ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                  U{u.unit_number} {u.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-gray-600 font-medium">每组人数</label>
            <select value={groupSize} onChange={e => setGroupSize(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              {[3, 4, 5, 6].map(n => <option key={n} value={n}>{n} 人/组</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600 font-medium">每场词数</label>
            <select value={wordCount} onChange={e => setWordCount(Number(e.target.value))}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              {[5, 8, 10, 15, 20].map(n => <option key={n} value={n}>{n} 词</option>)}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={hasConsolation} onChange={e => setHasConsolation(e.target.checked)} className="w-4 h-4" />
          开启安慰赛(未出线的孩子打黑马组,人人全程有比赛)
        </label>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 font-medium">取消</button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white font-semibold disabled:opacity-50">
            {submitting ? '创建中…' : '创建并自动分组'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
