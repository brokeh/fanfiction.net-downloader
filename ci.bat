SETLOCAL ENABLEDELAYEDEXPANSION

SETLOCAL
cd json2epub || (EXIT /B !ERRORLEVEL!)
cargo clippy -- -W clippy::all -W clippy::pedantic -W clippy::nursery -A clippy::missing_errors_doc -A clippy::missing_panics_doc -A clippy::single_call_fn || (EXIT /B !ERRORLEVEL!)
ENDLOCAL

SETLOCAL
cd json2epub-cli || (EXIT /B !ERRORLEVEL!)
cargo clippy -- -W clippy::all -W clippy::pedantic -W clippy::nursery || (EXIT /B !ERRORLEVEL!)
ENDLOCAL

docker compose run --rm dev eslint user-script/template.user.js
