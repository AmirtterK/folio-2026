/** Project holograms - in the middle off-road area like contacts */
export const NEURAL_POS = {
  x: 22,
  z: 35,
};

/** Holographic chess knight - in the middle off-road area like contacts */
export const KNIGHT_POS = {
  x: 38,
  z: 35,
  yaw: Math.PI,
};

/** Ricoh printer (resume) - in a row near the robot arm, off the track */
export const PRINTER_POS = {
  x: -34,
  z: 35,
};

/** Gmail mailbox (email) - in a row near the robot arm, off the track */
export const GMAIL_POS = {
  x: -14,
  z: 35,
};

/** Diploma - in the middle off-road area near other landmarks */
export const DIPLOMA_POS = {
  x: 54,
  z: 35,
  rotY: 0,
};

/** LinkedIn logo - in a row near the robot arm, off the track */
export const LINKEDIN_POS = {
  x: 6,
  z: 35,
};

/**
 * Chess (reference): key prompt relative to hologram/text anchor.
 * Chess anchor (HoloText group): [1.4, 0, 1.0], key prompt: [1.65, 1.95, -1.2]
 * Offset = key - anchor = [0.25, 1.95, -2.2], distance ~= 2.951.
 * Key/text prompts billboard to face the camera.
 */
export const KEY_PROMPT_OFFSET_FROM_HOLOGRAM = [0.25, 1.95, -2.2] as const;
