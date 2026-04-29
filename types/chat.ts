// ────────────────────────────────────────────────────────────────────────────
// Asistent AI — chat
// ────────────────────────────────────────────────────────────────────────────

export type ChatTemplate =
  | 'search_merchant'
  | 'top_merchants'
  | 'monthly_total'
  | 'category_evolution'
  | 'period_compare'
  | 'list_accounts'
  | 'list_categories'
  | 'raw_list'
  | 'cannot_answer';

export type ChatRole = 'user' | 'assistant' | 'system_error';

export type ChatErrorKind =
  | 'invalid_sql'
  | 'quota_exhausted'
  | 'cannot_answer'
  | 'context_overflow'
  | 'network';

export type EvidenceItem =
  | {
      kind: 'transaction';
      id: string;
      date: string;
      amount: number;
      merchant: string;
      account: string;
      category?: string;
    }
  | { kind: 'account'; id: string; name: string; type: string }
  | { kind: 'category'; id: string; name: string; parent?: string }
  | { kind: 'aggregate'; label: string; period: string; total: number; count: number };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  template?: ChatTemplate;
  sqlUsed?: string;
  evidence?: EvidenceItem[];
  explanationShort?: string;
  errorKind?: ChatErrorKind;
  createdAt: string;
}
