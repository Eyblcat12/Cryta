import { defineConfig } from 'vitest/config';

// Kept separate from unit tests because this suite needs loopback TCP permission.
export default defineConfig({ test: { include: ['test/email-test-smtp.integration.ts'], environment: 'node' } });
