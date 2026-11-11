import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pairs = [
  ['server/src/db/schema.sql', 'dist-server/db/schema.sql'],
];

for (const [from, to] of pairs) {
  const src = path.join(root, from);
  const dest = path.join(root, to);
  if (!fs.existsSync(src)) continue;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`copied ${from} -> ${to}`);
}
