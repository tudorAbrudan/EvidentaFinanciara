module.exports = {
  forbidden: [
    {
      name: 'services-no-ui',
      severity: 'error',
      comment: 'services/ trebuie să rămână pure logic, fără import UI.',
      from: { path: '^services' },
      to: { path: '^(components|app|hooks)' },
    },
    {
      name: 'components-no-app',
      severity: 'error',
      comment: 'components/ nu cunosc structura ecranelor (app/).',
      from: { path: '^components' },
      to: { path: '^app' },
    },
    {
      name: 'no-test-imports-in-prod',
      severity: 'error',
      comment: 'Codul de producție nu importă din __tests__/ sau __mocks__/.',
      from: { pathNot: '(^__tests__|^__mocks__)' },
      to: { path: '(^__tests__|^__mocks__)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Fără dependențe ciclice.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Fișiere fără import-uri inbound (posibil cod mort).',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.config\\.(js|cjs|mjs|ts|json)$',
          '__tests__/setup\\.ts$',
          '^app/',
          'expo-env\\.d\\.ts$',
          '\\.web\\.(ts|tsx)$',
        ],
      },
      to: {},
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
