/**
 * Shared result contract for Meal Agent tools.
 * It maps the project-level envelope onto DSH's schema and render interface.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const metadataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', const: 'local-fixture', required: true },
    fixtureVersion: { type: 'string', const: 'v1', required: true },
  },
} as const

const errorSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', required: true },
    message: { type: 'string', required: true },
    retryable: { type: 'boolean', required: true },
    missing: { type: 'array', items: { type: 'string' } },
    conflicts: { type: 'array', items: { type: 'string' } },
  },
} as const

/** Build the canonical success-or-failure schema shared by every Meal Tool. */
export function mealResultSchema<const TDataSchema extends ValueSchemaSpec>(
  dataSchema: TDataSchema,
) {
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', const: true, required: true },
          data: { ...dataSchema, required: true },
          error: { type: 'null', required: true },
          metadata: { ...metadataSchema, required: true },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', const: false, required: true },
          data: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: true,
          },
          error: { ...errorSchema, required: true },
          metadata: { ...metadataSchema, required: true },
        },
      },
    ],
  } as const
}

/** Return a successful deterministic Fixture result. */
export function mealSuccess<TData extends object>(data: TData) {
  return {
    success: true as const,
    data,
    error: null,
    metadata: {
      source: 'local-fixture' as const,
      fixtureVersion: 'v1' as const,
    },
  }
}

/** Return a stable business failure without throwing through the DSH runtime. */
export function mealFailure(code: string, message: string, retryable = false, missing?: string[], conflicts?: string[]) {
  return {
    success: false as const,
    data: {},
    error: { code, message, retryable, ...(missing ? { missing } : {}), ...(conflicts ? { conflicts } : {}) },
    metadata: {
      source: 'local-fixture' as const,
      fixtureVersion: 'v1' as const,
    },
  }
}

/** Project one validated canonical result into model-visible JSON text. */
export function renderMealResult(_args: unknown, value: JsonValue): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}
