import { buildSystemPrompt, buildMessages, type PromptContext } from '@/services/aiChatPrompt';
import type { ChatPair } from '@/services/aiChatRepo';

const CTX: PromptContext = {
  today: '2026-09-03',
  accounts: [
    { id: 'acc-bt', name: 'BT_curent_ron', currency: 'RON' },
    { id: 'acc-rev', name: 'Revolut EUR', currency: 'EUR' },
  ],
  categories: [
    { id: 'cat-sys-vehicle', name: 'Mașină', key: 'vehicle' },
    { id: 'cat-custom', name: 'Cadouri' },
  ],
};

describe('aiChatPrompt', () => {
  it('buildSystemPrompt conține schema cele 3 tabele', () => {
    const p = buildSystemPrompt(CTX);
    expect(p).toContain('financial_accounts');
    expect(p).toContain('expense_categories');
    expect(p).toContain('transactions');
    expect(p).not.toContain('bank_statements');
    expect(p).not.toContain('chat_messages');
  });

  it('buildSystemPrompt cere JSON cu valorile valide pentru template', () => {
    const p = buildSystemPrompt(CTX);
    expect(p).toContain('search_merchant');
    expect(p).toContain('cannot_answer');
    expect(p).toContain('LIMIT obligatoriu');
    expect(p).toContain('spend_total');
    expect(p).toContain('top_spending');
  });

  it('buildSystemPrompt injectează catalogul de conturi, categorii și data curentă', () => {
    const p = buildSystemPrompt(CTX);
    expect(p).toContain('2026-09-03');
    expect(p).toContain('BT_curent_ron');
    expect(p).toContain('acc-bt');
    expect(p).toContain('Revolut EUR');
    expect(p).toContain('Mașină');
    expect(p).toContain('key: vehicle');
    // Categoriile custom n-au cheie de sistem — nu inventăm una.
    expect(p).toContain('Cadouri (id: cat-custom)');
  });

  it('buildSystemPrompt nu trimite sume, solduri sau tranzacții', () => {
    const p = buildSystemPrompt({
      ...CTX,
      accounts: [{ id: 'acc-bt', name: 'BT_curent_ron', currency: 'RON' }],
    });
    const catalog = p.slice(
      p.indexOf('Conturile utilizatorului'),
      p.indexOf('Reguli de potrivire')
    );
    expect(catalog).not.toMatch(/\d+[.,]\d{2}/);
    expect(catalog).not.toContain('RON ');
  });

  it('buildSystemPrompt tratează catalogul gol fără să pice', () => {
    const p = buildSystemPrompt({ today: '2026-09-03', accounts: [], categories: [] });
    expect(p).toContain('(niciun cont)');
    expect(p).toContain('(nicio categorie)');
  });

  it('buildSystemPrompt include few-shot examples', () => {
    const p = buildSystemPrompt(CTX);
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
    const msgs = buildMessages(CTX, pairs, 'Q nouă');
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
    const msgs = buildMessages(CTX, pairs, 'Q2');
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'A1' });
  });
});

describe('reguli de corectitudine în prompt', () => {
  it('interzice COALESCE(amount_ron, amount) și impune CASE pe currency', () => {
    const p = buildSystemPrompt(CTX);
    expect(p).toContain("CASE WHEN currency = 'RON' THEN amount ELSE amount_ron END");
    // Regula veche, contradictorie, nu mai există.
    expect(p).not.toContain('- Pentru sume folosește COALESCE(amount_ron, amount).');
  });

  it('few-shot-urile respectă regula: niciun COALESCE pe sume', () => {
    const p = buildSystemPrompt(CTX);
    // Regula însăși citează COALESCE ca să-l interzică; verificăm doar exemplele.
    const fewShot = p.slice(p.indexOf('Exemplu de input/output:'));
    expect(fewShot).not.toContain('COALESCE(t.amount_ron, t.amount)');
    expect(fewShot).not.toContain('COALESCE(amount_ron, amount)');
  });

  it('few-shot-urile de cheltuieli includ restituirile', () => {
    const p = buildSystemPrompt(CTX);
    const fewShot = p.slice(p.indexOf('Exemplu de input/output:'));
    expect(fewShot).toContain('(t.amount < 0 OR t.is_refund = 1)');
    expect(fewShot).not.toContain('AND t.amount < 0 AND t.duplicate_of_id IS NULL');
  });

  it('impune excepția de transferuri la sold', () => {
    const p = buildSystemPrompt(CTX);
    expect(p).toContain('EXCEPȚIE IMPORTANTĂ la sold');
    expect(p).toContain('account_balance');
  });

  it('definește restituirile ca reducere de cheltuială, nu venit', () => {
    const p = buildSystemPrompt(CTX);
    expect(p).toContain('(amount < 0 OR is_refund = 1)');
    expect(p).toContain('(amount > 0 AND is_refund = 0)');
  });
});
