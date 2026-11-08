# AI Tang iframe 接入

本项目提供编辑与播放两种嵌入模式，入口查询参数为 `embed=edit|play`、`parentOrigin`、`instanceId`。
课程 ID、课件 ID 和短期凭证通过来源受限的 postMessage 握手提供。直接访问嵌入地址不授予接口权限。
API 由 AI Tang 后端提供，源代码见相邻 ai_tang 仓库的 courseware 模块；完整流程、协议与部署说明见
`ai_tang/docs/courseware.md`。

## 运行

- `npm ci`
- `npm run dev`：127.0.0.1:5173，代理 /api 至本地 8000。
- `AI_TANG_BUILD_MODE=test npm run build`：测试环境构建；production 和 development 同理。
- `npm run build:development|build:test|build:production`：显式环境构建。
- `npm run type-check`、`npm run lint:check`、`npm test`。

`.env.<mode>` 配置 API 和父页面白名单，`.env.<mode>.local` 或部署变量覆盖默认值。
测试域名 `courseware.test.rgznst.com`，生产域名 `courseware.rgznst.com`。
构建输出 `_headers`；托管平台需实际应用其中的 CSP frame-ancestors，或配置等价响应头规则。

嵌入模式不会调用 PPTist 上游 AI/图片服务。独立演示模式如需这些功能，必须显式配置
`VITE_PPTIST_SERVICE_URL`；默认不配置外部服务。

## 验收样例

`node scripts/create-test-pptx.cjs` 生成包含文字、图形、图片、图表、表格和 WAV 音频的合成 PPTX。
用于验证真实导入路径，不替代真实课件的兼容性验收。支持的大小为 PPTX 100 MiB、200 页、单媒体 50 MiB。
无法映射的音视频会提示数量；字体、排版与原生 PowerPoint 动画仍需人工核对。
