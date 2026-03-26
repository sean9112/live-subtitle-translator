const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MICROPHONE_USAGE_DESCRIPTION =
  'Live Subtitle Translator needs microphone access to transcribe and translate live speech on device.';

function writePlistKey(plistPath, key, value) {
  const quotedValue = `"${value.replace(/"/g, '\\"')}"`;

  try {
    execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', `Set :${key} ${quotedValue}`, plistPath],
      { stdio: 'ignore' },
    );
  } catch {
    execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', `Add :${key} string ${quotedValue}`, plistPath],
      { stdio: 'ignore' },
    );
  }
}

module.exports = async (context) => {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const productFilename = context.packager.appInfo.productFilename;
  const appBundlePath = path.join(context.appOutDir, `${productFilename}.app`);
  const contentsPath = path.join(appBundlePath, 'Contents');
  const frameworkAppsPath = path.join(contentsPath, 'Frameworks');
  const plistPaths = [path.join(contentsPath, 'Info.plist')];

  if (fs.existsSync(frameworkAppsPath)) {
    for (const entry of fs.readdirSync(frameworkAppsPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.endsWith('.app')) {
        continue;
      }

      plistPaths.push(path.join(frameworkAppsPath, entry.name, 'Contents', 'Info.plist'));
    }
  }

  for (const plistPath of plistPaths) {
    if (!fs.existsSync(plistPath)) {
      continue;
    }

    writePlistKey(
      plistPath,
      'NSMicrophoneUsageDescription',
      MICROPHONE_USAGE_DESCRIPTION,
    );
  }
};
