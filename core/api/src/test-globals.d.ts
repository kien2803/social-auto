/**
 * Test type augmentations — these resolve TS strictness issues
 * in integration tests without polluting production source.
 */

declare namespace NodeJS {
  interface Process {
    cwd(): string;
  }
}
