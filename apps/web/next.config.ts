import type { NextConfig } from 'next';
import { join } from 'node:path';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  // Docker builds set NEXT_OUTPUT=standalone for a minimal runtime image.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: join(__dirname, '../../'),
  poweredByHeader: false,
  transpilePackages: ['@mtjari/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
