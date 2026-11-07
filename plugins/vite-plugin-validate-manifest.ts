import path from 'node:path';
import type { Plugin } from 'vite';
import { MANIFEST_EXAMPLE, parseAndValidateManifest, readManifestFile } from './manifest-utils';

export function validateManifestPlugin(): Plugin {
  let manifestPath = '';

  return {
    name: 'validate-manifest',
    enforce: 'pre',
    apply: 'build',

    configResolved(config) {
      manifestPath = path.resolve(config.root, 'manifest.json');
    },

    async buildStart() {
      if (!manifestPath) return;

      let manifestContent = '';
      try {
        manifestContent = await readManifestFile(manifestPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.error({
          message:
            `[validate-manifest] 构建失败: 缺少根目录 manifest.json\n` +
            `文件: ${manifestPath}\n\n` +
            `错误:\n  1. 项目根目录必须存在 manifest.json。\n` +
            `  2. 读取文件失败: ${message}\n\n` +
            `示例:\n${MANIFEST_EXAMPLE}`,
          loc: {
            file: manifestPath,
            line: 1,
            column: 1,
          },
        });
      }

      const { errors, parseError } = parseAndValidateManifest(manifestContent);

      if (parseError) {
        this.error({
          message:
            `[validate-manifest] 构建失败: manifest.json 不是合法 JSON\n` +
            `文件: ${manifestPath}\n\n` +
            `错误:\n  1. ${parseError}\n\n` +
            `示例:\n${MANIFEST_EXAMPLE}`,
          loc: {
            file: manifestPath,
            line: 1,
            column: 1,
          },
        });
      }
      if (!errors.length) return;

      const details = errors.map((error, index) => {
        return `  ${index + 1}. ${error.message}`;
      }).join('\n');

      this.error({
        message:
          `[validate-manifest] 构建失败: manifest.json 校验未通过\n` +
          `文件: ${manifestPath}\n\n` +
          `错误:\n${details}\n\n` +
          `要求: navigationBar 必须包含 visible、title、backgroundColor、foregroundColor 四个字段。\n` +
          `颜色值必须使用合法的 6 位十六进制格式（#RRGGBB）。\n\n` +
          `示例:\n${MANIFEST_EXAMPLE}`,
        loc: {
          file: manifestPath,
          line: 1,
          column: 1,
        },
      });
    },
  };
}
