#!/usr/bin/env python3

from argparse import ArgumentParser
from base64 import b64encode
from os import path


def local_file_path(file_name):
    return path.join(path.dirname(__file__), file_name)


def pkg_file_path(file_name):
    return path.join(path.dirname(__file__), '..', 'json2epub', 'pkg', file_name)

def extract_gm_metadata(gm_script):
    lines = gm_script.splitlines()
    first_line = lines.index('// ==UserScript==')
    last_line = lines.index('// ==/UserScript==')
    return ''.join(f'{l}\n' for l in lines[first_line:last_line+1])

parser = ArgumentParser()
parser.add_argument('--publish', metavar='VERSION', required=False, help='Include extra metadata suitable for publishing the script to GitHub')
args = parser.parse_args()

with open(pkg_file_path('json2epub_bg.wasm'), 'rb') as f:
    wasm_data = f.read()
with open(pkg_file_path('json2epub.js'), 'r', encoding='ascii') as f:
    bindings_data = f.read()
with open(local_file_path('template.user.js'), 'r', encoding='utf-8') as f:
    template_script = f.read()

final_script = template_script
final_script = final_script.replace('/* <<<EMBED BINDINGS JS HERE>>> */', bindings_data)
final_script = final_script.replace('/* <<<EMBED BASE64 WASM MODULE HERE>>> */', b64encode(wasm_data).decode('ascii'))
if args.publish:
    ins_idx = final_script.index('\n', final_script.index('@description')) + 1
    final_script = (
        final_script[:ins_idx]
        + f'// @version      {args.publish}\n'
        + '// @updateURL    https://github.com/brokeh/fanfiction.net-downloader/releases/latest/download/fanfiction.net-download.meta.js\n'
        + '// @downloadURL  https://github.com/brokeh/fanfiction.net-downloader/releases/latest/download/fanfiction.net-download.user.js\n'
        + final_script[ins_idx:]
    )

output_file_name = local_file_path('fanfiction.net-download.user.js')
with open(output_file_name, 'w', encoding='utf-8') as f:
    f.write(final_script)
print(f'Successfully generated {output_file_name}')

output_file_name = local_file_path('fanfiction.net-download.meta.js')
with open(output_file_name, 'w', encoding='utf-8') as f:
    f.write(extract_gm_metadata(final_script))
print(f'Successfully generated {output_file_name}')
