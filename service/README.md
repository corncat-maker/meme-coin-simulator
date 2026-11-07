# QuickJS Service Template

这个目录不再承载独立的 HTTP/FaaS 服务，而是承载要被编译成 QuickJS runtime artifact 的 controller 模块源码。

通常开发轻应用时，不需要单独进入这个目录执行构建；Release 流程会自动调用这里的 build，把 controller 模块编译成 QuickJS runtime artifact。

只有在调试 service runtime artifact 构建本身时，才需要手动执行下面这些命令：

```bash
npm install
npm run build
npm run lint
npm run test:service-smoke
npm run test:service-integration
npm run test:service-integration:local
```

`npm run build` 会产出：

- `dist/controller.bundle.mjs`
- `dist/controller.manifest.json`
- `dist/spec.json`
- `dist/capability.manifest.json`
- `dist/meta.json`

这些产物会在 release 阶段被 `asap-service` 接收并落到本地 runtime 目录，由 `lingguang.service.request` 触发执行。

当前 `@server` 已内置两类宿主能力：

- `storage.*`：现有键值存储能力
- `oss.*`：面向正式环境的中心化对象存储能力，适合简单持久化场景

`npm run test:service-smoke` 是独立的 QuickJS service 协议冒烟检查器，要求先完成一次 `npm run build`，不会重复触发构建。

`npm run test:service-integration` 使用 Vitest 执行 `app/controller/*.test.ts`，通过 `/api/remote_skill` 调用真实 QuickJS service runtime 链路。执行前需要注入：

- `SERVICE_TEST_BASE_URL`
- `SERVICE_TEST_ARTIFACT_ID`，格式为 `flashapp-7e57` + 12 位小写 hex
- `SERVICE_TEST_ARTIFACT_VERSION`
- `SERVICE_TEST_UID`，格式为 `20880000` + 8 位数字
- `SERVICE_TEST_TRACE_ID`（可选）

本地 dev 验证可先启动 `asap-service`：

```bash
cd ../../asap-service
ASAP_SERVICE_RUNTIME_ROOT=/tmp/asap-service-runtime ~/miniconda3/bin/conda run --no-capture-output -n py310 python web/app.py --port 8081
```

然后在本目录执行：

```bash
npm run test:service-integration:local
```

该命令会生成派生测试 artifactId/uid，执行 `npm run build`，把 `dist` stage 到本地 `ASAP_SERVICE_RUNTIME_ROOT`，再通过本地 dev `/api/remote_skill` 运行 Vitest。

脚手架默认不内置业务集成测试文件。生成或修改 service API 后，应由 coding agent 创建或更新 `app/controller/service.test.ts`，并通过 `runtime/test/` 下的平台模板发起真实链路请求。
