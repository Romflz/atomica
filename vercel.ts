import { routes } from '@vercel/config/v1'
import type { VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'vite',
  buildCommand: 'pnpm build',
  outputDirectory: 'dist',
  headers: [
    // Vite fingerprints every file under /assets, so browsers can keep them forever.
    routes.cacheControl('/assets/(.*)', { public: true, maxAge: '1 year', immutable: true }),
  ],
}
