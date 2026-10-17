import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@pb/ai", "@pb/scenarios", "@pb/sim"],
  poweredByHeader: false,
};

export default config;
