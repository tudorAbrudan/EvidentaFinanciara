import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View as RNView, Text as RNText } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import {
  formatAmountRo,
  isFullyReconciled,
  type PdfReconciliation,
} from '@/services/bankStatementPdfParser';
import { statusColors } from '@/theme/colors';

/** Câte zile nereconciliate listăm înainte de a rezuma restul. */
const MAX_LISTED_DAYS = 5;

interface Props {
  reconciliation: PdfReconciliation;
  currency: string;
}

/**
 * Extrasul BT conține propriile totaluri de control, deci putem spune userului
 * dacă cifrele afișate sunt verificate matematic — sau exact ce zi nu bate.
 * Fără acest card, un import greșit arată identic cu unul corect.
 */
export default function ImportReconciliationCard({ reconciliation, currency }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const ok = isFullyReconciled(reconciliation);
  const color = ok ? statusColors.ok : statusColors.warning;
  const failedDays = reconciliation.days.filter(d => !d.ok);

  return (
    <RNView style={[styles.card, { backgroundColor: C.card, borderColor: color }]}>
      <RNView style={styles.header}>
        <Ionicons name={ok ? 'shield-checkmark' : 'alert-circle-outline'} size={20} color={color} />
        <RNText style={[styles.title, { color: C.text }]}>
          {ok ? 'Extras verificat cu totalurile băncii' : 'Extrasul nu se verifică integral'}
        </RNText>
      </RNView>

      <RNText style={[styles.summary, { color: C.textSecondary }]}>
        {reconciliation.transactionCount} tranzacții · cheltuieli{' '}
        {formatAmountRo(reconciliation.totals.actualDebit)} {currency}
        {reconciliation.totals.ok ? ' ✓' : ''} · venituri{' '}
        {formatAmountRo(reconciliation.totals.actualCredit)} {currency}
        {reconciliation.totals.ok ? ' ✓' : ''}
      </RNText>

      {ok ? (
        <RNText style={[styles.detail, { color: C.textSecondary }]}>
          Toate cele {reconciliation.days.length} zile din extras se potrivesc la ban cu rândurile
          „RULAJ ZI".
        </RNText>
      ) : (
        <RNView style={styles.problems}>
          {reconciliation.transactionCount !== reconciliation.refCount && (
            <RNText style={[styles.detail, { color: C.text }]}>
              • Extrasul are {reconciliation.refCount} tranzacții, dar au fost citite{' '}
              {reconciliation.transactionCount}.
            </RNText>
          )}
          {failedDays.slice(0, MAX_LISTED_DAYS).map(day => (
            <RNText key={day.date} style={[styles.detail, { color: C.text }]}>
              • {day.date}: citit {formatAmountRo(day.actualDebit)} /{' '}
              {formatAmountRo(day.actualCredit)}, în extras {formatAmountRo(day.expectedDebit)} /{' '}
              {formatAmountRo(day.expectedCredit)}
            </RNText>
          ))}
          {failedDays.length > MAX_LISTED_DAYS && (
            <RNText style={[styles.detail, { color: C.textSecondary }]}>
              … și încă {failedDays.length - MAX_LISTED_DAYS} zile.
            </RNText>
          )}
          <RNText style={[styles.hint, { color: C.textSecondary }]}>
            Verifică manual tranzacțiile de mai jos sau trimite extrasul la AI pentru o a doua
            citire.
          </RNText>
        </RNView>
      )}
    </RNView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 8,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '700', flex: 1 },
  summary: { fontSize: 13, lineHeight: 19 },
  detail: { fontSize: 12, lineHeight: 18 },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  problems: { gap: 2 },
});
