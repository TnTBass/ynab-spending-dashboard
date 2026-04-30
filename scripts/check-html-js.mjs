// Pre-commit syntax check for the inline <script> block(s) in public/index.html.
//
// The dashboard is a single HTML file with a ~1000-line inline <script>. There's
// no build step, so a typo lands in production unless something parses it first.
// This script reads the STAGED version of public/index.html (so WIP edits in the
// working tree don't mask or trigger a failure), extracts each inline script body,
// and runs `node --check` on it.
//
// External <script src="…"> tags are skipped — they don't have a body to check.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HTML_PATH = 'public/index.html';

let html;
try {
  html = execSync(`git show :${HTML_PATH}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch {
  // File isn't staged — nothing to check. The pre-commit hook gates on staging,
  // so this branch is mostly defensive.
  process.exit(0);
}

// Match <script> tags WITHOUT attributes (so we skip <script src="…">). Capture
// 1: the body. Track the source line where each match starts so error messages
// point back at index.html, not a tempfile.
const re = /<script>\s*\n([\s\S]*?)<\/script>/g;
const blocks = [];
let m;
while ((m = re.exec(html)) !== null) {
  const startLine = html.slice(0, m.index).split('\n').length;
  blocks.push({ body: m[1], startLine });
}

if (blocks.length === 0) {
  console.error(`No inline <script> blocks found in ${HTML_PATH} — nothing to check.`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'html-js-check-'));
let failed = 0;
try {
  for (let i = 0; i < blocks.length; i++) {
    const { body, startLine } = blocks[i];
    const tmp = join(dir, `block-${i}.js`);
    writeFileSync(tmp, body);
    try {
      execSync(`node --check "${tmp}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      failed++;
      const stderr = err.stderr ? err.stderr.toString() : err.message;
      console.error(`\n✗ Syntax error in ${HTML_PATH} inline <script> starting at line ${startLine}:\n`);
      // node --check prints "block-0.js:LINE" — translate the line number into
      // the original file's coordinates so the message is clickable.
      console.error(stderr.replace(/block-\d+\.js:(\d+)/g, (_, n) =>
        `${HTML_PATH}:${startLine + parseInt(n, 10) - 1}`));
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(failed > 0 ? 1 : 0);
