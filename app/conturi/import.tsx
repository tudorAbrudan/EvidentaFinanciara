import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  ActivityIndicator,
  View as RNView,
  Text as RNText,
} from 'react-native';

import AiPreflightDialog from '@/components/AiPreflightDialog';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCategories } from '@/hooks/useCategories';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { AI_CONSENT_KEY, getAiConfig, type AiProviderType } from '@/services/aiProvider';
import { mapStatementWithAi } from '@/services/aiStatementMapper';
import { mapStatementWithVisionAi } from '@/services/aiStatementVisionMapper';
import {
  parseBankStatementCsv,
  applyDirectionHint,
  type ParsedRow,
} from '@/services/bankStatementParser';
import { parseStatementPdf, type PdfStatementFormat } from '@/services/bankStatementPdfParser';
import { db, generateId } from '@/services/db';
import { getRateRon } from '@/services/fxRates';
import { listPendingTransferSuggestions } from '@/services/internalTransferSuggestion';
import { extractTextFromPdf } from '@/services/pdfExtractor';
import type { PreflightInfo } from '@/services/privacyPolicy';
import {
  createTransaction,
  findInternalTransferCandidates,
  findDuplicateCandidates,
  linkAsInternalTransfer,
  markAsDuplicate,
} from '@/services/transactions';
import { primary, statusColors } from '@/theme/colors';

type SourceKind = 'csv' | 'pdf';
type ParseFormat = string | PdfStatementFormat;

export default function ImportScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const params = useLocalSearchParams<{ account_id?: string }>();
  const accountId = params.account_id as string | undefined;
  const { accounts } = useFinancialAccounts();
  const { categories, getCategoryByKey } = useCategories();

  const [pickedName, setPickedName] = useState<string | null>(null);
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [pdfText, setPdfText] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsingStage, setParsingStage] = useState<string>('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  // Toate sursele de import (CSV, PDF euristic, AI text, AI vision) trec prin
  // corecția deterministă de semn înainte de preview — așa o „Incasare" greșit
  // clasificată ca debit apare corect ca venit, iar userul vede deja semnul bun.
  const setParsedRows = (parsed: ParsedRow[]) => setRows(parsed.map(applyDirectionHint));
  const [format, setFormat] = useState<ParseFormat>('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [usedAi, setUsedAi] = useState(false);
  const [usedVision, setUsedVision] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [aiProviderType, setAiProviderType] = useState<AiProviderType>('builtin');
  const [preflightInfo, setPreflightInfo] = useState<PreflightInfo | null>(null);
  const pendingAiActionRef = useRef<(() => void) | null>(null);

  function openPreflight(info: PreflightInfo, action: () => void) {
    pendingAiActionRef.current = action;
    setPreflightInfo(info);
  }

  function cancelPreflight() {
    pendingAiActionRef.current = null;
    setPreflightInfo(null);
  }

  function confirmPreflight() {
    const action = pendingAiActionRef.current;
    pendingAiActionRef.current = null;
    setPreflightInfo(null);
    action?.();
  }

  useEffect(() => {
    let cancelled = false;
    getAiConfig()
      .then(cfg => {
        if (!cancelled) setAiProviderType(cfg.type);
      })
      .catch(() => {
        // în caz de eroare, rămâne default-ul `builtin`
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const account = accounts.find(a => a.id === accountId);

  const totals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const r of rows) {
      if (r.amount > 0) inflow += r.amount;
      else outflow += -r.amount;
    }
    return { inflow, outflow, count: rows.length };
  }, [rows]);

  function resetParseState() {
    setRows([]);
    setFormat('');
    setWarnings([]);
    setUsedAi(false);
    setUsedVision(false);
    setPdfText(null);
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'text/csv',
          'text/comma-separated-values',
          'application/csv',
          'text/plain',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      resetParseState();
      setPickedName(asset.name);
      setPickedUri(asset.uri);
      const isPdf =
        asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
      const kind: SourceKind = isPdf ? 'pdf' : 'csv';
      setSourceKind(kind);
      await runParse(kind, asset.uri, account?.currency ?? 'RON');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut citi fișierul');
    }
  }

  async function runParse(kind: SourceKind, uri: string, currency: string) {
    setParsing(true);
    try {
      if (kind === 'csv') {
        setParsingStage('Se citește fișierul CSV…');
        const text = await FileSystem.readAsStringAsync(uri, { encoding: 'utf8' });
        const parsed = parseBankStatementCsv(text, currency);
        setParsedRows(parsed.rows);
        setFormat(parsed.format);
        setWarnings(parsed.warnings);
      } else {
        setParsingStage('Se extrage textul din PDF…');
        const extraction = await extractTextFromPdf(uri);
        setPdfText(extraction.text);
        setParsingStage('Se identifică tranzacțiile…');
        const parsed = parseStatementPdf(extraction.text, currency);
        setParsedRows(parsed.rows);
        setFormat(parsed.format);
        setWarnings([...extraction.warnings, ...parsed.warnings]);

        if (parsed.rows.length === 0) {
          await tryAiFallback(extraction.text, currency, true);
        }
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut analiza fișierul');
    } finally {
      setParsing(false);
      setParsingStage('');
    }
  }

  async function tryAiFallback(text: string, currency: string, automatic: boolean) {
    const consent = await AsyncStorage.getItem(AI_CONSENT_KEY);
    if (consent !== 'true') {
      if (!automatic) {
        Alert.alert(
          'AI dezactivat',
          'Activează asistentul AI din Setări pentru a trimite documentul la analiză.'
        );
      }
      return;
    }
    openPreflight(
      {
        fileName: pickedName ?? 'extras.pdf',
        sizeKb: Math.max(1, Math.round(text.length / 1024)),
        contentKind: 'pdf-text',
      },
      () => {
        void performAiFallback(text, currency, automatic);
      }
    );
  }

  async function performAiFallback(text: string, currency: string, automatic: boolean) {
    try {
      setParsingStage('Se trimite la AI pentru analiză avansată…');
      setParsing(true);
      const aiResult = await mapStatementWithAi(text, currency);
      if (aiResult.rows.length > 0) {
        setParsedRows(aiResult.rows);
        setFormat(aiResult.format);
        setWarnings([
          ...aiResult.warnings,
          'Rezultat obținut prin analiză AI — verifică tranzacțiile cu atenție.',
        ]);
        setUsedAi(true);
      } else if (!automatic) {
        Alert.alert(
          'AI nu a găsit tranzacții',
          'Modelul nu a putut extrage tranzacții din extras. Verifică textul sau încearcă alt fișier.'
        );
      }
    } catch (e) {
      Alert.alert(
        'Eroare AI',
        e instanceof Error ? e.message : 'Apelul la AI a eșuat. Verifică conexiunea.'
      );
    } finally {
      setParsing(false);
      setParsingStage('');
    }
  }

  async function reanalyzeWithAi() {
    if (sourceKind !== 'pdf') return;
    let text = pdfText;
    if (!text && pickedUri) {
      try {
        text = (await extractTextFromPdf(pickedUri)).text;
        setPdfText(text);
      } catch (e) {
        Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut citi PDF-ul.');
        return;
      }
    }
    if (!text) return;
    await tryAiFallback(text, account?.currency ?? 'RON', false);
  }

  async function runVisionFlow() {
    if (sourceKind !== 'pdf' || !pickedUri) return;
    const consent = await AsyncStorage.getItem(AI_CONSENT_KEY);
    if (consent !== 'true') {
      Alert.alert(
        'AI dezactivat',
        'Activează asistentul AI din Setări pentru a trimite documentul la analiză.'
      );
      return;
    }
    let sizeKb: number | undefined;
    try {
      const fileInfo = await FileSystem.getInfoAsync(pickedUri);
      if (fileInfo.exists && typeof fileInfo.size === 'number') {
        sizeKb = Math.max(1, Math.round(fileInfo.size / 1024));
      }
    } catch {
      // mărime opțională, continuăm fără
    }
    openPreflight(
      {
        fileName: pickedName ?? 'extras.pdf',
        sizeKb,
        contentKind: 'pdf-images',
      },
      () => {
        void performVisionFlow();
      }
    );
  }

  async function performVisionFlow() {
    if (sourceKind !== 'pdf' || !pickedUri) return;
    const currency = account?.currency ?? 'RON';
    setParsing(true);
    setParsingStage('Se randează paginile PDF…');
    try {
      const result = await mapStatementWithVisionAi(pickedUri, currency, evt => {
        if (evt.stage === 'rendering') setParsingStage('Se randează paginile PDF…');
        else if (evt.stage === 'sending') setParsingStage('Se trimite extrasul la AI vision…');
        else if (evt.stage === 'sending-chunked' && evt.current && evt.total) {
          setParsingStage(`Se trimite la AI vision (pagina ${evt.current}/${evt.total})…`);
        }
      });
      setParsedRows(result.rows);
      setFormat(result.format);
      setWarnings(result.warnings);
      setUsedAi(true);
      setUsedVision(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Apelul vision la AI a eșuat.';
      Alert.alert('Eroare AI vision', msg, [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Încearcă cu OCR + AI',
          onPress: () => {
            void reanalyzeWithAi();
          },
        },
      ]);
    } finally {
      setParsing(false);
      setParsingStage('');
    }
  }

  const aiButtonMode: 'vision' | 'ocr-text' | 'hidden' =
    aiProviderType === 'external' ? 'vision' : aiProviderType === 'none' ? 'hidden' : 'ocr-text';

  async function runImport() {
    if (!accountId) {
      Alert.alert('Eroare', 'Selectează un cont înainte de import.');
      return;
    }
    if (rows.length === 0) {
      Alert.alert('Eroare', 'Nu există tranzacții de importat.');
      return;
    }
    setImporting(true);
    try {
      const dates = rows.map(r => r.date).sort();
      const periodFrom = dates[0];
      const periodTo = dates[dates.length - 1];

      const stmtId = generateId();
      const now = new Date().toISOString();
      await db.runAsync(
        `INSERT INTO bank_statements
           (id, account_id, period_from, period_to, file_path, file_hash,
            imported_at, transaction_count, total_inflow, total_outflow, notes, created_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
        [
          stmtId,
          accountId,
          periodFrom,
          periodTo,
          now,
          rows.length,
          totals.inflow,
          totals.outflow,
          usedVision ? 'Importat via AI vision' : usedAi ? 'Importat via AI' : null,
          now,
        ]
      );

      let missingRates = 0;
      for (const r of rows) {
        let categoryId: string | undefined;
        if (r.category_key) {
          const cat = await getCategoryByKey(r.category_key);
          categoryId = cat?.id;
        }

        let amountRon: number | undefined;
        if (r.currency === 'RON') {
          amountRon = r.amount;
        } else {
          try {
            const rate = await getRateRon(r.date, r.currency);
            amountRon = r.amount * rate;
          } catch {
            missingRates += 1;
            amountRon = undefined;
          }
        }

        await createTransaction({
          account_id: accountId,
          date: r.date,
          amount: r.amount,
          currency: r.currency,
          amount_ron: amountRon,
          description: r.description,
          merchant: r.merchant,
          category_id: categoryId,
          source: 'statement',
          statement_id: stmtId,
        });
      }

      try {
        const transfers = await findInternalTransferCandidates();
        for (const cand of transfers) {
          if (cand.outflow.statement_id === stmtId || cand.inflow.statement_id === stmtId) {
            await linkAsInternalTransfer(cand.outflow.id, cand.inflow.id);
          }
        }
      } catch {}

      try {
        const duplicates = await findDuplicateCandidates(accountId);
        for (const group of duplicates) {
          for (const dup of group.candidates) {
            if (dup.statement_id === stmtId) {
              await markAsDuplicate(dup.id, group.primary.id);
            }
          }
        }
      } catch {}

      try {
        const pending = await listPendingTransferSuggestions({ limit: 10 });
        const fromThisStatement = pending.filter(p => p.statement_id === stmtId);
        if (fromThisStatement.length > 0) {
          setImportedCount(rows.length);
          setImporting(false);
          router.replace({
            pathname: '/sugestie-transfer/batch' as '/',
            params: { source: 'import', statementId: stmtId },
          });
          return;
        }
      } catch {}

      setImportedCount(rows.length);
      if (missingRates > 0) {
        Alert.alert(
          'Cursuri lipsă',
          `${missingRates} ${missingRates === 1 ? 'tranzacție nu a fost convertită' : 'tranzacții nu au fost convertite'} în RON (cursul BNR nu este disponibil offline). Poți încerca recalcularea din ecranul contului când ai acces la internet.`
        );
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Importul a eșuat');
    } finally {
      setImporting(false);
    }
  }

  if (!account) {
    return (
      <RNView style={[styles.container, { backgroundColor: C.background, padding: 24 }]}>
        <Stack.Screen options={{ title: 'Import extras' }} />
        <RNText style={{ color: C.text }}>
          Selectează un cont financiar din ecranul de detaliu pentru a importa un extras.
        </RNText>
      </RNView>
    );
  }

  if (importedCount !== null) {
    return (
      <RNView style={[styles.container, { backgroundColor: C.background }]}>
        <Stack.Screen options={{ title: 'Import finalizat' }} />
        <RNView style={styles.successWrap}>
          <Ionicons name="checkmark-circle" size={72} color={statusColors.ok} />
          <RNText style={[styles.successTitle, { color: C.text }]}>Import reușit</RNText>
          <RNText style={[styles.successSub, { color: C.textSecondary }]}>
            {importedCount} tranzacții importate în „{account.name}".
          </RNText>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/(tabs)');
            }}
            style={({ pressed }) => [
              styles.successBtn,
              { backgroundColor: primary },
              pressed && { opacity: 0.85 },
            ]}
          >
            <RNText style={styles.successBtnText}>Închide</RNText>
          </Pressable>
        </RNView>
      </RNView>
    );
  }

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen options={{ title: `Import extras — ${account.name}` }} />
      <ScrollView contentContainerStyle={styles.inner}>
        <RNText style={[styles.label, { color: C.text }]}>
          Pasul 1 — Selectează fișierul (PDF sau CSV)
        </RNText>
        <Pressable
          onPress={() => {
            void pickFile();
          }}
          disabled={parsing || importing}
          style={({ pressed }) => [
            styles.pickBtn,
            { borderColor: C.border, backgroundColor: C.card },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="document-outline" size={24} color={primary} />
          <RNText style={[styles.pickText, { color: C.text }]}>
            {pickedName ?? 'Apasă pentru a alege un fișier'}
          </RNText>
        </Pressable>

        {parsing && (
          <RNView style={styles.parsingRow}>
            <ActivityIndicator color={primary} />
            <RNText style={{ color: C.textSecondary, marginLeft: 8 }}>
              {parsingStage || 'Se analizează fișierul…'}
            </RNText>
          </RNView>
        )}

        {sourceKind === 'pdf' && !parsing && pickedName && aiButtonMode !== 'hidden' && (
          <Pressable
            onPress={() => {
              void (aiButtonMode === 'vision' ? runVisionFlow() : reanalyzeWithAi());
            }}
            style={({ pressed }) => [
              styles.aiBtn,
              { borderColor: primary, backgroundColor: C.card },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="sparkles" size={18} color={primary} />
            <RNText style={[styles.aiBtnText, { color: primary }]}>
              {aiButtonMode === 'vision'
                ? rows.length === 0
                  ? 'Trimite extras la AI'
                  : 'Re-analizează cu AI vision'
                : rows.length === 0
                  ? 'Trimite la AI'
                  : 'Re-analizează cu AI'}
            </RNText>
          </Pressable>
        )}

        {rows.length > 0 && (
          <>
            <RNText style={[styles.label, { color: C.text, marginTop: 24 }]}>
              Pasul 2 — Verifică tranzacțiile
            </RNText>
            <RNView
              style={[styles.summaryCard, { backgroundColor: C.card, borderColor: C.border }]}
            >
              <SummaryRow
                label="Sursă"
                value={
                  sourceKind === 'pdf'
                    ? usedVision
                      ? 'PDF + AI vision'
                      : usedAi
                        ? 'PDF + AI'
                        : 'PDF'
                    : 'CSV'
                }
                C={C}
              />
              <SummaryRow label="Format detectat" value={String(format).toUpperCase()} C={C} />
              <SummaryRow label="Total tranzacții" value={String(totals.count)} C={C} />
              <SummaryRow
                label="Venituri"
                value={`+${totals.inflow.toFixed(2)} ${account.currency}`}
                color={statusColors.ok}
                C={C}
              />
              <SummaryRow
                label="Cheltuieli"
                value={`-${totals.outflow.toFixed(2)} ${account.currency}`}
                color={statusColors.critical}
                C={C}
              />
            </RNView>

            {warnings.length > 0 && (
              <RNView
                style={[
                  styles.warningBox,
                  { borderColor: statusColors.warning, backgroundColor: C.card },
                ]}
              >
                <Ionicons name="warning-outline" size={16} color={statusColors.warning} />
                <RNView style={{ flex: 1 }}>
                  {warnings.slice(0, 5).map((w, i) => (
                    <RNText key={i} style={{ color: C.text, fontSize: 12 }}>
                      • {w}
                    </RNText>
                  ))}
                  {warnings.length > 5 && (
                    <RNText style={{ color: C.textSecondary, fontSize: 12 }}>
                      … și încă {warnings.length - 5} avertismente.
                    </RNText>
                  )}
                </RNView>
              </RNView>
            )}

            <RNText style={[styles.label, { color: C.text, marginTop: 16 }]}>
              Preview (primele 20)
            </RNText>
            {rows.slice(0, 20).map((r, i) => {
              const cat = r.category_key
                ? categories.find(c => c.key === r.category_key)
                : undefined;
              const color = r.amount >= 0 ? statusColors.ok : statusColors.critical;
              return (
                <RNView
                  key={i}
                  style={[styles.previewRow, { backgroundColor: C.card, borderColor: C.border }]}
                >
                  <RNView style={{ flex: 1 }}>
                    <RNText style={[styles.previewTitle, { color: C.text }]} numberOfLines={1}>
                      {r.merchant || r.description || 'Tranzacție'}
                    </RNText>
                    <RNText
                      style={[styles.previewSub, { color: C.textSecondary }]}
                      numberOfLines={1}
                    >
                      {r.date}
                      {cat ? ` • ${cat.name}` : ''}
                    </RNText>
                  </RNView>
                  <RNText style={[styles.previewAmount, { color }]}>
                    {r.amount >= 0 ? '+' : ''}
                    {r.amount.toFixed(2)} {r.currency}
                  </RNText>
                </RNView>
              );
            })}
            {rows.length > 20 && (
              <RNText style={[styles.previewMore, { color: C.textSecondary }]}>
                … și încă {rows.length - 20} tranzacții
              </RNText>
            )}
          </>
        )}

        {sourceKind === 'pdf' && !parsing && rows.length === 0 && pickedName && !usedAi && (
          <RNView style={[styles.emptyBox, { backgroundColor: C.card, borderColor: C.border }]}>
            <Ionicons name="alert-circle-outline" size={20} color={statusColors.warning} />
            <RNView style={{ flex: 1 }}>
              <RNText style={[styles.emptyTitle, { color: C.text }]}>
                Nu am identificat tranzacții
              </RNText>
              <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
                {aiButtonMode === 'vision'
                  ? 'Apasă „Trimite extras la AI" pentru analiză vision direct pe PDF.'
                  : aiButtonMode === 'ocr-text'
                    ? 'Apasă „Trimite la AI" pentru o analiză avansată a documentului.'
                    : 'Activează un provider AI din Setări pentru o analiză avansată.'}
              </RNText>
            </RNView>
          </RNView>
        )}
      </ScrollView>

      {rows.length > 0 && (
        <BottomActionBar
          label={`Importă ${rows.length} tranzacții`}
          icon={<Ionicons name="cloud-upload" size={18} color="#fff" />}
          onPress={() => {
            void runImport();
          }}
          loading={importing}
          safeArea
        />
      )}

      <AiPreflightDialog
        visible={preflightInfo !== null}
        info={preflightInfo}
        onCancel={cancelPreflight}
        onConfirm={confirmPreflight}
      />
    </RNView>
  );
}

function SummaryRow({
  label,
  value,
  color,
  C,
}: {
  label: string;
  value: string;
  color?: string;
  C: typeof Colors.light;
}) {
  return (
    <RNView style={styles.summaryRow}>
      <RNText style={{ color: C.textSecondary }}>{label}</RNText>
      <RNText style={{ color: color ?? C.text, fontWeight: '600' }}>{value}</RNText>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { padding: 16, paddingBottom: 96 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 12 },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 18,
    borderStyle: 'dashed',
  },
  pickText: { fontSize: 14 },
  parsingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },

  aiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 12,
  },
  aiBtnText: { fontSize: 14, fontWeight: '600' },

  summaryCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  previewTitle: { fontSize: 14, fontWeight: '500' },
  previewSub: { fontSize: 12 },
  previewAmount: { fontSize: 14, fontWeight: '700' },
  previewMore: { textAlign: 'center', fontSize: 12, marginTop: 8 },

  emptyBox: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    marginTop: 16,
  },
  emptyTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  emptySub: { fontSize: 12, lineHeight: 18 },

  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  successTitle: { fontSize: 22, fontWeight: '700' },
  successSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  successBtn: {
    marginTop: 16,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  successBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
