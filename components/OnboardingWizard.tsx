import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme as useColorSchemeNative,
  View,
} from 'react-native';

import AiDisclosureExpandable from '@/components/AiDisclosureExpandable';
import AppLockPinModal from '@/components/AppLockPinModal';
import Colors from '@/constants/Colors';
import { useThemePreference } from '@/hooks/useThemeScheme';
import {
  AI_CONSENT_KEY,
  PROVIDER_DEFAULTS,
  saveAiApiKey,
  saveAiConfig,
  type AiProviderType,
} from '@/services/aiProvider';
import { createDemoData, hasDemoData } from '@/services/demoData';
import { createFinancialAccount } from '@/services/financialAccounts';
import { AI_PROVIDER_LEGAL, AI_PROVIDER_NAME } from '@/services/privacyPolicy';
import * as settings from '@/services/settings';
import type { ThemePreference } from '@/services/settings';
import { primary, primaryMuted, primaryTint, statusColors } from '@/theme/colors';
import { radius, spacing } from '@/theme/layout';
import { FINANCIAL_ACCOUNT_TYPE_LABELS, type FinancialAccountType } from '@/types';

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step =
  | 'WELCOME'
  | 'APPEARANCE'
  | 'SECURITY'
  | 'ACCOUNT'
  | 'DEMO_DATA'
  | 'AI_STEP'
  | 'BACKUP'
  | 'SUMMARY';

const STEP_ORDER: Step[] = [
  'WELCOME',
  'APPEARANCE',
  'SECURITY',
  'ACCOUNT',
  'DEMO_DATA',
  'AI_STEP',
  'BACKUP',
  'SUMMARY',
];

const ACCOUNT_TYPES: FinancialAccountType[] = [
  'bank',
  'cash',
  'card',
  'savings',
  'investment',
  'other',
];

const CURRENCIES = ['RON', 'EUR', 'USD'];

function normalizeAmount(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { setPreference: setGlobalThemePreference } = useThemePreference();
  const systemScheme = useColorSchemeNative();

  const [step, setStep] = useState<Step>('WELCOME');
  const [committing, setCommitting] = useState(false);

  // APPEARANCE
  const [themePref, setThemePref] = useState<ThemePreference>('auto');

  // SECURITY
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinSetUp, setPinSetUp] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  // ACCOUNT
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<FinancialAccountType>('bank');
  const [accountInitialBalance, setAccountInitialBalance] = useState('');
  const [accountCurrency, setAccountCurrency] = useState('RON');

  // DEMO DATA
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoAlreadyExists, setDemoAlreadyExists] = useState(false);

  // AI
  const [aiProviderChoice, setAiProviderChoice] = useState<AiProviderType>('builtin');
  const [aiExternalUrl, setAiExternalUrl] = useState('');
  const [aiExternalApiKey, setAiExternalApiKey] = useState('');
  const [aiExternalModel, setAiExternalModel] = useState('');
  const [aiConsentChecked, setAiConsentChecked] = useState(false);

  // Tema „efectivă" pentru preview vizual în wizard, fără a scrie în context
  const effectiveScheme: 'light' | 'dark' = useMemo(() => {
    if (themePref === 'auto') return systemScheme === 'dark' ? 'dark' : 'light';
    return themePref;
  }, [themePref, systemScheme]);
  const C = Colors[effectiveScheme];

  useEffect(() => {
    if (Platform.OS === 'web') return;
    LocalAuthentication.hasHardwareAsync()
      .then(setBiometricAvailable)
      .catch(() => {});
  }, []);

  useEffect(() => {
    hasDemoData()
      .then(setDemoAlreadyExists)
      .catch(() => {});
  }, []);

  const stepIndex = STEP_ORDER.indexOf(step);
  const totalSteps = STEP_ORDER.length;
  const progress = (stepIndex + 1) / totalSteps;

  const canContinue = (() => {
    switch (step) {
      case 'ACCOUNT':
        return accountName.trim().length > 0;
      case 'AI_STEP':
        if (aiProviderChoice === 'none') return true;
        if (!aiConsentChecked) return false;
        if (aiProviderChoice === 'external') {
          return (
            aiExternalUrl.trim().length > 0 &&
            aiExternalApiKey.trim().length > 0 &&
            aiExternalModel.trim().length > 0
          );
        }
        return true;
      default:
        return true;
    }
  })();

  function goNext() {
    if (!canContinue) return;
    const next = STEP_ORDER[stepIndex + 1];
    if (next) setStep(next);
  }

  function goBack() {
    const prev = STEP_ORDER[stepIndex - 1];
    if (prev) setStep(prev);
  }

  async function handleCommit() {
    if (committing) return;
    setCommitting(true);

    try {
      // 1. Tema
      await settings.setThemePreference(themePref);
      setGlobalThemePreference(themePref);

      // 2. App lock (PIN deja salvat în SecureStore în pasul SECURITY dacă pinSetUp)
      if (pinSetUp) {
        await settings.setAppLockEnabled(true);
      }

      // 3. Cont real
      const initialBalance = normalizeAmount(accountInitialBalance);
      await createFinancialAccount({
        name: accountName.trim(),
        type: accountType,
        currency: accountCurrency,
        initial_balance: initialBalance,
      });

      // 4. AI provider
      const defaults = PROVIDER_DEFAULTS[aiProviderChoice];
      if (aiProviderChoice === 'external') {
        await saveAiConfig({
          type: 'external',
          url: aiExternalUrl.trim(),
          model: aiExternalModel.trim(),
        });
        await saveAiApiKey(aiExternalApiKey.trim());
      } else {
        await saveAiConfig({
          type: aiProviderChoice,
          url: defaults.url,
          model: defaults.model,
        });
      }

      // 5. Consent AI (dacă a ales builtin/external)
      if (aiProviderChoice !== 'none' && aiConsentChecked) {
        await AsyncStorage.setItem(AI_CONSENT_KEY, 'true');
      }

      // 6. Date demo (best-effort: nu blochează commit-ul)
      let demoWarning: string | null = null;
      if (demoEnabled && !demoAlreadyExists) {
        try {
          await createDemoData();
        } catch (e) {
          demoWarning = e instanceof Error ? e.message : 'Datele demo nu au putut fi generate.';
        }
      }

      // 7. Marchează onboarding done — ULTIMUL pas
      await settings.setOnboardingDone();

      if (demoWarning) {
        Alert.alert('Aproape gata', `Setup-ul a fost finalizat, dar:\n\n${demoWarning}`);
      }

      onComplete();
    } catch (e) {
      Alert.alert(
        'Eroare la salvare',
        e instanceof Error ? e.message : 'Nu s-a putut finaliza setup-ul. Încearcă din nou.'
      );
      setCommitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: C.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.stepIndicator, { color: C.textSecondary }]}>
          Pasul {stepIndex + 1} din {totalSteps}
        </Text>
        <View style={[styles.progressTrack, { backgroundColor: C.border }]}>
          <View
            style={[styles.progressFill, { backgroundColor: primary, width: `${progress * 100}%` }]}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 'WELCOME' && <WelcomeStep C={C} />}
        {step === 'APPEARANCE' && (
          <AppearanceStep C={C} themePref={themePref} setThemePref={setThemePref} />
        )}
        {step === 'SECURITY' && (
          <SecurityStep
            C={C}
            biometricAvailable={biometricAvailable}
            pinSetUp={pinSetUp}
            onActivate={() => setPinModalVisible(true)}
          />
        )}
        {step === 'ACCOUNT' && (
          <AccountStep
            C={C}
            accountName={accountName}
            setAccountName={setAccountName}
            accountType={accountType}
            setAccountType={setAccountType}
            accountInitialBalance={accountInitialBalance}
            setAccountInitialBalance={setAccountInitialBalance}
            accountCurrency={accountCurrency}
            setAccountCurrency={setAccountCurrency}
          />
        )}
        {step === 'DEMO_DATA' && (
          <DemoDataStep
            C={C}
            enabled={demoEnabled}
            setEnabled={setDemoEnabled}
            alreadyExists={demoAlreadyExists}
          />
        )}
        {step === 'AI_STEP' && (
          <AiStep
            C={C}
            provider={aiProviderChoice}
            setProvider={setAiProviderChoice}
            externalUrl={aiExternalUrl}
            setExternalUrl={setAiExternalUrl}
            externalApiKey={aiExternalApiKey}
            setExternalApiKey={setAiExternalApiKey}
            externalModel={aiExternalModel}
            setExternalModel={setAiExternalModel}
            consent={aiConsentChecked}
            setConsent={setAiConsentChecked}
          />
        )}
        {step === 'BACKUP' && <BackupStep C={C} />}
        {step === 'SUMMARY' && (
          <SummaryStep
            C={C}
            themePref={themePref}
            pinSetUp={pinSetUp}
            accountName={accountName}
            accountType={accountType}
            accountInitialBalance={accountInitialBalance}
            accountCurrency={accountCurrency}
            demoEnabled={demoEnabled && !demoAlreadyExists}
            aiProvider={aiProviderChoice}
          />
        )}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: C.border, backgroundColor: C.background }]}>
        {stepIndex > 0 ? (
          <Pressable style={[styles.btnGhost]} onPress={goBack} disabled={committing}>
            <Text style={[styles.btnGhostText, { color: C.textSecondary }]}>Înapoi</Text>
          </Pressable>
        ) : (
          <View style={styles.btnGhost} />
        )}

        {step === 'SUMMARY' ? (
          <Pressable
            style={[styles.btnPrimary, { backgroundColor: primary, opacity: committing ? 0.7 : 1 }]}
            onPress={() => {
              void handleCommit();
            }}
            disabled={committing}
          >
            {committing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnPrimaryText}>Începe</Text>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.btnPrimary,
              {
                backgroundColor: primary,
                opacity: canContinue ? 1 : 0.5,
              },
            ]}
            onPress={goNext}
            disabled={!canContinue}
          >
            <Text style={styles.btnPrimaryText}>Continuă</Text>
          </Pressable>
        )}
      </View>

      <AppLockPinModal
        visible={pinModalVisible}
        onDismiss={() => setPinModalVisible(false)}
        showSuccessAlert={false}
        deferEnable
        onPinSaved={() => setPinSetUp(true)}
      />
    </KeyboardAvoidingView>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Sub-componente per step (helper-i inline)
// ───────────────────────────────────────────────────────────────────────

interface ThemedProps {
  C: typeof Colors.light;
}

function StepHeader({
  C,
  icon,
  title,
  subtitle,
}: ThemedProps & { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string }) {
  return (
    <View style={styles.stepHeader}>
      <View style={[styles.stepIconBubble, { backgroundColor: primaryTint }]}>
        <Ionicons name={icon} size={32} color={primary} />
      </View>
      <Text style={[styles.stepTitle, { color: C.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.stepSubtitle, { color: C.textSecondary }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

function BulletList({
  C,
  items,
}: ThemedProps & { items: { icon: keyof typeof Ionicons.glyphMap; text: string }[] }) {
  return (
    <View style={styles.bulletList}>
      {items.map((it, i) => (
        <View key={i} style={styles.bullet}>
          <View style={[styles.bulletIcon, { backgroundColor: primaryTint }]}>
            <Ionicons name={it.icon} size={18} color={primary} />
          </View>
          <Text style={[styles.bulletText, { color: C.text }]}>{it.text}</Text>
        </View>
      ))}
    </View>
  );
}

function Chip({
  C,
  selected,
  label,
  onPress,
  disabled,
}: ThemedProps & {
  selected: boolean;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? primary : primaryMuted,
          borderColor: selected ? primary : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? '#fff' : C.text }]}>{label}</Text>
    </Pressable>
  );
}

// ─── WELCOME ────────────────────────────────────────────────────────────
function WelcomeStep({ C }: ThemedProps) {
  return (
    <View>
      <StepHeader
        C={C}
        icon="sparkles"
        title="Bine ai venit la Finanțe Personale"
        subtitle="O aplicație simplă pentru a-ți urmări banii — local, fără conturi online."
      />
      <BulletList
        C={C}
        items={[
          {
            icon: 'phone-portrait',
            text: 'Datele rămân pe dispozitivul tău. Niciun server obligatoriu.',
          },
          {
            icon: 'sparkles-outline',
            text: 'AI-ul e opțional și transparent — îl activezi tu, când vrei.',
          },
          { icon: 'archive', text: 'Backup manual oricând în iCloud, Drive sau Fișiere.' },
          {
            icon: 'shield-checkmark',
            text: 'Niciun cont online obligatoriu. Începi în câțiva pași.',
          },
        ]}
      />
    </View>
  );
}

// ─── APPEARANCE ─────────────────────────────────────────────────────────
function AppearanceStep({
  C,
  themePref,
  setThemePref,
}: ThemedProps & {
  themePref: ThemePreference;
  setThemePref: (p: ThemePreference) => void;
}) {
  return (
    <View>
      <StepHeader
        C={C}
        icon="color-palette"
        title="Cum arată app-ul"
        subtitle="Alege tema. O poți schimba oricând din Setări."
      />
      <View style={styles.chipRow}>
        <Chip
          C={C}
          selected={themePref === 'auto'}
          label="Auto"
          onPress={() => setThemePref('auto')}
        />
        <Chip
          C={C}
          selected={themePref === 'light'}
          label="Clar"
          onPress={() => setThemePref('light')}
        />
        <Chip
          C={C}
          selected={themePref === 'dark'}
          label="Întunecat"
          onPress={() => setThemePref('dark')}
        />
      </View>

      <View style={[styles.previewCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <Text style={[styles.previewLabel, { color: C.textSecondary }]}>Sold curent</Text>
        <Text style={[styles.previewValue, { color: C.text }]}>2.847,50 RON</Text>
        <View style={styles.previewRow}>
          <View style={[styles.previewPill, { backgroundColor: primaryTint }]}>
            <Text style={[styles.previewPillText, { color: primary }]}>+ Venituri</Text>
          </View>
          <View style={[styles.previewPill, { backgroundColor: 'rgba(216, 76, 76, 0.12)' }]}>
            <Text style={[styles.previewPillText, { color: statusColors.critical }]}>
              − Cheltuieli
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── SECURITY ───────────────────────────────────────────────────────────
function SecurityStep({
  C,
  biometricAvailable,
  pinSetUp,
  onActivate,
}: ThemedProps & {
  biometricAvailable: boolean;
  pinSetUp: boolean;
  onActivate: () => void;
}) {
  return (
    <View>
      <StepHeader
        C={C}
        icon="lock-closed"
        title="Blocare app"
        subtitle="Protejează-ți datele financiare cu PIN sau biometric."
      />
      <BulletList
        C={C}
        items={[
          {
            icon: 'finger-print',
            text: biometricAvailable
              ? 'Face ID / Touch ID disponibile pe acest dispozitiv.'
              : 'Doar PIN — biometria nu e disponibilă pe acest dispozitiv.',
          },
          { icon: 'keypad', text: 'PIN de 4–8 cifre ca alternativă la biometric.' },
          { icon: 'time', text: 'Aplicația se blochează automat când o trimiți în fundal.' },
        ]}
      />

      {pinSetUp ? (
        <View style={[styles.successCard, { borderColor: primary, backgroundColor: primaryTint }]}>
          <Ionicons name="checkmark-circle" size={22} color={primary} />
          <Text style={[styles.successText, { color: C.text }]}>
            PIN setat. Blocarea se activează la finalul setup-ului.
          </Text>
        </View>
      ) : (
        <Pressable onPress={onActivate} style={[styles.btnSecondary, { borderColor: primary }]}>
          <Ionicons name="lock-closed" size={18} color={primary} />
          <Text style={[styles.btnSecondaryText, { color: primary }]}>Activează app lock</Text>
        </Pressable>
      )}

      <Text style={[styles.skipHint, { color: C.textSecondary }]}>
        Poți sări peste — îl activezi oricând din Setări.
      </Text>
    </View>
  );
}

// ─── ACCOUNT ────────────────────────────────────────────────────────────
function AccountStep({
  C,
  accountName,
  setAccountName,
  accountType,
  setAccountType,
  accountInitialBalance,
  setAccountInitialBalance,
  accountCurrency,
  setAccountCurrency,
}: ThemedProps & {
  accountName: string;
  setAccountName: (v: string) => void;
  accountType: FinancialAccountType;
  setAccountType: (v: FinancialAccountType) => void;
  accountInitialBalance: string;
  setAccountInitialBalance: (v: string) => void;
  accountCurrency: string;
  setAccountCurrency: (v: string) => void;
}) {
  return (
    <View>
      <StepHeader
        C={C}
        icon="wallet"
        title="Primul cont"
        subtitle="Adaugă un cont real ca să poți începe să-ți urmărești cheltuielile."
      />

      <Text style={[styles.fieldLabel, { color: C.text }]}>Nume cont</Text>
      <TextInput
        value={accountName}
        onChangeText={setAccountName}
        placeholder="ex. ING Personal"
        placeholderTextColor={C.textSecondary}
        style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.card }]}
      />

      <Text style={[styles.fieldLabel, { color: C.text }]}>Tip</Text>
      <View style={styles.chipRow}>
        {ACCOUNT_TYPES.map(t => (
          <Chip
            key={t}
            C={C}
            selected={accountType === t}
            label={FINANCIAL_ACCOUNT_TYPE_LABELS[t]}
            onPress={() => setAccountType(t)}
          />
        ))}
      </View>

      <Text style={[styles.fieldLabel, { color: C.text }]}>Sold inițial</Text>
      <TextInput
        value={accountInitialBalance}
        onChangeText={setAccountInitialBalance}
        placeholder="0"
        placeholderTextColor={C.textSecondary}
        keyboardType="decimal-pad"
        style={[styles.input, { color: C.text, borderColor: C.border, backgroundColor: C.card }]}
      />

      <Text style={[styles.fieldLabel, { color: C.text }]}>Monedă</Text>
      <View style={styles.chipRow}>
        {CURRENCIES.map(c => (
          <Chip
            key={c}
            C={C}
            selected={accountCurrency === c}
            label={c}
            onPress={() => setAccountCurrency(c)}
          />
        ))}
      </View>
    </View>
  );
}

// ─── DEMO DATA ──────────────────────────────────────────────────────────
function DemoDataStep({
  C,
  enabled,
  setEnabled,
  alreadyExists,
}: ThemedProps & {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  alreadyExists: boolean;
}) {
  return (
    <View>
      <StepHeader
        C={C}
        icon="flask"
        title="Date demo"
        subtitle="Vezi cum arată app-ul cu un cont fictiv și ~30 de tranzacții."
      />

      <View style={[styles.toggleCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[styles.toggleTitle, { color: C.text }]}>
            Adaugă cont demo cu tranzacții fictive
          </Text>
          <Text style={[styles.toggleHint, { color: C.textSecondary }]}>
            Le poți șterge oricând cu un buton din Setări.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={setEnabled}
          disabled={alreadyExists}
          trackColor={{ false: C.border, true: primary }}
          thumbColor="#fff"
        />
      </View>

      {alreadyExists ? (
        <View style={[styles.infoBadge, { backgroundColor: primaryTint }]}>
          <Ionicons name="information-circle" size={18} color={primary} />
          <Text style={[styles.infoBadgeText, { color: C.text }]}>
            Deja există date demo. Le poți șterge din Setări.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── AI STEP ────────────────────────────────────────────────────────────
function AiStep({
  C,
  provider,
  setProvider,
  externalUrl,
  setExternalUrl,
  externalApiKey,
  setExternalApiKey,
  externalModel,
  setExternalModel,
  consent,
  setConsent,
}: ThemedProps & {
  provider: AiProviderType;
  setProvider: (p: AiProviderType) => void;
  externalUrl: string;
  setExternalUrl: (v: string) => void;
  externalApiKey: string;
  setExternalApiKey: (v: string) => void;
  externalModel: string;
  setExternalModel: (v: string) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
}) {
  return (
    <View>
      <StepHeader
        C={C}
        icon="sparkles"
        title="Asistent AI"
        subtitle="AI-ul te ajută să categorisești tranzacții, dar nu e obligatoriu."
      />

      <ProviderOption
        C={C}
        selected={provider === 'builtin'}
        title="Finanțe AI (recomandat)"
        description="Cheie inclusă, 20 cereri pe zi gratuite."
        onPress={() => setProvider('builtin')}
      />
      <ProviderOption
        C={C}
        selected={provider === 'external'}
        title="Cheia mea API"
        description="OpenAI / Mistral / orice endpoint compatibil. Nelimitat."
        onPress={() => setProvider('external')}
      />
      <ProviderOption
        C={C}
        selected={provider === 'none'}
        title="Fără AI"
        description="Folosesc app-ul fără asistent. Pot activa oricând din Setări."
        onPress={() => setProvider('none')}
      />

      {provider === 'external' ? (
        <View style={styles.externalFields}>
          <Text style={[styles.fieldLabel, { color: C.text }]}>URL API</Text>
          <TextInput
            value={externalUrl}
            onChangeText={setExternalUrl}
            placeholder="https://api.openai.com/v1"
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              { color: C.text, borderColor: C.border, backgroundColor: C.card },
            ]}
          />
          <Text style={[styles.fieldLabel, { color: C.text }]}>Cheie API</Text>
          <TextInput
            value={externalApiKey}
            onChangeText={setExternalApiKey}
            placeholder="sk-..."
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={[
              styles.input,
              { color: C.text, borderColor: C.border, backgroundColor: C.card },
            ]}
          />
          <Text style={[styles.fieldLabel, { color: C.text }]}>Model</Text>
          <TextInput
            value={externalModel}
            onChangeText={setExternalModel}
            placeholder="gpt-4o-mini"
            placeholderTextColor={C.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              { color: C.text, borderColor: C.border, backgroundColor: C.card },
            ]}
          />
        </View>
      ) : null}

      {provider !== 'none' ? (
        <>
          <Pressable
            style={[
              styles.consentRow,
              !consent && styles.consentRowCallout,
              !consent && { backgroundColor: primaryTint, borderColor: primary },
            ]}
            onPress={() => setConsent(!consent)}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: consent ? primary : C.border,
                  backgroundColor: consent ? primary : 'transparent',
                },
              ]}
            >
              {consent ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
            </View>
            <View style={styles.consentTextCol}>
              <Text style={[styles.consentText, { color: C.text }]}>
                Sunt de acord ca datele descrise mai jos să fie trimise la {AI_PROVIDER_NAME} (
                {AI_PROVIDER_LEGAL}) pentru procesare. Pot revoca oricând din Setări.
              </Text>
              {!consent ? (
                <Text style={[styles.consentRequiredHint, { color: primary }]}>
                  Necesar pentru a continua
                </Text>
              ) : null}
            </View>
          </Pressable>
          <AiDisclosureExpandable />
        </>
      ) : null}
    </View>
  );
}

function ProviderOption({
  C,
  selected,
  title,
  description,
  onPress,
}: ThemedProps & {
  selected: boolean;
  title: string;
  description: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.providerCard,
        {
          borderColor: selected ? primary : C.border,
          backgroundColor: selected ? primaryTint : C.card,
        },
      ]}
    >
      <View style={[styles.radio, { borderColor: selected ? primary : C.border }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: primary }]} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.providerTitle, { color: C.text }]}>{title}</Text>
        <Text style={[styles.providerDesc, { color: C.textSecondary }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

// ─── BACKUP ─────────────────────────────────────────────────────────────
function BackupStep({ C }: ThemedProps) {
  return (
    <View>
      <StepHeader
        C={C}
        icon="archive"
        title="Backup & restaurare"
        subtitle="Datele rămân pe device — backup-ul îl faci tu, când vrei."
      />
      <BulletList
        C={C}
        items={[
          { icon: 'document-text', text: 'Backup-ul e un fișier ZIP cu toate datele tale.' },
          {
            icon: 'cloud-upload',
            text: 'Salvează-l în iCloud, Google Drive sau aplicația Fișiere.',
          },
          { icon: 'sync', text: 'Restaurarea se face din Setări → Importă backup.' },
          { icon: 'notifications', text: 'Te anunțăm dacă au trecut prea multe zile fără backup.' },
        ]}
      />
    </View>
  );
}

// ─── SUMMARY ────────────────────────────────────────────────────────────
function SummaryStep({
  C,
  themePref,
  pinSetUp,
  accountName,
  accountType,
  accountInitialBalance,
  accountCurrency,
  demoEnabled,
  aiProvider,
}: ThemedProps & {
  themePref: ThemePreference;
  pinSetUp: boolean;
  accountName: string;
  accountType: FinancialAccountType;
  accountInitialBalance: string;
  accountCurrency: string;
  demoEnabled: boolean;
  aiProvider: AiProviderType;
}) {
  const themeLabel =
    themePref === 'auto' ? 'Automat' : themePref === 'light' ? 'Clar' : 'Întunecat';
  const balance = normalizeAmount(accountInitialBalance);
  const balanceLabel = `${balance.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${accountCurrency}`;
  const aiLabel =
    aiProvider === 'builtin'
      ? 'Finanțe AI'
      : aiProvider === 'external'
        ? 'Cheie proprie'
        : 'Fără AI';

  return (
    <View>
      <StepHeader
        C={C}
        icon="checkmark-circle"
        title="Gata de pornire"
        subtitle={'Verifică alegerile și apasă „Începe".'}
      />

      <View style={[styles.summaryCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <SummaryRow C={C} icon="color-palette" label="Tema" value={themeLabel} />
        <SummaryRow
          C={C}
          icon="lock-closed"
          label="App lock"
          value={pinSetUp ? 'Activ (PIN setat)' : 'Dezactivat'}
        />
        <SummaryRow
          C={C}
          icon="wallet"
          label="Cont"
          value={`${accountName} · ${FINANCIAL_ACCOUNT_TYPE_LABELS[accountType]} · ${balanceLabel}`}
        />
        <SummaryRow C={C} icon="flask" label="Date demo" value={demoEnabled ? 'Da' : 'Nu'} />
        <SummaryRow C={C} icon="sparkles" label="AI" value={aiLabel} />
      </View>
    </View>
  );
}

function SummaryRow({
  C,
  icon,
  label,
  value,
}: ThemedProps & { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <View style={[styles.summaryIcon, { backgroundColor: primaryTint }]}>
        <Ionicons name={icon} size={16} color={primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.summaryLabel, { color: C.textSecondary }]}>{label}</Text>
        <Text style={[styles.summaryValue, { color: C.text }]}>{value}</Text>
      </View>
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 9998,
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: spacing.screen,
    paddingBottom: 8,
  },
  stepIndicator: { fontSize: 13, fontWeight: '500', marginBottom: 8 },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 2 },
  scrollContent: {
    padding: spacing.screen,
    paddingBottom: spacing.section,
  },
  stepHeader: { alignItems: 'flex-start', marginBottom: spacing.section },
  stepIconBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  stepTitle: { fontSize: 24, fontWeight: '700', marginBottom: 6 },
  stepSubtitle: { fontSize: 15, lineHeight: 22 },
  bulletList: { gap: 12, marginBottom: 8 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  bulletIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20, paddingTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  previewCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.cardPadding,
    marginTop: 8,
  },
  previewLabel: { fontSize: 12, marginBottom: 4 },
  previewValue: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  previewRow: { flexDirection: 'row', gap: 8 },
  previewPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  previewPillText: { fontSize: 12, fontWeight: '600' },
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: 8,
  },
  successText: { flex: 1, fontSize: 14 },
  btnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    paddingVertical: 14,
    borderRadius: radius.pill,
    marginTop: 8,
  },
  btnSecondaryText: { fontSize: 15, fontWeight: '600' },
  skipHint: { fontSize: 13, textAlign: 'center', marginTop: 12 },
  fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.cardPadding,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  toggleTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  toggleHint: { fontSize: 13, lineHeight: 18 },
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    marginTop: 12,
  },
  infoBadgeText: { flex: 1, fontSize: 13 },
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: spacing.cardPadding,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  providerTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  providerDesc: { fontSize: 13, lineHeight: 18 },
  externalFields: { marginTop: 8 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 16,
  },
  consentRowCallout: {
    padding: 12,
    borderWidth: 1.5,
    borderRadius: radius.md,
  },
  consentTextCol: { flex: 1, gap: 4 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  consentText: { flex: 1, fontSize: 13, lineHeight: 18 },
  consentRequiredHint: { fontSize: 12, fontWeight: '600' },
  summaryCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  summaryIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryLabel: { fontSize: 12, marginBottom: 2 },
  summaryValue: { fontSize: 14, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: spacing.screen,
    paddingVertical: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: 1,
  },
  btnGhost: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    minWidth: 80,
  },
  btnGhostText: { fontSize: 15, fontWeight: '600' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
