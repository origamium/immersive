"""Compare the preserved avcon getter definitions without importing its code."""
import ast
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = root / '.local/avcon-original/python/client.py'
if not source.is_file():
    raise SystemExit('Private avcon preservation is required: .local/avcon-original/python/client.py')
original = []
for node in ast.walk(ast.parse(source.read_text())):
    if isinstance(node, ast.FunctionDef) and node.name.startswith('get_'):
        for call in ast.walk(node):
            if (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                    and call.func.attr in ('_post_simple', '_post_param')):
                original.append({
                    'method': node.name,
                    'command': ast.literal_eval(call.args[0]),
                    'extended': call.func.attr == '_post_param',
                    'parameters': ast.literal_eval(call.args[1]) if len(call.args) > 1 else [],
                })
current = json.loads((root / 'native/Sources/DenonControl/Resources/catalog.json').read_text())['commands']
by_method = lambda item: item['method']
if sorted(original, key=by_method) != sorted(current, key=by_method):
    raise SystemExit('FAIL: getter catalog differs from preserved avcon implementation')
print(f'PASS: {len(original)} getter commands, parameters and endpoint families match avcon')
