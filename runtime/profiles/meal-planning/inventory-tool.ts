/**
 * DSH Cordis plugin that exposes the current Meal inventory as a native Tool.
 * The fixed inventory keeps the first Tool Calling verification deterministic.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'meal-inventory-tool'
export const inject = ['tools']

/** Register the read-only inventory Tool with the DSH Tool registry. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'get_inventory',
    description: 'Return the ingredients currently available to the user.',

    // This read-only Tool accepts no model arguments.
    parameters: {},

    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ingredient: { type: 'string', required: true },
                quantity: { type: 'number', required: true },
                unit: { type: 'string', required: true },
              },
            },
          },
        },
      },

      // Project the structured result into model-visible Tool content.
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value),
      }],
    },

    // Fixed data makes the initial Agent-to-Tool chain reproducible.
    async execute() {
      return {
        items: [
          { ingredient: 'chicken_breast', quantity: 300, unit: 'g' },
          { ingredient: 'eggs', quantity: 6, unit: 'count' },
          { ingredient: 'broccoli', quantity: 1, unit: 'count' },
          { ingredient: 'milk', quantity: 500, unit: 'ml' },
        ],
      }
    },
  }))
}
