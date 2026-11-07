# 闪应用开发基础规范

本规范是闪应用开发的通用基础规范，也是所有闪应用实现必须遵守的底层核心约束。

---

## 什么是闪应用

从技术层面看，闪应用是基于 React + TypeScript 构建的 HTML5 Web App。闪应用运行在移动端 App WebView、Web 端 PC 浏览器或移动端浏览器的 iframe sandbox 中。

闪应用通过 `lingguang.*` API 与宿主交互，获取读写相册、DB 存储等增强能力。除非特殊说明，浏览器原生 API 默认可用。

---

## 技术栈

- React 18 + TypeScript
- Vite 7
- Tailwind CSS 3.4

---

## 依赖与组件说明

- 开发环境已经集成若干组件和工具库。开发相关功能时，应优先使用已有组件或工具库，以保持代码简洁、可靠。所有可用依赖都声明在 `package.json` 中，如有需要可自行查看。
- 开发环境已整合 ReactBits、MagicUI 等组件库资源，源码位于 `components` 目录，覆盖文字、背景、卡片、列表、按钮、导航和特殊效果七类核心场景。需求匹配时可自行检索并选用，以提升最终交付体验。

---

## 代码模块化规范

- 不要把所有代码放在单个文件中，应主动拆分为独立模块。
- 单个组件文件不要超过 150 行。

---

## 开发规范

- 优先使用 Tailwind CSS 工具类（utility classes）实现样式。仅在 Tailwind 无法满足需求时，才使用自定义 CSS。
- 可以使用 Material Icons 加强视觉表达。
- HTML 中的所有交互控件都必须明确指定唯一的 `data-testid`。对于 `radio` 类型控件，`data-testid` 需要加在 `label` 上；如果不提供，测试工具会报错。
- `canvas` 元素的 `width`、`height` 属性禁止直接设置像素值，必须通过 JS 动态计算：先根据屏幕宽度和预期展示占比计算 `width`，再按比例计算 `height`。
- 必须在项目根目录创建并维护 `manifest.json`。
- 禁止将 `manifest.json` 放在 `src/`、`public/` 或任何其他子目录。
- `manifest.json` 至少必须包含 `navigationBar.visible`、`navigationBar.title`、`navigationBar.backgroundColor`、`navigationBar.foregroundColor`。
- `navigationBar.backgroundColor` 与 `navigationBar.foregroundColor` 的颜色值只允许使用 `#RRGGBB` 格式。
- `navigationBar.title` 禁止包含 HTML 特殊字符 `< > & " '`。
- 在开始设计页面布局之前，必须先决定是否启用原生 `navigationBar`。当 `navigationBar.visible` 为 `false` 时，表示隐藏原生顶部导航栏，应用页面的 viewport 会扩展到整个屏幕；此时必须由应用自己处理顶部区域的布局、安全区和样式，避免内容被遮挡或出现错误留白。
- **跨目录导入使用 `@/` 路径别名**：`@/*` 已映射到 `src/*`，跨目录导入时用 `@/` 代替 `../`；同目录导入可以使用 `./`。
- 本项目是运行在浏览器中的 React + TypeScript 前端代码，禁止使用任何 `NodeJS.*` 类型（例如 `NodeJS.Timeout`、`NodeJS.Timer` 等），也不要从 Node.js 内置模块导入内容。
- 对 `setTimeout` / `setInterval` 的返回值，一律使用 `number` 或 `ReturnType<typeof setTimeout>`，例如：`const timerRef = useRef<number | null>(null);`。
- **禁止使用 `fonts.googleapis.com`，禁止引入其他第三方 JS 或 CSS 资源。**
- 禁止使用浏览器原生方法 `alert()` 和 `confirm()`。如需提示或确认功能，必须使用模拟弹窗效果。
- 禁止使用 `window.parent.postMessage` 向父窗口发送消息。
- 禁止把包含 `lingguang.db.*` 或 `lingguang.ai.*` 调用的 `useCallback` 写成依赖并修改同一个 state，再由依赖该 callback 的 `useEffect` 自动触发；这类写法容易导致重复请求或无限循环。加载型请求应使用稳定 callback、`useRef` 防重入，或由用户操作显式触发。
- **音频播放规范（强制）**：凡是播放音效、背景音乐、语音片段等音频内容，必须使用 `howler.js`。在 React Scaffold 项目中，只能从 `@/lib/audio` 导入 `Howl` / `Howler`，禁止直接从 `howler` 导入。`@/lib/audio` 已封装宿主静音同步与 `html5: true`，不要自行实现第二套音频底层。
- **图片资源引用**：图片必须先使用 `import` 导入，再在页面中引用，禁止直接使用字符串路径。
  - 用户上传的图片附件会自动下载到 `{{workspace}}/src/assets/` 目录。
  - 正确做法：`import userImg from './assets/user.png';`，然后使用 `<img src={userImg} />`。
  - 错误做法：`<img src="assets/user.png" />` 或 `<img src="./assets/user.png" />`，这类写法会导致 404。
- `<div id="container"></div>` 是应用 DOM 结构的顶层容器。如果应用需要设置背景色，可以设置在 `container` 这一层；也可以设置在更上层的 `<body></body>`。
- 凡是读取 `window.localStorage.getItem` 等持久化数据时，都必须假设数据可能来自旧版本，可能缺字段、字段类型不一致，或结构已经变化。必须先做 schema 归一化和兜底，再渲染页面和执行业务逻辑。
- 禁止直接对历史数据字段调用 `.map`、`.filter`、`.length`、`.includes`、`Object.keys` 或进行深层属性访问，除非已经判空或补默认值。
- 优先使用安全写法：数组使用 `Array.isArray(x) ? x : []` 或 `x ?? []`，对象使用 `x ?? {}`，属性访问使用 `obj?.a?.b`，字符串使用 `typeof x === 'string' ? x : ''`，数字使用 `typeof x === 'number' ? x : 0`。
- 单条脏数据不能导致页面崩溃。

---

## 视觉安全区规范

应用运行在全屏 WebView 中，客户端右上角会浮动系统操作按钮。页面顶部安全区高度通过 CSS 变量 `--flash-app-safe-top` 提供。

不要在 viewport 顶部 `var(--flash-app-safe-top, 0px)` 范围内放置可交互元素，例如按钮、输入框、菜单、关闭按钮、悬浮操作入口等。背景、装饰图、不可交互内容可以延伸到该区域，但用户可点击、可拖拽、可聚焦的元素应避开该区域。

如果需要使用 `position: absolute` 或 `position: fixed` 放置可交互元素，并且设置了 `top`，必须叠加安全区变量，例如：

```css
.floating-action {
  position: fixed;
  top: calc(var(--flash-app-safe-top, 0px) + 16px);
  right: 16px;
}
```

不要直接写：

```css
top: 16px;
```

除非该元素明确不是可交互元素，或者它位于页面背景层、装饰层。

---

## 音频开发规范

- 需要音频播放能力时，统一使用 `import { Howl, Howler } from '@/lib/audio'`。
- `./src/assets/facebook-sound-kit` 是项目内置的 `.m4a` 音效资源目录，可自行查找和引用。例如 `./src/assets/facebook-sound-kit/buttons-and-navigation/button-1.m4a` 是按钮音效：路径中的 `buttons-and-navigation` 表示该文件夹存放按钮与导航类音效，文件名则直接表明其适用场景。
- 不能直接使用浏览器原生 AudioContext 相关 API，但可以使用 Tone.js 实现音频合成。
