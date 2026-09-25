/**
 * Boots inside the test Profile and verifies the inventory Tool through the
 * public DSH Tool registry seam.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const name = 'meal-inventory-tool-test-probe'
export const inject = ['tools']

/** Validate registration, schema, execution, and model-visible rendering. */
export async function apply(ctx: Context): Promise<void> {
  const tool = ctx.tools.get('get_inventory')
  if (!tool) throw new Error('get_inventory is not registered')

  const schema = tool.output.schema as {
    type?: string
    required?: string[]
    properties?: { items?: { type?: string } }
  }
  if (schema.type !== 'object'
    || !schema.required?.includes('items')
    || schema.properties?.items?.type !== 'array') {
    throw new Error('get_inventory exposes an invalid output schema')
  }

  const value = await tool.execute({}, undefined as never) as JsonValue
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.items)) {
    throw new Error('get_inventory returned a non-inventory value')
  }

  const content = tool.output.render({}, value)
  const rendered = content.length === 1
    && content[0]?.type === 'text'
    && content[0].text === JSON.stringify(value)

  if (value.items.length !== 4 || !rendered) {
    throw new Error('get_inventory returned an invalid model-visible result')
  }

  const marker = `MEAL_INVENTORY_TOOL_OK ${JSON.stringify({
    name: tool.name,
    items: value.items.length,
    rendered,
  })}\n`

  process.stdout.write(marker, () => process.emit('SIGTERM'))
}
