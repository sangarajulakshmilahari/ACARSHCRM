/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["xlsx", "pdf-parse"],
  },
};

module.exports = nextConfig;
