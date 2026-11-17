/** Stable errors at the State boundary, separate from Meal Tool results. */
export type StateErrorCode =
  | 'STATE_NOT_INITIALIZED'
  | 'STATE_VERSION_CONFLICT'
  | 'INVALID_STATE_TRANSITION'
  | 'CANDIDATE_VALIDATION_FAILED'
  | 'STATE_STORE_ERROR'

export class StateError extends Error {
  constructor(public readonly code: StateErrorCode, message: string) {
    super(message)
    this.name = 'StateError'
  }
}
