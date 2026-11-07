import fs from 'node:fs/promises';

export type ManifestViolation = {
  message: string;
};

export type AppManifest = {
  navigationBar: {
    visible: boolean;
    title: string;
    backgroundColor: string;
    foregroundColor: string;
  };
  localStorage?: boolean;
};

export const MANIFEST_EXAMPLE = [
  '{',
  '  "navigationBar": {',
  '    "visible": true,',
  '    "title": "应用标题",',
  '    "backgroundColor": "#ffffff",',
  '    "foregroundColor": "#000000"',
  '  }',
  '}',
].join('\n');

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const FORBIDDEN_HTML_TITLE_CHARS_PATTERN = /[<>&"']/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateNavigationBar(navigationBar: Record<string, unknown>): ManifestViolation[] {
  const errors: ManifestViolation[] = [];
  const requiredKeys = ['visible', 'title', 'backgroundColor', 'foregroundColor'] as const;

  for (const key of requiredKeys) {
    if (!(key in navigationBar)) {
      errors.push({
        message: `manifest.json 中的 navigationBar.${key} 为必填字段。`,
      });
    }
  }

  if ('visible' in navigationBar && typeof navigationBar.visible !== 'boolean') {
    errors.push({
      message: 'manifest.json 中的 navigationBar.visible 必须是布尔值。',
    });
  }

  if ('title' in navigationBar) {
    if (typeof navigationBar.title !== 'string') {
      errors.push({
        message: 'manifest.json 中的 navigationBar.title 必须是字符串。',
      });
    } else if (navigationBar.title.trim().length === 0) {
      errors.push({
        message: 'manifest.json 中的 navigationBar.title 不能为空字符串。',
      });
    } else if (FORBIDDEN_HTML_TITLE_CHARS_PATTERN.test(navigationBar.title)) {
      errors.push({
        message: 'manifest.json 中的 navigationBar.title 不能包含 HTML 特殊字符 < > & " \'。',
      });
    }
  }

  if ('backgroundColor' in navigationBar) {
    if (typeof navigationBar.backgroundColor !== 'string') {
      errors.push({
        message: 'manifest.json 中的 navigationBar.backgroundColor 必须是字符串。',
      });
    } else if (!HEX_COLOR_PATTERN.test(navigationBar.backgroundColor)) {
      errors.push({
        message: 'manifest.json 中的 navigationBar.backgroundColor 必须是合法的 6 位十六进制颜色值，例如 #ffffff。',
      });
    }
  }

  if ('foregroundColor' in navigationBar) {
    if (typeof navigationBar.foregroundColor !== 'string') {
      errors.push({
        message: 'manifest.json 中的 navigationBar.foregroundColor 必须是字符串。',
      });
    } else if (!HEX_COLOR_PATTERN.test(navigationBar.foregroundColor)) {
      errors.push({
        message: 'manifest.json 中的 navigationBar.foregroundColor 必须是合法的 6 位十六进制颜色值，例如 #000000。',
      });
    }
  }

  return errors;
}

function validateManifest(manifest: unknown): ManifestViolation[] {
  if (!isRecord(manifest)) {
    return [{
      message: 'manifest.json 顶层必须是 JSON 对象。',
    }];
  }

  if (!('navigationBar' in manifest)) {
    return [{
      message: 'manifest.json 必须包含 navigationBar 对象。',
    }];
  }

  const { navigationBar } = manifest;
  if (!isRecord(navigationBar)) {
    return [{
      message: 'manifest.json 中的 navigationBar 必须是对象。',
    }];
  }

  return validateNavigationBar(navigationBar);
}

export async function readManifestFile(manifestPath: string): Promise<string> {
  return fs.readFile(manifestPath, 'utf8');
}

export function parseAndValidateManifest(manifestContent: string): {
  manifest: AppManifest | null;
  errors: ManifestViolation[];
  parseError: string | null;
} {
  let manifest: unknown;

  try {
    manifest = JSON.parse(manifestContent);
  } catch (error) {
    return {
      manifest: null,
      errors: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  const errors = validateManifest(manifest);
  if (errors.length) {
    return {
      manifest: null,
      errors,
      parseError: null,
    };
  }

  return {
    manifest: manifest as AppManifest,
    errors: [],
    parseError: null,
  };
}

export function getManifestTitle(manifest: AppManifest): string {
  return `${manifest.navigationBar.title} - 灵光闪应用`;
}

export function getInlineManifestJson(manifest: AppManifest): string {
  return JSON.stringify(manifest).replace(/</g, '\\u003c');
}
