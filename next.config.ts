import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components / PPR are off on purpose: every screen is per-user and every API reads the session,
  // so there is nothing to prerender and the extra Suspense rules only get in the way.
  // The brief names the endpoint POST /ai/chat; keep that path working alongside /api/ai/*.
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
