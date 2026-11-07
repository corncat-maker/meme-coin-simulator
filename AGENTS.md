# 仓库指南

## 项目背景
这是一个用于 AI 应用开发的脚手架项目，定义了基础约束、可用依赖、类型声明及相关文档。

## 项目结构与模块组织
- `src/` 存放应用代码。`src/main.tsx` 负责启动应用，`src/App.tsx` 是默认根组件。
- `src/components/ui/` 与 `src/components/magicui/` 存放可复用 UI 组件；修改共享组件时请注意保持向后兼容。
- `src/hooks/` 存放自定义 React Hooks，`src/lib/` 存放工具函数，`src/assets/` 存放会被打包的静态资源。
- `public/` 存放按原样提供的静态文件。
- `plugins/` 存放自定义 Vite 校验插件（如导入或存储相关守卫插件）。
- `docs/` 存放 API 与平台规范文档；行为变更时请同步更新对应文档。

## 构建、测试与开发命令
- `npm install`：安装依赖。
- `npm run dev`：启动带 HMR 的 Vite 开发服务器。
- `npm run build`：用于构建基于当前脚手架生成的应用，执行入口可达文件的 TypeScript 工程构建（`tsc -b`）并在 `dist/` 产出生产构建结果。`tsconfig.app.json` 的 `include` 应保持为应用入口及其需要的声明文件，而不是用于全量扫描整个脚手架源码。
- `npm run typecheck:all`：用于检查当前脚手架整体质量，执行面向整个 `src/` 的全量 TypeScript 类型检查；当共享组件、类型声明或脚手架基础能力变更时，应运行该命令。
- `npm run preview`：本地预览已构建产物。
- `npm run lint`：在仓库范围内执行 ESLint。

## 代码风格与命名规范
- 技术栈为 TypeScript + React（函数式组件）。
- 遵循现有文件风格：当前应用代码以 2 空格缩进和单引号导入为主。
- 优先使用 `@/*` 别名导入 `src` 下模块（在 `tsconfig`/`vite` 中已配置）。
- 命名模式：
  - 组件：`PascalCase`（如 `FeatureCard.tsx`）
  - Hooks：`useXxx`（如 `use-toast.ts`）
  - 工具函数：在 `src/lib/` 中导出语义清晰的 `camelCase` 名称
- 提交 PR 前请先运行 `npm run lint`。

## 测试指南
- 当前未配置自动化测试运行器（`package.json` 中没有 `test` 脚本）。
- 目前请通过以下方式验证改动：
  - `npm run lint`
  - `npm run build`
  - 使用 `npm run dev` 与 `npm run preview` 进行手动验证
- 若新增测试，建议使用 Vitest + React Testing Library，并将测试文件命名为 `*.test.ts(x)`，放在对应功能旁或 `src/__tests__/` 下。
- `service/` 子目录保留 QuickJS service integration 测试基建，但空脚手架默认不内置业务测试文件；因此直接运行 `npm run test:service-integration` 出现 `No test files found, exiting with code 1` 是预期行为。生成或修改 service API 后，coding agent 应创建/更新 `service/app/controller/service.test.ts`。

## 变更上传说明
- 当用户要求将本地变更同步到 OSS 脚手架目录时，先读取当前 Git 分支名，并提取其中的版本段。
- 分支名中的版本段必须与 OSS 脚手架路径中的版本段保持一致。例如 `feature/v7` 对应 `oss://antsys-asapservice-oss-prod/artifact/template/mini_app/scaffold/v7-asap-react-ts-scaffold`。
- 上传时保持仓库内的相对路径不变，只覆盖用户明确确认过的目标文件，不批量上传无关文件。
- 执行覆盖上传前，先把将要写入的 OSS 完整目标路径告知用户，待用户确认后再执行。
- 当前环境下优先使用 `ossutilmac64` 执行 `cp -f` 覆盖上传。
- 如果需要查看 OSS scaffold 目录的当前层文件与子目录，使用 `ossutilmac64 ls <oss-path> -d`，不要直接使用会递归列出所有对象的普通 `ls`。
- 上传完成后，对目标对象路径执行一次 `ossutilmac64 ls <oss-object>`，确认对象已更新，不要只依赖上传命令成功返回。
- 覆盖 OSS 时还需要同步分支版本对应的同名压缩包，例如 `release/v10` 对应 `oss://antsys-asapservice-oss-prod/artifact/template/mini_app/scaffold/v10-asap-react-ts-scaffold.tar.gz`。
- 生成同名 `.tar.gz` 前必须先执行 `git status --short`。如果存在任何未提交改动，必须停下来提示用户先提交/处理改动，不要直接打包或上传。
- 同名 `.tar.gz` 使用当前提交生成，而不是直接压缩工作区目录：`git archive --format=tar.gz --output=/tmp/<version>-asap-react-ts-scaffold.tar.gz HEAD`。`git archive HEAD` 只包含当前提交中的 tracked 文件，不包含未提交改动、`node_modules/`、`dist/`、`.git/` 等工作区产物。
- 上传同名 `.tar.gz` 前也要先把完整 OSS 目标路径告知用户并等待确认；确认后执行 `ossutilmac64 cp -f /tmp/<version>-asap-react-ts-scaffold.tar.gz <oss-tar-object>`，完成后用 `ossutilmac64 ls <oss-tar-object>` 验证对象已更新。
