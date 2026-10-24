import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components / PPR are off on purpose: every screen is per-user and every API reads the session,
  // so there is nothing to prerender and the extra Suspense rules only get in the way.
  // The brief names the endpoint POST /ai/chat; keep that path working alongside /api/ai/*.
  poweredByHeader: false,
  // Basic hardening: no framing (clickjacking), no MIME sniffing, no full-URL referrers.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    return ["chat", "summary", "smart-leave"].map((p) => ({ source: `/ai/${p}`, destination: `/api/ai/${p}` }));
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
