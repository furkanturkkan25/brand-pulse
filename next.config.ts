import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace home dizini olunca Turbopack her şeyi izleyip EMFILE + 404 üretiyordu
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
