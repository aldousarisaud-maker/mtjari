import type { NextConfig } from 'next';
import { join } from 'node:path';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const root = (process.env.ROOT_DOMAIN ?? 'mtjari.cc').toLowerCase();
// Pages are never framed, except the builder's preview (?pv=<signed token>), and only by the dashboard itself.
const previewFrameAncestors = `frame-ancestors https://${root} https://www.${root} http://localhost:* http://127.0.0.1:*`;

const config: NextConfig = {
  // Docker builds set NEXT_OUTPUT=standalone for a minimal runtime image.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: join(__dirname, '../../'),
  poweredByHeader: false,
  transpilePackages: ['@mtjari/shared'],
  // Product image uploads pass through a server action on their way to the API.
  experimental: { serverActions: { bodySizeLimit: '9mb' } },
  async headers() {
    return [
      { source: '/:path*', missing: [{ type: 'query', key: 'pv' }], headers: [...securityHeaders, { key: 'X-Frame-Options', value: 'DENY' }] },
      { source: '/:path*', has: [{ type: 'query', key: 'pv' }], headers: [...securityHeaders, { key: 'Content-Security-Policy', value: previewFrameAncestors }] },
    ];
  },
};

export default config;
