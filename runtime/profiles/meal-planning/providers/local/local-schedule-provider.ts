/** Local schedule adapter backed by the deterministic V1 Fixture. */
import { scheduleDays } from '../../meal-fixtures.ts'
import type { ScheduleData, ScheduleProvider, ScheduleQuery } from '../contracts/schedule-provider.ts'
import { ProviderError } from '../provider-error.ts'

export class LocalScheduleProvider implements ScheduleProvider {
  getSchedule(query: ScheduleQuery): ScheduleData {
    if (query.days < 1 || query.days > scheduleDays.length) {
      throw new ProviderError('INVALID_PROVIDER_QUERY', 'Schedule window is not available.', {
        minDays: 1,
        maxDays: scheduleDays.length,
      })
    }
    return {
      days: scheduleDays.slice(0, query.days).map(day => ({
        ...day,
        slots: day.slots.map(slot => ({ ...slot })),
      })),
    }
  }
}
