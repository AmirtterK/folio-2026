"""Extracts the road / paving / railing / cone from stylized_neon_japanese_city.glb into small web assets.
usage: python scripts/build-track-assets.py <glb>
"""
import json, struct, sys, io, os
import numpy as np
from PIL import Image, ImageFilter

src = sys.argv[1]
f = open(src, "rb").read()
l = struct.unpack("<I", f[12:16])[0]
j = json.loads(f[20:20 + l])
bin_ = f[20 + l + 8:]
OUT_PUB = "public/models/track"
OUT_JSON = "components/trackAssets"

def acc(i):
    a = j["accessors"][i]; bv = j["bufferViews"][a["bufferView"]]
    ct = {5126: "f4", 5123: "u2", 5125: "u4"}[a["componentType"]]
    n = {"SCALAR": 1, "VEC3": 3, "VEC2": 2}[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    arr = np.frombuffer(bin_, dtype=ct, count=a["count"] * n, offset=off)
    return arr.reshape(-1, n) if n > 1 else arr

names = {n.get("name"): i for i, n in enumerate(j["nodes"])}
def prim(name):
    return j["meshes"][j["nodes"][names[name]]["mesh"]]["primitives"][0]

def image(mat_name):
    m = [x for x in j["materials"] if x.get("name") == mat_name][0]
    t = m["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    img = j["images"][j["textures"][t]["source"]]
    bv = j["bufferViews"][img["bufferView"]]
    return Image.open(io.BytesIO(bin_[bv["byteOffset"]:bv["byteOffset"] + bv["byteLength"]])).convert("RGB")

def r(a, d=4):
    return [round(float(x), d) for x in np.asarray(a).reshape(-1)]

# ---------- paving (the ground) ----------
paving = image("Material.015")
paving.save(f"{OUT_PUB}/paving.jpg", quality=80, optimize=True)

# ---------- road: asphalt + white edge lines + dashed centre line ----------
ROAD_W, PERIOD = 14.0, 9.4          # world units across the road / along one texture repeat
asph = image("Material.020")        # one tile covers ~9.4 x 9.4 units
ppu = asph.size[0] / PERIOD         # pixels per unit (isotropic) while composing
W = asph.size[0]; H = int(round(ROAD_W * ppu))
canvas = Image.new("RGB", (W, H))
for y in range(0, H, asph.size[1]):
    canvas.paste(asph, (0, y))
px = np.asarray(canvas).astype(np.float32)
def paint(x0u, x1u, y0u, y1u, col=(236, 236, 232)):
    xa, xb = int(round(x0u * ppu)), int(round(x1u * ppu))
    ya, yb = int(round(y0u * ppu)), int(round(y1u * ppu))
    rng = np.random.default_rng(7)
    noise = 1 - 0.10 * rng.random((yb - ya, xb - xa, 1))      # slightly worn paint
    px[ya:yb, xa:xb] = px[ya:yb, xa:xb] * 0.08 + np.array(col) * noise * 0.92
paint(0, PERIOD, 0.30, 0.60)                       # edge line
paint(0, PERIOD, ROAD_W - 0.60, ROAD_W - 0.30)     # edge line
for d0 in (0.6, 5.3):                              # centre dashes (2 per repeat)
    paint(d0, d0 + 2.2, ROAD_W / 2 - 0.15, ROAD_W / 2 + 0.15)
road = Image.fromarray(np.clip(px, 0, 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS)
road.save(f"{OUT_PUB}/road.jpg", quality=82, optimize=True)

# ---------- railing: one module of 4 post spacings ----------
p = prim("Object_184")
P = acc(p["attributes"]["POSITION"]).astype(np.float64)
N = acc(p["attributes"]["NORMAL"]).astype(np.float64)
I = acc(p["indices"]).reshape(-1, 3).astype(int)
SP = 1.35
tops = np.unique(np.round(P[P[:, 1] > 1.1][:, 0], 2))
a = tops[0] + 8 * SP - SP / 2
cx = P[I][:, :, 0].mean(1)
keep = (cx >= a) & (cx < a + 4 * SP)
tri = I[keep]
used = np.unique(tri)
remap = {int(o): k for k, o in enumerate(used)}
pos = P[used].copy(); nor = N[used]
pos[:, 0] -= a + 2 * SP
pos[:, 1] -= P[:, 1].min()
pos[:, 2] -= (P[:, 2].min() + P[:, 2].max()) / 2
idx = [remap[int(v)] for v in tri.reshape(-1)]
json.dump({"length": 4 * SP, "height": float(pos[:, 1].max()), "positions": r(pos), "normals": r(nor, 3), "indices": idx},
          open(f"{OUT_JSON}/rail.json", "w"))
print("rail module verts", len(used), "tris", len(tri), "length", 4 * SP)

# ---------- traffic cone (red body + white band) ----------
parts = {}
cone_pos = []
for key, name in (("body", "Object_18"), ("band", "Object_19")):
    q = prim(name)
    Q = acc(q["attributes"]["POSITION"]).astype(np.float64)
    parts[key] = (Q, acc(q["attributes"]["NORMAL"]).astype(np.float64), acc(q["indices"]).astype(int))
allp = np.concatenate([v[0] for v in parts.values()])
cxz = (allp.min(0) + allp.max(0)) / 2
out = {}
for key, (Q, Nn, Ii) in parts.items():
    Q = Q.copy(); Q[:, 0] -= cxz[0]; Q[:, 2] -= cxz[2]; Q[:, 1] -= allp[:, 1].min()
    out[key] = {"positions": r(Q), "normals": r(Nn, 3), "indices": [int(v) for v in Ii]}
out["height"] = float(allp[:, 1].max() - allp[:, 1].min())
out["radius"] = float(max(allp[:, 0].max() - allp[:, 0].min(), allp[:, 2].max() - allp[:, 2].min()) / 2)
json.dump(out, open(f"{OUT_JSON}/cone.json", "w"))
print("cone height", out["height"], "radius", out["radius"])
print("done")
