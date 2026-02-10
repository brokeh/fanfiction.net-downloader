#!/bin/bash -eu

(cd json2epub && wasm-pack build --target no-modules)
python3 user-script/generate.py "$@"
