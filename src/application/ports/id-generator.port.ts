export interface IdGeneratorPort {
  uuid(): string;
  /** Opaque, URL-safe public id with a type prefix, e.g. app_8f3k... */
  prefixed(prefix: string): string;
}
export const ID_GENERATOR = Symbol('ID_GENERATOR');
