"""Merge local safetensors shards without materializing model tensors in RAM."""
import argparse
import json
import pathlib
import shutil
import struct

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=pathlib.Path, help='Qwen transformer directory containing the two safetensors shards')
parser.add_argument('target', type=pathlib.Path, help='Destination .safetensors file (must not exist)')
args = parser.parse_args()
source, target = args.source, args.target
if target.exists():
    raise SystemExit(f'Target already exists: {target}')
header = {'__metadata__': {'format': 'pt'}}
shards = []
offset = 0
for shard in sorted(source.glob('diffusion_pytorch_model-*-of-*.safetensors')):
    with shard.open('rb') as f:
        header_length = struct.unpack('<Q', f.read(8))[0]
        entries = json.loads(f.read(header_length))
    data_size = shard.stat().st_size - 8 - header_length
    for key, value in entries.items():
        if key == '__metadata__':
            continue
        if key in header:
            raise ValueError(f'Duplicate tensor: {key}')
        value['data_offsets'] = [n + offset for n in value['data_offsets']]
        header[key] = value
    shards.append((shard, 8 + header_length, data_size))
    offset += data_size
if len(shards) != 2:
    raise ValueError('Expected two shards')
encoded = json.dumps(header, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 8)
temporary = target.with_suffix('.partial')
target.parent.mkdir(parents=True, exist_ok=True)
with temporary.open('xb') as out:
    out.write(struct.pack('<Q', len(encoded)))
    out.write(encoded)
    for shard, start, size in shards:
        print(f'Copying {shard.name}: {size} bytes', flush=True)
        with shard.open('rb') as f:
            f.seek(start)
            shutil.copyfileobj(f, out, 8 * 1024 * 1024)
if temporary.stat().st_size != 8 + len(encoded) + offset:
    raise ValueError('Merged size mismatch')
from safetensors import safe_open
with safe_open(str(temporary), framework='pt', device='cpu') as model:
    assert len(list(model.keys())) == len(header) - 1
temporary.rename(target)
print(f'Complete: {target} ({target.stat().st_size} bytes)', flush=True)
