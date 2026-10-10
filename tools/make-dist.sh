#!/usr/bin/env bash
# Сборка архива системы в dist/ (ссылка download в system.json указывает на него через raw.githubusercontent.com).
# Запасной манифест dist/system-jsdelivr.json отдаёт тот же архив через jsDelivr, если GitHub с сервера недоступен.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(jq -r .version system.json)
ZIP="dist/thunderbolt-shtab-$VERSION.zip"
CDN="https://cdn.jsdelivr.net/gh/alexdunecat/Thunderbolt-HQ@main"
node tools/load-test.mjs > /dev/null   # система должна загружаться
for f in module/*.mjs module/*/*.mjs; do node --check "$f"; done
# ссылка download всегда на архив этой версии: старые архивы удаляются, и устаревшая ссылка даёт 404 при установке
RAW="https://raw.githubusercontent.com/alexdunecat/Thunderbolt-HQ/main"
jq --arg dl "$RAW/$ZIP" '.download=$dl' system.json > system.json.tmp && mv system.json.tmp system.json
rm -f dist/thunderbolt-shtab-*.zip
zip -qr "$ZIP" system.json module templates styles lang data assets packs README.md -x "*/LOCK"
jq --arg man "$CDN/dist/system-jsdelivr.json" --arg dl "$CDN/$ZIP" '.manifest=$man | .download=$dl' system.json > dist/system-jsdelivr.json
echo "$ZIP"
