import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_PACKAGE = 'jieba-js@1.0.2';
const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const overlayPath = resolve(rootDir, 'data', 'wordlist-zh-sg-overlay.txt');
const outputPath = resolve(rootDir, 'data', 'wordlist-zh-sg.txt');
const tempDir = mkdtempSync(join(tmpdir(), 'stet-zh-sg-'));
const HAN_ONLY_PATTERN = /^\p{Script=Han}+$/u;

try {
  const packOutput = execFileSync('npm', ['pack', SOURCE_PACKAGE], {
    cwd: tempDir,
    encoding: 'utf8',
  }).trim();
  const tarball = packOutput.split('\n').at(-1);
  if (!tarball) {
    throw new Error(`npm pack ${SOURCE_PACKAGE} did not return a tarball name`);
  }

  const rawDictionary = execFileSync(
    'tar',
    ['-xOf', join(tempDir, tarball), 'package/dict/dict.txt.big'],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );

  const words = new Set();
  for (const line of rawDictionary.split(/\r?\n/u)) {
    const [term = ''] = line.trim().split(/\s+/u, 1);
    if (HAN_ONLY_PATTERN.test(term)) {
      words.add(term);
    }
  }

  for (const line of readFileSync(overlayPath, 'utf8').split(/\r?\n/u)) {
    const term = line.trim();
    if (HAN_ONLY_PATTERN.test(term)) {
      words.add(term);
    }
  }

  const output = [...words].sort((left, right) => left.localeCompare(right, 'zh-Hans-SG'));
  writeFileSync(outputPath, `${output.join('\n')}\n`);

  console.log(JSON.stringify({
    sourcePackage: SOURCE_PACKAGE,
    outputPath,
    wordCount: output.length,
  }));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
