#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check index.js
node --input-type=module -e '
const m = await import("./index.js");
if (typeof m.apply !== "function") throw new Error("нет export function apply");
if (m.name !== "dsh-mailbox") throw new Error("имя плагина не то: " + m.name);
if (!Array.isArray(m.inject)) throw new Error("inject должен быть массивом");
'
node -e 'const f=require("fs"); for (const p of ["package.json","locale/ru.json","locale/en.json"]) JSON.parse(f.readFileSync(p,"utf8"));'
test -s icon.svg
grep -q "$(node -p "require('./package.json').name")" cordis.patch.yml
echo "check ok"
