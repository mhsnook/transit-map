import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  driver: 'durable-sqlite',
  schema: './src/collector/schema.ts',
  out: './src/collector/migrations',
})
