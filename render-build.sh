#!/usr/bin/env bash
# Exit on error
set -o errexit

echo "==> Building React frontend dashboard..."
cd frontend
npx pnpm@10.26.1 install --frozen-lockfile
npx pnpm@10.26.1 run build
cd ..

echo "==> Installing Python dependencies..."
pip install -r requirements.txt
