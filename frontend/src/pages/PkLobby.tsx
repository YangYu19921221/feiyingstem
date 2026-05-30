import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pkApi, type PkUnitItem } from '../api/pk';
import { getStudentBooks, type StudentBook } from '../api/progress';
import PkInviteModal from '../components/pk/PkInviteModal';

export default function PkLobby() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [books, setBooks] = useState<StudentBook[]>([]);
  const [selectedBook, setSelectedBook] = useState<number | null>(null);
  const [units, setUnits] = useState<PkUnitItem[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<number | null>(null);
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [inviteCode, setInviteCode] = useState('');
  const [showInvite, setShowInvite] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const navTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (navTimer.current !== null) window.clearTimeout(navTimer.current);
  }, []);

  useEffect(() => {
    getStudentBooks()
      .then(setBooks)
      .catch((e) => {
        console.error('load books failed', e);
        setBooks([]);
      });
  }, []);

  useEffect(() => {
    if (!selectedBook) {
      setUnits([]);
      setSelectedUnit(null);
      return;
    }
    pkApi
      .listUnitsByBook(selectedBook)
      .then(setUnits)
      .catch((e) => {
        console.error('load units failed', e);
        setUnits([]);
      });
  }, [selectedBook]);

  const handleCreate = async () => {
    setError('');
    if (!selectedUnit) {
      setError('请先选择单元');
      return;
    }
    setCreating(true);
    try {
      const data = await pkApi.createRoom(selectedUnit, maxPlayers);
      setShowInvite(data.invite_code);
      navTimer.current = window.setTimeout(() => navigate(`/pk/arena/${data.room_id}`), 1500);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || '创建失败');
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    setError('');
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError('邀请码必须是 6 位');
      return;
    }
    try {
      const data = await pkApi.joinRoomByCode(code);
      navigate(`/pk/arena/${data.room_id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const errorMap: Record<string, string> = {
        ROOM_NOT_FOUND: '邀请码无效',
        ROOM_FINISHED: '该房间的 PK 已结束',
        ROOM_FULL: '房间已满',
        ROOM_ALREADY_STARTED: '房间已开始',
        USER_ALREADY_IN_ROOM: '你已在另一个 PK 房间中',
      };
      setError(errorMap[detail] || detail || e?.message || '加入失败');
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">PK 竞技场</h1>
        <button
          onClick={() => navigate('/student/dashboard')}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 返回
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('create')}
          className={`flex-1 py-2 rounded-lg font-medium ${
            tab === 'create' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
          }`}
        >
          创建房间
        </button>
        <button
          onClick={() => setTab('join')}
          className={`flex-1 py-2 rounded-lg font-medium ${
            tab === 'join' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
          }`}
        >
          加入房间
        </button>
      </div>

      {tab === 'create' && (
        <div className="space-y-3">
          <select
            value={selectedBook ?? ''}
            onChange={(e) => setSelectedBook(e.target.value ? Number(e.target.value) : null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="">— 选择单词本 —</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            value={selectedUnit ?? ''}
            onChange={(e) => setSelectedUnit(e.target.value ? Number(e.target.value) : null)}
            disabled={!selectedBook}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-50"
          >
            <option value="">— 选择单元 —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.word_count} 个词)
              </option>
            ))}
          </select>

          <select
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} 人房
              </option>
            ))}
          </select>

          <button
            onClick={handleCreate}
            disabled={creating || !selectedUnit}
            className="w-full py-2 bg-green-500 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {creating ? '创建中…' : '创建并获取邀请码'}
          </button>
        </div>
      )}

      {tab === 'join' && (
        <div className="space-y-3">
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono tracking-widest text-center text-lg uppercase"
            maxLength={6}
            placeholder="6 位邀请码"
          />
          <button
            onClick={handleJoin}
            className="w-full py-2 bg-green-500 text-white rounded-lg font-medium"
          >
            加入
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {showInvite && (
        <PkInviteModal inviteCode={showInvite} onClose={() => setShowInvite(null)} />
      )}
    </div>
  );
}
