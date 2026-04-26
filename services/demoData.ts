import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from './db';
import { createFinancialAccount } from './financialAccounts';
import { createTransaction } from './transactions';

const DEMO_ACCOUNT_KEY = 'settings_demo_account_id';

interface DemoTxTemplate {
  category_id: string | null;
  amount: number; // pozitiv pentru income, negativ pentru cheltuieli
  description: string;
  merchant?: string;
  /** offset în zile față de azi (negativ = în trecut) */
  daysAgo: number;
}

/**
 * Set de tranzacții fictive distribuite pe ultimele ~60 zile.
 * Aproximativ 30 de tranzacții pe categorii relevante + câteva necategorizate.
 */
function buildDemoTransactions(): DemoTxTemplate[] {
  return [
    // Venituri (2)
    {
      category_id: 'cat-sys-income',
      amount: 5200,
      description: 'Salariu',
      merchant: 'Angajator SRL',
      daysAgo: 1,
    },
    {
      category_id: 'cat-sys-income',
      amount: 5200,
      description: 'Salariu',
      merchant: 'Angajator SRL',
      daysAgo: 31,
    },

    // Casă / chirie (2)
    {
      category_id: 'cat-sys-home',
      amount: -1500,
      description: 'Chirie',
      merchant: 'Proprietar',
      daysAgo: 3,
    },
    {
      category_id: 'cat-sys-home',
      amount: -1500,
      description: 'Chirie',
      merchant: 'Proprietar',
      daysAgo: 33,
    },

    // Mâncare (6)
    {
      category_id: 'cat-sys-food',
      amount: -187.4,
      description: 'Cumpărături',
      merchant: 'Lidl',
      daysAgo: 2,
    },
    {
      category_id: 'cat-sys-food',
      amount: -56.2,
      description: 'Pâine, lapte',
      merchant: 'Carrefour',
      daysAgo: 5,
    },
    {
      category_id: 'cat-sys-food',
      amount: -243.9,
      description: 'Săptămânale',
      merchant: 'Kaufland',
      daysAgo: 8,
    },
    {
      category_id: 'cat-sys-food',
      amount: -78.5,
      description: 'Fructe & legume',
      merchant: 'Mega Image',
      daysAgo: 14,
    },
    {
      category_id: 'cat-sys-food',
      amount: -312.1,
      description: 'Cumpărături lunare',
      merchant: 'Lidl',
      daysAgo: 21,
    },
    {
      category_id: 'cat-sys-food',
      amount: -94.3,
      description: 'Carne & ouă',
      merchant: 'Carrefour',
      daysAgo: 27,
    },

    // Distracție (4)
    {
      category_id: 'cat-sys-entertainment',
      amount: -28,
      description: 'Cafea',
      merchant: 'Starbucks',
      daysAgo: 4,
    },
    {
      category_id: 'cat-sys-entertainment',
      amount: -185,
      description: 'Cină',
      merchant: 'La Mama',
      daysAgo: 11,
    },
    {
      category_id: 'cat-sys-entertainment',
      amount: -62,
      description: 'Bilete cinema',
      merchant: 'Cinema City',
      daysAgo: 17,
    },
    {
      category_id: 'cat-sys-entertainment',
      amount: -34,
      description: 'Cafea cu colegii',
      merchant: 'Starbucks',
      daysAgo: 25,
    },

    // Abonamente (4)
    {
      category_id: 'cat-sys-subscriptions',
      amount: -39.99,
      description: 'Netflix',
      merchant: 'Netflix',
      daysAgo: 6,
    },
    {
      category_id: 'cat-sys-subscriptions',
      amount: -19.99,
      description: 'Spotify',
      merchant: 'Spotify',
      daysAgo: 9,
    },
    {
      category_id: 'cat-sys-subscriptions',
      amount: -39.99,
      description: 'Netflix',
      merchant: 'Netflix',
      daysAgo: 36,
    },
    {
      category_id: 'cat-sys-subscriptions',
      amount: -19.99,
      description: 'Spotify',
      merchant: 'Spotify',
      daysAgo: 39,
    },

    // Mașină (1)
    {
      category_id: 'cat-sys-vehicle',
      amount: -218.4,
      description: 'Combustibil',
      merchant: 'OMV',
      daysAgo: 12,
    },

    // Sănătate (2)
    {
      category_id: 'cat-sys-health',
      amount: -45.5,
      description: 'Vitamine',
      merchant: 'Sensiblu',
      daysAgo: 19,
    },
    {
      category_id: 'cat-sys-health',
      amount: -78.2,
      description: 'Medicamente',
      merchant: 'Catena',
      daysAgo: 42,
    },

    // Transport (2)
    {
      category_id: 'cat-sys-transport',
      amount: -22.5,
      description: 'Cursă seara',
      merchant: 'Bolt',
      daysAgo: 7,
    },
    {
      category_id: 'cat-sys-transport',
      amount: -15,
      description: 'Abonament STB',
      merchant: 'STB',
      daysAgo: 30,
    },

    // Utilități (2)
    {
      category_id: 'cat-sys-utilities',
      amount: -184.5,
      description: 'Curent',
      merchant: 'Enel',
      daysAgo: 16,
    },
    {
      category_id: 'cat-sys-utilities',
      amount: -129,
      description: 'Internet & TV',
      merchant: 'Digi',
      daysAgo: 22,
    },

    // Necategorizate intenționat (3)
    {
      category_id: null,
      amount: -84,
      description: 'Cinema City',
      merchant: 'Cinema City',
      daysAgo: 13,
    },
    {
      category_id: null,
      amount: -276.5,
      description: 'Echipament sport',
      merchant: 'Decathlon',
      daysAgo: 24,
    },
    { category_id: null, amount: -412.9, description: 'Mobilier', merchant: 'Ikea', daysAgo: 45 },
  ];
}

function dateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Creează un cont demo cu ~30 de tranzacții fictive distribuite pe ultimele 60 de zile.
 * Tracking-ul contului demo se face în AsyncStorage pentru a permite ștergere ulterioară.
 *
 * Idempotent — dacă există deja un cont demo, returnează-l fără re-creare.
 */
export async function createDemoData(): Promise<{ accountId: string; transactionCount: number }> {
  const existing = await AsyncStorage.getItem(DEMO_ACCOUNT_KEY);
  if (existing) {
    return { accountId: existing, transactionCount: 0 };
  }

  const account = await createFinancialAccount({
    name: 'Cont demo',
    type: 'bank',
    currency: 'RON',
    initial_balance: 3500,
    color: '#9F9F9F',
    icon: 'flask',
    notes: 'Cont demo cu tranzacții fictive. Poate fi șters din Setări.',
  });

  const templates = buildDemoTransactions();
  let count = 0;
  for (const t of templates) {
    await createTransaction({
      account_id: account.id,
      date: dateOffset(t.daysAgo),
      amount: t.amount,
      currency: 'RON',
      description: t.description,
      merchant: t.merchant,
      category_id: t.category_id ?? undefined,
      source: 'demo',
    });
    count += 1;
  }

  await AsyncStorage.setItem(DEMO_ACCOUNT_KEY, account.id);
  return { accountId: account.id, transactionCount: count };
}

/**
 * Șterge contul demo și TOATE tranzacțiile asociate (sau marcate `source='demo'`).
 * Spre deosebire de `deleteFinancialAccount`, șterge tranzacțiile efectiv.
 * No-op dacă nu există cont demo.
 */
export async function deleteDemoData(): Promise<void> {
  const accountId = await AsyncStorage.getItem(DEMO_ACCOUNT_KEY);
  if (!accountId) return;
  try {
    await db.withTransactionAsync(async () => {
      // Șterge tranzacțiile demo (atât pe accountId cât și orice cu source='demo' rătăcite)
      await db.runAsync('DELETE FROM transactions WHERE account_id = ? OR source = ?', [
        accountId,
        'demo',
      ]);
      // Șterge contul demo
      await db.runAsync('DELETE FROM financial_accounts WHERE id = ?', [accountId]);
    });
  } finally {
    await AsyncStorage.removeItem(DEMO_ACCOUNT_KEY);
  }
}

export async function hasDemoData(): Promise<boolean> {
  const accountId = await AsyncStorage.getItem(DEMO_ACCOUNT_KEY);
  return accountId != null;
}

export async function getDemoAccountId(): Promise<string | null> {
  return AsyncStorage.getItem(DEMO_ACCOUNT_KEY);
}
