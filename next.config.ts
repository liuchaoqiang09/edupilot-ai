import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 作业提交可含多张照片/附件，默认 1MB 会拦掉合法上传。
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
