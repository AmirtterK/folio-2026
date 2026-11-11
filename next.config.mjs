import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pin the project root so Next doesn't pick up the stray package-lock.json in C:\Users\LENOVO
  outputFileTracingRoot: root,
};

export default nextConfig;
