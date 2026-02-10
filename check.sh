#!/bin/bash -eu

(
    cd json2epub &&
    cargo clippy -- -W clippy::all -W clippy::pedantic -W clippy::nursery -A clippy::missing_errors_doc -A clippy::missing_panics_doc -A clippy::single_call_fn
)

(
    cd json2epub-cli &&
    cargo clippy -- -W clippy::all -W clippy::pedantic -W clippy::nursery
)

pylint **/*.py
eslint user-script/template.user.js
