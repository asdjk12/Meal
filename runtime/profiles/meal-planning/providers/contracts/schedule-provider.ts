/** Cooking-time schedule seam for a requested planning window. */
import type { ScheduleDay } from '../../meal-plan-types.ts'

export interface ScheduleQuery {
  days: number
}

export interface ScheduleData {
  days: ScheduleDay[]
}

export interface ScheduleProvider {
  getSchedule(query: ScheduleQuery): ScheduleData | Promise<ScheduleData>
}
