@echo off

SETLOCAL ENABLEDELAYEDEXPANSION

SETLOCAL
cd json2epub || (EXIT /B !ERRORLEVEL!)
wasm-pack build --target no-modules || (EXIT /B !ERRORLEVEL!)
ENDLOCAL

python user-script/generate.py %* || (EXIT /B !ERRORLEVEL!)

ENDLOCAL
