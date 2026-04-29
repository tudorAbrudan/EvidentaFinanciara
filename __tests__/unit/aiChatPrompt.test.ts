import { buildSystemPrompt, buildMessages } from '@/services/aiChatPrompt';
import type { ChatPair } from '@/services/aiChatRepo';

describe('aiChatPrompt', () => {
  it('buildSystemPrompt conține schema cele 3 tabele', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('financial_accounts');
    expect(p).toContain('expense_categories');
    expect(p).toContain('transactions');
    expect(p).not.toContain('bank_statements');
    expect(p).not.toContain('chat_messages');
  });

  it('buildSystemPrompt cere JSON cu cele 9 valori valide pentru template', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('search_merchant');
    expect(p).toContain('cannot_answer');
    expect(p).toContain('LIMIT obligatoriu');
  });

  it('buildSystemPrompt include few-shot examples', () => {
    const p = buildSystemPrompt();
    expect(p.toLowerCase()).toContain('exemplu');
  });

  it('buildMessages compactează history la întrebări + explanationShort', () => {
    const pairs: ChatPair[] = [
      {
        user: { id: 'u1', role: 'user', content: 'Q1', createdAt: '' },
        assistant: {
          id: 'a1',
          role: 'assistant',
          content: 'TEXT BUBBLE LUNG',
          explanationShort: 'sumar a1',
          createdAt: '',
        },
      },
    ];
    const msgs = buildMessages(pairs, 'Q nouă');
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: 'Q1' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'sumar a1' });
    expect(msgs[2].content).not.toContain('TEXT BUBBLE LUNG');
    expect(msgs[3]).toEqual({ role: 'user', content: 'Q nouă' });
  });

  it('buildMessages folosește assistant.content când explanationShort lipsește', () => {
    const pairs: ChatPair[] = [
      {
        user: { id: 'u1', role: 'user', content: 'Q1', createdAt: '' },
        assistant: { id: 'a1', role: 'assistant', content: 'A1', createdAt: '' },
      },
    ];
    const msgs = buildMessages(pairs, 'Q2');
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'A1' });
  });
});
