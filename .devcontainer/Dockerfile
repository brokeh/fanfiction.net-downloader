# FROM mcr.microsoft.com/devcontainers/rust:2-1-trixie
ARG RUST_VERSION=1.93
FROM rust:${RUST_VERSION}-slim-trixie

RUN \
    cargo install wasm-pack \
    && rustup component add clippy \
    \
    && apt-get update \
    && apt-get install --yes python3 pylint npm \
    \
    && npm install -g eslint@10.0.0 @eslint/js

ENV NODE_PATH=/usr/local/lib/node_modules
