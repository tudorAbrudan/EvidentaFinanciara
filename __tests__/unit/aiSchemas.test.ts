import {
  ChatResponseSchema,
  parseAiJsonResponse,
  StatementResponseSchema,
} from '@/services/aiSchemas';

describe('parseAiJsonResponse', () => {
  it('parse JSON simplu cu StatementResponseSchema', () => {
    const result = parseAiJsonResponse(
      '{"rows":[{"date":"2026-05-21","amount":-100.5}]}',
      StatementResponseSchema
    );
    expect(result.ok).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
  });

  it('extrage JSON din response cu text decoratif înainte/după', () => {
    const result = parseAiJsonResponse(
      'Iată rezultatul:\n{"rows":[{"date":"2026-05-21","amount":-100}]}\nMulțumesc!',
      StatementResponseSchema
    );
    expect(result.ok).toBe(true);
    expect(result.data?.rows).toHaveLength(1);
  });

  it('strip fence ```json ... ```', () => {
    const result = parseAiJsonResponse(
      '```json\n{"rows":[{"date":"2026-05-21","amount":-100}]}\n```',
      StatementResponseSchema
    );
    expect(result.ok).toBe(true);
  });

  it('eroare no_json_found pe text fără { }', () => {
    const result = parseAiJsonResponse('nope', StatementResponseSchema);
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('no_json_found');
  });

  it('eroare invalid_json pe JSON malformat', () => {
    const result = parseAiJsonResponse('{not valid json}', StatementResponseSchema);
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('invalid_json');
  });

  it('eroare schema_violation pe câmpuri lipsă', () => {
    const result = parseAiJsonResponse('{"rows":[{"foo":"bar"}]}', StatementResponseSchema);
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('schema_violation');
    expect(result.error?.path).toMatch(/rows/);
  });

  it('schema_violation include path-ul precis', () => {
    const result = parseAiJsonResponse(
      '{"rows":[{"date":"2026-05-21","amount":true}]}',
      StatementResponseSchema
    );
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('schema_violation');
    // path-ul Zod include indexul în array
    expect(result.error?.path).toMatch(/rows\.0\.amount/);
  });

  it('ChatResponseSchema acceptă răspuns minim valid', () => {
    const result = parseAiJsonResponse(
      '{"sql":"SELECT 1","template":"raw_list","explanation_short":"test"}',
      ChatResponseSchema
    );
    expect(result.ok).toBe(true);
    expect(result.data?.template).toBe('raw_list');
    // params primește default {}
    expect(result.data?.params).toEqual({});
  });

  it('ChatResponseSchema respinge template necunoscut', () => {
    const result = parseAiJsonResponse(
      '{"sql":null,"template":"unknown","explanation_short":""}',
      ChatResponseSchema
    );
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('schema_violation');
  });
});
