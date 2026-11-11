// Builds data/neuralHologram.json for the hologram neural network landmark.
//
// Reads the trained weights of the neural-flows project and keeps only the strongest connections
// (largest |weight|) into each neuron, so the landmark ships a few KB instead of the 1.2 MB weights file.
//
// Usage (from the toy-car-lab folder):
//   node scripts/build-neural-hologram.mjs "C:\path\to\neural-flows\data\model_weights.json"

import fs from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("Pass the path to neural-flows' model_weights.json");
  process.exit(1);
}

const weights = JSON.parse(fs.readFileSync(src, "utf8"));
const KEEP = [10, 10, 12]; // strongest incoming connections kept per neuron, per layer hop

const conns = weights.layers.map((layer, l) => {
  const flat = []; // [source, target, source, target, ...]
  layer.weights.forEach((row, target) => {
    row
      .map((w, source) => [Math.abs(w), source])
      .sort((a, b) => b[0] - a[0])
      .slice(0, KEEP[l])
      .forEach(([, source]) => flat.push(source, target));
  });
  return flat;
});

const out = { architecture: weights.architecture, conns };
const dest = path.join(process.cwd(), "data", "neuralHologram.json");
fs.writeFileSync(dest, JSON.stringify(out));
console.log(
  `wrote ${dest}: ${weights.architecture.join(" > ")}, ` +
    `${conns.map((c) => c.length / 2).join(" + ")} connections`
);
