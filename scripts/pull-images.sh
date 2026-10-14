#!/usr/bin/env bash
# Pre-pull the runtime images used by the execution sandbox.
# Containers run with --network none and --pull never, so images must exist locally.
set -euo pipefail
for image in node:20-alpine node:22-alpine python:3.12-alpine eclipse-temurin:21-jdk-alpine gcc:13 golang:1.22-alpine ruby:3.3-alpine; do
  echo "Pulling $image"
  docker pull "$image"
done
echo "Done."
