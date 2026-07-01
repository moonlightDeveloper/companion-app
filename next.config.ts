import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        // FLAG-58: bare /story is not a landable screen. It's entered only via the `/`
        // router, the intro handoff (?intake=), a saved-report deep-link (?report=), or a
        // person (?person=). With NONE of those present, redirect to `/` server-side —
        // before the page renders, so no flash of the intake. (`missing` matches only when
        // all three query keys are absent.)
        source: "/story",
        missing: [
          { type: "query", key: "intake" },
          { type: "query", key: "report" },
          { type: "query", key: "person" },
          { type: "query", key: "recover" },
        ],
        destination: "/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
