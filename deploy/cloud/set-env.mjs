#!/usr/bin/env node
// Sets one value in the server's live.env from a file (so a secret never appears on a command
// line or in a log), keeping every other line and the file private. Used by
// `npm run cloud -- set <NAME>`; the value file is deleted afterwards.
//
//   node set-env.mjs <live.env> <NAME> <value-file>
import fs from 'node:fs';

const [file, name, valueFile] = process.argv.slice(2);
if (!file || !/^[A-Z][A-Z0-9_]{1,60}$/.test(name ?? '') || !valueFile) {
  console.error('usage: set-env.mjs <live.env> <NAME> <value-file>');
  process.exit(2);
}
const value = fs.readFileSync(valueFile, 'utf8').trim();
if (!value || /[\r\n]/.test(value)) {
  console.error(`${name}: the value is empty or has more than one line.`);
  process.exit(1);
}
const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
const at = lines.findIndex((l) => l.startsWith(`${name}=`));
if (at >= 0) lines[at] = `${name}=${value}`;
else lines.splice(lines.at(-1) === '' ? lines.length - 1 : lines.length, 0, `${name}=${value}`);
fs.writeFileSync(file, `${lines.join('\n').replace(/\n*$/, '')}\n`, { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log(`${name} ${at >= 0 ? 'updated' : 'added'} in ${file}.`);
