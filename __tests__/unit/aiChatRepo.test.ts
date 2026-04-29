import { appendMessage, listMessages, clearAll, recentPairs } from '@/services/aiChatRepo';
import { db } from '@/services/db';

describe('aiChatRepo', () => {
  beforeEach(() => {
    (db.runAsync as jest.Mock).mockClear();
    (db.getAllAsync as jest.Mock).mockClear();
  });

  it('appendMessage inserează cu id generat și createdAt ISO', async () => {
    (db.runAsync as jest.Mock).mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
    const msg = await appendMessage({
      role: 'user',
      content: 'La ce bănci am cont?',
    });
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(msg.createdAt).toString()).not.toBe('Invalid Date');
    expect(msg.role).toBe('user');
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO chat_messages'),
      expect.any(Array)
    );
  });

  it('appendMessage stringifică evidence', async () => {
    (db.runAsync as jest.Mock).mockResolvedValue({ lastInsertRowId: 1, changes: 1 });
    await appendMessage({
      role: 'assistant',
      content: 'Ai 3 conturi.',
      template: 'list_accounts',
      evidence: [{ kind: 'account', id: 'a1', name: 'BT', type: 'bank' }],
    });
    const params = (db.runAsync as jest.Mock).mock.calls[0][1] as unknown[];
    const evidenceParam = params.find(p => typeof p === 'string' && p.startsWith('['));
    expect(evidenceParam).toBe(
      JSON.stringify([{ kind: 'account', id: 'a1', name: 'BT', type: 'bank' }])
    );
  });

  it('listMessages parsează evidence_json înapoi la array', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      {
        id: 'm1',
        role: 'assistant',
        content: 'X',
        template: 'list_accounts',
        sql_used: null,
        evidence_json: JSON.stringify([{ kind: 'account', id: 'a1', name: 'BT', type: 'bank' }]),
        explanation_short: 'lista conturi',
        error_kind: null,
        created_at: '2026-04-29T10:00:00.000Z',
      },
    ]);
    const msgs = await listMessages();
    expect(msgs[0].evidence).toEqual([{ kind: 'account', id: 'a1', name: 'BT', type: 'bank' }]);
  });

  it('clearAll șterge toate mesajele', async () => {
    await clearAll();
    expect(db.runAsync).toHaveBeenCalledWith('DELETE FROM chat_messages');
  });

  it('recentPairs grupează user+assistant și skipează system_error', async () => {
    (db.getAllAsync as jest.Mock).mockResolvedValue([
      {
        id: '4',
        role: 'assistant',
        content: 'A2',
        explanation_short: 'a2',
        sql_used: null,
        template: 'raw_list',
        evidence_json: null,
        error_kind: null,
        created_at: '2026-04-29T10:04:00.000Z',
      },
      {
        id: '3',
        role: 'user',
        content: 'Q2',
        explanation_short: null,
        sql_used: null,
        template: null,
        evidence_json: null,
        error_kind: null,
        created_at: '2026-04-29T10:03:00.000Z',
      },
      {
        id: 'e1',
        role: 'system_error',
        content: 'Eroare',
        explanation_short: null,
        sql_used: null,
        template: null,
        evidence_json: null,
        error_kind: 'network',
        created_at: '2026-04-29T10:02:00.000Z',
      },
      {
        id: '2',
        role: 'assistant',
        content: 'A1',
        explanation_short: 'a1',
        sql_used: null,
        template: 'raw_list',
        evidence_json: null,
        error_kind: null,
        created_at: '2026-04-29T10:01:00.000Z',
      },
      {
        id: '1',
        role: 'user',
        content: 'Q1',
        explanation_short: null,
        sql_used: null,
        template: null,
        evidence_json: null,
        error_kind: null,
        created_at: '2026-04-29T10:00:00.000Z',
      },
    ]);
    const pairs = await recentPairs(5);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].user.content).toBe('Q2');
    expect(pairs[0].assistant.content).toBe('A2');
    expect(pairs[1].user.content).toBe('Q1');
  });
});
