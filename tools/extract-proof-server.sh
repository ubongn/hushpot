#!/bin/bash
# Extract midnightntwrk/proof-server image rootfs via Docker Hub registry API (no docker engine required).
set -e
TAG="${1:-8.1.0}"
REPO="midnightntwrk/proof-server"
ROOTFS="/root/proof-rootfs"
ACCEPT="Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json"

TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REPO}:pull" | sed 's/.*"token":"\([^"]*\)".*/\1/')
echo "token: ${TOKEN:0:20}..."

MANIFEST=$(curl -s -H "Authorization: Bearer $TOKEN" -H "$ACCEPT" "https://registry-1.docker.io/v2/${REPO}/manifests/${TAG}")
echo "$MANIFEST" > /root/manifest-raw.json

# If manifest list/index, pick linux/amd64
if echo "$MANIFEST" | grep -q '"manifests"'; then
  DIGEST=$(echo "$MANIFEST" | python3 -c "
import json,sys
m=json.load(sys.stdin)
for e in m.get('manifests',[]):
    p=e.get('platform',{})
    if p.get('architecture')=='amd64' and p.get('os')=='linux':
        print(e['digest']); break
")
  echo "amd64 digest: $DIGEST"
  MANIFEST=$(curl -s -H "Authorization: Bearer $TOKEN" -H "$ACCEPT" "https://registry-1.docker.io/v2/${REPO}/manifests/${DIGEST}")
fi
echo "$MANIFEST" > /root/manifest.json

CONFIG=$(echo "$MANIFEST" | python3 -c "import json,sys; print(json.load(sys.stdin)['config']['digest'])")
curl -sL -H "Authorization: Bearer $TOKEN" "https://registry-1.docker.io/v2/${REPO}/blobs/${CONFIG}" > /root/image-config.json
python3 -c "
import json
c=json.load(open('/root/image-config.json'))['config']
print('Entrypoint:', c.get('Entrypoint'))
print('Cmd:', c.get('Cmd'))
print('Env:', c.get('Env'))
print('User:', c.get('User'))
print('WorkingDir:', c.get('WorkingDir'))
"

mkdir -p "$ROOTFS"
LAYER_COUNT=$(echo "$MANIFEST" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['layers']))")
echo "layers: $LAYER_COUNT"
i=0
for DIGEST in $(echo "$MANIFEST" | python3 -c "import json,sys; [print(l['digest']) for l in json.load(sys.stdin)['layers']]"); do
  i=$((i+1))
  echo "--- layer $i/$LAYER_COUNT: $DIGEST"
  curl -sL -H "Authorization: Bearer $TOKEN" "https://registry-1.docker.io/v2/${REPO}/blobs/${DIGEST}" -o /root/layer.tar.gz
  tar -xzf /root/layer.tar.gz -C "$ROOTFS" 2>/dev/null || tar -xf /root/layer.tar.gz -C "$ROOTFS"
done
rm -f /root/layer.tar.gz
echo "=== rootfs top ==="
ls "$ROOTFS"
echo "=== proof binary candidates ==="
find "$ROOTFS" -type f \( -name '*proof*' -o -name 'midnight*' \) 2>/dev/null | head -20
