import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 作业提交可含多张照片/附件，默认 1MB 会拦掉合法上传。
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 小星语音需麦克风；登录迎宾天气需本站定位；摄像头仍关闭。
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self)" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
