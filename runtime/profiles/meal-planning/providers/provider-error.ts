/** Internal provider failure contract; Tools translate it to stable Tool errors. */
export type ProviderErrorCode =
  | 'DATA_NOT_FOUND'
  | 'DATA_SOURCE_UNAVAILABLE'
  | 'INVALID_PROVIDER_QUERY'
  | 'PROVIDER_INTERNAL_ERROR'
  | 'UNSUPPORTED_PROVIDER'

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
