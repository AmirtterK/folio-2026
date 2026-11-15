/** Where the car starts (the grid on the main straight). Same point as TRACK_START in RacingTrack.tsx. */
export const CAR_START = { x: 30.15, z: 57.15 };

/**
 * Rotation about +y that turns a model whose front is local +z toward the car's starting position. This is what
 * the diploma's hard-coded 50 degrees stands for (it is 52 degrees from where the diploma stands).
 */
export const yawToStart = (x: number, z: number) => Math.atan2(CAR_START.x - x, CAR_START.z - z);

/** Project holograms - in front of the start line, off-road */
export const NEURAL_POS = {
  x: -18,
  z: 38,
};

/** Holographic chess knight - in front of the start line, off-road */
export const KNIGHT_POS = {
  x: -52,
  z: 28,
  yaw: Math.PI,
};

/*
 * Contact landmarks: spread out through the open infield next to the project holograms (the big empty area in the
 * south-west of the loop), at least ~17 units from the road, each one turned toward the car's start like the diploma.
 * (Gmail and LinkedIn used to stand on the road itself.)
 */

/** Ricoh printer (resume) */
export const PRINTER_POS = {
  x: -76,
  z: 20,
  yaw: yawToStart(-76, 20),
};

/** Gmail mailbox (email) */
export const GMAIL_POS = {
  x: -52,
  z: 6,
  yaw: yawToStart(-52, 6),
};

/** Diploma - in front of the start line, off-road */
export const DIPLOMA_POS = {
  x: 8,
  z: 40,
  rotY: 0,
};

/** LinkedIn logo */
export const LINKEDIN_POS = {
  x: -78,
  z: -12,
  yaw: yawToStart(-78, -12),
};

/**
 * Shakespeare statue (the "Shakespeare Says" project). He stands on the infield side of the barrier, a few steps west of
 * the street lamp at about (-23.3, 21.6): the lamp one step on from the lamp beside the neural hologram (4.9, 34.8), in the
 * direction away from the x = 37 lamp, toward the middle of the project area. The road is diagonal here, so his nearest
 * back corner is ~0.3 off the barrier (7.7 from the road's centre line) and the far end of the bench stands a little
 * clear of it. yaw = 0 keeps his front (+z) facing into the infield, which the inspect camera and the text offsets expect.
 */
export const SHAKESPEARE_POS = {
  x: -30,
  z: 16.45,
  yaw: 0,
};

/**
 * Chess (reference): key prompt relative to hologram/text anchor.
 * Chess anchor (HoloText group): [1.4, 0, 1.0], key prompt: [1.65, 1.95, -1.2]
 * Offset = key - anchor = [0.25, 1.95, -2.2], distance ~= 2.951.
 * Key/text prompts billboard to face the camera.
 */
export const KEY_PROMPT_OFFSET_FROM_HOLOGRAM = [0.25, 1.95, -2.2] as const;
